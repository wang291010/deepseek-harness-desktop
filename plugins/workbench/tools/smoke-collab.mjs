import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-workbench-collab-'));
process.env.USERPROFILE = tempHome;
process.env.HOME = tempHome;
process.env.DSH_WORKBENCH_WORKER_TIMEOUT_MS = '3000';

const routes = new Map();
const llmCalls = [];
const agentPrompts = [];
const spawnOptions = [];
const workspaces = [];
const plan = {
  title: '附件协作测试',
  summary: '一个子代理读取附件并输出结论。',
  strategy: '单子代理执行。',
  maxParallel: 1,
  mainAgent: { name: '汇总代理', role: '主代理', mission: '汇总结果' },
  workers: [{ name: '文档阅读员', role: '执行者', task: '读取附件并总结', dependsOn: [], acceptance: '给出结论', agentRef: 'alpha' }],
  acceptanceCriteria: ['结论完整']
};

const ctx = {
  inject(names, callback) {
    if (names.includes('webServer')) {
      callback({
        webServer: { register(route) { routes.set(route.path, route); return () => {}; } },
        workspaceRegistry: { list: () => workspaces },
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
            const text = Array.isArray(options.prompt) ? options.prompt.map((entry) => entry.text || '').join('\n') : String(options.prompt || '');
            agentPrompts.push(text);
            spawnOptions.push(options);
            return {
              id: 'run-' + options.label,
              localAgent: { options: {} },
              result: Promise.resolve({ output: [{ type: 'text', text: options.label + ' 完成' }], stopReason: 'completed' }),
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

async function callRaw(path, method, body) {
  const route = routes.get(path);
  assert(route, `route missing: ${path}`);
  let status = 0;
  let text = '';
  const res = { writeHead(code) { status = code; }, end(value) { text += value || ''; } };
  await route.handler(request(method, path, body), res);
  return { status, data: text ? JSON.parse(text) : {} };
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

  // --- agents pool: defaults + validation + write ---
  const defaults = await call('/api/dsh-workbench/agents/list', 'GET');
  assert.equal(defaults.mode, 'free', 'default pool mode should be free-form');
  assert.ok(defaults.agents.length >= 5, 'default agent pool should have at least 5 agents');
  assert.ok(defaults.agents.some((agent) => agent.id === 'code-reviewer'), 'default pool should include code-reviewer');
  const written = await call('/api/dsh-workbench/agents/write', 'POST', {
    mode: 'pool',
    agents: [
      { id: 'alpha', name: 'Alpha', role: '验证', capabilities: ['test'], prompt: '验证一切', provider: 'test-provider', model: 'pool-model' },
      { id: 'beta', name: 'Beta', role: '写作', capabilities: ['docs'], prompt: '写好文档' },
      { id: 'alpha', name: '重复', role: '', capabilities: [], prompt: '' }
    ]
  });
  assert.equal(written.mode, 'pool', 'written pool should keep pool mode');
  assert.equal(written.agents.length, 2, 'duplicate agent ids should be dropped');
  const invalidWrite = await callRaw('/api/dsh-workbench/agents/write', 'POST', { agents: 'not-an-array' });
  assert.equal(invalidWrite.status, 400, 'non-array agents should be rejected');

  // --- attachment upload: validation + store ---
  const badType = await callRaw('/api/dsh-workbench/attachment/put', 'POST', { name: 'evil.exe', data: Buffer.from('x').toString('base64') });
  assert.equal(badType.status, 400, 'exe attachment should be rejected');
  const missing = await callRaw('/api/dsh-workbench/attachment/put', 'POST', { name: 'a.txt' });
  assert.equal(missing.status, 400, 'missing data should be rejected');
  const uploaded = await call('/api/dsh-workbench/attachment/put', 'POST', { name: '说明.txt', data: Buffer.from('这是测试附件内容 hello world', 'utf8').toString('base64') });
  assert.ok(uploaded.id, 'upload should return an id');
  assert.equal(uploaded.name, '说明.txt');
  assert.equal(uploaded.mime, 'text/plain');

  // --- create orchestration with attachment, plan prompt carries pool + attachment ---
  await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_create', scope: 'all', projectPath: 'D:\\demo', sourceSessionId: 'session-1',
    idea: '总结附件内容', attachments: [{ id: uploaded.id, name: uploaded.name, mime: uploaded.mime, size: uploaded.size }]
  });
  let created = (await listAll()).orchestrations[0];
  assert.equal(created.attachments.length, 1);
  assert.ok(String(created.attachments[0].summary).includes('hello world'), 'text attachment should be summarized');
  const id = created.id;
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_plan', scope: 'all', projectPath: 'D:\\demo', id });
  const planned = await waitPhase(id, ['planned', 'failed']);
  assert.equal(planned.phase, 'planned');
  assert.ok(llmCalls.length >= 1);
  assert.ok(llmCalls[0].prompt.includes('说明.txt'), 'plan prompt should include attachment name');
  assert.ok(llmCalls[0].prompt.includes('候选专家参考'), 'plan prompt should include agent pool in pool mode');
  assert.ok(llmCalls[0].prompt.includes('alpha'), 'plan prompt should include written pool agent ids');

  // --- execute: worker prompt carries attachment; logs are recorded ---
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_start', scope: 'all', projectPath: 'D:\\demo', id });
  await waitPhase(id, ['review', 'failed', 'cancelled'], 12000);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const terminal = (await listAll()).orchestrations.find((item) => item.id === id);
  assert.equal(terminal.phase, 'review');
  assert.ok(agentPrompts.some((text) => text.includes('说明.txt')), 'worker prompt should include attachment');
  assert.ok(agentPrompts.some((text) => text.includes('验证一切')), 'worker prompt should include matched pool prompt');
  assert.ok(spawnOptions.some((options) => options.agentOptions && options.agentOptions.model === 'pool-model'), 'pool model should be used as fallback when worker model is empty');
  assert.ok(Array.isArray(terminal.log) && terminal.log.length >= 3, 'orchestration should record execution logs');
  assert.ok(terminal.log.some((entry) => entry.level === 'info' && entry.text.includes('主代理完成汇总')), 'log should include main agent completion');
  assert.ok(terminal.log.every((entry) => ['info', 'warn', 'error'].includes(entry.level)), 'log levels should be valid');

  // --- removal deletes attachment files ---
  const attachmentPath = join(tempHome, '.dsh', 'attachments', uploaded.id);
  await stat(attachmentPath); // exists before removal
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_remove', scope: 'all', projectPath: 'D:\\demo', id });
  await new Promise((resolve) => setTimeout(resolve, 100));
  let removed = true;
  try { await stat(attachmentPath); removed = false; } catch (e) { /* expected */ }
  assert.ok(removed, 'attachment file should be removed with the orchestration');

  // native folder picker route must exist and degrade gracefully outside Electron
  const pick = await callRaw('/api/dsh-workbench/fs/pick-folder', 'POST');
  assert.equal(pick.status, 400, 'native picker should be unavailable in plain Node');
  assert.equal(pick.data.error, 'native-dialog-unavailable');

  // --- reset restores defaults in free mode; free mode omits the pool reference ---
  const reset = await call('/api/dsh-workbench/agents/reset', 'POST');
  assert.equal(reset.mode, 'free');
  assert.equal(reset.agents.length, 7, 'reset should restore the default 7 agents');
  const llmCallsBeforeFree = llmCalls.length;
  await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_create', scope: 'all', projectPath: 'D:\\demo', sourceSessionId: 'session-1', idea: '自由编排测试'
  });
  const freeId = (await listAll()).orchestrations.find((item) => item.idea === '自由编排测试').id;
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_plan', scope: 'all', projectPath: 'D:\\demo', id: freeId });
  await waitPhase(freeId, ['planned', 'failed']);
  assert.ok(llmCalls.length > llmCallsBeforeFree);
  const freePrompt = llmCalls[llmCalls.length - 1].prompt;
  assert.ok(!freePrompt.includes('候选专家参考'), 'free mode should omit the pool reference from the plan prompt');
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_remove', scope: 'all', projectPath: 'D:\\demo', id: freeId });

  // --- project context injection: file structure + tech stack + history ---
  const projectDir = join(tempHome, 'projects', 'demo-app');
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, 'package.json'), JSON.stringify({ name: 'demo-app', dependencies: { react: '^18' } }), 'utf8');
  await writeFile(join(projectDir, 'src.txt'), 'placeholder', 'utf8');
  workspaces.push({ path: projectDir });
  await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_create', scope: 'all', projectPath: projectDir, sourceSessionId: 'session-1', idea: '项目上下文测试'
  });
  const ctxId = (await listAll()).orchestrations.find((item) => item.idea === '项目上下文测试').id;
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_plan', scope: 'all', projectPath: projectDir, id: ctxId });
  await waitPhase(ctxId, ['planned', 'failed']);
  const ctxPrompt = llmCalls[llmCalls.length - 1].prompt;
  assert.ok(ctxPrompt.includes('项目上下文'), 'plan prompt should include project context');
  assert.ok(ctxPrompt.includes('项目文件结构'), 'plan prompt should include project file structure');
  assert.ok(ctxPrompt.includes('技术栈线索'), 'plan prompt should include tech stack hints');
  assert.ok(ctxPrompt.includes('package.json') && ctxPrompt.includes('demo-app'), 'plan prompt should include manifest content');
  assert.ok(ctxPrompt.includes('src.txt'), 'plan prompt should include project file names');
  await call('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_remove', scope: 'all', projectPath: projectDir, id: ctxId });
  console.log('collab smoke test passed');
} finally {
  await rm(tempHome, { recursive: true, force: true });
}
