#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const debugPort = process.argv[2] || '9226';
const worktreeRoot = process.env.DSH_WORKBENCH_WORKTREE_ROOT || 'C:\\dsh-wt';
const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page');
assert(target, `no page target on ${debugPort}`);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const item = pending.get(message.id);
  pending.delete(message.id);
  message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
});
function send(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } });
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function api(path, method = 'GET', body) {
  const expression = `fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { 'content-type': 'application/json' }, body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))} }).then(async (response) => { const text = await response.text(); let value = null; try { value = text ? JSON.parse(text) : null; } catch { value = text; } return { status: response.status, value }; })`;
  return evaluate(expression);
}
async function expectRejected(path, body, expectedStatus, label) {
  const response = await api(path, 'POST', body);
  assert.equal(response.status, expectedStatus, `${label} returned an unexpected status: ${JSON.stringify(response)}`);
  return response;
}
const context = await evaluate(`JSON.parse(localStorage.getItem('dsh.sessions.current') || '{}')`);
const sessionId = context.sessionId || '';
assert(sessionId, 'no active session');
const liveContext = await evaluate(`(() => { const sid = ${JSON.stringify(sessionId)}; const urls = performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/api/dsh-workbench/tasks/list?')); const match = [...urls].reverse().map((name) => new URL(name)).find((url) => url.searchParams.get('sessionId') === sid && url.searchParams.get('projectPath')); return { projectPath: match ? match.searchParams.get('projectPath') : '' }; })()`);
const projectPath = liveContext.projectPath || '';
assert(projectPath, 'no live project path');
const listPath = `/api/dsh-workbench/tasks/list?scope=all&projectPath=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}`;
const mutationPath = '/api/dsh-workbench/tasks/mutate';
const ids = [];
async function record(id) { return (await api(listPath)).value.orchestrations.find((item) => item.id === id); }
async function createGuard(title, worker) {
  const created = await api(mutationPath, 'POST', { action: 'orchestration_create', scope: 'all', projectPath, sourceSessionId: sessionId, title, idea: title, worktreeMode: 'write-workers' });
  assert.equal(created.status, 200, JSON.stringify(created));
  const id = created.value.orchestrations.find((item) => item.title === title)?.id || '';
  assert(id, `${title}: orchestration not created`);
  ids.push(id);
  const planned = await api(mutationPath, 'POST', { action: 'orchestration_set_plan', scope: 'all', projectPath, id, modelPolicy: 'balanced', plan: { title, summary: title, strategy: '边界验收', maxParallel: 1, mainAgent: { id: 'main', name: '主协调', role: '协调', mission: '边界验收', readOnly: true }, workers: [worker], acceptanceCriteria: ['边界错误被拒绝'] } });
  assert.equal(planned.status, 200, JSON.stringify(planned));
  return id;
}
let cancelId = '';
let cancelWorker = null;
try {
  const title = `F6-B 取消清理真实验收 ${new Date().toISOString()}`;
  const created = await api(mutationPath, 'POST', { action: 'orchestration_create', scope: 'all', projectPath, sourceSessionId: sessionId, title, idea: '启动写型 worker 后立即取消，验证隔离区可清理', worktreeMode: 'write-workers' });
  assert.equal(created.status, 200, JSON.stringify(created));
  cancelId = created.value.orchestrations.find((item) => item.title === title)?.id || '';
  assert(cancelId, 'cancel orchestration not created');
  ids.push(cancelId);
  const plan = await api(mutationPath, 'POST', { action: 'orchestration_set_plan', scope: 'all', projectPath, id: cancelId, modelPolicy: 'balanced', plan: { title, summary: '取消后清理', strategy: '隔离执行后取消', maxParallel: 1, mainAgent: { id: 'main', name: '主协调', role: '协调', mission: '汇总取消证据', readOnly: true }, workers: [{ id: 'writer', name: 'Codex 取消验收', role: '开发者', task: '在当前 worktree 创建一个临时文件，然后等待；收到取消后立即停止。', dependsOn: [], acceptance: '取消后隔离区可清理', readOnly: false, executionTrack: 'B', productProvider: 'codex' }], acceptanceCriteria: ['取消后任务进入 cancelled', '隔离区可删除'] } });
  assert.equal(plan.status, 200, JSON.stringify(plan));
  const started = await api(mutationPath, 'POST', { action: 'orchestration_start', scope: 'all', projectPath, id: cancelId });
  assert.equal(started.status, 200, JSON.stringify(started));
  let current = null;
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    current = await record(cancelId);
    cancelWorker = current?.workers?.[0] || null;
    if (cancelWorker?.worktreePath || current?.phase === 'failed' || current?.phase === 'cancelled') break;
  }
  const cancelled = await api(mutationPath, 'POST', { action: 'orchestration_cancel', scope: 'all', projectPath, id: cancelId });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled));
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    current = await record(cancelId);
    if (current?.phase === 'cancelled') break;
  }
  assert.equal(current?.phase, 'cancelled', JSON.stringify(current));
  cancelWorker = current?.workers?.[0] || cancelWorker;
  if (cancelWorker?.worktreePath) {
    const discarded = await api('/api/dsh-workbench/orchestration/worktree', 'POST', { action: 'discard', id: cancelId, workerId: cancelWorker.id });
    assert.equal(discarded.status, 200, JSON.stringify(discarded));
    assert.equal(existsSync(cancelWorker.worktreePath), false, 'cancelled worktree was not removed');
  }

  const traversalId = await createGuard(`F6-B 越界路径拒绝 ${Date.now()}`, { id: 'writer', name: '越界', role: '开发者', task: '边界', readOnly: false, executionTrack: 'B', productProvider: 'codex', worktreePath: `${worktreeRoot}\\..\\outside`, worktreeBranch: 'codex/wb-guard', worktreeStatus: 'ready' });
  const traversal = await expectRejected('/api/dsh-workbench/orchestration/worktree', { action: 'discard', id: traversalId, workerId: 'writer' }, 403, 'path traversal');
  const branchId = await createGuard(`F6-B 非工作台分支拒绝 ${Date.now()}`, { id: 'writer', name: '分支', role: '开发者', task: '边界', readOnly: false, executionTrack: 'B', productProvider: 'codex', worktreePath: `${worktreeRoot}\\guard-non-workbench`, worktreeBranch: 'feature/user-branch', worktreeStatus: 'ready' });
  const branch = await expectRejected('/api/dsh-workbench/orchestration/worktree', { action: 'discard', id: branchId, workerId: 'writer' }, 403, 'non-workbench branch');
  const stateId = await createGuard(`F6-B 错误状态拒绝 ${Date.now()}`, { id: 'writer', name: '状态', role: '开发者', task: '边界', readOnly: false, executionTrack: 'B', productProvider: 'codex', worktreePath: `${worktreeRoot}\\guard-invalid-state`, worktreeBranch: 'codex/wb-guard', worktreeStatus: 'ready' });
  const state = await expectRejected('/api/dsh-workbench/orchestration/worktree', { action: 'apply', id: stateId, workerId: 'writer' }, 409, 'invalid apply state');
  console.log(JSON.stringify({ ok: true, cancelled: { phase: current.phase, worktreeCreated: Boolean(cancelWorker?.worktreePath), cleanupVerified: cancelWorker?.worktreePath ? !existsSync(cancelWorker.worktreePath) : null }, rejected: { traversal: traversal.status, nonWorkbenchBranch: branch.status, invalidState: state.status } }, null, 2));
} finally {
  for (const id of ids) {
    try { await api(mutationPath, 'POST', { action: 'orchestration_remove', scope: 'all', projectPath, id }); } catch {}
  }
  ws.close();
}
