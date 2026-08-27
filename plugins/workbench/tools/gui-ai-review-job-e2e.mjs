import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const port = process.argv[2] || '9224';
const existingTitle = process.argv[3] && process.argv[3] !== '--cleanup' ? process.argv[3] : '';
const replayHash = process.argv[4] || '';
const title = existingTitle || ('AI后台初审临时验收-' + Date.now());
const shouldCreate = !existingTitle || Boolean(replayHash);
const shouldCleanup = shouldCreate || process.argv.includes('--cleanup');
const path = `inbox/${title}.md`;
let createdAt = new Date().toISOString();
const makeMarkdown = (created) => [
  '---', `title: ${title}`, 'type: decision', 'tags: [AI初审, 后台任务, 验收]', 'confidence: high', 'status: draft',
  'claimType: fact', 'staleness: STABLE', 'source: 工作台真实界面临时验收', 'project: DeepSeek Harness Desktop 工作台',
  'summary: 验证 AI 初审在切换页面后继续运行并恢复进度。', `created: ${created}`, '---', '',
  `# ${title}`, '', '这个方法永远正确，适合所有项目，也不需要任何边界条件或验证步骤。'
].join('\n');
if (replayHash) {
  const epoch = Number(title.split('-').at(-1));
  for (let offset = 0; offset < 2000; offset += 1) {
    const candidate = new Date(epoch + offset).toISOString();
    if (createHash('sha1').update(makeMarkdown(candidate)).digest('hex') === replayHash) { createdAt = candidate; break; }
  }
  assert.equal(createHash('sha1').update(makeMarkdown(createdAt)).digest('hex'), replayHash, 'unable to reconstruct replay source');
}
const markdown = makeMarkdown(createdAt);

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:')) || targets.find((item) => item.type === 'page');
assert(target, 'no browser page target');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, reject) => { socket.addEventListener('open', ok, { once: true }); socket.addEventListener('error', reject, { once: true }); });
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
  return new Promise((ok, reject) => pending.set(id, { resolve: ok, reject }));
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const captureScreenshot = () => Promise.race([send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }), wait(10000).then(() => null)]);
async function clickNav(label) {
  const clicked = await evaluate(`(() => { const b=[...document.querySelectorAll('.wb-nav-btn')].find((x)=>(x.title||x.textContent||'').trim()===${JSON.stringify(label)}); b?.click(); return !!b; })()`);
  assert.equal(clicked, true, `navigation missing: ${label}`); await wait(700);
}
async function openReviewItem() {
  await clickNav('知识库');
  const tab = await evaluate(`(() => { const b=[...document.querySelectorAll('.wb-collab-panel-tab')].find((x)=>(x.textContent||'').trim().startsWith('审核')); b?.click(); return !!b; })()`);
  assert.equal(tab, true, 'review tab missing'); await wait(800);
  const selected = await evaluate(`(() => { const row=[...document.querySelectorAll('.wb-review-row')].find((x)=>(x.textContent||'').includes(${JSON.stringify(title)})); row?.click(); return !!row; })()`);
  assert.equal(selected, true, 'temporary review item missing'); await wait(500);
}

