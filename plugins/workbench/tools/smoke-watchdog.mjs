import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-workbench-watchdog-'));
process.env.USERPROFILE = tempHome;
process.env.HOME = tempHome;
process.env.DSH_WORKBENCH_WORKER_TIMEOUT_MS = '40';
process.env.DSH_WORKBENCH_WORKER_MAX_RETRIES = '2';

const routes = new Map();
const llmCalls = [];
const spawnCalls = [];
const plan = {
  title: '看门狗测试',
  summary: '单子代理验证超时重试与需人工介入。',
  strategy: '一个子代理直接执行。',
  maxParallel: 1,
  mainAgent: { name: '汇总代理', role: '主代理', mission: '汇总结果' },
  workers: [
    { name: '慢执行代理', role: '执行者', task: '永远不返回，触发超时', dependsOn: [], acceptance: '不适用' }
  ],
  acceptanceCriteria: ['触发看门狗路径']
};

const ctx = {
  inject(names, callback) {
    if (names.includes('webServer')) {
      callback({
        webServer: { register(route) { routes.set(route.path, route); return () => {}; } },
        llm: {
          listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }],
          listModels: async () => [{ provider: 'test-provider', id: 'test-model', name: 'Test Model' }],
          async *stream(options) {
            const messageText = Array.isArray(options && options.messages) && options.messages[0] && Array.isArray(options.messages[0].content)
              ? options.messages[0].content.map((block) => block && block.text || '').join('')
              : '';
            llmCalls.push({ system: String(options && options.system || ''), prompt: messageText });
            yield { type: 'text-delta', text: JSON.stringify(plan) };
          }
        }
      });
    } else if (names.includes('subagents')) {
      callback({
        subagents: {
          list: () => ['spawn', 'fork'],
          start: async (kind, options) => {
            spawnCalls.push(options.label);
            return {
              id: 'run-' + options.label + '-' + spawnCalls.length,
              localAgent: { options: {} },
              // Never resolves: the watchdog timeout must reject and trigger a retry.
              result: new Promise(() => {}),
              dispose: async () => {}
            };
          }
        },
        agents: { get: (id) => ({ id: id || 'session-1', session: { header: { cwd: 'D:\\demo' } } }), roots: () => [] }
      });
    } else if (names.includes('commands')) {
      callback({ commands: { register: () => [] }, sessionProjections: {} });
    }
  },
  on() {}
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
  const res = {
    writeHead(code) { status = code; },
    end(value) { text += value || ''; }
  };
  await route.handler(request(method, path + query, body), res);
  const data = JSON.parse(text);
  assert.equal(status, 200, JSON.stringify(data));
  return data;
}

async function listAll() {
  return call('/api/dsh-workbench/tasks/list', 'GET', undefined, '?scope=all&projectPath=D%3A%5Cdemo');
}

async function waitPhase(id, phases, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await listAll();
    const rec = snap.orchestrations.find((item) => item.id === id);
    if (rec && phases.includes(rec.phase)) return rec;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('orchestration did not reach ' + phases.join('/'));
}

try {
  const { apply } = await import('../lib/host/index.js?' + Date.now());
  apply(ctx);

  // --- quick-mode flag round trip + planner instruction ---
  await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_create', scope: 'all', projectPath: 'D:\\demo',
    sourceSessionId: 'session-1', idea: '今天上海天气如何？', quick: true
  });
  let created = (await listAll()).orchestrations[0];
  assert.equal(created.quick, true, 'quick flag should persist on creation');
  await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_plan', scope: 'all', projectPath: 'D:\\demo', id: created.id
  });
  await waitPhase(created.id, ['planned', 'failed']);
  assert.ok(llmCalls.length >= 1, 'planner should have been invoked');
  assert.ok(llmCalls[0].system.includes('快速问答模式'), 'quick mode should inject planner instruction');
  assert.ok(llmCalls[0].system.includes('直接回答'), 'quick mode instruction should mention direct answer');
  await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_remove', scope: 'all', projectPath: 'D:\\demo', id: created.id
  });

  // --- watchdog: worker times out, retries twice, then needs-human failure ---
  await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_create', scope: 'all', projectPath: 'D:\\demo',
    sourceSessionId: 'session-1', idea: '触发看门狗'
  });
  created = (await listAll()).orchestrations[0];
  assert.equal(created.quick, false);
  const id = created.id;
  await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_plan', scope: 'all', projectPath: 'D:\\demo', id
  });
  const planned = await waitPhase(id, ['planned', 'failed']);
  assert.equal(planned.phase, 'planned');
  await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_start', scope: 'all', projectPath: 'D:\\demo', id
  });
  const terminal = await waitPhase(id, ['review', 'failed', 'cancelled'], 12000);
  assert.equal(terminal.phase, 'failed');
  assert.ok(String(terminal.runtimeError).includes('需要人工介入'), 'all-failed run should ask for human intervention');
  assert.equal(spawnCalls.length, 3, 'worker should be spawned 1 + 2 retries');
  const worker = terminal.workers[0];
  assert.equal(worker.status, 'failed');
  assert.equal(worker.attempts, 3, 'worker attempts should record 3 tries');
  assert.ok(String(worker.error).includes('超时'), 'worker error should mention timeout');
  assert.ok(Array.isArray(terminal.log), 'orchestration should have execution logs');
  assert.ok(terminal.log.some((entry) => entry.level === 'warn' && entry.text.includes('重试')), 'log should record retries');
  assert.ok(terminal.log.some((entry) => entry.level === 'error' && entry.text.includes('需要人工介入')), 'log should record needs-human intervention');
  console.log('watchdog smoke test passed');
} finally {
  await rm(tempHome, { recursive: true, force: true });
}
