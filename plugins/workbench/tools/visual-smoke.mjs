import { writeFile } from 'node:fs/promises';

const debugPort = process.argv[2] || '9224';
const output = process.argv[3] || 'orchestration-visual-smoke.png';
const targetView = process.argv[4] || 'AI 协作';
const navMode = process.argv[5] || '';
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
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Page.reload', { ignoreCache: true });
await wait(6000);
await send('Runtime.evaluate', { expression: `(() => {
  if ([...document.querySelectorAll('button')].some((button) => button.textContent.trim() === ${JSON.stringify(targetView)})) return;
  const taskCenter = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '任务中心');
  if (taskCenter) taskCenter.click();
})()` });
await wait(700);
await send('Runtime.evaluate', { expression: `(() => {
  if ([...document.querySelectorAll('button')].some((button) => button.textContent.trim() === ${JSON.stringify(targetView)})) return;
  const open = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('展开任务中心'));
  if (open) open.click();
})()` });
await wait(700);
await send('Runtime.evaluate', { expression: `(() => {
  const tab = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === ${JSON.stringify(targetView)});
  if (tab) tab.click();
})()` });
await wait(900);
await send('Runtime.evaluate', { expression: `(() => {
  const scope = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '全部项目');
  if (scope) scope.click();
})()` });
await wait(700);
if (targetView === '想法库') {
  await send('Runtime.evaluate', { expression: `(() => {
    const filter = document.querySelector('.wb-idea-filters button:last-child');
    if (filter) filter.click();
  })()` });
  await wait(500);
}
if (navMode === 'collapse') {
  await send('Runtime.evaluate', { expression: `(() => {
    const collapse = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '收起侧边栏');
    if (collapse) collapse.click();
  })()` });
  await wait(500);
}
if (navMode === 'expand') {
  await send('Runtime.evaluate', { expression: `(() => {
    const expand = [...document.querySelectorAll('button')].find((button) => button.title === '展开侧边栏');
    if (expand) expand.click();
  })()` });
  await wait(500);
}
const state = await send('Runtime.evaluate', { expression: `({
  title: document.title,
  body: document.body.innerText.slice(0, 4000),
  hasTargetView: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === ${JSON.stringify(targetView)}),
  runtimeReady: ${JSON.stringify(targetView)} !== 'AI 协作' || document.body.innerText.includes('代理运行时已就绪')
})`, returnByValue: true });
if (!state.result.value.hasTargetView) throw new Error('target view was not rendered: ' + JSON.stringify(state.result.value));
if (!state.result.value.runtimeReady) throw new Error('subagent runtime did not render as ready: ' + JSON.stringify(state.result.value));
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await writeFile(output, Buffer.from(shot.data, 'base64'));
console.log(JSON.stringify(state.result.value, null, 2));
ws.close();
