#!/usr/bin/env node
import assert from 'node:assert/strict';

const debugPort = process.argv[2] || '9224';
const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:')) || targets.find((item) => item.type === 'page');
assert(target, 'no browser page target');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
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
  const expression = `fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { 'content-type': 'application/json' }, body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))} }).then(async (response) => { const text = await response.text(); const value = text ? JSON.parse(text) : null; if (!response.ok) throw new Error(JSON.stringify(value)); return value; })`;
  return evaluate(expression);
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function poll(read, accept, label, timeoutMs = 360000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) return last;
    await wait(500);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

const context = await evaluate(`(() => {
  const current = JSON.parse(localStorage.getItem('dsh.sessions.current') || '{}').sessionId || '';
  const urls = performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/api/dsh-workbench/tasks/list?'));
  const match = [...urls].reverse().map((name) => new URL(name)).find((url) => url.searchParams.get('sessionId') === current && url.searchParams.get('projectPath'));
  return { sessionId: current, projectPath: match ? match.searchParams.get('projectPath') : '' };
})()`);
assert(context.sessionId && context.projectPath, `unable to resolve live session/project: ${JSON.stringify(context)}`);

const marker = `F1 异步回传实机验证 ${new Date().toISOString()}`;
const listPath = `/api/dsh-workbench/tasks/list?scope=all&projectPath=${encodeURIComponent(context.projectPath)}&sessionId=${encodeURIComponent(context.sessionId)}`;
const mutationPath = '/api/dsh-workbench/tasks/mutate';
let orchestrationId = '';
try {
  const created = await pageApi(mutationPath, 'POST', {
    action: 'orchestration_create', scope: 'all', projectPath: context.projectPath, sourceSessionId: context.sessionId,
    title: marker, idea: '只读验证 F1 continuable 异步回传、动态并行槽和依赖提前唤醒；禁止修改任何文件。'
  });
  const orchestration = created.orchestrations.find((item) => item.title === marker);
  assert(orchestration, 'temporary orchestration was not created');
  orchestrationId = orchestration.id;
  await pageApi(mutationPath, 'POST', {
    action: 'orchestration_set_plan', scope: 'all', projectPath: context.projectPath, id: orchestrationId, modelPolicy: 'balanced',
    plan: {
      title: marker, summary: '真实桌面只读并行回传验收。', strategy: '两个根任务并行；第三个任务只依赖快任务，必须无需等待无关慢任务。', maxParallel: 2,
      mainAgent: { id: 'main', name: 'F1 验收汇总', role: '主代理', mission: '只汇总三个 worker 的验收标记和时序，不修改文件。', readOnly: true },
      workers: [
        { id: 'fast', name: '快速标记', role: '快速验证员', task: '不要调用工具，不要读取文件，只回复 FAST_OK 和一句当前任务说明。', dependsOn: [], acceptance: '输出包含 FAST_OK', readOnly: true },
        { id: 'slow', name: '独立深读', role: '只读审阅员', task: '只读检查 docs/多Agent协作改造方案-2026-08-24.md 和 plugins/workbench/lib/host/index.js 中 F1 动态并行槽相关实现，列出至少 8 个有文件或函数依据的核对点，最后输出 SLOW_OK；禁止修改文件。', dependsOn: [], acceptance: '输出包含 SLOW_OK 且至少 8 个核对点', readOnly: true },
        { id: 'dependent', name: '提前唤醒验证', role: '依赖验证员', task: '确认依赖任务 fast 已完成，然后不要调用工具，只回复 DEPENDENT_OK 并说明你没有等待 slow 的业务依赖。', dependsOn: ['fast'], acceptance: '输出包含 DEPENDENT_OK', readOnly: true }
      ],
      acceptanceCriteria: ['三个 worker 完成', '全部使用 continuable', 'dependent.startedAt 早于 slow.completedAt']
    }
  });
  await pageApi(mutationPath, 'POST', { action: 'orchestration_start', scope: 'all', projectPath: context.projectPath, id: orchestrationId });
  const terminal = await poll(
    async () => (await pageApi(listPath)).orchestrations.find((item) => item.id === orchestrationId),
    (item) => item && ['review', 'failed', 'cancelled'].includes(item.phase),
    'orchestration terminal state'
  );
  assert.equal(terminal.phase, 'review', terminal.runtimeError || 'orchestration did not reach review');
  const byId = Object.fromEntries(terminal.workers.map((worker) => [worker.id, worker]));
  assert.deepEqual(Object.keys(byId).sort(), ['dependent', 'fast', 'slow']);
  for (const id of ['fast', 'slow', 'dependent']) {
    assert.equal(byId[id].status, 'completed', `${id}: ${byId[id].error}`);
    assert.equal(byId[id].deliveryMode, 'continuable', `${id} did not use official continuable delivery`);
    assert(byId[id].deliveredAt, `${id} missing deliveredAt`);
  }
  assert.match(byId.fast.output, /FAST_OK/);
  assert.match(byId.slow.output, /SLOW_OK/);
  assert.match(byId.dependent.output, /DEPENDENT_OK/);
  const dependentStart = Date.parse(byId.dependent.startedAt);
  const slowEnd = Date.parse(byId.slow.completedAt);
  assert(Number.isFinite(dependentStart) && Number.isFinite(slowEnd));
  assert(dependentStart < slowEnd, `dependent did not start before unrelated slow worker completed: ${byId.dependent.startedAt} >= ${byId.slow.completedAt}`);
  console.log(JSON.stringify({
    ok: true, orchestrationId, phase: terminal.phase, jobId: terminal.jobId,
    timing: Object.fromEntries(Object.entries(byId).map(([id, worker]) => [id, { startedAt: worker.startedAt, deliveredAt: worker.deliveredAt, completedAt: worker.completedAt, deliveryMode: worker.deliveryMode, attempts: worker.attempts }])),
    dependentLeadMs: slowEnd - dependentStart,
    finalReportChars: String(terminal.finalReport || '').length
  }, null, 2));
} finally {
  if (orchestrationId) {
    await pageApi(mutationPath, 'POST', { action: 'orchestration_cancel', scope: 'all', projectPath: context.projectPath, id: orchestrationId }).catch(() => {});
    await pageApi(mutationPath, 'POST', { action: 'orchestration_remove', scope: 'all', projectPath: context.projectPath, id: orchestrationId }).catch(() => {});
  }
  ws.close();
}
