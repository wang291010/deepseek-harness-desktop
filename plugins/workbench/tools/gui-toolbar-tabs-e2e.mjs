import assert from 'node:assert/strict';

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
  for (let attempt = 0; attempt < 30; attempt += 1) { await wait(500); if (await evaluate(`!!document.querySelector('.wb-root')`)) break; }
  await evaluate(`(() => { if (!document.querySelector('.wb-agent')) [...document.querySelectorAll('.wb-nav-btn')].find((item)=>(item.title||item.textContent||'').trim()==='Agent 工作区')?.click(); return true; })()`); await wait(500);
  await evaluate(`(() => { if (!document.querySelector('.wb-tb')) document.querySelector('[title="打开工具栏"]')?.click(); return true; })()`);
  for (let attempt = 0; attempt < 20; attempt += 1) { await wait(250); if (await evaluate(`!!document.querySelector('.wb-tb')`)) break; }
  const result = await evaluate(`(() => {
    const toolbar = document.querySelector('.wb-tb');
    if (!toolbar) return { missing: true };
    const shell = toolbar.parentElement;
    shell.style.width = '280px'; shell.style.minWidth = '280px'; shell.style.maxWidth = '280px'; shell.style.flex = '0 0 280px';
    const tabs = [...toolbar.querySelectorAll('.wb-tb-tab')];
    const container = toolbar.querySelector('.wb-tb-tabs');
    const containerRect = container.getBoundingClientRect();
    const rows = [...new Set(tabs.map((item) => Math.round(item.getBoundingClientRect().top)))];
    return {
      labels: tabs.map((item) => item.textContent.trim()),
      rows: rows.length,
      overflow: container.scrollWidth > container.clientWidth + 1,
      visible: tabs.every((item) => { const rect = item.getBoundingClientRect(); return rect.left >= containerRect.left - 1 && rect.right <= containerRect.right + 1; }),
      width: Math.round(containerRect.width)
    };
  })()`);
  assert.deepEqual(result.labels, ['详细信息', '协作', '项目配置', 'Git图谱', '文件视图', '蒸馏']);
  assert.equal(result.rows, 2, 'narrow toolbar should use two tab rows');
  assert.equal(result.overflow, false, 'toolbar tabs must not require horizontal scrolling');
  assert.equal(result.visible, true, 'all toolbar tabs must remain visible');
  const distillClicked = await evaluate(`(() => { const button=[...document.querySelectorAll('.wb-tb-tab')].find((item)=>(item.textContent||'').trim()==='蒸馏'); button?.click(); return !!button; })()`); await wait(250);
  const distillPanel = await evaluate(`(() => ({ title:[...document.querySelectorAll('.wb-tb-session-title')].some((item)=>item.textContent.trim()==='会话蒸馏'), hasInternalBadge:document.querySelector('.wb-tb-scroll')?.textContent.includes('P6.1')||false, hasBusinessCopy:document.querySelector('.wb-tb-scroll')?.textContent.includes('AI 从当前对话提取可复用知识')||false }))()`);
  assert.equal(distillClicked, true); assert.equal(distillPanel.title, true); assert.equal(distillPanel.hasInternalBadge, false); assert.equal(distillPanel.hasBusinessCopy, true);
  console.log('gui-toolbar-tabs-e2e: PASS'); console.log(JSON.stringify(result, null, 2));
} finally { socket.close(); }
