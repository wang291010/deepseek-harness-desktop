#!/usr/bin/env node
import assert from 'node:assert/strict';

const debugPort = process.argv[2] || '9225';
const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:')) || targets.find((item) => item.type === 'page');
assert(target, 'no browser page target');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const waiter = pending.get(message.id); pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
});
function send(method, params = {}) {
  const id = ++nextId; ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`cdp timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } });
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function pageApi(path, method = 'GET', body) {
  return evaluate(`fetch(${JSON.stringify(path)}, {method:${JSON.stringify(method)},headers:{'content-type':'application/json'},body:${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))}}).then(async r=>{const t=await r.text();const v=t?JSON.parse(t):null;if(!r.ok)throw new Error(JSON.stringify(v));return v;})`);
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function poll(read, accept, label, timeoutMs = 420000) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) { last = await read(); if (accept(last)) return last; await wait(600); }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

const context = await evaluate(`(() => { const current=JSON.parse(localStorage.getItem('dsh.sessions.current')||'{}').sessionId||''; const urls=performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/api/dsh-workbench/tasks/list?')); const match=[...urls].reverse().map(n=>new URL(n)).find(u=>u.searchParams.get('sessionId')===current&&u.searchParams.get('projectPath')); return {sessionId:current,projectPath:match?match.searchParams.get('projectPath'):''}; })()`);
assert(context.sessionId && context.projectPath, `unable to resolve live context: ${JSON.stringify(context)}`);
const suffix = Date.now().toString(36);
const marker = `G1 只读自动并行实机验证 ${suffix}`;
const idea = '同时回答第一个独立问题：17 加 25 等于多少？另外回答第二个独立问题：法国首都是哪里？并且回答第三个独立问题：十六进制 FF 对应十进制多少？';
const listPath = `/api/dsh-workbench/tasks/list?scope=all&projectPath=${encodeURIComponent(context.projectPath)}&sessionId=${encodeURIComponent(context.sessionId)}`;
const mutationPath = '/api/dsh-workbench/tasks/mutate';
let orchestrationId = '';
try {
  const created = await pageApi(mutationPath, 'POST', { action: 'orchestration_create', scope: 'all', projectPath: context.projectPath, sourceSessionId: context.sessionId, title: marker, idea, autoParallel: true, parallelCount: 3 });
  const orchestration = created.orchestrations.find((item) => item.title === marker);
  assert(orchestration); orchestrationId = orchestration.id;
  await pageApi(mutationPath, 'POST', { action: 'orchestration_plan', scope: 'all', projectPath: context.projectPath, id: orchestrationId, probeModels: false, modelPolicy: 'balanced' });
  const planned = await poll(async () => (await pageApi(listPath)).orchestrations.find((item) => item.id === orchestrationId), (item) => item && ['planned', 'failed'].includes(item.phase), 'G1 planned');
  assert.equal(planned.phase, 'planned', planned.runtimeError);
  assert.equal(planned.workers.length, 3);
  assert.equal(planned.maxParallel, 3);
  assert(planned.workers.every((worker) => worker.readOnly === true && worker.dependsOn.length === 0));
  await pageApi(mutationPath, 'POST', { action: 'orchestration_start', scope: 'all', projectPath: context.projectPath, id: orchestrationId });
  const terminal = await poll(async () => (await pageApi(listPath)).orchestrations.find((item) => item.id === orchestrationId), (item) => item && ['review', 'failed', 'cancelled'].includes(item.phase), 'G1 terminal');
  assert.equal(terminal.phase, 'review', JSON.stringify({ runtimeError: terminal.runtimeError, workers: terminal.workers.map((worker) => ({ name: worker.name, status: worker.status, error: worker.error })) }, null, 2));
  const starts = terminal.workers.map((worker) => Date.parse(worker.startedAt));
  const ends = terminal.workers.map((worker) => Date.parse(worker.completedAt));
  assert(starts.every(Number.isFinite) && ends.every(Number.isFinite));
  assert(Math.max(...starts) < Math.min(...ends), `workers did not overlap: ${JSON.stringify({ starts, ends })}`);
  console.log(JSON.stringify({ ok: true, autoParallel: terminal.autoParallel, workerCount: terminal.workers.length, maxParallel: terminal.maxParallel, overlapMs: Math.min(...ends) - Math.max(...starts), workers: terminal.workers.map((worker) => ({ name: worker.name, startedAt: worker.startedAt, completedAt: worker.completedAt, output: worker.output.slice(0, 160) })) }, null, 2));
} finally {
  if (orchestrationId) {
    await pageApi(mutationPath, 'POST', { action: 'orchestration_cancel', scope: 'all', projectPath: context.projectPath, id: orchestrationId }).catch(() => {});
    await pageApi(mutationPath, 'POST', { action: 'orchestration_remove', scope: 'all', projectPath: context.projectPath, id: orchestrationId }).catch(() => {});
  }
  ws.close();
}
