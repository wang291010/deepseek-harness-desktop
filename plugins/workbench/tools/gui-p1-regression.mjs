#!/usr/bin/env node
/**
 * CDP GUI regression for P1A / P1B verification queue:
 * task-center subviews, AI-collab quick-add, idea handoff entry, folder picker,
 * session menu, file view tab, experts page. Real execution is covered by
 * gui-p26/p27 scripts; this focuses on structural + fast interactions.
 *
 * Usage: node tools/gui-p1-regression.mjs [debugPort] [outDir]
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
    new Promise((_, reject) => setTimeout(() => { pending.delete(id); reject(new Error('cdp timeout: ' + method)); }, 30000))
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

const clickNav = (label) => evaluate(`(() => {
  const b = [...document.querySelectorAll('.wb-nav-btn')].find((x) => (x.title || x.textContent || '').trim() === ${JSON.stringify(label)});
  if (b) b.click();
  return !!b;
})()`);

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.reload', { ignoreCache: true });
  await wait(7000);

  console.log('step: session panel structural checks');
  const panel = await evaluate(`(() => ({
    moreMenus: document.querySelectorAll('.wb-sp-menu').length,
    newSession: [...document.querySelectorAll('button')].some((b) => b.title === '新建会话'),
    createProject: [...document.querySelectorAll('button')].some((b) => b.title === '创建新项目'),
    modeSwitch: !!document.querySelector('.wb-chat-mode-switch')
  }))()`);
  console.log('panel: ' + JSON.stringify(panel, null, 2));
  if (!panel.moreMenus || !panel.newSession || !panel.createProject || !panel.modeSwitch) throw new Error('session panel missing elements: ' + JSON.stringify(panel));

  console.log('step: folder picker browse button');
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.title === '创建新项目'); if (b) b.click(); return !!b; })()`);
  await wait(500);
  const picker = await evaluate(`(() => ({
    browse: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '浏览…'),
    pathInput: !!document.querySelector('.wb-sp-newform input[type="text"], .wb-sp-newform input:not([type="file"])')
  }))()`);
  console.log('picker: ' + JSON.stringify(picker, null, 2));
  if (!picker.browse || !picker.pathInput) throw new Error('folder picker missing: ' + JSON.stringify(picker));
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.title === '创建新项目'); if (b) b.click(); return true; })()`);
  await wait(300);

  console.log('step: open task center and switch subviews');
  await clickNav('任务中心');
  await wait(1500);
  const taskTabs = await evaluate(`(() => {
    const tabs = [...document.querySelectorAll('button')].filter((b) => ['聚焦', '想法库', '任务', 'AI 协作', '复盘'].includes(b.textContent.trim()) && b.closest('[class*="task-center"]'));
    return tabs.map((t) => t.textContent.trim());
  })()`);
  console.log('task center tabs: ' + JSON.stringify(taskTabs, null, 2));
  if (!['聚焦', '想法库', '任务', 'AI 协作', '复盘'].every((label) => taskTabs.includes(label))) throw new Error('task center tabs incomplete: ' + JSON.stringify(taskTabs));
  const subviewResults = {};
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '任务' && x.closest('[class*="task-center"]')); if (b) b.click(); return !!b; })()`);
  await wait(700);
  for (const label of ['看板', '列表', '时间线', '模板']) {
    const clicked = await evaluate(`(() => { const b = [...document.querySelectorAll('.wb-task-subviews button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (b) b.click(); return !!b; })()`);
    await wait(500);
    const body = await evaluate(`(() => document.body.innerText.slice(0, 200))()`);
    subviewResults[label] = { clicked, rendered: body.length > 20 };
  }
  console.log('subviews: ' + JSON.stringify(subviewResults, null, 2));
  if (Object.values(subviewResults).some((entry) => !entry.clicked || !entry.rendered)) throw new Error('task center subview failed: ' + JSON.stringify(subviewResults));
  await shot('p1-task-center.png');

  console.log('step: AI collab quick-add');
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'AI 协作' && x.closest('[class*="task-center"]')); if (b) b.click(); return !!b; })()`);
  await wait(900);
  const quickAdd = await evaluate(`(() => {
    const area = [...document.querySelectorAll('textarea')].find((t) => (t.placeholder || '').includes('直接写任务或目标') || (t.placeholder || '').includes('输入问题，Enter'));
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '交给 AI 团队');
    return { hasInput: !!area, hasSubmit: !!btn };
  })()`);
  console.log('quick-add: ' + JSON.stringify(quickAdd, null, 2));
  if (!quickAdd.hasInput || !quickAdd.hasSubmit) throw new Error('AI collab quick-add missing: ' + JSON.stringify(quickAdd));
  await evaluate(`(() => {
    const area = [...document.querySelectorAll('textarea')].find((t) => (t.placeholder || '').includes('直接写任务或目标') || (t.placeholder || '').includes('输入问题，Enter'));
    if (!area) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(area, '');
    area.dispatchEvent(new Event('input', { bubbles: true }));
    area.dispatchEvent(new Event('change', { bubbles: true }));
    area.focus();
    return true;
  })()`);
  await send('Input.insertText', { text: 'P1 回归：快速创建并清理' });
  await wait(300);
  const createdId = await evaluate(`(async () => {
    const btn = [...document.querySelectorAll('button')].find((b) => ['交给 AI 团队', '发送问题'].includes(b.textContent.trim()) && !b.disabled);
    if (!btn) return null;
    btn.click();
    await new Promise((r) => setTimeout(r, 1000));
    const list = await fetch('/api/dsh-workbench/tasks/list?scope=all').then((r) => r.json());
    const rec = (list.orchestrations || []).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).find((o) => o.idea === 'P1 回归：快速创建并清理');
    return rec ? rec.id : null;
  })()`);
  console.log('quick-add created: ' + createdId);
  if (!createdId) throw new Error('quick-add did not create an orchestration');
  await pageApi('/api/dsh-workbench/tasks/mutate', 'POST', { action: 'orchestration_remove', scope: 'all', id: createdId }).catch(() => {});

  console.log('step: ideas handoff entry');
  const ideasState = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '想法库' && x.closest('[class*="task-center"]'));
    if (b) b.click();
    return true;
  })()`);
  await wait(900);
  const ideas = await evaluate(`(() => ({
    hasList: document.querySelectorAll('.wb-collab-list-row, [class*="idea"]').length > 0,
    handoffButtonText: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => t.includes('交给 AI 团队') || t.includes('查看协作任务')) || ''
  }))()`);
  console.log('ideas: ' + JSON.stringify(ideas, null, 2));
  if (!ideas.handoffButtonText) throw new Error('ideas handoff entry missing: ' + JSON.stringify(ideas));

  console.log('step: close task center, open file view tab');
  await evaluate(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
  await wait(800);
  await evaluate(`(() => { const b = document.querySelector('.wb-tb-reopen'); if (b) b.click(); return !!b; })()`);
  await wait(900);
  await evaluate(`(() => { const b = [...document.querySelectorAll('.wb-tb-tab')].find((x) => x.textContent.trim() === '文件视图'); if (b) b.click(); return !!b; })()`);
  await wait(1200);
  const fileView = await evaluate(`(() => {
    const text = document.body.innerText;
    return { hasTitle: text.includes('文件视图'), rendered: text.length > 100 };
  })()`);
  console.log('file view: ' + JSON.stringify(fileView, null, 2));
  if (!fileView.hasTitle || !fileView.rendered) throw new Error('file view tab failed: ' + JSON.stringify(fileView));
  await shot('p1-file-view.png');

  console.log('step: experts page');
  await evaluate(`(() => { const b = document.querySelector('.wb-tb-close'); if (b) b.click(); return true; })()`);
  await wait(500);
  const expertsNav = await clickNav('专家');
  await wait(1200);
  const experts = await evaluate(`(() => {
    const text = document.body.innerText;
    return { navFound: ${'true'}, hasPage: text.includes('专家'), hasList: document.querySelectorAll('[class*="exp"], [class*="expert"]').length > 0, snippet: text.slice(0, 300) };
  })()`);
  console.log('experts: ' + JSON.stringify(experts, null, 2));
  if (!expertsNav || !experts.hasPage) throw new Error('experts page failed: ' + JSON.stringify(experts));
  await shot('p1-experts.png');

  console.log(JSON.stringify({ panel, picker, taskTabs, subviewResults, quickAdd, createdId, ideas, fileView, experts }, null, 2));
  console.log('p1/p1b GUI regression passed');
  process.exit(0);
} finally {
  try { ws.close(); } catch (e) { /* ignore */ }
}
