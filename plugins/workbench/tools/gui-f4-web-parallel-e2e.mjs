#!/usr/bin/env node
import assert from 'node:assert/strict';

const debugPort = process.argv[2] || '9224';
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
async function poll(read, accept, label, timeoutMs = 360000) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) { last = await read(); if (accept(last)) return last; await wait(700); }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
}
const context = await evaluate(`(() => { const current=JSON.parse(localStorage.getItem('dsh.sessions.current')||'{}').sessionId||''; const urls=performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/api/dsh-workbench/tasks/list?')); const match=[...urls].reverse().map(n=>new URL(n)).find(u=>u.searchParams.get('sessionId')===current&&u.searchParams.get('projectPath')); return {sessionId:current,projectPath:match?match.searchParams.get('projectPath'):''}; })()`);
assert(context.sessionId && context.projectPath, `unable to resolve live context: ${JSON.stringify(context)}`);

const marker = `F4 Web 并发实机验证 ${new Date().toISOString()}`;
const listPath = `/api/dsh-workbench/tasks/list?scope=all&projectPath=${encodeURIComponent(context.projectPath)}&sessionId=${encodeURIComponent(context.sessionId)}`;
const mutationPath = '/api/dsh-workbench/tasks/mutate';
let orchestrationId = '';
try {
  const created = await pageApi(mutationPath, 'POST', { action: 'orchestration_create', scope: 'all', projectPath: context.projectPath, sourceSessionId: context.sessionId, title: marker, idea: '只读验证知识检索多问题 Web fallback 并发，不修改任何文件。' });
  const orchestration = created.orchestrations.find((item) => item.title === marker);
  assert(orchestration); orchestrationId = orchestration.id;
  const exactQuery = '查询 2026 年 RAG 最新基准？另外查询 2026 年主流向量数据库价格？同时查询最新 AI 隐私法规变化？';
  await pageApi(mutationPath, 'POST', {
    action: 'orchestration_set_plan', scope: 'all', projectPath: context.projectPath, id: orchestrationId, modelPolicy: 'balanced',
    plan: {
      title: marker, summary: '三路 Web fallback 并发 trace 验收。', strategy: '单个只读 worker 先检索知识库，再严格按返回 webQueries 同批联网。', maxParallel: 1,
      mainAgent: { id: 'main', name: 'F4 汇总', role: '主代理', mission: '汇总 worker 结果并说明 trace 由外部验收脚本判定。', readOnly: true },
      workers: [{ id: 'web', name: '三路联网验证', role: '检索验证员', dependsOn: [], readOnly: true, acceptance: '完成三路联网并输出 F4_WEB_OK', task: `必须按以下步骤执行：1. 先用 knowledge_search 搜索完全相同的字符串：${exactQuery} 2. 读取返回的 webQueries。3. 在紧接着的同一个 assistant 工具调用批次中，一次性发出每条 webQueries 对应的 web_search，禁止串行等待，最多三路。4. 汇总并输出 F4_WEB_OK。禁止修改文件。` }],
      acceptanceCriteria: ['worker 完成', 'trace hasParallelWebEvidence=true']
    }
  });
  await pageApi('/api/dsh-workbench/knowledge/traces', 'POST', { action: 'clear' });
  await pageApi(mutationPath, 'POST', { action: 'orchestration_start', scope: 'all', projectPath: context.projectPath, id: orchestrationId });
  const terminal = await poll(async () => (await pageApi(listPath)).orchestrations.find((item) => item.id === orchestrationId), (item) => item && ['review', 'failed', 'cancelled'].includes(item.phase), 'F4 orchestration terminal');
  assert.equal(terminal.phase, 'review', terminal.runtimeError);
  const worker = terminal.workers.find((item) => item.id === 'web');
  assert(worker && worker.status === 'completed', worker && worker.error);
  assert.match(worker.output, /F4_WEB_OK/);
  const traces = await pageApi(`/api/dsh-workbench/knowledge/traces?sessionId=${encodeURIComponent(worker.sessionId)}&limit=30`);
  assert.equal(traces.summary.hasParallelWebEvidence, true, JSON.stringify(traces.summary));
  assert(traces.summary.webCalls >= 2, JSON.stringify(traces.summary));
  assert(traces.summary.webOverlapPairs.some((pair) => pair.overlapMs > 0));
  console.log(JSON.stringify({ ok: true, orchestrationId, workerSessionId: worker.sessionId, webCalls: traces.summary.webCalls, webParallelBatches: traces.summary.webParallelBatches, webOverlapPairs: traces.summary.webOverlapPairs, outputChars: worker.output.length }, null, 2));
} finally {
  if (orchestrationId) {
    await pageApi(mutationPath, 'POST', { action: 'orchestration_cancel', scope: 'all', projectPath: context.projectPath, id: orchestrationId }).catch(() => {});
    await pageApi(mutationPath, 'POST', { action: 'orchestration_remove', scope: 'all', projectPath: context.projectPath, id: orchestrationId }).catch(() => {});
  }
  ws.close();
}
