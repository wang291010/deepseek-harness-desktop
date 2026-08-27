import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-workbench-track-b-'));
const repo = join(tempHome, 'repo');
await import('node:fs/promises').then(({ mkdir }) => mkdir(repo));
process.env.USERPROFILE = tempHome;
process.env.HOME = tempHome;
process.env.DSH_HOME = join(tempHome, '.dsh');
process.env.DSH_WORKBENCH_WORKER_MAX_RETRIES = '0';
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true });
git('init');
await writeFile(join(repo, 'README.md'), '# fixture\n');
git('add', 'README.md');
git('-c', 'user.name=Smoke', '-c', 'user.email=smoke@local', 'commit', '-m', 'init');

const routes = new Map();
const listeners = new Map();
const rootAgent = { id: 'session-track-b', options: { provider: 'test', model: 'test' }, session: { header: { id: 'session-track-b', cwd: repo, delegationDepth: 0 } } };
const plan = {
  title: '双轨隔离测试', summary: '轨道 B 写型 worker', strategy: '隔离后人工应用', maxParallel: 1,
  mainAgent: { id: 'main', name: '主协调', role: '协调', mission: '汇总', executionTrack: 'A' },
  workers: [{ id: 'writer', name: '写入代理', role: '开发者', task: '新增 isolated.txt', dependsOn: [], readOnly: false, acceptance: '文件存在', executionTrack: 'B', productProvider: 'codex' }],
  acceptanceCriteria: ['隔离分支可应用']
};
let externalCalls = 0;
let createdParentCwd = '';
const subagents = {
  list: () => ['codex', 'claude-code', 'spawn', 'fork'],
  getProvider: () => undefined,
  start: async (provider, options) => {
    if (provider === 'codex') {
      externalCalls++;
      createdParentCwd = options.parent.session.header.cwd;
      await writeFile(join(createdParentCwd, 'isolated.txt'), 'track-b\n');
      return { id: 'codex-run', result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '已在隔离工作树完成修改' }] }), dispose: async () => {} };
    }
    return { id: 'main-run', localAgent: { options: rootAgent.options }, result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '汇总完成' }] }), dispose: async () => {} };
  }
};
const agents = {
  get: (id) => id === rootAgent.id ? rootAgent : undefined,
  roots: () => [rootAgent],
  create: async (options) => ({ agent: { id: options.sessionId, options: options.agentOptions, session: { header: { id: options.sessionId, ...options.meta } } }, dispose: async () => {} })
};
const ctx = {
  inject(names, callback) {
    if (names.includes('webServer')) callback({ webServer: { register(route) { routes.set(route.path, route); return () => {}; } }, workspaceRegistry: { list: () => [{ path: repo }] }, llm: { listProviders: () => [{ id: 'test', name: 'Test' }], listModels: async () => [{ provider: 'test', id: 'test', name: 'Test' }], async *stream() { yield { type: 'text-delta', text: JSON.stringify(plan) }; } } });
    else if (names.includes('subagents')) callback({ subagents, agents });
    else if (names.includes('commands')) callback({ commands: { register: () => [] }, sessionProjections: {} });
  },
  on(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); return () => {}; }
};
function request(method, url, body) { const req = new PassThrough(); req.method = method; req.url = url; req.socket = { remoteAddress: '127.0.0.1' }; req.headers = { host: '127.0.0.1' }; queueMicrotask(() => req.end(body === undefined ? '' : JSON.stringify(body))); return req; }
async function call(path, body, query = '') { const route = routes.get(path); assert(route); let status = 0; let text = ''; const res = { writeHead(code) { status = code; }, end(value) { text += value || ''; } }; await route.handler(request(body === undefined ? 'GET' : 'POST', path + query, body), res); const data = JSON.parse(text); assert.equal(status, 200, JSON.stringify(data)); return data; }
async function current(id) { return (await call('/api/dsh-workbench/tasks/list', undefined, '?scope=all&projectPath=' + encodeURIComponent(repo))).orchestrations.find((item) => item.id === id); }
async function waitPhase(id, phase) { const until = Date.now() + 8000; while (Date.now() < until) { const item = await current(id); if (item && item.phase === phase) return item; await new Promise((resolve) => setTimeout(resolve, 20)); } throw new Error('timeout waiting ' + phase); }

try {
  const { apply } = await import('../lib/host/index.js?' + Date.now());
  apply(ctx);
  const created = await call('/api/dsh-workbench/tasks/mutate', { action: 'orchestration_create', scope: 'all', projectPath: repo, sourceSessionId: rootAgent.id, idea: '测试轨道 B 与 worktree', worktreeMode: 'write-workers' });
  const id = created.orchestrations.find((item) => item.idea === '测试轨道 B 与 worktree').id;
  await call('/api/dsh-workbench/tasks/mutate', { action: 'orchestration_plan', scope: 'all', projectPath: repo, id });
  await waitPhase(id, 'planned');
  await call('/api/dsh-workbench/tasks/mutate', { action: 'orchestration_start', scope: 'all', projectPath: repo, id });
  const reviewed = await waitPhase(id, 'review');
  const worker = reviewed.workers[0];
  assert.equal(externalCalls, 1);
  assert.equal(worker.usedExecutionTrack, 'B');
  assert.equal(worker.usedSubagentProvider, 'codex');
  assert.equal(worker.worktreeStatus, 'changed');
  assert.notEqual(createdParentCwd, repo);
  assert.equal(existsSync(join(repo, 'isolated.txt')), false, 'original project must remain untouched before apply');
  await call('/api/dsh-workbench/orchestration/worktree', { action: 'apply', id, workerId: worker.id });
  assert.equal((await readFile(join(repo, 'isolated.txt'), 'utf8')).trim(), 'track-b');
  await call('/api/dsh-workbench/orchestration/worktree', { action: 'discard', id, workerId: worker.id });
  assert.equal(existsSync(worker.worktreePath), false);
  console.log('dual-track + worktree smoke test passed');
} finally {
  for (const listener of listeners.get('dispose') || []) listener();
  await rm(tempHome, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 });
}
