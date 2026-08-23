import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-workbench-failover-'));
process.env.USERPROFILE = tempHome;
process.env.HOME = tempHome;

const routes = new Map();
const calls = new Map();
const plan = {
  title: '失败自动换模型',
  summary: '验证失败后自动切换模型重跑',
  strategy: '并行执行。',
  maxParallel: 2,
  mainAgent: { name: '交付负责人', role: '主代理', mission: '汇总', rationale: '汇总' },
  workers: [
    { name: '体验检查员', role: 'UX', task: '检查登录体验', dependsOn: [], acceptance: '给出证据' },
    { name: '安全检查员', role: 'Security', task: '检查登录风险', dependsOn: [], acceptance: '给出证据' }
  ],
  acceptanceCriteria: ['有证据']
};

const ctx = {
  inject(names, callback) {
    if (names.includes('webServer')) {
      callback({
        webServer: { register(route) { routes.set(route.path, route); return () => {}; } },
        llm: {
          listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }],
          listModels: async () => [{ provider: 'test-provider', id: 'test-model', name: 'Test Model' }],
          async *stream() { yield { type: 'text-delta', text: JSON.stringify(plan) }; }
        }
      });
    } else if (names.includes('subagents')) {
      callback({
        subagents: {
          list: () => ['spawn'],
          start: async (kind, options) => {
            const label = String(options.label || '');
            const count = (calls.get(label) || 0) + 1;
            calls.set(label, count);
            const hasModel = !!(options.agentOptions && options.agentOptions.model);
            if (label === '体验检查员' && count === 1 && !hasModel) {
              return {
                id: 'run-' + label + '-' + count,
                localAgent: { options: {} },
                result: Promise.resolve({ output: [{ type: 'text', text: '' }], stopReason: 'error', error: { message: '上游 502', code: 'upstream_error' } }),
                dispose: async () => {}
              };
            }
            return {
              id: 'run-' + label + '-' + count,
              localAgent: { options: options.agentOptions || {} },
              result: Promise.resolve({ output: [{ type: 'text', text: label + ' 完成：已提供证据。' }], stopReason: 'completed' }),
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

try {
  const { apply } = await import('../lib/host/index.js?' + Date.now());
  apply(ctx);
  await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_create', scope: 'all', projectPath: 'D:\\demo', sourceSessionId: 'session-1', idea: '检查登录流程是否安全'
  });
  const created = await call('/api/dsh-workbench/tasks/list', 'GET', undefined, '?scope=all&projectPath=D%3A%5Cdemo');
  const id = created.orchestrations[0].id;
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_plan', scope: 'all', projectPath: 'D:\\demo', id, modelPolicy: 'balanced' });
  let planned = null;
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const snap = await call('/api/dsh-workbench/tasks/list', 'GET', undefined, '?scope=all&projectPath=D%3A%5Cdemo');
    if (snap.orchestrations[0] && snap.orchestrations[0].phase === 'planned') { planned = snap.orchestrations[0]; break; }
  }
  assert(planned, 'plan should complete');
  assert.equal(planned.workers[0].provider, '', 'worker should start without explicit model (inherit)');
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_start', scope: 'all', projectPath: 'D:\\demo', id, sourceSessionId: 'session-1' });
  let terminal = null;
  for (let i = 0; i < 120; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const snap = await call('/api/dsh-workbench/tasks/list', 'GET', undefined, '?scope=all&projectPath=D%3A%5Cdemo');
    const rec = snap.orchestrations[0];
    if (rec.phase === 'review' || rec.phase === 'failed' || rec.phase === 'cancelled') { terminal = rec; break; }
  }
  assert(terminal, 'orchestration should reach terminal state');
  assert.equal(terminal.phase, 'review', 'failover should let the failed worker recover');
  const failedWorker = terminal.workers.find((worker) => worker.name === '体验检查员');
  assert.equal(failedWorker.status, 'completed');
  assert.equal(failedWorker.usedModel, 'test-model', 'worker should have been retried with failover model');
  assert.ok(String(failedWorker.modelReason || '').includes('自动切换'), 'modelReason should record failover');
  assert.ok((terminal.log || []).some((entry) => String(entry.text).includes('自动切换模型')), 'log should record automatic model switch');
  console.log('worker failover smoke test passed');
} finally {
  await rm(tempHome, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 });
}
