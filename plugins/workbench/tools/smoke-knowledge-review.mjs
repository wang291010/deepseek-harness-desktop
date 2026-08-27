import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-workbench-review-'));
process.env.DSH_HOME = tempHome;
process.env.DSH_KNOWLEDGE_AI_REVIEW_TIMEOUT_MS = '100';
const routes = new Map();
let lastLlmPrompt = '';
let malformedReviewPending = true;
let malformedReviewCalls = 0;
const aiReviewResponse = JSON.stringify({
  summary: '内容可复用，建议补充适用范围并优化标题。',
  recommendation: '应用建议后重新评分，再由人工决定是否发布。',
  dimensions: [
    { id: 'grounding', score: 90, rationale: '正文附有明确来源。' },
    { id: 'atomicity', score: 80, rationale: '主题基本聚焦。' },
    { id: 'completeness', score: 80, rationale: '结论完整但边界可加强。' },
    { id: 'uniqueness', score: 90, rationale: '未发现高相似条目。' },
    { id: 'clarity', score: 80, rationale: '结构清楚。' },
    { id: 'retrievability', score: 80, rationale: '标题与标签可检索。' },
    { id: 'freshness', score: 70, rationale: '需要补充适用时间。' },
    { id: 'safety', score: 100, rationale: '未发现敏感内容。' }
  ],
  warnings: ['建议注明适用版本'],
  suggestions: [{ id: 's1', title: '补充适用范围', reason: '避免脱离上下文后误用', severity: 'medium', before: '用于验证 AI 初审。', after: '用于验证 AI 初审，适用于当前工作台知识审核流程。' }],
  proposedContent: ['---', 'title: AI 初审优化条目', 'type: note', 'tags: [审核, AI初审]', 'confidence: high', 'status: published', 'claimType: fact', 'staleness: STABLE', 'source: 不允许覆盖的来源', 'project: 不允许覆盖的项目', 'summary: AI 优化后的摘要', 'created: 2026-08-24T00:00:00.000Z', '---', '', '# AI 初审优化条目', '', '用于验证 AI 初审，适用于当前工作台知识审核流程。'].join('\n')
});
const taggedAiReviewResponse = [
  '<DIMENSION id="grounding" score="90">正文附有明确来源。</DIMENSION>',
  '<DIMENSION id="atomicity" score="80">主题基本聚焦。</DIMENSION>',
  '<DIMENSION id="completeness" score="80">结论完整但边界可加强。</DIMENSION>',
  '<DIMENSION id="uniqueness" score="90">未发现高相似条目。</DIMENSION>',
  '<DIMENSION id="clarity" score="80">结构清楚。</DIMENSION>',
  '<DIMENSION id="retrievability" score="80">标题与标签可检索。</DIMENSION>',
  '<DIMENSION id="freshness" score="70">需要补充适用时间。</DIMENSION>',
  '<DIMENSION id="safety" score="100">未发现敏感内容。</DIMENSION>',
  '<SUMMARY>内容可复用，建议补充适用范围。</SUMMARY>',
  '<RECOMMENDATION>应用建议后由人工决定是否发布。</RECOMMENDATION>',
  '<WARNING>建议注明适用版本</WARNING>',
  '<SUGGESTION id="s1" severity="medium"><TITLE>补充适用范围</TITLE><REASON>避免误用</REASON><BEFORE>用于验证 AI 初审。</BEFORE><AFTER>用于验证 AI 初审，适用于当前流程。</AFTER></SUGGESTION>'
].join('\n');
const ctx = {
  inject(names, callback) {
    if (names.includes('webServer')) callback({
      webServer: { register(route) { routes.set(route.path, route); return () => {}; } },
      workspaceRegistry: { list: () => [] },
      llm: { listProviders: () => [], listModels: async () => [], async *stream({ messages }) {
        lastLlmPrompt = messages[0].content[0].text;
        if (lastLlmPrompt.includes('E2E_RETRY_MARKER')) {
          malformedReviewCalls += 1;
          if (malformedReviewPending) { malformedReviewPending = false; yield { type: 'text-delta', text: '{"summary":"被截断' }; return; }
          yield { type: 'text-delta', text: taggedAiReviewResponse }; return;
        }
        if (lastLlmPrompt.includes('E2E_FORMAT_FAIL_MARKER')) { yield { type: 'text-delta', text: '{"summary":"始终截断' }; return; }
        if (lastLlmPrompt.includes('E2E_TIMEOUT_MARKER')) { await new Promise((resolve) => setTimeout(resolve, 500)); yield { type: 'text-delta', text: taggedAiReviewResponse }; return; }
        yield { type: 'text-delta', text: aiReviewResponse };
      } }
    });
    else if (names.includes('subagents')) callback({ subagents: { list: () => [] }, agents: { get: () => null, roots: () => [] } });
    else if (names.includes('commands')) callback({ commands: { register: () => [] }, sessionProjections: {} });
  },
  on() {}
};
function request(method, url, body) {
  const req = new PassThrough(); req.method = method; req.url = url; req.socket = { remoteAddress: '127.0.0.1' }; req.headers = { host: '127.0.0.1:9999' };
  queueMicrotask(() => req.end(body === undefined ? '' : JSON.stringify(body))); return req;
}
async function callRaw(path, method = 'GET', body) {
  const route = routes.get(path.split('?')[0]); assert(route, `route missing: ${path}`);
  let statusCode = 0; let text = ''; const res = { writeHead(code) { statusCode = code; }, end(value) { text += value || ''; } };
  await route.handler(request(method, path, body), res); return { statusCode, data: text ? JSON.parse(text) : {} };
}
async function call(path, method = 'GET', body) {
  const result = await callRaw(path, method, body); assert.equal(result.statusCode, 200, JSON.stringify(result.data)); return result.data;
}
const markdown = (title, options = {}) => [
  '---', `title: ${title}`, 'type: note', `tags: [审核]`, `confidence: ${options.confidence || 'high'}`, `status: ${options.status || 'review'}`,
  'claimType: fact', `staleness: ${options.staleness || 'STABLE'}`, `source: ${options.source === undefined ? '项目日志 C0099' : options.source}`, 'project: Test',
  `summary: ${title} 的可复用结论`, 'created: 2026-08-24T00:00:00.000Z', '---', '', `# ${title}`, '', options.body || `${title} 的正文足够长，用于验证审核发布、退回、归档、哈希保护和审计历史。`
].join('\n');

