#!/usr/bin/env node
/**
 * CDP GUI regression for P2.7 follow-ups:
 * 1. Narrow-window layout (multi-AI shell, agent panel, flow messages must not overflow).
 * 2. "始终编排" complex task -> multi-worker plan -> execution -> main-agent summary.
 *
 * Usage: node tools/gui-p27-regression.mjs [debugPort] [outDir]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const debugPort = process.argv[2] || '9224';
const outDir = process.argv[3] || 'C:/Users/wang2/.codex/visualizations/2026/08/19/01a01abc-ea70-7b00-b2d3-6ed17ee5bb0b';
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
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
});
function send(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => { pending.delete(id); reject(new Error('cdp timeout: ' + method)); }, 20000))
  ]);
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

const shot = async (name) => {
  try { await send('Page.bringToFront'); } catch (e) { /* ignore */ }
  let capture = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      break;
    } catch (e) {
      if (attempt === 2) throw e;
      await wait(3000);
    }
  }
  const file = join(outDir, name);
  await writeFile(file, Buffer.from(capture.data, 'base64'));
  return file;
};

async function pageApi(path, method, body) {
  const expression = `fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { 'content-type': 'application/json' }, body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))} }).then((r) => r.text()).then((t) => { if (!t) throw new Error('empty response'); return JSON.parse(t); })`;
  return evaluate(expression);
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 980, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.reload', { ignoreCache: true });
  await wait(7000);

  console.log('step: navigate to Agent page and root session');
  await evaluate(`(() => {
    const active = document.querySelector('.wb-nav-btn-main.wb-nav-btn-active');
    if (!(active && (active.title || active.textContent || '').includes('Agent'))) {
      const b = [...document.querySelectorAll('button')].find((x) => (x.title || x.textContent || '').trim() === 'Agent 工作区');
      if (b) b.click();
    }
    return true;
  })()`);
  await wait(1200);
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.wb-sp-row')].find((r) => (r.querySelector('.wb-sp-title') || {}).textContent === '临时学习' && !r.className.includes('active'));
    if (row) row.click();
    return true;
  })()`);
  await wait(1500);

  console.log('step: switch to multi AI from sidebar');
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('.wb-chat-mode-switch button')].find((x) => (x.textContent || '').replace(/\\s/g, '') === '多AI');
    if (b) b.click();
    return !!b;
  })()`);
  await wait(1200);

  console.log('step: narrow-window layout checks');
  const narrow = await evaluate(`(() => {
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width) }; };
    const shell = document.querySelector('.wb-chat-shell-multi');
    const stack = document.querySelector('.wb-chat-multi-stack');
    const compose = document.querySelector('.wb-chat-compose');
    const modeSwitch = document.querySelector('.wb-chat-mode-switch');
    const overflowX = document.documentElement.scrollWidth - window.innerWidth;
    const contains = (r) => r && r.left >= -1 && r.right <= window.innerWidth + 1;
    return {
      vw: window.innerWidth,
      shell: rect(shell), stack: rect(stack), compose: rect(compose), modeSwitch: rect(modeSwitch),
      stackInside: contains(rect(stack)), composeInside: contains(rect(compose)), overflowX
    };
  })()`);
  console.log('narrow layout: ' + JSON.stringify(narrow, null, 2));
  if (!narrow.stackInside || !narrow.composeInside || narrow.overflowX > 1) {
    throw new Error('narrow-window layout overflow: ' + JSON.stringify(narrow));
  }
  await shot('p27-narrow-multi.png');

  console.log('step: force always-orchestrate and send a complex task');
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('.wb-chat-compose-tools button')].find((x) => (x.textContent || '').trim() === '自动');
    if (b) b.click();
    return !!b;
  })()`);
  await wait(500);
  const strategyState = await evaluate(`(() => {
    const b = [...document.querySelectorAll('.wb-chat-compose-tools button')].find((x) => (x.textContent || '').trim() === '始终编排');
    return { alwaysOn: !!b };
  })()`);
  console.log('strategy: ' + JSON.stringify(strategyState, null, 2));
  if (!strategyState.alwaysOn) throw new Error('always-orchestrate toggle failed');
  const taskText = '为简历生成器新增导出 PDF 功能：需要拆解为三个子任务（设计导出交互、实现 PDF 渲染、编写使用说明与测试），全部完成后由主代理汇总验收。';
  let sent = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    sent = await evaluate(`(() => {
      const area = document.querySelector('.wb-chat-compose textarea');
      if (!area) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(area, ${JSON.stringify(taskText)});
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    if (sent) break;
    await wait(600);
  }
  if (!sent) throw new Error('multi-AI composer textarea missing');
  await wait(400);
  await evaluate(`(() => { const b = [...document.querySelectorAll('.wb-chat-send')].find((x) => !x.disabled); if (b) b.click(); return !!b; })()`);

  let multiWorkerPlan = null;
  let finalState = null;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await wait(3000);
    finalState = await evaluate(`(() => {
      const flow = document.querySelector('.wb-chat-flow');
      const agents = document.querySelector('.wb-chat-agents');
      const done = !!flow && !!flow.querySelector('.wb-chat-msg-assistant');
      return { done, flowText: flow ? flow.textContent.slice(0, 160) : '', agentRows: agents ? agents.querySelectorAll('.wb-chat-agent-row').length : 0, collapsed: agents ? agents.className.includes('collapsed') : false };
    })()`);
    if (attempt === 30) await shot('p27-always-running.png');
    if (finalState.done) break;
  }
  console.log('final state: ' + JSON.stringify(finalState, null, 2));
  if (!finalState.done) throw new Error('always-orchestrate task did not finish in time');

  const list = await pageApi('/api/dsh-workbench/tasks/list?scope=all&projectPath=' + encodeURIComponent('D:\\临时学习'), 'GET');
  const record = (list.orchestrations || []).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).find((o) => o.idea && o.idea.includes('导出 PDF 功能'));
  multiWorkerPlan = record ? { id: record.id, phase: record.phase, workerCount: (record.workers || []).length, workerNames: (record.workers || []).map((w) => w.name).slice(0, 5), finalReport: (record.finalReport || '').slice(0, 80), taskId: record.taskId } : null;
  console.log('orchestration record: ' + JSON.stringify(multiWorkerPlan, null, 2));
  if (!multiWorkerPlan) throw new Error('orchestration record missing');
  if ((multiWorkerPlan.workerCount || 0) < 2) throw new Error('always-orchestrate should plan multiple workers: ' + JSON.stringify(multiWorkerPlan));
  const boardTask = (list.tasks || []).find((t) => t.id === multiWorkerPlan.taskId);
  console.log('board task: ' + JSON.stringify(boardTask ? { title: boardTask.title, status: boardTask.status, orchestrationId: boardTask.orchestrationId } : null, null, 2));
  if (!boardTask) throw new Error('orchestration board task missing');
  if (!['in_progress', 'blocked', 'completed', 'pending'].includes(boardTask.status)) throw new Error('unexpected board task status: ' + boardTask.status);
  await shot('p27-always-final.png');

  await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  console.log(JSON.stringify({ narrow, strategy: strategyState, final: finalState, orchestration: multiWorkerPlan, boardTask: boardTask && { status: boardTask.status } }, null, 2));
  console.log('p2.7 follow-up GUI regression passed');
  process.exit(0);
} finally {
  try { await send('Emulation.clearDeviceMetricsOverride'); } catch (e) { /* ignore */ }
  try { ws.close(); } catch (e) { /* ignore */ }
}
