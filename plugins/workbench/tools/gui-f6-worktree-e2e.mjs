#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const debugPort = process.argv[2] || '9226';
const markerName = `.f6-real-worker-${Date.now()}.txt`;
const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page');
assert(target, `no page target on ${debugPort}`);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
let nextId = 0; const pending = new Map();
ws.addEventListener('message', (event) => { const m = JSON.parse(String(event.data)); if (!m.id || !pending.has(m.id)) return; const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); });
function send(method, params = {}) { const id = ++nextId; ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000); pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } }); }); }
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
async function api(path, method = 'GET', body) { const expression = `fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { 'content-type': 'application/json' }, body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))} }).then(async (r) => { const t = await r.text(); const v = t ? JSON.parse(t) : null; if (!r.ok) throw new Error(JSON.stringify(v)); return v; })`; return evaluate(expression); }
const context = await evaluate(`JSON.parse(localStorage.getItem('dsh.sessions.current') || '{}')`);
const sessionId = context.sessionId || '';
assert(sessionId, 'no active session');
const liveContext = await evaluate(`(() => { const sid = ${JSON.stringify(sessionId)}; const urls = performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/api/dsh-workbench/tasks/list?')); const match = [...urls].reverse().map((name) => new URL(name)).find((url) => url.searchParams.get('sessionId') === sid && url.searchParams.get('projectPath')); return { projectPath: match ? match.searchParams.get('projectPath') : '' }; })()`);
const projectPath = liveContext.projectPath || '';
assert(projectPath, 'no live project path');
const listPath = `/api/dsh-workbench/tasks/list?scope=all&projectPath=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}`;
const mutationPath = '/api/dsh-workbench/tasks/mutate';
let id = '';
try {
  const title = `F6 worktree 真实写型验收 ${new Date().toISOString()}`;
  const created = await api(mutationPath, 'POST', { action: 'orchestration_create', scope: 'all', projectPath, sourceSessionId: sessionId, title, idea: `在隔离 worktree 创建 ${markerName}，验证 apply/discard；禁止修改原项目其他内容。`, worktreeMode: 'write-workers' });
  id = created.orchestrations.find((item) => item.title === title)?.id || '';
  assert(id, 'orchestration not created');
  await api(mutationPath, 'POST', { action: 'orchestration_set_plan', scope: 'all', projectPath, id, modelPolicy: 'balanced', plan: {
    title, summary: 'Codex worktree 写型验收', strategy: '隔离执行后人工应用', maxParallel: 1,
    mainAgent: { id: 'main', name: '主协调', role: '协调', mission: '汇总 worktree 证据', readOnly: true },
    workers: [{ id: 'writer', name: 'Codex 写型验收', role: '开发者', task: `在当前独立 worktree 中创建文件 ${markerName}，内容必须为 F6_TRACK_B_OK；不要修改其他文件。`, dependsOn: [], acceptance: '隔离文件存在且内容正确', readOnly: false, executionTrack: 'B', productProvider: 'codex' }],
    acceptanceCriteria: ['原项目 apply 前不变', '应用后文件可见', 'discard 可清理']
  } });
  await api(mutationPath, 'POST', { action: 'orchestration_start', scope: 'all', projectPath, id });
  let record;
  for (let i = 0; i < 180; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    record = (await api(listPath)).orchestrations.find((item) => item.id === id);
    const workerState = record?.workers?.[0];
    if (record && ['review', 'failed', 'cancelled'].includes(record.phase)) break;
    // The parent report may remain running while the write worker has already
    // committed its isolated branch; F6 can validate apply/discard independently
    // of the knowledge-audit result produced by the parent summarizer.
    if (workerState?.status === 'completed' && workerState.worktreeStatus === 'changed') break;
  }
  assert(record, 'record disappeared');
  const worker = record.workers?.[0];
  console.log(JSON.stringify({ id, phase: record.phase, runtimeError: record.runtimeError, worker: worker && { status: worker.status, worktreeStatus: worker.worktreeStatus, worktreePath: worker.worktreePath, usedExecutionTrack: worker.usedExecutionTrack, usedSubagentProvider: worker.usedSubagentProvider, error: worker.error, output: String(worker.output || '').slice(0, 500) } }, null, 2));
  assert.equal(worker.status, 'completed', worker.error || 'writer failed');
  assert.equal(worker.usedExecutionTrack, 'B');
  assert.equal(worker.usedSubagentProvider, 'codex');
  assert.equal(worker.worktreeStatus, 'changed');
  const originalMarker = `${projectPath.replaceAll('\\', '/')}/${markerName}`;
  assert.equal(existsSync(originalMarker), false, 'original project changed before apply');
  await api('/api/dsh-workbench/orchestration/worktree', 'POST', { action: 'apply', id, workerId: worker.id });
  assert.equal(existsSync(originalMarker), true, 'apply did not expose marker');
  await api('/api/dsh-workbench/orchestration/worktree', 'POST', { action: 'discard', id, workerId: worker.id });
  console.log(JSON.stringify({ ok: true, applyObserved: true, discardRequested: true }));
} finally {
  try { await api('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_remove', scope: 'all', projectPath, id }); } catch {}
  ws.close();
}
