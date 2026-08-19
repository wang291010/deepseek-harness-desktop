import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-workbench-memory-'));
process.env.USERPROFILE = tempHome;
process.env.HOME = tempHome;
process.env.DSH_WORKBENCH_WORKER_TIMEOUT_MS = '3000';

const routes = new Map();
const llmCalls = [];
const plan = {
  title: '记忆测试任务',
  summary: '执行并生成记忆。',
  strategy: '单子代理。',
  maxParallel: 1,
  mainAgent: { name: '汇总代理', role: '主代理', mission: '汇总' },
  workers: [{ name: '执行者', role: '执行', task: '完成一件事', dependsOn: [], acceptance: '有结论' }],
  acceptanceCriteria: ['完成']
};
const snapshotJson = JSON.stringify({
  summary: '完成了记忆测试任务并验证快照机制。',
  findings: ['快照包含关键发现A', '快照包含关键发现B'],
  decisions: ['采用摘要存储方案'],
  pending: ['补充跨会话实测']
});

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
            yield { type: 'text-delta', text: String(options && options.system || '').includes('记忆快照') ? snapshotJson : JSON.stringify(plan) };
          }
        }
      });
    } else if (names.includes('subagents')) {
      callback({
        subagents: {
          list: () => ['spawn', 'fork'],
          start: async (kind, options) => ({
            id: 'run-' + options.label,
            localAgent: { options: {} },
            result: Promise.resolve({ output: [{ type: 'text', text: options.label + ' 完成' }], stopReason: 'completed' }),
            dispose: async () => {}
          })
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
  const res = { writeHead(code) { status = code; }, end(value) { text += value || ''; } };
  await route.handler(request(method, path + query, body), res);
  const data = text ? JSON.parse(text) : {};
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

  // run a small orchestration to review
  await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_create', scope: 'all', projectPath: 'D:\\demo', sourceSessionId: 'session-1', idea: '执行记忆测试'
  });
  const id = (await listAll()).orchestrations[0].id;
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_plan', scope: 'all', projectPath: 'D:\\demo', id });
  await waitPhase(id, ['planned', 'failed']);
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_start', scope: 'all', projectPath: 'D:\\demo', id });
  await waitPhase(id, ['review', 'failed', 'cancelled'], 12000);

  // reject generation before a task ends
  const early = await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_create', scope: 'all', projectPath: 'D:\\demo', sourceSessionId: 'session-1', idea: '未结束任务'
  });
  const earlyId = (await listAll()).orchestrations.find((item) => item.idea === '未结束任务').id;
  const notReadyRoute = routes.get('/api/dsh-workbench/memory/generate');
  let earlyStatus = 0;
  const earlyRes = { writeHead(code) { earlyStatus = code; }, end() {} };
  await notReadyRoute.handler(request('POST', '/api/dsh-workbench/memory/generate', { orchestrationId: earlyId }), earlyRes);
  assert.equal(earlyStatus, 400, 'generation for unfinished task should be rejected');
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_remove', scope: 'all', projectPath: 'D:\\demo', id: earlyId });

  // generate snapshot from the completed orchestration
  const generated = await call('/api/dsh-workbench/memory/generate', 'POST', { orchestrationId: id });
  assert.ok(generated.snapshot.id, 'snapshot should have an id');
  assert.ok(generated.snapshot.summary.includes('记忆测试任务'), 'snapshot summary should be generated: ' + generated.snapshot.summary);
  assert.equal(generated.snapshot.findings.length, 2);
  assert.equal(generated.snapshot.decisions.length, 1);
  const memory = await call('/api/dsh-workbench/memory/list', 'GET');
  assert.equal(memory.snapshots.length, 1);
  assert.ok(memory.snapshots[0].sourceOrchestrationId === id);
  const snapshotId = generated.snapshot.id;

  // load memory into a new orchestration: plan prompt carries the snapshot
  await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_create', scope: 'all', projectPath: 'D:\\demo', sourceSessionId: 'session-1',
    idea: '基于记忆继续工作', memoryTokens: [snapshotId, 'not-a-real-token']
  });
  const second = (await listAll()).orchestrations.find((item) => item.idea === '基于记忆继续工作');
  assert.equal(second.memory.length, 1, 'invalid memory tokens should be ignored');
  assert.ok(second.memory[0].summary.includes('记忆测试任务'));
  const secondId = second.id;
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_plan', scope: 'all', projectPath: 'D:\\demo', id: secondId });
  await waitPhase(secondId, ['planned', 'failed']);
  assert.ok(llmCalls.some((entry) => entry.prompt.includes('记忆快照（跨会话上下文')), 'plan prompt should carry memory snapshot section');
  assert.ok(llmCalls.some((entry) => entry.prompt.includes('完成了记忆测试任务')), 'plan prompt should include snapshot summary');
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_remove', scope: 'all', projectPath: 'D:\\demo', id: secondId });

  // remove snapshot
  await call('/api/dsh-workbench/memory/remove', 'POST', { id: snapshotId });
  const afterRemove = await call('/api/dsh-workbench/memory/list', 'GET');
  assert.equal(afterRemove.snapshots.length, 0);
  console.log('memory smoke test passed');
} finally {
  await rm(tempHome, { recursive: true, force: true });
}