let passed = false;
try {
  const { apply } = await import('../lib/host/index.js?' + Date.now()); apply(ctx);
  await call('/api/dsh-workbench/knowledge/list');
  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'inbox', name: '审核条目A', content: markdown('审核条目A') });
  let queue = await call('/api/dsh-workbench/knowledge/review/list');
  assert.equal(queue.total, 1); assert.equal(queue.counts.lowRisk, 1);
  let detail = await call('/api/dsh-workbench/knowledge/review/detail?path=' + encodeURIComponent('inbox/审核条目A.md'));
  assert.equal(detail.precheck.blocks.length, 0); assert.ok(detail.hash);
  const editedContent = detail.content.replace('可复用结论', '人工核对后的可复用结论');
  const saved = await call('/api/dsh-workbench/knowledge/review/save', 'POST', { path: detail.path, expectedHash: detail.hash, content: editedContent, note: '人工编辑' });
  assert.notEqual(saved.hash, detail.hash);
  const staleSave = await callRaw('/api/dsh-workbench/knowledge/review/save', 'POST', { path: detail.path, expectedHash: detail.hash, content: detail.content });
  assert.equal(staleSave.statusCode, 500); assert.match(staleSave.data.message, /修改/);

  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'inbox', name: 'AI初审条目', content: markdown('AI初审条目', { body: '用于验证 AI 初审。' }) });
  let aiDetail = await call('/api/dsh-workbench/knowledge/review/detail?path=' + encodeURIComponent('inbox/AI初审条目.md'));
  const aiReview = await call('/api/dsh-workbench/knowledge/review/ai-review', 'POST', { path: aiDetail.path, expectedHash: aiDetail.hash });
  assert.equal(aiReview.totalScore, 85); assert.equal(aiReview.level, 'excellent'); assert.equal(aiReview.dimensions.length, 8); assert.equal(aiReview.stale, false);
  assert.match(aiReview.proposedContent, /status: review/); assert.match(aiReview.proposedContent, /source: 项目日志 C0099/); assert.doesNotMatch(aiReview.proposedContent, /不允许覆盖的来源/);
  aiDetail = await call('/api/dsh-workbench/knowledge/review/detail?path=' + encodeURIComponent('inbox/AI初审条目.md'));
  assert.equal(aiDetail.aiReview.id, aiReview.id); assert.equal(aiDetail.aiReview.stale, false);
  aiDetail = await call('/api/dsh-workbench/knowledge/review/save', 'POST', { path: aiDetail.path, expectedHash: aiDetail.hash, content: aiReview.proposedContent, note: '应用 AI 建议', aiReviewId: aiReview.id, appliedSuggestionIds: ['s1'], aiAppliedContent: aiReview.proposedContent });
  assert.equal(aiDetail.aiReview.stale, true); assert.equal(aiDetail.feedbackCount, 1);
  assert.equal(aiDetail.aiEdit.count, 1); assert.equal(aiDetail.aiEdit.state, 'saved');
  assert.equal(aiDetail.aiEdit.changedAfterSave, false); assert.equal(aiDetail.aiEdit.hunks.length, 1);
  queue = await call('/api/dsh-workbench/knowledge/review/list');
  const aiQueueItem = queue.items.find((item) => item.path === aiDetail.path);
  assert.equal(aiQueueItem.aiEdit.count, 1); assert.equal(aiQueueItem.aiEdit.state, 'saved');
  aiDetail = await call('/api/dsh-workbench/knowledge/review/save', 'POST', { path: aiDetail.path, expectedHash: aiDetail.hash, content: aiDetail.content + '\n人工补充。\n', note: 'AI 修改后的人工编辑' });
  assert.equal(aiDetail.aiEdit.state, 'human_modified'); assert.equal(aiDetail.aiEdit.changedAfterSave, true);

  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'inbox', name: '异步恢复条目', content: markdown('异步恢复条目', { body: 'E2E_RETRY_MARKER：用于验证切页后恢复进度，以及 JSON 截断后的自动重试。' }) });
  let asyncDetail = await call('/api/dsh-workbench/knowledge/review/detail?path=' + encodeURIComponent('inbox/异步恢复条目.md'));
  const startedRaw = await callRaw('/api/dsh-workbench/knowledge/review/ai-review/start', 'POST', { path: asyncDetail.path, expectedHash: asyncDetail.hash });
  assert.equal(startedRaw.statusCode, 202); assert.ok(['queued', 'running'].includes(startedRaw.data.status)); assert.equal(startedRaw.data.progress >= 5, true);
  const duplicateStart = await callRaw('/api/dsh-workbench/knowledge/review/ai-review/start', 'POST', { path: asyncDetail.path, expectedHash: asyncDetail.hash });
  assert.equal(duplicateStart.statusCode, 202); assert.equal(duplicateStart.data.id, startedRaw.data.id);
  let asyncJob = startedRaw.data;
  for (let attempt = 0; attempt < 50 && ['queued', 'running'].includes(asyncJob.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    asyncJob = await call('/api/dsh-workbench/knowledge/review/ai-review/status?id=' + encodeURIComponent(startedRaw.data.id));
  }
  assert.equal(asyncJob.status, 'completed'); assert.equal(asyncJob.progress, 100); assert.ok(asyncJob.reviewId); assert.equal(malformedReviewCalls, 2);
  asyncDetail = await call('/api/dsh-workbench/knowledge/review/detail?path=' + encodeURIComponent('inbox/异步恢复条目.md'));
  assert.equal(asyncDetail.aiJob.status, 'completed'); assert.equal(asyncDetail.aiReview.id, asyncJob.reviewId);

  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'inbox', name: '格式失败条目', content: markdown('格式失败条目', { body: 'E2E_FORMAT_FAIL_MARKER' }) });
  const failedDetail = await call('/api/dsh-workbench/knowledge/review/detail?path=' + encodeURIComponent('inbox/格式失败条目.md'));
  const failedStart = await callRaw('/api/dsh-workbench/knowledge/review/ai-review/start', 'POST', { path: failedDetail.path, expectedHash: failedDetail.hash });
  let failedJob = failedStart.data;
  for (let attempt = 0; attempt < 50 && ['queued', 'running'].includes(failedJob.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    failedJob = await call('/api/dsh-workbench/knowledge/review/ai-review/status?id=' + encodeURIComponent(failedStart.data.id));
  }
  assert.equal(failedJob.status, 'failed'); assert.match(failedJob.error, /自动重试/); assert.doesNotMatch(failedJob.error, /Unterminated|string in JSON/i);

  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'inbox', name: '超时条目', content: markdown('超时条目', { body: 'E2E_TIMEOUT_MARKER' }) });
  const timeoutDetail = await call('/api/dsh-workbench/knowledge/review/detail?path=' + encodeURIComponent('inbox/超时条目.md'));
  const timeoutStart = await callRaw('/api/dsh-workbench/knowledge/review/ai-review/start', 'POST', { path: timeoutDetail.path, expectedHash: timeoutDetail.hash });
  let timeoutJob = timeoutStart.data;
  for (let attempt = 0; attempt < 50 && ['queued', 'running'].includes(timeoutJob.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    timeoutJob = await call('/api/dsh-workbench/knowledge/review/ai-review/status?id=' + encodeURIComponent(timeoutStart.data.id));
  }
  assert.equal(timeoutJob.status, 'failed'); assert.match(timeoutJob.error, /超时/);
  const missingNote = await callRaw('/api/dsh-workbench/knowledge/review/decision', 'POST', { path: detail.path, expectedHash: saved.hash, decision: 'request_changes' });
  assert.equal(missingNote.statusCode, 500);
  const returned = await call('/api/dsh-workbench/knowledge/review/decision', 'POST', { path: detail.path, expectedHash: saved.hash, decision: 'request_changes', note: '补充适用范围' });
  assert.equal(returned.pathAfter, 'inbox/审核条目A.md'); assert.equal(returned.entry.status, 'draft');
  detail = await call('/api/dsh-workbench/knowledge/review/detail?path=' + encodeURIComponent('inbox/审核条目A.md'));
  assert.ok(detail.history.some((event) => event.decision === 'request_changes'));
  const approved = await call('/api/dsh-workbench/knowledge/review/decision', 'POST', { path: detail.path, expectedHash: detail.hash, decision: 'approve' });
  assert.equal(approved.pathAfter, 'atomic/审核条目A.md'); assert.equal(approved.entry.status, 'published');
  const published = await readFile(join(tempHome, 'knowledge', '02-Atomic', '审核条目A.md'), 'utf8');
  assert.ok(published.includes('reviewDecision: approved')); assert.ok(published.includes('verifiedBy: human'));
  await assert.rejects(stat(join(tempHome, 'knowledge', '01-Inbox', '审核条目A.md')), /ENOENT/);

  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'inbox', name: '审核条目B', content: markdown('审核条目B') });
  detail = await call('/api/dsh-workbench/knowledge/review/detail?path=' + encodeURIComponent('inbox/审核条目B.md'));
  const rejected = await call('/api/dsh-workbench/knowledge/review/decision', 'POST', { path: detail.path, expectedHash: detail.hash, decision: 'reject', note: '内容不再适用' });
  assert.equal(rejected.pathAfter, 'archive/审核条目B.md'); assert.equal(rejected.entry.status, 'deprecated');

  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'inbox', name: '含密钥条目', content: markdown('含密钥条目', { body: '这是测试正文，包含 api_key=very-secret-token-value，必须阻止发布。' }) });
  detail = await call('/api/dsh-workbench/knowledge/review/detail?path=' + encodeURIComponent('inbox/含密钥条目.md'));
  const secretAiReview = await call('/api/dsh-workbench/knowledge/review/ai-review', 'POST', { path: detail.path, expectedHash: detail.hash });
  assert.equal(secretAiReview.level, 'blocked'); assert.ok(secretAiReview.hardBlockers.some((item) => /敏感|密钥/.test(item)));
  assert.doesNotMatch(lastLlmPrompt, /very-secret-token-value/); assert.match(lastLlmPrompt, /REDACTED/);
  const secretBlocked = await callRaw('/api/dsh-workbench/knowledge/review/decision', 'POST', { path: detail.path, expectedHash: detail.hash, decision: 'approve' });
  assert.equal(secretBlocked.statusCode, 500); assert.match(secretBlocked.data.message, /敏感信息|密钥/);

  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'inbox', name: '批量安全条目', content: markdown('批量安全条目') });
  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'inbox', name: '批量低置信条目', content: markdown('批量低置信条目', { confidence: 'low' }) });
  queue = await call('/api/dsh-workbench/knowledge/review/list');
  const batchPaths = queue.items.filter((item) => item.title.startsWith('批量')).map((item) => item.path);
  const batch = await call('/api/dsh-workbench/knowledge/review/batch', 'POST', { paths: batchPaths, decision: 'approve' });
  assert.equal(batch.succeeded, 1); assert.equal(batch.failed, 1);
  const audit = JSON.parse(await readFile(join(tempHome, 'dsh-workbench-knowledge-reviews.json'), 'utf8'));
  assert.ok(audit.events.some((event) => event.decision === 'approve'));
  assert.ok(audit.events.some((event) => event.decision === 'reject'));
  assert.ok(audit.events.some((event) => event.decision === 'ai_review'));
  assert.ok(audit.aiReviews.some((item) => item.totalScore === 85));
  assert.ok(audit.feedback.some((item) => item.action === 'apply_suggestions'));
  assert.ok(audit.aiEdits.some((item) => item.path === 'inbox/AI初审条目.md' && item.hunks.length === 1));
  passed = true; console.log('smoke-knowledge-review: PASS');
} finally {
  await rm(tempHome, { recursive: true, force: true });
  if (!passed) process.exitCode = 1;
}
