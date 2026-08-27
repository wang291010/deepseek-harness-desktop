import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-workbench-distill-'));
process.env.DSH_HOME = tempHome;

const routes = new Map();
const llmPayload = JSON.stringify({ candidates: [
  { type: 'decision', title: '会话蒸馏采用人工审核', content: '会话蒸馏候选必须经过人工审核，并且只写入 01-Inbox 草稿区。', tags: ['会话蒸馏', '审核'], confidence: 'high', claimType: 'fact', staleness: 'STABLE', suggestedAction: 'ADD', reason: '用户明确确认', sourceSeqs: [3], evidence: '其他决策点都按你的推荐' },
  { type: 'preference', title: '先出方案再执行', content: '涉及新功能时，先提供完整方案，待用户审核确认后再执行。', tags: ['工作偏好'], confidence: 'high', claimType: 'fact', staleness: 'CHECK', suggestedAction: 'ADD', reason: '用户明确要求', sourceSeqs: [1], evidence: '先出方案，再执行' }
] });
const ctx = {
  inject(names, callback) {
    if (names.includes('webServer')) callback({
      webServer: { register(route) { routes.set(route.path, route); return () => {}; } },
      workspaceRegistry: { list: () => [] },
      llm: { listProviders: () => [], listModels: async () => [], async *stream({ system }) { yield { type: 'text-delta', text: system.includes('高精度会话蒸馏器') ? llmPayload : '{}' }; } }
    });
    else if (names.includes('subagents')) callback({ subagents: { list: () => [] }, agents: { get: () => null, roots: () => [] } });
    else if (names.includes('commands')) callback({ commands: { register: () => [] }, sessionProjections: {} });
  },
  on() {}
};

function request(method, url, body) {
  const req = new PassThrough();
  req.method = method; req.url = url; req.socket = { remoteAddress: '127.0.0.1' }; req.headers = { host: '127.0.0.1:9999' };
  queueMicrotask(() => req.end(body === undefined ? '' : JSON.stringify(body)));
  return req;
}
async function call(path, method = 'GET', body) {
  const route = routes.get(path.split('?')[0]);
  assert(route, `route missing: ${path}`);
  let statusCode = 0; let text = '';
  const res = { writeHead(code) { statusCode = code; }, end(value) { text += value || ''; } };
  await route.handler(request(method, path, body), res);
  const data = text ? JSON.parse(text) : {};
  assert.equal(statusCode, 200, JSON.stringify(data));
  return data;
}
async function waitForRun(id) {
  for (let i = 0; i < 80; i += 1) {
    const run = await call('/api/dsh-workbench/distill/run?id=' + encodeURIComponent(id));
    if (['review', 'failed', 'cancelled'].includes(run.status)) return run;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error('distill run timeout');
}

let passed = false;
try {
  const { apply } = await import('../lib/host/index.js?' + Date.now());
  apply(ctx);
  const transcript = [
    { seq: 1, turn: 1, role: 'user', text: '先出方案，再执行。密钥 api_key=very-secret-token-value 不应进入模型。' },
    { seq: 2, turn: 1, role: 'assistant', text: '好的，我会先给方案。' },
    { seq: 3, turn: 2, role: 'user', text: '其他决策点都按你的推荐。' }
  ];
  const analyzed = await call('/api/dsh-workbench/distill/analyze', 'POST', {
    sessionId: 'session-1', projectPath: 'C:\\project', title: '测试会话', template: 'auto',
    range: { mode: 'all', fromSeq: 1, toSeq: 3, fromTurn: 1, toTurn: 2, turnCount: 2 }, transcript
  });
  assert.equal(analyzed.secretsRedacted, true, 'secrets should be redacted before extraction');
  const review = await waitForRun(analyzed.run.id);
  assert.equal(review.status, 'review');
  assert.equal(review.candidates.length, 2);
  assert.ok(review.candidates.every((item) => item.selected));
  review.candidates[1].selected = false;
  const saved = await call('/api/dsh-workbench/distill/review', 'POST', { id: review.id, candidates: review.candidates });
  assert.equal(saved.candidates.filter((item) => item.selected).length, 1);
  const committed = await call('/api/dsh-workbench/distill/commit', 'POST', { id: review.id });
  assert.equal(committed.status, 'committed');
  assert.equal(committed.committed.length, 1);
  assert.match(committed.committed[0].path, /^inbox\//);
  const fileName = committed.committed[0].path.slice('inbox/'.length);
  const draft = await readFile(join(tempHome, 'knowledge', '01-Inbox', fileName), 'utf8');
  assert.ok(draft.includes('status: review'));
  assert.ok(draft.includes('sourceSessionId: session-1'));
  assert.ok(draft.includes('suggestedAction: ADD'));
  assert.ok(!draft.includes('very-secret-token-value'));
  const history = await call('/api/dsh-workbench/distill/history?sessionId=session-1');
  assert.equal(history.cursor, 3, 'cursor advances only after successful commit');
  const repeated = await call('/api/dsh-workbench/distill/analyze', 'POST', {
    sessionId: 'session-1', projectPath: 'C:\\project', title: '测试会话', template: 'auto',
    range: { mode: 'all', fromSeq: 1, toSeq: 3, fromTurn: 1, toTurn: 2, turnCount: 2 }, transcript
  });
  assert.equal(repeated.reused, true, 'same source range should be idempotent');
  assert.equal(repeated.run.id, committed.id);
  const undone = await call('/api/dsh-workbench/distill/undo', 'POST', { id: committed.id });
  assert.equal(undone.status, 'undone');
  await assert.rejects(stat(join(tempHome, 'knowledge', '01-Inbox', fileName)), /ENOENT/);
  passed = true;
  console.log('smoke-distill: PASS');
} finally {
  await rm(tempHome, { recursive: true, force: true });
  if (!passed) process.exitCode = 1;
}
