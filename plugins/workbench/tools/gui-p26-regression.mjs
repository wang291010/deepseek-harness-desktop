#!/usr/bin/env node
/**
 * CDP GUI regression for P2.6 (Agent-page single/multi-AI conversation shell).
 *
 * Usage: node tools/gui-p26-regression.mjs [debugPort] [outDir] [probe]
 *   probe=1  -> only inspect page structure and exit
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const debugPort = process.argv[2] || '9224';
const outDir = process.argv[3] || 'C:/Users/wang2/.codex/visualizations/2026/08/19/01a01abc-ea70-7b00-b2d3-6ed17ee5bb0b';
const probeOnly = process.argv[4] === '1';
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

const inspect = () => evaluate(`(() => {
  const buttons = [...document.querySelectorAll('button')].map((b) => ({
    text: (b.textContent || '').trim().slice(0, 40),
    title: b.title || '',
    cls: (b.className || '').toString().slice(0, 80),
    disabled: b.disabled
  }));
  return {
    title: document.title,
    url: location.href,
    hasWbChatShell: !!document.querySelector('.wb-chat-shell'),
    hasModebar: !!document.querySelector('.wb-chat-modebar'),
    hasNativeComposer: !!document.querySelector('[data-composer-seat]'),
    textareas: [...document.querySelectorAll('textarea')].map((t) => (t.placeholder || '').slice(0, 60)),
    navButtons: buttons.filter((b) => /Agent|工作台|任务|知识|风格|监控|流程/.test(b.text + b.title)).slice(0, 30),
    buttons: buttons.slice(0, 50),
    snippet: document.body.innerText.slice(0, 800)
  };
})()`);

try {
  await send('Page.enable');
  await send('Runtime.enable');
  if (!probeOnly) await send('Page.reload', { ignoreCache: true });
  await wait(probeOnly ? 1500 : 7000);

  console.log('step: inspect agent workspace');
  const state = await inspect();
  console.log(JSON.stringify(state, null, 2));
  if (probeOnly) process.exit(0);

  console.log('step: navigate to Agent page');
  const nav = await evaluate(`(() => {
    const active = document.querySelector('.wb-nav-btn-main.wb-nav-btn-active');
    if (active && (active.title || active.textContent || '').includes('Agent')) return { ok: true, already: true };
    const candidates = [
      ...[...document.querySelectorAll('button')].find((b) => (b.title || b.textContent || '').trim() === 'Agent 工作区'),
      ...[...document.querySelectorAll('.wb-nav-btn')].find((b) => (b.title || b.textContent || '').includes('Agent'))
    ].filter(Boolean);
    if (!candidates.length) return { ok: false, reason: 'agent nav missing', buttons: [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim().slice(0, 30)) };
    candidates[0].click();
    return { ok: true };
  })()`);
  if (!nav.ok) throw new Error(JSON.stringify(nav));
  await wait(2500);

  const agentState = await inspect();
  console.log('agent page state: ' + JSON.stringify(agentState, null, 2));
  if (!agentState.hasWbChatShell || !agentState.hasModebar) {
    throw new Error('agent chat shell/modebar missing: ' + JSON.stringify(agentState));
  }

  console.log('step: switch to root session (临时学习) if present');
  const sessionSwitch = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.wb-sp-row')];
    const target = rows.find((row) => (row.querySelector('.wb-sp-title') || {}).textContent === '临时学习' && !row.className.includes('active'));
    if (!target) return { ok: false };
    target.click();
    return { ok: true };
  })()`);
  console.log('session switch: ' + JSON.stringify(sessionSwitch));
  await wait(1800);
  await shot('p26-agent-single.png');

  console.log('step: switch to multi AI');
  const multi = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.wb-chat-modebar button')].find((b) => (b.textContent || '').replace(/\\s/g, '') === '多AI');
    if (!btn) return { ok: false, buttons: [...document.querySelectorAll('.wb-chat-modebar button')].map((b) => (b.textContent || '').trim()) };
    btn.click();
    return { ok: true };
  })()`);
  if (!multi.ok) throw new Error(JSON.stringify(multi));
  await wait(1200);
  const multiState = await evaluate(`(() => ({
    shellMulti: !!document.querySelector('.wb-chat-shell-multi'),
    nativeHidden: (() => { const seat = document.querySelector('.wb-chat-shell-multi [data-composer-seat]'); if (!seat) return true; return getComputedStyle(seat).visibility === 'hidden' && getComputedStyle(seat).pointerEvents === 'none'; })(),
    textareas: [...document.querySelectorAll('.wb-chat-compose textarea')].map((t) => (t.placeholder || '').slice(0, 80)),
    hasStrategy: document.body.innerText.includes('自动') || document.body.innerText.includes('始终编排'),
    hasComplexity: document.body.innerText.includes('复杂度'),
    modeButtons: [...document.querySelectorAll('.wb-chat-modebar button')].map((b) => (b.textContent || '').trim())
  }))()`);
  console.log('multi state: ' + JSON.stringify(multiState, null, 2));
  if (!multiState.shellMulti || !multiState.nativeHidden || !multiState.textareas.length) {
    throw new Error('multi-AI shell regression failed: ' + JSON.stringify(multiState));
  }
  await shot('p26-agent-multi.png');

  console.log('step: open @ reference overlay');
  const refOpen = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.wb-chat-compose-tools button')].find((b) => (b.textContent || '').trim() === '@' || b.title === '引用想法或文件');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!refOpen) throw new Error('reference button missing');
  await wait(600);
  const refState = await evaluate(`(() => ({
    popVisible: !!document.querySelector('.wb-chat-ref-pop'),
    searchPlaceholder: (() => { const input = document.querySelector('.wb-chat-ref-search'); return input ? input.placeholder : ''; })(),
    itemCount: document.querySelectorAll('.wb-chat-ref-item').length
  }))()`);
  console.log('ref state: ' + JSON.stringify(refState, null, 2));
  if (!refState.popVisible || !refState.searchPlaceholder) throw new Error('reference overlay failed: ' + JSON.stringify(refState));
  await shot('p26-agent-refs.png');
  await evaluate(`(() => { const btn = [...document.querySelectorAll('.wb-chat-compose-tools button')].find((b) => (b.textContent || '').trim() === '@' || b.title === '引用想法或文件'); if (btn) btn.click(); return true; })()`);
  await wait(300);

  console.log('step: open project context dialog');
  const ctxOpen = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.wb-chat-icon-btn')].find((b) => (b.title || '').includes('项目上下文'));
    if (!btn) return { ok: false, disabled: btn ? btn.disabled : null, iconButtons: [...document.querySelectorAll('.wb-chat-icon-btn')].map((b) => b.title) };
    if (btn.disabled) return { ok: false, disabled: true, iconButtons: [...document.querySelectorAll('.wb-chat-icon-btn')].map((b) => b.title) };
    btn.click();
    return { ok: true };
  })()`);
  if (ctxOpen.ok) {
    await wait(700);
    const ctxState = await evaluate(`(() => ({
      dialog: !!document.querySelector('.wb-chat-context-dialog'),
      labels: [...document.querySelectorAll('.wb-chat-context-dialog label')].map((l) => (l.textContent || '').trim().slice(0, 30)),
      hasSave: [...document.querySelectorAll('.wb-chat-context-dialog button')].some((b) => b.textContent.includes('保存'))
    }))()`);
    console.log('ctx state: ' + JSON.stringify(ctxState, null, 2));
    if (!ctxState.dialog || !ctxState.hasSave) throw new Error('project context dialog failed: ' + JSON.stringify(ctxState));
    await shot('p26-agent-context.png');
    await evaluate(`(() => { const btn = [...document.querySelectorAll('.wb-chat-context-dialog button')].find((b) => b.textContent.trim() === '取消'); if (btn) btn.click(); return true; })()`);
    await wait(300);
  } else {
    console.log('ctx skipped (session may have no project): ' + JSON.stringify(ctxOpen));
  }

  console.log('step: probe models via host API');
  let probe = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    probe = await pageApi('/api/dsh-workbench/models/probe', 'POST', { force: attempt === 0 }).catch((error) => ({ apiError: String((error && error.message) || error) }));
    if (probe && !probe.apiError) break;
  }
  console.log('probe result: ' + JSON.stringify(probe, null, 2).slice(0, 3000));
  if (!probe || probe.apiError) throw new Error('models/probe failed: ' + JSON.stringify(probe));
  const probeSummary = probe.probe ? {
    status: probe.probe.status,
    availableCount: probe.probe.availableCount,
    totalCount: probe.probe.totalCount,
    catalogCount: probe.probe.catalogCount,
    skippedCount: probe.probe.skippedCount,
    first: (probe.probe.results || [])[0] || null
  } : { models: probe.models };
  console.log('probe summary: ' + JSON.stringify(probeSummary, null, 2));

  console.log('step: send a quick real message through multi-AI composer');
  let sent = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    sent = await evaluate(`(() => {
      const area = document.querySelector('.wb-chat-compose textarea');
      if (!area) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(area, '一句话说明你正在做什么，用于验证主代理结果进入对话窗口。');
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    if (sent) break;
    await wait(600);
  }
  if (!sent) throw new Error('multi-AI composer textarea missing');
  await wait(400);
  const sendBtn = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.wb-chat-send')].find((b) => !b.disabled);
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!sendBtn) throw new Error('send button missing/disabled');

  let finalState = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await wait(3000);
    finalState = await evaluate(`(() => {
      const card = document.querySelector('.wb-chat-progress');
      const probeText = card ? (card.querySelector('.wb-chat-probe') || {}).textContent || '' : '';
      const report = card ? (card.querySelector('.wb-chat-report') || {}).textContent || '' : '';
      const err = card ? (card.querySelector('.wb-err-note, .wb-chat-error, [class*="err"]') || {}).textContent || '' : '';
      const phaseText = card ? (card.querySelector('.wb-chat-progress-head') || {}).textContent || '' : '';
      const flow = document.querySelector('.wb-chat-flow');
      const done = (flow && !!flow.querySelector('.wb-chat-msg-assistant')) || err.length > 0 || phaseText.includes('失败') || phaseText.includes('已拒绝') || phaseText.includes('已完成') || phaseText.includes('等待验收');
      return { card: !!card, probeText, report: report.slice(0, 200), err: err.slice(0, 200), phaseText: phaseText.slice(0, 120), done, flowUser: !!document.querySelector('.wb-chat-flow .wb-chat-msg-user'), flowAssistant: !!document.querySelector('.wb-chat-flow .wb-chat-msg-assistant'), flowText: flow ? flow.textContent.slice(0, 240) : '', busyRow: !!document.querySelector('.wb-chat-agent-busy') };
    })()`);
    if (finalState.done) break;
    if (attempt === 20) await shot('p26-agent-running.png');
  }
  console.log('final chat state: ' + JSON.stringify(finalState, null, 2));
  if (!finalState.card) throw new Error('progress card never appeared');
  if (!finalState.done) throw new Error('orchestration did not finish in time: ' + JSON.stringify(finalState));
  if (!finalState.flowUser || !finalState.flowAssistant) throw new Error('main-agent result did not appear in the conversation flow: ' + JSON.stringify(finalState));
  await shot('p26-agent-final.png');

  console.log('step: open task center from chat card');
  const jump = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.wb-chat-progress button')].find((b) => b.textContent.includes('在任务中心查看完整记录'));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!jump) throw new Error('task-center jump button missing');
  await wait(2500);
  const taskCenterState = await evaluate(`(() => ({
    hasOrchestrate: document.body.innerText.includes('协作任务') || document.body.innerText.includes('AI COLLABORATION'),
    selectedTitle: (() => { const el = document.querySelector('.wb-orch-selected, .wb-collab-detail, [class*="orchestration"]'); return el ? el.textContent.trim().slice(0, 160) : ''; })(),
    snippet: document.body.innerText.slice(0, 500)
  }))()`);
  console.log('task center state: ' + JSON.stringify(taskCenterState, null, 2));
  await shot('p26-task-center.png');

  console.log(JSON.stringify({ multi: multiState, ref: refState, context: ctxOpen, probe: probeSummary, chat: finalState, taskCenter: taskCenterState }, null, 2));
  console.log('p2.6 GUI regression passed');
  process.exit(0);
} finally {
  try { ws.close(); } catch (e) { /* ignore */ }
}
