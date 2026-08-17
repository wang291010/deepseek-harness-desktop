import { writeFile } from 'node:fs/promises';

const debugPort = process.argv[2] || '9226';
const ideaText = process.argv[3] || '左栏临时想法功能验证';
const output = process.argv[4] || '';
const captureOnly = ideaText === '--capture-only';
const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:'));
if (!target) throw new Error('no DSH page target');

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
  const item = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
});
function send(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send('Runtime.enable');
if (output) await send('Page.enable');
if (captureOnly) {
  await new Promise((resolve) => setTimeout(resolve, 700));
  const layout = await send('Runtime.evaluate', { expression: `({
    navCollapsed: !!document.querySelector('.wb-nav-collapsed'),
    sessionCaptureVisible: !!document.querySelector('.wb-sp-capture'),
    rightToolbarVisible: !!document.querySelector('.wb-tb-col'),
    rightToolbarReopenVisible: !!document.querySelector('.wb-tb-reopen')
  })`, returnByValue: true });
  const value = layout.result.value;
  if (!value.navCollapsed || !value.sessionCaptureVisible || value.rightToolbarVisible || !value.rightToolbarReopenVisible) {
    throw new Error('default focused layout failed: ' + JSON.stringify(value));
  }
  if (output) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(output, Buffer.from(shot.data, 'base64'));
  }
  console.log(JSON.stringify(value, null, 2));
  ws.close();
  process.exit(0);
}
await send('Runtime.evaluate', { expression: `(() => {
  const expand = [...document.querySelectorAll('button')].find((button) => button.title === '展开侧边栏');
  if (expand) expand.click();
  const input = document.querySelector('.wb-sp-capture textarea');
  if (!input) throw new Error('session-column capture input missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(ideaText)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()` });
await wait(250);
await send('Runtime.evaluate', { expression: `(() => {
  const save = document.querySelector('.wb-sp-capture-actions button');
  if (!save || save.disabled) throw new Error('session-column capture save unavailable');
  save.click();
})()` });
await wait(1000);
const state = await send('Runtime.evaluate', { expression: `({
  notice: document.querySelector('.wb-sp-capture-note')?.textContent || '',
  recent: [...document.querySelectorAll('.wb-sp-idea span')].map((item) => item.textContent),
  value: document.querySelector('.wb-sp-capture textarea')?.value || ''
})`, returnByValue: true });
if (state.result.value.notice !== '已存入想法库') throw new Error('capture notice missing: ' + JSON.stringify(state.result.value));
if (!state.result.value.recent.includes(ideaText)) throw new Error('captured idea not listed: ' + JSON.stringify(state.result.value));
if (state.result.value.value !== '') throw new Error('capture input did not clear: ' + JSON.stringify(state.result.value));
console.log(JSON.stringify(state.result.value, null, 2));
if (output) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(output, Buffer.from(shot.data, 'base64'));
}
ws.close();
