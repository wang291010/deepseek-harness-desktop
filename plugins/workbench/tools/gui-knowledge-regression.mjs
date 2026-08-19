#!/usr/bin/env node
/**
 * CDP GUI regression for the P5 knowledge page (v3.1).
 *
 * Usage: node tools/gui-knowledge-regression.mjs [debugPort] [outDir]
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const debugPort = process.argv[2] || '9224';
const outDir = process.argv[3] || 'C:/Users/wang2/.codex/visualizations/2026/08/18/01a0172b-e0c6-7000-85b1-6caaee4593de';
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
    new Promise((_, reject) => setTimeout(() => {
      pending.delete(id);
      reject(new Error('cdp timeout: ' + method));
    }, 15000))
  ]);
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(expression) {
  const result = await Promise.race([
    send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('evaluate timeout')), 15000))
  ]);
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

const seedContent = [
  '---',
  'title: GUI 回归测试条目',
  'tags: [回归, gui]',
  'confidence: medium',
  'related: ""',
  'summary: 用于 CDP GUI 回归的临时条目。',
  'source: regression',
  'project: ',
  'created: ' + new Date().toISOString(),
  '---',
  '# GUI 回归测试条目',
  '这份临时知识用于验证检索结果卡片与溯源展示，回归结束后会删除。'
].join('\n');

try {
  console.log('step: reload');
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.reload', { ignoreCache: true });
  await wait(7000);

  console.log('step: navigate to knowledge page');
  const nav = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '知识库');
    if (!button) return { ok: false, reason: 'knowledge nav button missing' };
    button.click();
    return { ok: true };
  })()`);
  if (!nav.ok) throw new Error(JSON.stringify(nav));
  await wait(2500);

  console.log('step: dashboard checks');
  const dashState = await evaluate(`(() => {
    const text = document.body.innerText;
    return {
      hasTitle: text.includes('知识库'),
      hasDocs: text.includes('文档总数'),
      hasTrend: text.includes('近 7 天新增趋势'),
      hasTabs: ['增长与浏览','检索','蒸馏','维护','评测','向量设置'].every((label) => text.includes(label)),
      hasObsidian: [...document.querySelectorAll('button')].some((button) => button.textContent.includes('在 Obsidian 中打开')),
      hasCopy: [...document.querySelectorAll('button')].some((button) => button.textContent.includes('复制路径')),
      snippet: text.slice(0, 600)
    };
  })()`);
  if (!dashState.hasDocs || !dashState.hasTrend || !dashState.hasTabs) {
    throw new Error('dashboard regression failed: ' + JSON.stringify(dashState));
  }
  await shot('knowledge-dash.png');

  // seed one entry so search returns a real result card
  console.log('step: seed entry');
  const seeded = await pageApi('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'inbox', name: 'GUI回归测试条目', content: seedContent });
  if (!seeded.entry) throw new Error('seed entry failed');

  console.log('step: search tab');
  const searchNav = await evaluate(`(() => {
    const tab = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '检索');
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
  if (!searchNav) throw new Error('search tab missing');
  await wait(800);
  console.log('step: type query');
  await evaluate(`(() => {
    const input = [...document.querySelectorAll('input')].find((item) => (item.placeholder || '').includes('自然语言提问'));
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'GUI 回归 检索 测试');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await wait(300);
  console.log('step: run search');
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].filter((item) => item.textContent.trim() === '检索').pop();
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await wait(3000);
  console.log('step: search checks');
  const searchState = await evaluate(`(() => {
    const cards = document.querySelectorAll('.wb-knowledge-result-card');
    return {
      cardCount: cards.length,
      hasCitation: [...cards].some((card) => card.innerText.includes('溯源：')),
      hasRoute: document.body.innerText.includes('路由：'),
      snippet: cards.length ? cards[0].innerText.slice(0, 300) : document.body.innerText.slice(0, 300)
    };
  })()`);
  if (searchState.cardCount < 1 || !searchState.hasCitation) {
    throw new Error('search regression failed: ' + JSON.stringify(searchState));
  }
  await shot('knowledge-search.png');

  const distillNav = await evaluate(`(() => {
    const tab = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '蒸馏');
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
  if (!distillNav) throw new Error('distill tab missing');
  await wait(800);
  console.log('step: type distill content');
  await evaluate(`(() => {
    const area = [...document.querySelectorAll('textarea')].find((item) => (item.placeholder || '').includes('粘贴对话'));
    if (!area) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(area, '回归测试：上线时先备份运行副本再复制新文件，重启后端口会变化。');
    area.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await wait(300);
  console.log('step: run distill');
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '蒸馏入库');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  console.log('step: distill checks (polling)');
  let distillState = null;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await wait(2000);
    distillState = await evaluate(`(() => {
      const text = document.body.innerText;
      const idx = text.indexOf('已写入：');
      const path = idx >= 0 ? text.slice(idx + 4).trim().split(/[\\s，。]/)[0] : '';
      return { hasResult: text.includes('已写入：'), path, fallback: text.includes('兜底模板') };
    })()`);
    if (distillState.hasResult) break;
  }
  if (!distillState.hasResult || !distillState.path) {
    throw new Error('distill regression failed: ' + JSON.stringify(distillState));
  }
  await shot('knowledge-distill.png');

  // new entry form: click 新建条目 → form visible → fill → save → appears
  console.log('step: new entry form');
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '新建条目');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await wait(800);
  const formVisible = await evaluate(`(() => !!document.querySelector('input[placeholder*="标题（同时作为文件名）"]'))()`);
  if (!formVisible) throw new Error('new entry form did not appear after clicking 新建条目');
  await evaluate(`(() => {
    const setVal = (el, value) => { const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const title = document.querySelector('input[placeholder*="标题（同时作为文件名）"]');
    const tags = [...document.querySelectorAll('input')].find((item) => (item.placeholder || '').includes('标签（逗号分隔）'));
    const summary = [...document.querySelectorAll('input')].find((item) => (item.placeholder || '').includes('一句话摘要'));
    const body = [...document.querySelectorAll('textarea')].find((item) => (item.placeholder || '').includes('正文'));
    if (!title || !tags || !summary || !body) return false;
    setVal(title, 'GUI新建条目');
    setVal(tags, '回归, 新建');
    setVal(summary, 'GUI 回归新建条目');
    setVal(body, '这是 GUI 回归自动创建的新条目，验证后删除。');
    return true;
  })()`);
  await wait(300);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '写入知识库');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await wait(2500);
  const newEntryState = await evaluate(`(() => ({
    visible: document.body.innerText.includes('GUI新建条目'),
    hasSummary: document.body.innerText.includes('GUI 回归新建条目')
  }))()`);
  if (!newEntryState.visible) throw new Error('new entry was not saved: ' + JSON.stringify(newEntryState));
  await shot('knowledge-new-entry.png');

  // asset overview: seed typed entries, verify groups, then cleanup
  console.log('step: overview tab');
  const typedSeed = [
    { folder: 'atomic', name: '技能-GUI示例', content: '---\ntitle: 技能-GUI示例\ntype: skill\ntags: [技能]\nconfidence: high\nrelated: ""\nsummary: 示例技能条目。\n---\n# 技能-GUI示例\n示例技能正文。' },
    { folder: 'projects', name: '项目-GUI示例', content: '---\ntitle: 项目-GUI示例\ntype: project\ntags: [项目]\nconfidence: medium\nrelated: ""\nsummary: 示例项目条目。\n---\n# 项目-GUI示例\n示例项目正文。' },
    { folder: 'inbox', name: '工作流-GUI示例', content: '---\ntitle: 工作流-GUI示例\ntype: workflow\ntags: [工作流]\nconfidence: high\nrelated: ""\nsummary: 示例工作流条目。\n---\n# 工作流-GUI示例\n示例工作流正文。' }
  ];
  for (const item of typedSeed) {
    await pageApi('/api/dsh-workbench/knowledge/write', 'POST', item);
  }
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '检索');
    if (tab) tab.click();
    return true;
  })()`);
  await wait(500);
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '总览');
    if (tab) tab.click();
    return true;
  })()`);
  await wait(2500);
  const overviewState = await evaluate(`(() => {
    const text = document.body.innerText;
    return {
      hasSkillPool: text.includes('知识库技能池'),
      hasExpertSkills: text.includes('专家技能'),
      hasProjects: text.includes('项目（知识库 + 工作区）'),
      hasWorkflows: text.includes('工作流（知识库 + 模板库）'),
      hasTyped: text.includes('技能-GUI示例') && text.includes('项目-GUI示例') && text.includes('工作流-GUI示例')
    };
  })()`);
  if (!overviewState.hasSkillPool || !overviewState.hasExpertSkills || !overviewState.hasTyped) {
    throw new Error('overview regression failed: ' + JSON.stringify(overviewState));
  }
  await shot('knowledge-overview.png');

  // cleanup seeded entries
  console.log('step: cleanup');
  await pageApi('/api/dsh-workbench/knowledge/remove', 'POST', { path: seeded.entry.path }).catch(() => {});
  await pageApi('/api/dsh-workbench/knowledge/remove', 'POST', { path: distillState.path }).catch(() => {});
  await pageApi('/api/dsh-workbench/knowledge/remove', 'POST', { path: 'inbox/GUI新建条目.md' }).catch(() => {});
  for (const item of typedSeed) {
    await pageApi('/api/dsh-workbench/knowledge/remove', 'POST', { path: item.folder + '/' + item.name + '.md' }).catch(() => {});
  }
  await pageApi('/api/dsh-workbench/knowledge/remove', 'POST', { path: 'inbox/NodeProbe条目.md' }).catch(() => {});

  console.log(JSON.stringify({ dash: dashState, search: searchState, distill: distillState, newEntry: newEntryState, overview: overviewState }, null, 2));
  console.log('knowledge GUI regression passed');
  process.exit(0);
} finally {
  try { ws.close(); } catch (e) { /* ignore */ }
}
  console.log('step: distill tab');
