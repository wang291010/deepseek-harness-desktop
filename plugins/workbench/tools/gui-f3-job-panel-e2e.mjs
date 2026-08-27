#!/usr/bin/env node
/**
 * Real-desktop F3 verification through CDP:
 * create a temporary read-only orchestration, observe it in the official
 * Job Panel, cancel it from Workbench, observe the killed terminal view,
 * then remove the temporary Workbench record.
 *
 * Usage: node tools/gui-f3-job-panel-e2e.mjs [debugPort] [outDir]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const debugPort = process.argv[2] || '9224';
const outDir = process.argv[3] || 'C:/YourWorkbench/artifacts/f3-job-panel-e2e';
await mkdir(outDir, { recursive: true });

const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:')) || targets.find((item) => item.type === 'page');
if (!target) throw new Error('no browser page target');

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
  const waiter = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
});

function send(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`cdp timeout: ${method}`));
    }, 30000);
    pending.set(id, {
      resolve(value) { clearTimeout(timer); resolve(value); },
      reject(error) { clearTimeout(timer); reject(error); }
    });
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
async function poll(read, accept, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await wait(80);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function screenshot(name) {
  await send('Page.bringToFront').catch(() => {});
  const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const path = join(outDir, name);
  await writeFile(path, Buffer.from(capture.data, 'base64'));
  return path;
}

const context = await evaluate(`(() => {
  const current = JSON.parse(localStorage.getItem('dsh.sessions.current') || '{}').sessionId || '';
  const urls = performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/api/dsh-workbench/tasks/list?'));
  const match = [...urls].reverse().map((name) => new URL(name)).find((url) => url.searchParams.get('sessionId') === current && url.searchParams.get('projectPath'));
  return { sessionId: current, projectPath: match ? match.searchParams.get('projectPath') : '' };
})()`);
if (!context.sessionId || !context.projectPath) throw new Error(`unable to resolve live session/project: ${JSON.stringify(context)}`);

const marker = `F3 Job Panel 实机验证 ${new Date().toISOString()}`;
const listPath = `/api/dsh-workbench/tasks/list?scope=all&projectPath=${encodeURIComponent(context.projectPath)}&sessionId=${encodeURIComponent(context.sessionId)}`;
const mutationPath = '/api/dsh-workbench/tasks/mutate';
let orchestrationId = '';
let jobId = '';

try {
  const created = await pageApi(mutationPath, 'POST', {
    action: 'orchestration_create',
    scope: 'all',
    projectPath: context.projectPath,
    sourceSessionId: context.sessionId,
    title: marker,
    idea: '临时只读验证任务：确认官方 Job Panel 能显示工作台编排。不要修改文件，只回复验证文本。'
  });
  const orchestration = created.orchestrations.find((item) => item.title === marker);
  if (!orchestration) throw new Error('temporary orchestration was not created');
  orchestrationId = orchestration.id;

  await pageApi(mutationPath, 'POST', {
    action: 'orchestration_set_plan',
    scope: 'all',
    projectPath: context.projectPath,
    id: orchestrationId,
    modelPolicy: 'balanced',
    plan: {
      title: marker,
      summary: '实机验证官方 Job Panel 投影。',
      strategy: '启动一个只读子代理并立即验证后台任务列表。',
      maxParallel: 1,
      mainAgent: { id: 'main', name: 'F3 验证汇总', role: '主代理', mission: '汇总验证结果', readOnly: true },
      workers: [{ id: 'f3-worker', name: 'F3 验证子代理', role: '验证员', task: '保持只读，检查当前目录后回复 F3 验证运行中；不要写文件。', dependsOn: [], acceptance: '返回一行验证文本', readOnly: true }],
      acceptanceCriteria: ['官方 Job Panel 出现 orchestration 任务']
    }
  });

  await pageApi(mutationPath, 'POST', {
    action: 'orchestration_start', scope: 'all', projectPath: context.projectPath, id: orchestrationId
  });

  const running = await poll(
    async () => (await pageApi(listPath)).orchestrations.find((item) => item.id === orchestrationId),
    (item) => Boolean(item && item.jobId),
    'persisted official job id'
  );
  jobId = running.jobId;

  const trigger = await poll(
    () => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((item) => /后台任务/.test(item.getAttribute('aria-label') || '')); return button ? { label: button.getAttribute('aria-label'), text: button.innerText } : null; })()`),
    Boolean,
    'official Job Panel trigger'
  );
  await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((item) => /后台任务/.test(item.getAttribute('aria-label') || '')); button.click(); return true; })()`);
  const runningRow = await poll(
    () => evaluate(`(() => { const menu = document.querySelector('[aria-label="后台任务"]'); return menu ? menu.innerText : ''; })()`),
    (text) => text.includes('orchestration') && text.includes(marker),
    'running orchestration row'
  );
  const runningShot = await screenshot('f3-job-panel-running.png');

  await pageApi(mutationPath, 'POST', {
    action: 'orchestration_cancel', scope: 'all', projectPath: context.projectPath, id: orchestrationId
  });
  const cancelled = await poll(
    async () => (await pageApi(listPath)).orchestrations.find((item) => item.id === orchestrationId),
    (item) => item && item.phase === 'cancelled',
    'Workbench cancelled state'
  );
  const killedRow = await poll(
    () => evaluate(`(() => { const menu = document.querySelector('[aria-label="后台任务"]'); return menu ? menu.innerText : ''; })()`),
    (text) => text.includes('orchestration') && text.includes(marker) && /cancelled|已取消|killed/.test(text),
    'killed Job Panel row'
  );
  const killedShot = await screenshot('f3-job-panel-killed.png');

  console.log(JSON.stringify({
    ok: true,
    sessionId: context.sessionId,
    projectPath: context.projectPath,
    orchestrationId,
    jobId,
    trigger,
    runningRow,
    killedRow,
    workbenchPhase: cancelled.phase,
    screenshots: [runningShot, killedShot]
  }, null, 2));
} finally {
  if (orchestrationId) {
    await pageApi(mutationPath, 'POST', {
      action: 'orchestration_cancel', scope: 'all', projectPath: context.projectPath, id: orchestrationId
    }).catch(() => {});
    await pageApi(mutationPath, 'POST', {
      action: 'orchestration_remove', scope: 'all', projectPath: context.projectPath, id: orchestrationId
    }).catch(() => {});
  }
  ws.close();
}
