import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-workbench-workflow-'));
process.env.USERPROFILE = tempHome;
process.env.HOME = tempHome;

const routes = new Map();
const ctx = {
  inject(names, callback) {
    if (names.includes('webServer')) {
      callback({
        webServer: { register(route) { routes.set(route.path, route); return () => {}; } },
        workspaceRegistry: { list: () => [] },
        llm: { listProviders: () => [], listModels: async () => [], async *stream() { yield { type: 'text-delta', text: '{}' }; } }
      });
    } else if (names.includes('subagents')) {
      callback({ subagents: { list: () => [], start: async () => ({ id: 'x', localAgent: { options: {} }, result: Promise.resolve({ output: [], stopReason: 'completed' }), dispose: async () => {} }) }, agents: { get: () => ({ id: 's', session: { header: { cwd: '' } } }), roots: () => [] } });
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

try {
  const { apply } = await import('../lib/host/index.js?' + Date.now());
  apply(ctx);

  // defaults are seeded lazily
  const initial = await call('/api/dsh-workbench/workflows/list', 'GET');
  assert.ok(initial.templates.length >= 4, 'default workflow templates should be seeded');
  assert.ok(initial.templates.some((t) => t.id === 'wf-daily-report'), 'default templates should include daily report');
  assert.equal(initial.schedules.length, 0);
  assert.equal(initial.runs.length, 0);

  // create a custom template through the task store
  const created = await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'template_create', scope: 'all', projectPath: '', title: '自定义发布流程', description: '发布前检查',
    steps: ['检查版本号', '构建产物', '发布说明']
  });
  const custom = created.templates.find((t) => t.title === '自定义发布流程');
  assert.ok(custom && custom.id, 'custom template should be created');
  assert.equal(custom.steps.length, 3);

  // run a default template against a project
  const run = await call('/api/dsh-workbench/workflows/run', 'POST', { templateId: 'wf-daily-report', projectPath: 'D:\\demo' });
  assert.equal(run.run.status, 'done');
  assert.equal(run.run.taskCount, 3);
  const tasks = await call('/api/dsh-workbench/tasks/list', 'GET', undefined, '?scope=all');
  const group = tasks.tasks.filter((task) => task.groupTitle === '日报/晨报汇总');
  assert.equal(group.length, 3, 'workflow run should create grouped tasks');

  // schedule CRUD
  const scheduled = await call('/api/dsh-workbench/workflows/schedule', 'POST', { templateId: 'wf-daily-report', projectPath: 'D:\\demo', intervalMinutes: 60 });
  assert.equal(scheduled.schedules.length, 1);
  const scheduleId = scheduled.schedules[0].id;
  const route = routes.get('/api/dsh-workbench/workflows/schedule');
  let badStatus = 0;
  const badRes = { writeHead(code) { badStatus = code; }, end() {} };
  await route.handler(request('POST', '/api/dsh-workbench/workflows/schedule', { templateId: 'missing', projectPath: '', intervalMinutes: 60 }), badRes);
  assert.equal(badStatus, 400, 'schedule with unknown template should be rejected');

  const removed = await call('/api/dsh-workbench/workflows/remove', 'POST', { kind: 'schedule', id: scheduleId });
  assert.equal(removed.schedules.length, 0);
  const removedRun = await call('/api/dsh-workbench/workflows/remove', 'POST', { kind: 'run', id: run.run.id });
  assert.equal(removedRun.runs.length, 0);

  // cleanup custom template
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'template_remove', scope: 'all', projectPath: '', templateId: custom.id });
  console.log('workflow smoke test passed');
  process.exit(0);
} finally {
  await rm(tempHome, { recursive: true, force: true });
}
