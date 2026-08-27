#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const debugPort = process.argv[2] || '9226';
const markerName = `.f6-conflict-${Date.now()}.txt`;
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
const context = await evaluate(`JSON.parse(localStorage.getItem('dsh.sessions.current') || '{}')`);
const contextSessionId = context.sessionId || '';
assert(contextSessionId, 'no active session');
const liveContext = await evaluate(`(() => { const urls = performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/api/dsh-workbench/tasks/list?')); const match = [...urls].reverse().map((name) => new URL(name)).find((url) => url.searchParams.get('projectPath')); const current = JSON.parse(localStorage.getItem('dsh.sessions.current') || '{}'); return { projectPath: match ? match.searchParams.get('projectPath') : (current.cwd || current.projectPath || ''), sessionId: match ? (match.searchParams.get('sessionId') || '') : '' }; })()`);
const projectPath = liveContext.projectPath || '';
assert(projectPath, 'no live project path');
const sessionId = liveContext.sessionId || contextSessionId;
const listPath = `/api/dsh-workbench/tasks/list?scope=all&projectPath=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}`;
const mutationPath = '/api/dsh-workbench/tasks/mutate';
let orchestrationId = '';
let worker = null;
const conflictPath = `${projectPath.replaceAll('\\', '/')}/.gitignore`;
const baselineRead = await api(`/api/dsh-workbench/fs/read?path=${encodeURIComponent(conflictPath)}`);
assert.equal(baselineRead.status, 200, JSON.stringify(baselineRead));
const baselineContent = baselineRead.value.content;
try {
  const title = `F6-B apply 冲突真实验收 ${new Date().toISOString()}`;
  const created = await api(mutationPath, 'POST', { action: 'orchestration_create', scope: 'all', projectPath, sourceSessionId: sessionId, title, idea: `在隔离 worktree 创建 ${markerName}，原项目随后创建同名文件，验证 apply 冲突保护`, worktreeMode: 'write-workers' });
  assert.equal(created.status, 200, JSON.stringify(created));
  orchestrationId = created.value.orchestrations.find((item) => item.title === title)?.id || '';
  assert(orchestrationId, 'orchestration not created');
  const plan = await api(mutationPath, 'POST', { action: 'orchestration_set_plan', scope: 'all', projectPath, id: orchestrationId, modelPolicy: 'balanced', plan: { title, summary: 'apply 冲突', strategy: '隔离执行后制造原项目冲突', maxParallel: 1, mainAgent: { id: 'main', name: '主协调', role: '协调', mission: '汇总冲突证据', readOnly: true }, workers: [{ id: 'writer', name: 'Codex 冲突验收', role: '开发者', task: '在当前独立 worktree 修改已有文件 .gitignore：仅在文件末尾追加一行 # F6_WORKTREE_VERSION，不要修改其他文件。', dependsOn: [], acceptance: '隔离文件存在且包含标记行', readOnly: false, executionTrack: 'B', productProvider: 'codex' }], acceptanceCriteria: ['原项目冲突时 apply 被拒绝'] } });
  assert.equal(plan.status, 200, JSON.stringify(plan));
  const started = await api(mutationPath, 'POST', { action: 'orchestration_start', scope: 'all', projectPath, id: orchestrationId });
  assert.equal(started.status, 200, JSON.stringify(started));
  let record = null;
  for (let i = 0; i < 180; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    record = (await api(listPath)).value.orchestrations.find((item) => item.id === orchestrationId);
    worker = record?.workers?.[0] || null;
    if (worker?.status === 'completed' && worker.worktreeStatus === 'changed') break;
    if (record && ['failed', 'cancelled'].includes(record.phase)) break;
  }
  assert.equal(worker?.status, 'completed', worker?.error || 'writer did not complete');
  assert.equal(worker?.worktreeStatus, 'changed');
  assert(worker?.worktreePath, 'worktree path missing');
  const worktreeMarker = `${worker.worktreePath.replaceAll('\\', '/')}/.gitignore`;
  assert(existsSync(worktreeMarker), 'worktree file missing');
  assert(readFileSync(worktreeMarker, 'utf8').includes('# F6_WORKTREE_VERSION'), 'worktree marker content mismatch');
  const conflictWrite = await api('/api/dsh-workbench/fs/write', 'POST', { path: conflictPath, content: `${baselineContent}\n# F6_ORIGINAL_CONFLICT_VERSION\n` });
  assert.equal(conflictWrite.status, 200, JSON.stringify(conflictWrite));
  const apply = await api('/api/dsh-workbench/orchestration/worktree', 'POST', { action: 'apply', id: orchestrationId, workerId: worker.id });
  assert.equal(apply.status, 409, JSON.stringify(apply));
  const conflictRead = await api(`/api/dsh-workbench/fs/read?path=${encodeURIComponent(conflictPath)}`);
  assert.equal(conflictRead.status, 200, JSON.stringify(conflictRead));
  assert(conflictRead.value.content.endsWith('# F6_ORIGINAL_CONFLICT_VERSION\n'), 'conflict apply changed original file');
  console.log(JSON.stringify({ ok: true, workerStatus: worker.status, worktreeStatus: worker.worktreeStatus, applyStatus: apply.status, conflictProtected: true }, null, 2));
} finally {
  try { await api('/api/dsh-workbench/fs/write', 'POST', { path: conflictPath, content: baselineContent }); } catch {}
  try { if (worker?.worktreePath) await api('/api/dsh-workbench/orchestration/worktree', 'POST', { action: 'discard', id: orchestrationId, workerId: worker.id }); } catch {}
  try { await api(mutationPath, 'POST', { action: 'orchestration_remove', scope: 'all', projectPath, id: orchestrationId }); } catch {}
  ws.close();
}
