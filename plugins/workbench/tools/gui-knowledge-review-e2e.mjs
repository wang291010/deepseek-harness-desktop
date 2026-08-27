import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const port = process.argv[2] || '9224';
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:')) || targets.find((item) => item.type === 'page');
assert(target, 'no browser page target');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const callbacks = pending.get(message.id); pending.delete(message.id);
  if (message.error) callbacks.reject(new Error(message.error.message)); else callbacks.resolve(message.result);
});
function send(method, params = {}) {
  const id = ++nextId; socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Page.reload', { ignoreCache: true });
  for (let attempt = 0; attempt < 25; attempt += 1) { await wait(500); if (await evaluate(`!!document.querySelector('.wb-root')`)) break; }
  const navigated = await evaluate(`(() => { const button=[...document.querySelectorAll('.wb-nav-btn')].find((item)=>(item.title||item.textContent||'').trim()==='知识库'); if(button) button.click(); return !!button; })()`);
  assert.equal(navigated, true, 'knowledge navigation missing'); await wait(1200);
  const tabClicked = await evaluate(`(() => { const button=[...document.querySelectorAll('.wb-collab-panel-tab')].find((item)=>(item.textContent||'').trim().startsWith('审核')); if(button) button.click(); return !!button; })()`);
  assert.equal(tabClicked, true, 'review tab missing'); await wait(1200);
  const artifactDir = resolve('..', '..', 'artifacts', 'knowledge-ai-review-e2e'); await mkdir(artifactDir, { recursive: true });
  let shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(resolve(artifactDir, 'review-two-pane.png'), Buffer.from(shot.data, 'base64'));
  const detailOpened = await evaluate(`(() => { const button=[...document.querySelectorAll('.wb-review-editor-head-actions button')].find((item)=>(item.textContent||'').trim()==='审核详情'); if(button) button.click(); return !!button; })()`);
  assert.equal(detailOpened, true, 'review detail trigger missing'); await wait(300);
  const evidenceOpened = await evaluate(`(() => { const button=[...document.querySelectorAll('.wb-review-inspector-tabs button')].find((item)=>(item.textContent||'').trim()==='来源与预检'); if(button) button.click(); return !!button; })()`);
  assert.equal(evidenceOpened, true, 'evidence tab missing'); await wait(200);
  shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(resolve(artifactDir, 'review-detail-drawer.png'), Buffer.from(shot.data, 'base64'));
  const result = await evaluate(`(() => ({
    badge: document.querySelector('.wb-review-count')?.textContent || '',
    rows: document.querySelectorAll('.wb-review-row').length,
    layout: !!document.querySelector('.wb-review-layout'),
    actions: [...document.querySelectorAll('.wb-review-actions button')].map((item) => item.textContent.trim()),
    aiButton: [...document.querySelectorAll('.wb-review-editor-head-actions button')].map((item) => item.textContent.trim()).find((item)=>item.includes('AI 初审')) || '',
    columns: getComputedStyle(document.querySelector('.wb-review-layout')).gridTemplateColumns.split(' ').length,
    hasSourcePanel: [...document.querySelectorAll('.wb-review-evidence h4')].some((item) => item.textContent.includes('来源与范围')),
    hasPrecheckPanel: [...document.querySelectorAll('.wb-review-evidence h4')].some((item) => item.textContent.includes('质量与协调'))
  }))()`);
  assert.ok(Number(result.badge) >= 7); assert.ok(result.rows >= 7); assert.equal(result.layout, true); assert.equal(result.columns, 2); assert.ok(result.aiButton.includes('AI 初审'));
  for (const label of ['通过并发布到 02', '退回修改', '暂不处理', '不采纳并归档']) assert.ok(result.actions.includes(label), `missing action: ${label}`);
  assert.equal(result.hasSourcePanel, true); assert.equal(result.hasPrecheckPanel, true);
  const aiClicked = await evaluate(`(() => { const button=[...document.querySelectorAll('.wb-review-inspector-tabs button')].find((item)=>(item.textContent||'').trim()==='AI 初审'); button?.click(); return !!button; })()`); await wait(200);
  const aiEmpty = await evaluate(`([...document.querySelectorAll('.wb-review-evidence h4')].some((item)=>item.textContent.includes('尚未进行 AI 初审')))`);
  assert.equal(aiClicked, true); assert.equal(aiEmpty, true);
  shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(resolve(artifactDir, 'review-ai-panel.png'), Buffer.from(shot.data, 'base64'));
  console.log('gui-knowledge-review-e2e: PASS'); console.log(JSON.stringify(result, null, 2));
} finally { socket.close(); }
