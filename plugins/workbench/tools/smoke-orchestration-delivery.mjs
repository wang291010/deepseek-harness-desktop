import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-workbench-delivery-'));
process.env.USERPROFILE = tempHome;
process.env.HOME = tempHome;
process.env.DSH_WORKBENCH_WORKER_MAX_RETRIES = '0';

const routes = new Map();
const listeners = new Map();
const childAgents = new Map();
const timeline = [];
const continuableCalls = [];
let foregroundCalls = 0;

const plan = {
  title: '异步回传测试',
  summary: '验证快任务完成后立刻释放并行槽位。',
  strategy: '快慢任务并行，依赖快任务的第三项应提前启动。',
  maxParallel: 2,
  mainAgent: { name: '汇总代理', role: '主代理', mission: '汇总三个结果' },
  workers: [
    { id: 'fast', name: '快速代理', role: '研究员', task: '快速完成', dependsOn: [], acceptance: '返回快速结果' },
    { id: 'slow', name: '慢速代理', role: '研究员', task: '较慢完成', dependsOn: [], acceptance: '返回慢速结果' },
    { id: 'dependent', name: '依赖代理', role: '复核员', task: '复核快速结果', dependsOn: ['fast'], acceptance: '返回复核结果' }
  ],
  acceptanceCriteria: ['三个结果均完成']
};

function emit(name, value) {
  for (const listener of listeners.get(name) || []) listener(value);
}

const rootAgent = {
  id: 'session-1',
  options: { provider: 'test-provider', model: 'test-model' },
  session: { header: { id: 'session-1', cwd: 'D:\\demo' } }
};

const subagents = {
  list: () => ['spawn', 'fork'],
  getProvider: (name) => name === 'spawn' ? { name: 'spawn', prepareContinuable() {} } : undefined,
  startContinuable: async (spec) => {
    const label = spec.label;
    // Keep the slow branch comfortably beyond Windows temp-store rename jitter so this
    // checks dynamic slot release, not whether the host finished several atomic writes in 145ms.
    const delay = label === '慢速代理' ? 600 : (label === '快速代理' ? 35 : 20);
    continuableCalls.push({ childId: spec.childId, label });
    timeline.push({ type: 'start', label, at: Date.now() });
    childAgents.set(spec.childId, {
      id: spec.childId,
      options: spec.request.agentOptions || rootAgent.options,
      session: { header: { id: spec.childId, cwd: 'D:\\demo', parentSession: rootAgent.id } }
    });
    setTimeout(() => {
      timeline.push({ type: 'end', label, at: Date.now() });
      childAgents.delete(spec.childId);
      emit('subagent/end', {
        id: spec.childId,
        provider: 'spawn',
        runId: 'run-' + spec.childId,
        local: true,
        stopReason: 'completed',
        lastAssistantMessage: [{ type: 'text', text: label + '结果' }]
      });
    }, delay);
    return { childId: spec.childId, messageId: 'message-' + spec.childId };
  },
  drainContinuableChildren: async () => {},
  start: async (_kind, options) => {
    foregroundCalls += 1;
    return {
      id: 'main-run-' + foregroundCalls,
      localAgent: { options: options.agentOptions || rootAgent.options },
      result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '最终汇总' }] }),
      dispose: async () => {}
    };
  }
};

const ctx = {
  inject(names, callback) {
    if (names.includes('webServer')) {
      callback({
        webServer: { register(route) { routes.set(route.path, route); return () => {}; } },
        workspaceRegistry: {},
        llm: {
          listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }],
          listModels: async () => [{ provider: 'test-provider', id: 'test-model', name: 'Test Model' }],
          async *stream() { yield { type: 'text-delta', text: JSON.stringify(plan) }; }
        }
      });
    } else if (names.includes('subagents')) {
      callback({
        subagents,
        agents: {
          get: (id) => id === rootAgent.id ? rootAgent : childAgents.get(id),
          roots: () => [rootAgent]
        }
      });
    } else if (names.includes('commands')) {
      callback({ commands: { register: () => [] }, sessionProjections: {} });
    }
  },
  on(name, callback) {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(callback);
    return () => listeners.set(name, (listeners.get(name) || []).filter((entry) => entry !== callback));
  }
};

function request(method, url, body) {
  const req = new PassThrough();
  req.method = method;
  req.url = url;
  req.socket = { remoteAddress: '127.0.0.1' };
  req.headers = { host: '127.0.0.1:9999' };
  queueMicrotask(() => req.end(body === undefined ? '' : JSON.stringify(body)));
  return req;
}

async function call(path, method, body, query = '') {
  const route = routes.get(path);
  assert(route, `route missing: ${path}`);
  let status = 0;
  let text = '';
  const res = { writeHead(code) { status = code; }, end(value) { text += value || ''; } };
  await route.handler(request(method, path + query, body), res);
  const data = JSON.parse(text);
  assert.equal(status, 200, JSON.stringify(data));
  return data;
}

async function listAll() {
  return call('/api/dsh-workbench/tasks/list', 'GET', undefined, '?scope=all&projectPath=D%3A%5Cdemo');
}

async function waitPhase(id, phases, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = (await listAll()).orchestrations.find((item) => item.id === id);
    if (record && phases.includes(record.phase)) return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('orchestration did not reach ' + phases.join('/'));
}

try {
  const { apply } = await import('../lib/host/index.js?' + Date.now());
  apply(ctx);
  const createdResponse = await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_create', scope: 'all', projectPath: 'D:\\demo',
    sourceSessionId: rootAgent.id, idea: '验证异步回传与动态并行调度'
  });
  const id = createdResponse.orchestrations.find((item) => item.idea === '验证异步回传与动态并行调度').id;
  await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_plan', scope: 'all', projectPath: 'D:\\demo', id
  });
  assert.equal((await waitPhase(id, ['planned', 'failed'])).phase, 'planned');
  await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_start', scope: 'all', projectPath: 'D:\\demo', id
  });
  const terminal = await waitPhase(id, ['review', 'failed'], 8000);
  assert.equal(terminal.phase, 'review');
  assert.equal(continuableCalls.length, 3, 'all workers should use startContinuable');
  assert.equal(foregroundCalls, 1, 'only the final coordinator should use one-shot spawn');
  const dependentStart = timeline.find((entry) => entry.type === 'start' && entry.label === '依赖代理');
  const slowEnd = timeline.find((entry) => entry.type === 'end' && entry.label === '慢速代理');
  assert(dependentStart && slowEnd);
  assert.ok(dependentStart.at < slowEnd.at, 'dependent worker should start before unrelated slow worker ends');
  assert.ok(terminal.workers.every((worker) => worker.deliveryMode === 'continuable'));
  assert.ok(terminal.workers.every((worker) => worker.deliveredAt), 'delivery timestamps should be persisted');
  assert.ok(terminal.log.some((entry) => entry.text.includes('官方异步回传通道')));
  console.log('orchestration delivery smoke test passed');
} finally {
  emit('dispose');
  await rm(tempHome, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 });
}
