import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-workbench-jobs-'));
process.env.USERPROFILE = tempHome;
process.env.HOME = tempHome;
process.env.DSH_WORKBENCH_WORKER_MAX_RETRIES = '0';

const routes = new Map();
const listeners = new Map();
const jobRecords = new Map();
let jobCounter = 0;
let runCounter = 0;

const plan = {
  title: 'Job Panel 接入测试',
  summary: '验证官方任务生命周期。',
  strategy: '单代理执行后由主代理汇总。',
  maxParallel: 1,
  mainAgent: { name: '汇总代理', role: '主代理', mission: '汇总结果' },
  workers: [{ id: 'worker', name: '执行代理', role: '研究员', task: '完成测试任务', dependsOn: [], acceptance: '返回结果' }],
  acceptanceCriteria: ['任务进入官方 Job Panel']
};

function emit(name, value) {
  for (const listener of listeners.get(name) || []) listener(value);
}

const rootAgent = {
  id: 'session-jobs',
  options: { provider: 'test-provider', model: 'test-model' },
  session: { header: { id: 'session-jobs', cwd: 'D:\\jobs-demo' } }
};

const jobs = {
  attachController(name) {
    assert.equal(name, 'dsh-workbench');
    return () => {};
  },
  start(spec) {
    assert.equal(spec.kind, 'orchestration');
    assert.equal(spec.owner, rootAgent);
    const id = `orchestration-${++jobCounter}`;
    const hooks = spec.run();
    const record = { id, spec, hooks, status: 'running', detail: '', output: '' };
    jobRecords.set(id, record);
    hooks.done.then((outcome) => Object.assign(record, outcome));
    return id;
  },
  kill(id, caller, reason) {
    const record = jobRecords.get(id);
    assert(record);
    assert.equal(caller, rootAgent);
    record.status = 'stopping';
    record.hooks.cancel(reason);
    return 'requested';
  }
};

const subagents = {
  list: () => ['spawn'],
  getProvider: () => undefined,
  start: async (_kind, options) => {
    const id = `run-${++runCounter}`;
    let timer;
    let settled = false;
    const result = new Promise((resolve) => {
      const finish = (stopReason, text = '') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stopReason, output: text ? [{ type: 'text', text }] : [] });
      };
      timer = setTimeout(() => finish('completed', options.label === '汇总代理' ? '官方任务最终汇总' : '子代理结果'), 80);
      options.signal.addEventListener('abort', () => finish('aborted'), { once: true });
    });
    return {
      id,
      localAgent: { options: rootAgent.options },
      result,
      dispose: async () => { clearTimeout(timer); }
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
      callback({ subagents, agents: { get: (id) => id === rootAgent.id ? rootAgent : undefined, roots: () => [rootAgent] } });
    } else if (names.length === 1 && names[0] === 'jobs') {
      callback({ jobs });
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
  return call('/api/dsh-workbench/tasks/list', 'GET', undefined, '?scope=all&projectPath=D%3A%5Cjobs-demo');
}

async function waitRecord(id, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = (await listAll()).orchestrations.find((item) => item.id === id);
    if (record && predicate(record)) return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('orchestration condition timed out');
}

async function createPlanned(idea) {
  const created = await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_create', scope: 'all', projectPath: 'D:\\jobs-demo', sourceSessionId: rootAgent.id, idea
  });
  const id = created.orchestrations.find((item) => item.idea === idea).id;
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_plan', scope: 'all', projectPath: 'D:\\jobs-demo', id });
  await waitRecord(id, (record) => record.phase === 'planned');
  return id;
}

try {
  const { apply } = await import('../lib/host/index.js?' + Date.now());
  apply(ctx);

  const completedId = await createPlanned('验证官方 Job Panel 完成态');
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_start', scope: 'all', projectPath: 'D:\\jobs-demo', id: completedId });
  const completed = await waitRecord(completedId, (record) => record.phase === 'review' && record.jobId);
  const completedJob = jobRecords.get(completed.jobId);
  await completedJob.hooks.done;
  assert.equal(completedJob.status, 'completed');
  assert.match(completedJob.output, /官方任务最终汇总/);
  assert.match(completedJob.spec.label, /^AI 协作 · /);
  const completedWithJobLog = await waitRecord(completedId, (record) => record.log.some((entry) => entry.text.includes('官方 Job Panel')));
  assert(completedWithJobLog.log.some((entry) => entry.text.includes('官方 Job Panel')));

  const killedId = await createPlanned('验证 Job Panel 停止任务');
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_start', scope: 'all', projectPath: 'D:\\jobs-demo', id: killedId });
  const running = await waitRecord(killedId, (record) => record.phase === 'running' && record.jobId);
  jobs.kill(running.jobId, rootAgent, 'smoke stop');
  const killed = await waitRecord(killedId, (record) => record.phase === 'cancelled');
  const killedJob = jobRecords.get(running.jobId);
  await killedJob.hooks.done;
  assert.equal(killedJob.status, 'killed');
  assert.match(killed.runtimeError, /smoke stop|终止|abort/i);

  console.log('orchestration jobs smoke test passed');
} finally {
  emit('dispose');
  await rm(tempHome, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 });
}
