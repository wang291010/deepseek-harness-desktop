#!/usr/bin/env node
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';

const debugPort = process.argv[2] || '9225';
const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:')) || targets.find((item) => item.type === 'page');
assert(target, 'no browser page target');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const waiter = pending.get(message.id); pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
});
function send(method, params = {}) {
  const id = ++nextId; ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`cdp timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } });
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function pageApi(path, method = 'GET', body) {
  return evaluate(`fetch(${JSON.stringify(path)}, {method:${JSON.stringify(method)},headers:{'content-type':'application/json'},body:${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))}}).then(async r=>{const t=await r.text();let v=t?JSON.parse(t):null;return {ok:r.ok,status:r.status,data:v};})`);
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function poll(read, accept, label, timeoutMs = 360000) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) { last = await read(); if (accept(last)) return last; await wait(700); }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function makeEvidencePng() {
  const width = 128; const height = 128; const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3); row[0] = 0;
    for (let x = 0; x < width; x++) {
      const greenCorner = x >= 96 && y < 32;
      row[1 + x * 3] = greenCorner ? 0 : 240;
      row[2 + x * 3] = greenCorner ? 190 : 30;
      row[3 + x * 3] = greenCorner ? 60 : 30;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))]);
}

const context = await evaluate(`(() => { const current=JSON.parse(localStorage.getItem('dsh.sessions.current')||'{}').sessionId||''; const urls=performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/api/dsh-workbench/tasks/list?')); const match=[...urls].reverse().map(n=>new URL(n)).find(u=>u.searchParams.get('sessionId')===current&&u.searchParams.get('projectPath')); return {sessionId:current,projectPath:match?match.searchParams.get('projectPath'):''}; })()`);
assert(context.sessionId && context.projectPath, `unable to resolve live context: ${JSON.stringify(context)}`);
const marker = `F5 多模态实机验证 ${new Date().toISOString()}`;
const listPath = `/api/dsh-workbench/tasks/list?scope=all&projectPath=${encodeURIComponent(context.projectPath)}&sessionId=${encodeURIComponent(context.sessionId)}`;
const mutationPath = '/api/dsh-workbench/tasks/mutate';
let orchestrationId = '';
try {
  const upload = await pageApi('/api/dsh-workbench/attachment/put', 'POST', { name: 'f5-red-green-evidence.png', data: makeEvidencePng().toString('base64') });
  assert.equal(upload.ok, true, JSON.stringify(upload.data));
  const created = await pageApi(mutationPath, 'POST', { action: 'orchestration_create', scope: 'all', projectPath: context.projectPath, sourceSessionId: context.sessionId, title: marker, idea: '观察附件图片：说明主体颜色和右上角小色块颜色。', attachments: [upload.data] });
  assert.equal(created.ok, true, JSON.stringify(created.data));
  const orchestration = created.data.orchestrations.find((item) => item.title === marker);
  assert(orchestration); orchestrationId = orchestration.id;
  const storedImage = orchestration.attachments.find((item) => item.name === 'f5-red-green-evidence.png');
  assert(storedImage && storedImage.imageRef && storedImage.imageRef.attachmentId, JSON.stringify(storedImage));

  const listing = await pageApi(listPath);
  assert.equal(listing.ok, true);
  const imageModel = (listing.data.modelCatalog || []).find((model) => Array.isArray(model.inputModalities) && model.inputModalities.includes('image'));
  if (!imageModel) {
    const planning = await pageApi(mutationPath, 'POST', { action: 'orchestration_plan', scope: 'all', projectPath: context.projectPath, id: orchestrationId, probeModels: false });
    assert.equal(planning.ok, true, JSON.stringify(planning.data));
    const failed = await poll(async () => (await pageApi(listPath)).data.orchestrations.find((item) => item.id === orchestrationId), (item) => item && item.phase === 'failed', 'explicit multimodal capability failure');
    assert.match(failed.runtimeError, /没有明确支持图片输入的模型/);
    console.log(JSON.stringify({ ok: true, capabilityAvailable: false, attachmentId: storedImage.imageRef.attachmentId, explicitFailure: failed.runtimeError }, null, 2));
  } else {
    const planning = await pageApi(mutationPath, 'POST', { action: 'orchestration_plan', scope: 'all', projectPath: context.projectPath, id: orchestrationId, probeModels: false });
    assert.equal(planning.ok, true, JSON.stringify(planning.data));
    const planned = await poll(async () => (await pageApi(listPath)).data.orchestrations.find((item) => item.id === orchestrationId), (item) => item && ['planned', 'failed'].includes(item.phase), 'F5 image-aware planning');
    assert.equal(planned.phase, 'planned', JSON.stringify({ runtimeError: planned.runtimeError, phase: planned.phase }, null, 2));
    assert((planned.plan && planned.plan.workers || []).length > 0, 'image-aware planning should produce workers');
    const plan = {
      title: marker, summary: '原生图片内容块实机验收。', strategy: '由支持图片的模型直接观察附件。', maxParallel: 1,
      mainAgent: { id: 'main', name: 'F5 汇总', role: '主代理', mission: '汇总图片观察结论。', readOnly: true },
      workers: [{ id: 'vision', name: '图片观察员', role: '多模态验证员', dependsOn: [], readOnly: true, provider: imageModel.provider, model: imageModel.id, acceptance: '指出主体为红色、右上角为绿色，并输出 F5_IMAGE_OK', task: '直接观察随消息传入的图片，不要猜测文件名。指出主体颜色和右上角小色块颜色；最后输出 F5_IMAGE_OK。' }],
      acceptanceCriteria: ['识别红色主体与绿色右上角', '输出 F5_IMAGE_OK']
    };
    assert.equal((await pageApi(mutationPath, 'POST', { action: 'orchestration_set_plan', scope: 'all', projectPath: context.projectPath, id: orchestrationId, plan })).ok, true);
    assert.equal((await pageApi(mutationPath, 'POST', { action: 'orchestration_start', scope: 'all', projectPath: context.projectPath, id: orchestrationId })).ok, true);
    const terminal = await poll(async () => (await pageApi(listPath)).data.orchestrations.find((item) => item.id === orchestrationId), (item) => item && ['review', 'failed', 'cancelled'].includes(item.phase), 'F5 orchestration terminal');
    assert.equal(terminal.phase, 'review', JSON.stringify({ runtimeError: terminal.runtimeError, workers: terminal.workers.map((entry) => ({ id: entry.id, status: entry.status, error: entry.error, provider: entry.usedProvider || entry.provider, model: entry.usedModel || entry.model })) }, null, 2));
    const worker = terminal.workers.find((item) => item.id === 'vision');
    assert(worker && worker.status === 'completed', worker && worker.error);
    assert.match(worker.output, /F5_IMAGE_OK/);
    assert.match(worker.output, /红|red/i);
    assert.match(worker.output, /绿|green/i);
    console.log(JSON.stringify({ ok: true, capabilityAvailable: true, planningPassed: true, model: `${imageModel.provider}/${imageModel.id}`, attachmentId: storedImage.imageRef.attachmentId, output: worker.output.slice(0, 500) }, null, 2));
  }
} finally {
  if (orchestrationId) {
    await pageApi(mutationPath, 'POST', { action: 'orchestration_cancel', scope: 'all', projectPath: context.projectPath, id: orchestrationId }).catch(() => {});
    await pageApi(mutationPath, 'POST', { action: 'orchestration_remove', scope: 'all', projectPath: context.projectPath, id: orchestrationId }).catch(() => {});
  }
  ws.close();
}
