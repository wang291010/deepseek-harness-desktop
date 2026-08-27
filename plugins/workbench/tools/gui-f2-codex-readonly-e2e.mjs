#!/usr/bin/env node
import assert from 'node:assert/strict';

const debugPort = process.argv[2] || '9224';
const productProvider = process.argv[3] || 'codex';
const providerLabel = productProvider === 'claude-code' ? 'Claude' : 'Codex';
const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page');
assert(target, `no browser page target on CDP ${debugPort}`);
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
async function pageApi(path, method = 'GET', body) {
  const expression = `fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { 'content-type': 'application/json' }, body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))} }).then(async (response) => { const text = await response.text(); const value = text ? JSON.parse(text) : null; if (!response.ok) throw new Error(JSON.stringify(value)); return value; })`;
  return evaluate(expression);
}
const context = await evaluate(`(() => {
  const sessionId = JSON.parse(localStorage.getItem('dsh.sessions.current') || '{}').sessionId || '';
  const urls = performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/api/dsh-workbench/tasks/list?'));
  const match = [...urls].reverse().map((name) => new URL(name)).find((url) => url.searchParams.get('sessionId') === sessionId && url.searchParams.get('projectPath'));
  return { sessionId, projectPath: match ? match.searchParams.get('projectPath') : '' };
})()`);
assert(context.sessionId && context.projectPath, `unable to resolve live session/project: ${JSON.stringify(context)}`);

const title = `F2 ${providerLabel} 真实只读验收 ${new Date().toISOString()}`;
const listPath = `/api/dsh-workbench/tasks/list?scope=all&projectPath=${encodeURIComponent(context.projectPath)}&sessionId=${encodeURIComponent(context.sessionId)}`;
const mutationPath = '/api/dsh-workbench/tasks/mutate';
let orchestrationId = '';
try {
  const created = await pageApi(mutationPath, 'POST', { action: 'orchestration_create', scope: 'all', projectPath: context.projectPath, sourceSessionId: context.sessionId, title, idea: `验证 ${providerLabel} 轨道 B 真实只读 worker；禁止修改任何文件。` });
  orchestrationId = created.orchestrations.find((item) => item.title === title)?.id || '';
  assert(orchestrationId, 'temporary orchestration was not created');
  await pageApi(mutationPath, 'POST', {
    action: 'orchestration_set_plan', scope: 'all', projectPath: context.projectPath, id: orchestrationId, modelPolicy: 'balanced',
    plan: {
      title, summary: `${providerLabel} 轨道 B 只读验收`, strategy: '单个只读 worker', maxParallel: 1,
      mainAgent: { id: 'main', name: '主协调', role: '协调', mission: '汇总验收结果', readOnly: true },
      workers: [{ id: `${productProvider}-readonly`, name: `${providerLabel} 只读验收`, role: '只读审阅员', task: `只读检查项目根目录 README.md 的标题，回复 ${productProvider.toUpperCase()}_TRACK_B_OK；禁止修改任何文件。`, dependsOn: [], acceptance: `输出包含 ${productProvider.toUpperCase()}_TRACK_B_OK`, readOnly: true, executionTrack: 'B', productProvider }],
      acceptanceCriteria: ['worker 完成', `使用轨道 B ${providerLabel}`]
    }
  });
  await pageApi(mutationPath, 'POST', { action: 'orchestration_start', scope: 'all', projectPath: context.projectPath, id: orchestrationId });
  let record;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const snapshot = await pageApi(listPath);
    record = snapshot.orchestrations.find((item) => item.id === orchestrationId);
    if (record && ['review', 'failed', 'cancelled'].includes(record.phase)) break;
  }
  assert(record, 'orchestration record disappeared');
  const worker = record.workers?.[0];
  console.log(JSON.stringify({
    id: orchestrationId,
    phase: record.phase,
    runtimeError: record.runtimeError,
    worker: worker && {
      status: worker.status,
      readOnly: worker.readOnly,
      executionTrack: worker.executionTrack,
      usedExecutionTrack: worker.usedExecutionTrack,
      productProvider: worker.productProvider,
      usedSubagentProvider: worker.usedSubagentProvider,
      deliveryMode: worker.deliveryMode,
      error: worker.error,
      output: String(worker.output || '').slice(0, 500)
    }
  }, null, 2));
  assert.equal(record.phase, 'review', record.runtimeError || 'Codex track B did not reach review');
  assert.equal(worker.status, 'completed', worker.error || 'Codex worker did not complete');
  assert.equal(worker.readOnly, true);
  assert.equal(worker.usedExecutionTrack, 'B');
  assert.equal(worker.usedSubagentProvider, productProvider);
  assert.match(worker.output, new RegExp(`${productProvider.toUpperCase()}_TRACK_B_OK`));
} finally {
  if (orchestrationId) {
    await pageApi(mutationPath, 'POST', { action: 'orchestration_cancel', scope: 'all', projectPath: context.projectPath, id: orchestrationId }).catch(() => {});
    await pageApi(mutationPath, 'POST', { action: 'orchestration_remove', scope: 'all', projectPath: context.projectPath, id: orchestrationId }).catch(() => {});
  }
  ws.close();
}
