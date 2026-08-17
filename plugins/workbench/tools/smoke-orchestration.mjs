import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-workbench-orchestration-'));
process.env.USERPROFILE = tempHome;
process.env.HOME = tempHome;

const routes = new Map();
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
        subagents: { list: () => ['spawn', 'fork'] },
        agents: { get: () => undefined, roots: () => [] }
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
    action: 'orchestration_plan', scope: 'all', projectPath: 'D:\\demo', id
  });
  assert.equal(planned.orchestrations[0].phase, 'planned');
  assert.equal(planned.orchestrations[0].workers.length, 2);
  assert.equal(planned.orchestrations[0].mainAgent.name, '交付负责人');
  const persisted = JSON.parse(await readFile(join(tempHome, '.dsh', 'dsh-workbench-tasks.json'), 'utf8'));
  assert.equal(persisted.version, 4);
  console.log('orchestration smoke test passed');
} finally {
  await rm(tempHome, { recursive: true, force: true });
}