const artifactDir = resolve('..', '..', 'artifacts', 'knowledge-ai-review-jobs-e2e');
await mkdir(artifactDir, { recursive: true });
try {
  await send('Page.enable'); await send('Runtime.enable');
  for (let attempt = 0; attempt < 30; attempt += 1) { if (await evaluate(`!!document.querySelector('.wb-root')`)) break; await wait(500); }
  if (shouldCreate) {
    const created = await evaluate(`fetch('/api/dsh-workbench/knowledge/write',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({folder:'inbox',name:${JSON.stringify(title)},content:${JSON.stringify(markdown)}})}).then(async r=>({ok:r.ok,status:r.status,data:await r.json()}))`);
    assert.equal(created.ok, true, JSON.stringify(created));
    await send('Page.reload', { ignoreCache: true });
    for (let attempt = 0; attempt < 30; attempt += 1) { if (await evaluate(`!!document.querySelector('.wb-root')`)) break; await wait(500); }
  }
  await openReviewItem();
  if (existingTitle && !replayHash) {
    const detail = await evaluate(`(() => { const b=[...document.querySelectorAll('.wb-review-editor-head-actions button')].find((x)=>(x.textContent||'').trim()==='审核详情'); b?.click(); return !!b; })()`);
    assert.equal(detail, true, 'review detail trigger missing'); await wait(250);
    const aiTab = await evaluate(`(() => { const b=[...document.querySelectorAll('.wb-review-inspector-tabs button')].find((x)=>(x.textContent||'').trim()==='AI 初审'); b?.click(); return !!b; })()`);
    assert.equal(aiTab, true, 'AI review tab missing'); await wait(250);
    const score = await evaluate(`document.querySelector('.wb-ai-score')?.textContent||''`);
    assert.ok(score, 'completed AI score is not visible');
    const shot = await captureScreenshot();
    if (shot) await writeFile(resolve(artifactDir, 'ai-review-result.png'), Buffer.from(shot.data, 'base64'));
    console.log('gui-ai-review-result-e2e: PASS'); console.log(JSON.stringify({ title, finalScore: score }, null, 2));
  } else {
  let recovered = { replay: Boolean(replayHash) };
  let state = null;
  let shot;
  if (!replayHash) {
  const started = await evaluate(`(() => { const b=[...document.querySelectorAll('.wb-review-editor-head-actions button')].find((x)=>(x.textContent||'').includes('AI 初审')); b?.click(); return !!b; })()`);
  assert.equal(started, true, 'AI review button missing');
  for (let attempt = 0; attempt < 20; attempt += 1) { if (await evaluate(`!!document.querySelector('.wb-ai-progress-card')`)) break; await wait(250); }
  assert.equal(await evaluate(`!!document.querySelector('.wb-ai-progress-card')`), true, 'progress card did not appear');
  shot = await captureScreenshot();
  if (shot) await writeFile(resolve(artifactDir, 'ai-review-progress.png'), Buffer.from(shot.data, 'base64'));

  await clickNav('专家'); await wait(1200); await openReviewItem();
  recovered = await evaluate(`(() => ({progress:!!document.querySelector('.wb-ai-progress-card'),score:!!document.querySelector('.wb-ai-score-card'),button:[...document.querySelectorAll('.wb-review-editor-head-actions button')].map(x=>x.textContent.trim()).join('|')}))()`);
  assert.equal(recovered.progress || recovered.score, true, JSON.stringify(recovered));
  shot = await captureScreenshot();
  if (shot) await writeFile(resolve(artifactDir, 'ai-review-restored.png'), Buffer.from(shot.data, 'base64'));

  } else {
    const detail = await evaluate(`(() => { const b=[...document.querySelectorAll('.wb-review-editor-head-actions button')].find((x)=>(x.textContent||'').trim()==='审核详情'); b?.click(); return !!b; })()`);
    assert.equal(detail, true, 'review detail trigger missing'); await wait(250);
    const aiTab = await evaluate(`(() => { const b=[...document.querySelectorAll('.wb-review-inspector-tabs button')].find((x)=>(x.textContent||'').trim()==='AI 初审'); b?.click(); return !!b; })()`);
    assert.equal(aiTab, true, 'AI review tab missing'); await wait(250);
    state = await evaluate(`(() => ({score:document.querySelector('.wb-ai-score')?.textContent||'',failed:'',rawError:false}))()`);
  }
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (state && state.score) break;
    state = await evaluate(`(() => ({score:document.querySelector('.wb-ai-score')?.textContent||'',failed:document.querySelector('.wb-ai-progress-failed')?.textContent||'',rawError:(document.body.innerText||'').includes('Unterminated string in JSON')}))()`);
    if (state.score || state.failed) break;
    await wait(1000);
  }
  assert.equal(Boolean(state && state.rawError), false, JSON.stringify(state));
  assert.ok(state && state.score, `AI review did not complete: ${JSON.stringify(state)}`);
  const suggestionCount = await evaluate(`document.querySelectorAll('.wb-ai-suggestion input[type=checkbox]').length`);
  assert.ok(suggestionCount > 0, 'AI review returned no editable suggestion for the intentionally vague temporary entry');
  const applied = await evaluate(`(() => { const boxes=[...document.querySelectorAll('.wb-ai-suggestion input[type=checkbox]')]; boxes.forEach((box)=>{ if(!box.checked) box.click(); }); const b=[...document.querySelectorAll('.wb-review-evidence button')].find((x)=>(x.textContent||'').includes('应用所选建议')); b?.click(); return !!b; })()`);
  assert.equal(applied, true, 'apply selected AI suggestions button missing'); await wait(400);
  const diffState = await evaluate(`(() => ({toolbar:!!document.querySelector('.wb-ai-edit-toolbar'),diff:!!document.querySelector('.wb-ai-diff-wrap'),modes:[...document.querySelectorAll('.wb-ai-edit-modes button')].map((x)=>x.textContent.trim()),status:document.querySelector('.wb-ai-edit-status')?.textContent||''}))()`);
  assert.equal(diffState.toolbar, true, JSON.stringify(diffState)); assert.equal(diffState.diff, true, JSON.stringify(diffState));
  assert.deepEqual(diffState.modes, ['正常编辑','AI 修改对照','只看修改']); assert.match(diffState.status, /AI 已改 .*未保存/);
  const saved = await evaluate(`(() => { const b=[...document.querySelectorAll('.wb-review-actions button')].find((x)=>(x.textContent||'').trim()==='保存修改'); b?.click(); return !!b; })()`);
  assert.equal(saved, true, 'save AI edits button missing');
  for (let attempt = 0; attempt < 40; attempt += 1) { if (await evaluate(`(document.querySelector('.wb-ai-edit-status')?.textContent||'').includes('AI 已改') && !(document.querySelector('.wb-ai-edit-status')?.textContent||'').includes('未保存')`)) break; await wait(250); }
  const persisted = await evaluate(`(() => ({status:document.querySelector('.wb-ai-edit-status')?.textContent||'',queue:[...document.querySelectorAll('.wb-ai-edit-list-label')].map((x)=>x.textContent.trim()),marks:document.querySelectorAll('.wb-ai-inline-change mark').length}))()`);
  assert.match(persisted.status, /AI 已改/); assert.doesNotMatch(persisted.status, /未保存/); assert.ok(persisted.queue.some((item)=>item.includes('AI 已改'))); assert.equal(persisted.marks, suggestionCount, JSON.stringify(persisted));
  console.log('gui-ai-review-job-e2e: PASS');
  console.log(JSON.stringify({ title, recovered, finalScore: state.score, suggestionCount, diffState, persisted }, null, 2));
  shot = await captureScreenshot();
  if (shot) await writeFile(resolve(artifactDir, 'ai-review-result.png'), Buffer.from(shot.data, 'base64'));
  }
} finally {
  if (shouldCleanup) { try { await Promise.race([evaluate(`fetch('/api/dsh-workbench/knowledge/remove',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:${JSON.stringify(path)}})}).then(r=>r.json())`), wait(10000)]); } catch {} }
  socket.close();
}
