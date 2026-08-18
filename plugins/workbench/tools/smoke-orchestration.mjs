import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-workbench-orchestration-'));
process.env.USERPROFILE = tempHome;
process.env.HOME = tempHome;

const routes = new Map();
const agentPrompts = [];
const plan = {
  title: '检查登录体验',
  summary: '由体验与安全两个子代理分别检查，主代理汇总。',
  strategy: '并行检查后统一汇总。',
  maxParallel: 2,
  mainAgent: { name: '交付负责人', role: '主代理', mission: '汇总并进行质量控制', rationale: '需要统一权衡体验与安全' },
  workers: [
    { name: '体验检查员', role: 'UX', task: '检查登录流程体验', dependsOn: [], acceptance: '列出证据和建议' },
    { name: '安全检查员', role: 'Security', task: '检查登录流程风险', dependsOn: [], acceptance: '列出风险和验证方式' }
  ],
  acceptanceCriteria: ['体验和安全问题都有证据', '给出可执行改进顺序']
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
          list: () => ['spawn', 'fork'],
          start: async (kind, options) => {
            const text = Array.isArray(options.prompt) ? options.prompt.map((entry) => entry.text || '').join('\n') : String(options.prompt || '');
            agentPrompts.push(text);
            return {
              id: 'run-' + options.label,
              localAgent: { options: {} },
              result: Promise.resolve({ output: [{ type: 'text', text: options.label + ' 完成：已提供证据。' }], stopReason: 'completed' }),
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
  const ideaCreated = await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'idea_create', scope: 'all', projectPath: 'D:\\demo', sourceSessionId: 'session-1', body: '检查登录流程'
  });
  assert.equal(ideaCreated.ideas.length, 1);
  const ideaId = ideaCreated.ideas[0].id;
  const converted = await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'idea_convert_orchestration', scope: 'all', projectPath: 'D:\\demo', sourceSessionId: 'session-1', id: ideaId
  });
  assert.equal(converted.ideas[0].status, 'promoted');
  assert.equal(converted.orchestrations.length, 1);
  await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_remove', scope: 'all', projectPath: 'D:\\demo', id: converted.orchestrations[0].id
  });
  await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_create', scope: 'all', projectPath: 'D:\\demo',
    sourceSessionId: 'session-1', idea: '检查登录流程'
  });
  const created = await call('/api/dsh-workbench/tasks/list', 'GET', undefined, '?scope=all&projectPath=D%3A%5Cdemo');
  assert.equal(created.orchestrations.length, 1);
  assert.equal(created.orchestrationRuntime.available, true);
  assert.equal(created.modelCatalog[0].id, 'test-model');
  const id = created.orchestrations[0].id;
  const planned = await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_plan', scope: 'all', projectPath: 'D:\\demo', id, feedback: '把方案精简为两个子代理，体验与安全并行'
  });
  assert.equal(planned.orchestrations[0].phase, 'planning');
  assert.ok(planned.orchestrations[0].planningNote, 'planningNote should be set while generating');
  assert.ok(String(planned.orchestrations[0].planningNote).includes('重新编排'), 'planning note should reflect feedback');
  let plannedState = null;
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const snap = await call('/api/dsh-workbench/tasks/list', 'GET', undefined, '?scope=all&projectPath=D%3A%5Cdemo');
    if (snap.orchestrations[0] && snap.orchestrations[0].phase === 'planned') {
      plannedState = snap.orchestrations[0];
      break;
    }
  }
  assert(plannedState, 'orchestration plan should complete asynchronously');
  assert.equal(plannedState.workers.length, 2);
  assert.equal(plannedState.mainAgent.name, '交付负责人');
  assert.equal(plannedState.feedback, '把方案精简为两个子代理，体验与安全并行');
  assert.equal(plannedState.planVersions[0].feedback, '把方案精简为两个子代理，体验与安全并行');
  const persisted = JSON.parse(await readFile(join(tempHome, '.dsh', 'dsh-workbench-tasks.json'), 'utf8'));
  assert.equal(persisted.version, 4);

  // Simulate an interrupted run: one worker completed, the rest interrupted by restart.
  const storeFile = join(tempHome, '.dsh', 'dsh-workbench-tasks.json');
  const interrupted = JSON.parse(await readFile(storeFile, 'utf8'));
  const target = interrupted.orchestrations[0];
  target.phase = 'failed';
  target.runtimeError = '桌面端重启中断了本次执行；已完成步骤已保留，可以点击“继续执行”从未完成步骤接着跑。';
  target.workers = target.workers.map((worker, index) => index === 0
    ? { ...worker, status: 'completed', output: '第一步已完成', completedAt: new Date().toISOString() }
    : { ...worker, status: 'failed', error: '桌面端重启中断了本次执行', completedAt: new Date().toISOString() });
  target.mainAgent = { ...target.mainAgent, status: 'failed', error: '桌面端重启中断了本次执行', completedAt: new Date().toISOString() };
  target.feedback = '把方案精简为两个子代理，体验与安全并行';
  target.completedAt = new Date().toISOString();
  await writeFile(storeFile, JSON.stringify(interrupted, null, 2) + '\n', 'utf8');

  const resumed = await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_resume', scope: 'all', projectPath: 'D:\\demo', id
  });
  assert.equal(resumed.orchestrations[0].phase, 'running');
  assert.equal(resumed.orchestrations[0].attempt, 1);
  assert.ok(resumed.orchestrations[0].workers.find((worker) => worker.status === 'completed'), 'completed worker should be kept on resume');
  assert.equal(resumed.orchestrations[0].workers.filter((worker) => worker.status === 'planned').length, 1, 'interrupted worker should be reset to planned');

  let resumedState = null;
  for (let i = 0; i < 100; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const snap = await call('/api/dsh-workbench/tasks/list', 'GET', undefined, '?scope=all&projectPath=D%3A%5Cdemo');
    const rec = snap.orchestrations[0];
    if (rec.phase === 'review' || rec.phase === 'failed') { resumedState = rec; break; }
  }
  assert(resumedState, 'resumed orchestration should reach a terminal state');
  assert.equal(resumedState.phase, 'review');
  assert.equal(resumedState.workers.filter((worker) => worker.status === 'completed').length, 2);
  assert.equal(resumedState.workers[0].output, '第一步已完成');
  assert.ok(resumedState.finalReport, 'main agent should produce a final report after resume');
  assert.ok(agentPrompts.length >= 2, 'workers and main agent should have been prompted');
  assert.ok(agentPrompts.every((text) => !text.includes('用户最新反馈')), 'feedback must not be injected into agent prompts');
  assert.ok(agentPrompts.every((text) => !text.includes('把方案精简为两个子代理')), 'feedback text must not be injected into agent prompts');

  // Continue optimizing: after review, the user sends a new instruction to the main agent.
  const continuing = await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_continue', scope: 'all', projectPath: 'D:\\demo', id,
    message: '把报告第 2 部分的方案再优化一下'
  });
  assert.equal(continuing.orchestrations[0].phase, 'refining');
  assert.equal(continuing.orchestrations[0].refineCount, 1);
  assert.equal(continuing.orchestrations[0].thread.length, 1);
  assert.equal(continuing.orchestrations[0].thread[0].role, 'user');

  let refinedState = null;
  for (let i = 0; i < 100; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const snap = await call('/api/dsh-workbench/tasks/list', 'GET', undefined, '?scope=all&projectPath=D%3A%5Cdemo');
    const rec = snap.orchestrations[0];
    if (rec.phase === 'review' || rec.phase === 'failed') { refinedState = rec; break; }
  }
  assert(refinedState, 'refined orchestration should reach a terminal state');
  assert.equal(refinedState.phase, 'review');
  assert.equal(refinedState.thread.length, 2, 'thread should contain user instruction and main agent reply');
  assert.equal(refinedState.thread[1].role, 'main');
  assert.ok(refinedState.thread[1].text.length > 0);
  assert.ok(agentPrompts.some((text) => text.includes('用户本次优化要求')), 'continuation prompt should include the new instruction');
  assert.ok(agentPrompts.some((text) => text.includes('把报告第 2 部分的方案再优化一下')), 'continuation prompt should carry the user message');
  console.log('orchestration smoke test passed');
} finally {
  await rm(tempHome, { recursive: true, force: true });
}
