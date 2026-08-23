import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-workbench-knowledge-'));
process.env.USERPROFILE = tempHome;
process.env.HOME = tempHome;

const routes = new Map();
const ctx = {
  inject(names, callback) {
    if (names.includes('webServer')) {
      callback({
        webServer: { register(route) { routes.set(route.path, route); return () => {}; } },
        workspaceRegistry: { list: () => [] },
        llm: { listProviders: () => [], listModels: async () => [], async *stream() { yield { type: 'text-delta', text: '{}' }; } }
      });
    } else if (names.includes('subagents')) {
      callback({ subagents: { list: () => [], start: async () => ({ id: 'x', localAgent: { options: {} }, result: Promise.resolve({ output: [], stopReason: 'completed' }), dispose: async () => {} }) }, agents: { get: () => ({ id: 's', session: { header: { cwd: '' } } }), roots: () => [] } });
    } else if (names.includes('commands')) {
      callback({ commands: { register: () => [] }, sessionProjections: {} });
    }
  },
  on() {}
};

function request(method, url, body) {
  const req = new PassThrough();
  req.method = method;
  req.url = url;
  req.socket = { remoteAddress: '127.0.0.1' };
  req.headers = { host: '127.0.0.1:9999' };
  queueMicrotask(() => req.end(body === undefined ? '' : JSON.stringify(body)));
  return req;
}

async function callRaw(path, method, body) {
  const route = routes.get(path.split('?')[0]);
  assert(route, `route missing: ${path}`);
  let status = 0;
  let text = '';
  const res = { writeHead(code) { status = code; }, end(value) { text += value || ''; } };
  await route.handler(request(method, path, body), res);
  return { status, data: text ? JSON.parse(text) : {} };
}

async function call(path, method, body) {
  const { status, data } = await callRaw(path, method, body);
  assert.equal(status, 200, JSON.stringify(data));
  return data;
}

const fastapiContent = [
  '---',
  'title: 订单中台为什么用 FastAPI',
  'tags: [架构, 订单, fastapi]',
  'confidence: high',
  'status: published',
  'claimType: fact',
  'staleness: STABLE',
  'related: "[[订单中台]] [[异步消息]]"',
  'summary: 异步解耦与高性能是关键。',
  'source: 会话',
  'project: D:\\order',
  'created: 2026-08-19T00:00:00.000Z',
  '---',
  '# 订单中台为什么用 FastAPI',
  'FastAPI 提供异步支持与类型校验，适合订单中台的高并发与长流程。'
].join('\n');

const profileContent = [
  '---',
  'title: 检索画像配置',
  'tags: [知识库, 检索]',
  'confidence: medium',
  'related: "[[订单中台为什么用 FastAPI]]"',
  'summary: 每个项目可以配置不同的检索路由与预算。',
  'source: 思考',
  'project: D:\\workbench',
  'created: 2026-08-19T00:00:00.000Z',
  '---',
  '# 检索画像配置',
  '检索画像决定启用哪些召回路由、权重、TopK 与 token 预算。'
].join('\n');

const mcpContent = [
  '---',
  'title: 知识库 MCP 接入',
  'tags: [知识库, mcp]',
  'confidence: high',
  'related: "[[检索画像配置]]"',
  'summary: 通过稳定本地接口，其他 agent 可直接查询知识库。',
  'source: 设计',
  'project: D:\\workbench',
  'created: 2026-08-19T00:00:00.000Z',
  '---',
  '# 知识库 MCP 接入',
  '预留检索接口与 CLI 脚本，未来可被其他 agent/IDE 调用。'
].join('\n');

let smokePassed = false;
try {
  const { apply } = await import('../lib/host/index.js?' + Date.now());
  apply(ctx);

  // mock embedding server to prove the pluggable vector interface end-to-end
  const mockEmbed = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        const texts = Array.isArray(body.texts) ? body.texts : [];
        res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
        res.end(JSON.stringify({ data: texts.map((text, index) => [index + 1, 0.5, 0.25]) }));
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
  });
  await new Promise((resolvePromise) => mockEmbed.listen(0, '127.0.0.1', resolvePromise));
  const mockEmbedPort = mockEmbed.address().port;

  const initial = await call('/api/dsh-workbench/knowledge/list', 'GET');
  assert.ok(initial.vaultRoot, 'vault root should be created');
  assert.equal(initial.entries.length, 2, 'default + experience templates are scanned on first list');
  assert.equal(initial.stats.documents, 2);
  assert.equal(initial.stats.trend.length, 7);
  assert.equal(initial.vector.provider, 'bge-local', 'v4 default vector provider is local BGE');
  assert.equal(initial.vector.model, 'bge-small-zh-v1.5');
  const vaultRoot = initial.vaultRoot;
  await stat(join(vaultRoot, 'Dashboard.md'));
  await stat(join(vaultRoot, 'README.md'));
  await stat(join(vaultRoot, '.obsidian', 'app.json'));
  await stat(join(vaultRoot, '99-Templates', '默认条目模板.md'));
  await stat(join(vaultRoot, '99-Templates', '项目经验模板.md'));
  await stat(join(vaultRoot, '00-Raw'));
  await stat(join(vaultRoot, '05-Archive'));

  // v4: disable vector for deterministic local tests (custom mock provider used later)
  await call('/api/dsh-workbench/knowledge/vector', 'POST', { config: { provider: 'none' } });

  const written = await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'inbox', name: '订单中台-FastAPI', content: fastapiContent });
  assert.equal(written.entry.title, '订单中台为什么用 FastAPI');
  assert.deepEqual(written.entry.tags, ['架构', '订单', 'fastapi']);
  assert.equal(written.entry.confidence, 'high');
  assert.equal(written.entry.status, 'published', 'explicit published status should be kept');
  assert.equal(written.entry.claimType, 'fact');
  assert.ok(written.entry.confidenceBasis, 'confidence basis should be computed at scan');
  assert.ok(written.entry.confidenceBasis.reasons.length >= 1);
  assert.ok(written.precheck, 'write should return a precheck report');
  assert.equal(written.precheck.exactTitle, null);
  assert.ok(written.entry.related.includes('订单中台'));
  assert.equal(written.entry.project, 'D:\\order');
  assert.ok(written.entry.createdAt);
  assert.ok(written.entry.hash);
  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'atomic', name: '检索画像配置', content: profileContent });
  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'projects', name: '知识库-MCP接入', content: mcpContent });

  const badName = await callRaw('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'inbox', name: '../escape', content: 'x' });
  assert.equal(badName.status, 400, 'path traversal name should be rejected');
  const badRead = await callRaw('/api/dsh-workbench/knowledge/read?path=' + encodeURIComponent('../../evil.md'), 'GET', undefined);
  assert.equal(badRead.status, 400, 'path traversal read should be rejected');
  const badExternal = await callRaw('/api/dsh-workbench/open/external', 'POST', { uri: 'file:///C:/Windows/System32' });
  assert.equal(badExternal.status, 400, 'non-obsidian/http external uri should be rejected');
  const missingExternal = await callRaw('/api/dsh-workbench/open/external', 'POST', { uri: 'obsidian://open?path=' + encodeURIComponent(vaultRoot) });
  assert.ok(missingExternal.status === 200 || missingExternal.status === 400, 'obsidian uri should be accepted (200) or report unavailable (400), not 500');

  const synced = await call('/api/dsh-workbench/knowledge/sync', 'POST');
  assert.equal(synced.entries.length, 5, '3 written entries + 2 templates');
  assert.ok(synced.stats.documents >= 5);
  assert.ok(synced.stats.links >= 1);
  assert.ok(synced.stats.weekNew >= 3);
  const onDisk = await readFile(join(vaultRoot, '01-Inbox', '订单中台-FastAPI.md'), 'utf8');
  assert.ok(onDisk.includes('FastAPI'), 'markdown file should be written to the vault');

  const search = await call('/api/dsh-workbench/knowledge/search', 'POST', { query: '订单中台 FastAPI', topK: 3 });
  assert.ok(search.results.length >= 1);
  assert.equal(search.results[0].path, 'inbox/订单中台-FastAPI.md');
  assert.ok(search.results[0].snippet.length > 0);
  assert.ok(search.routes.includes('bm25'));
  assert.ok(search.routes.includes('graph'));
  assert.ok(search.routing && search.routing.mode, 'search should include routing classification');
  assert.ok('selfCheck' in search, 'search should include self-check gate');
  assert.ok(search.estimatedTokens > 0);
  assert.ok(search.results[0].confidence);
  assert.ok(search.results[0].computedConfidence);
  assert.ok(search.results[0].retrievalScore > 0, 'result should carry fused retrieval score');
  assert.equal(search.results[0].status, 'published');
  assert.equal(search.profile.topK, 5, 'default profile topK when no project profile saved');
  assert.ok(search.results.length <= 3, 'topK cap should apply');

  const profile = await call('/api/dsh-workbench/knowledge/profile?project=' + encodeURIComponent('D:\\proj'), 'GET');
  assert.equal(profile.profile.topK, 5);
  const savedProfile = await call('/api/dsh-workbench/knowledge/profile', 'POST', {
    project: 'D:\\proj',
    profile: { mode: 'vector', topK: 7, rerank: 'local', routes: { bm25: true, graph: true, vector: true, hyde: false } }
  });
  assert.equal(savedProfile.profile.topK, 7);
  assert.equal(savedProfile.profile.rerank, 'local');
  const vectorEnabledSearch = await call('/api/dsh-workbench/knowledge/search', 'POST', { query: 'FastAPI', project: 'D:\\proj' });
  assert.equal(vectorEnabledSearch.vectorStatus, 'disabled', 'profile enables vector but provider is none');
  assert.ok(['disabled', 'skipped'].includes(vectorEnabledSearch.rerankStatus), 'local rerank should fall back when local BGE is disabled');

  // configure the pluggable vector provider (mock "paid model" endpoint) and rebuild vectors
  const configuredVector = await call('/api/dsh-workbench/knowledge/vector', 'POST', {
    config: { provider: 'custom', model: 'mock-embed', baseUrl: 'http://127.0.0.1:' + mockEmbedPort + '/embed', apiKey: '', python: '' }
  });
  assert.equal(configuredVector.saved, true, 'custom provider test embed should pass');
  assert.equal(configuredVector.status.tested, true);
  const rebuilt = await call('/api/dsh-workbench/knowledge/vector/rebuild', 'POST');
  assert.equal(rebuilt.rebuilt, true);
  assert.ok(rebuilt.count >= 4);
  const vectorSearch = await call('/api/dsh-workbench/knowledge/search', 'POST', { query: 'FastAPI', project: 'D:\\proj' });
  assert.equal(vectorSearch.vectorStatus, 'ok');
  assert.ok(vectorSearch.routes.includes('vector'));
  const backToNone = await call('/api/dsh-workbench/knowledge/vector', 'POST', { config: { provider: 'none' } });
  assert.equal(backToNone.saved, true);
  assert.equal(backToNone.config.provider, 'none');

  const distilled = await call('/api/dsh-workbench/knowledge/distill', 'POST', {
    title: '部署经验',
    source: 'text',
    content: '上线时先备份运行副本再复制新文件，重启后端口会变化。'
  });
  assert.equal(distilled.fallback, true);
  assert.equal(distilled.entry.confidence, 'low');
  assert.equal(distilled.entry.status, 'review', 'distilled entries land as review in inbox');
  assert.ok(distilled.precheck, 'distill should carry a precheck report');
  assert.equal(distilled.autoPublished, false, 'manual review mode should not auto-publish');
  assert.ok(distilled.entry.path.startsWith('inbox/'));
  assert.ok(distilled.entry.path.includes('部署经验'));

  const report = await call('/api/dsh-workbench/knowledge/maintain', 'POST');
  assert.equal(report.mocsUpdated, true);
  assert.ok(Array.isArray(report.duplicates));
  assert.ok(Array.isArray(report.brokenLinks));
  assert.ok(Array.isArray(report.orphans));
  const mocs = await readFile(join(vaultRoot, '03-MOCs', 'Index.md'), 'utf8');
  assert.ok(mocs.includes('知识库地图'));
  assert.ok(mocs.includes('标签索引'));

  const feedback = await call('/api/dsh-workbench/knowledge/feedback', 'POST', { question: '检索画像怎么配', note: '没找到', missed: true });
  assert.equal(feedback.ok, true);
  const evalStore = await call('/api/dsh-workbench/knowledge/eval', 'GET');
  assert.ok(evalStore.candidates.length >= 1);
  await call('/api/dsh-workbench/knowledge/eval/add', 'POST', { question: '订单中台为什么用 FastAPI', expected: ['inbox/订单中台-FastAPI.md'] });
  const evalRun = await call('/api/dsh-workbench/knowledge/eval/run', 'POST', { topK: 5 });
  assert.equal(evalRun.items, 1);
  assert.equal(evalRun.recallAtK, 1, 'fastapi entry should be recalled');
  assert.ok(evalRun.avgTokens > 0);
  assert.equal(evalRun.acceptance.ready, false, 'a one-item smoke set must not claim production acceptance');
  assert.equal(evalRun.acceptance.checks.find((check) => check.id === 'recall-at-k').passed, true);
  assert.equal(evalRun.acceptance.checks.find((check) => check.id === 'dataset-size').passed, false);
  assert.equal(evalRun.onlineAudit.groundednessSamples, 0);
  const evalAfterRun = await call('/api/dsh-workbench/knowledge/eval', 'GET');
  assert.ok((evalAfterRun.history || []).length >= 1, 'eval history should be stored');
  const emptySearch = await call('/api/dsh-workbench/knowledge/search', 'POST', { query: 'zzzznomatchxyz' });
  assert.equal(emptySearch.results.length, 0);
  const evalAfterEmpty = await call('/api/dsh-workbench/knowledge/eval', 'GET');
  assert.ok(evalAfterEmpty.candidates.some((item) => item.question === 'zzzznomatchxyz'), 'empty search should auto-record a candidate');

  const readEntry = await call('/api/dsh-workbench/knowledge/read?path=' + encodeURIComponent(written.entry.path), 'GET');
  assert.ok(readEntry.content.includes('FastAPI'));
  assert.equal(readEntry.entry.title, written.entry.title);
  const removed = await call('/api/dsh-workbench/knowledge/remove', 'POST', { path: readEntry.path });
  assert.equal(removed.ok, true);

  // typed entries for the asset overview
  const skillContent = [
    '---',
    'title: 技能-代码审查',
    'type: skill',
    'tags: [技能, 审查]',
    'confidence: high',
    'related: ""',
    'summary: 代码审查检查清单。',
    'created: 2026-08-19T00:00:00.000Z',
    '---',
    '# 技能-代码审查',
    '逐项核对边界、可维护性与隐患。'
  ].join('\n');
  const projectContent = [
    '---',
    'title: 项目-工作台',
    'type: project',
    'tags: [项目]',
    'confidence: medium',
    'related: ""',
    'summary: 工作台项目复盘。',
    'created: 2026-08-19T00:00:00.000Z',
    '---',
    '# 项目-工作台',
    '记录工作台项目的目标与进展。'
  ].join('\n');
  const workflowContent = [
    '---',
    'title: 工作流-发布',
    'type: workflow',
    'tags: [工作流, 发布]',
    'confidence: high',
    'related: ""',
    'summary: 发布流程沉淀。',
    'created: 2026-08-19T00:00:00.000Z',
    '---',
    '# 工作流-发布',
    '备份 → 复制 → 重启 → 回归。'
  ].join('\n');
  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'atomic', name: '技能-代码审查', content: skillContent });
  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'projects', name: '项目-工作台', content: projectContent });
  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'inbox', name: '工作流-发布', content: workflowContent });

  // tags participate in retrieval (keyword only in tags)
  const tagOnlyContent = [
    '---',
    'title: 标签检索测试',
    'tags: [xyzabc]',
    'confidence: medium',
    'status: published',
    'related: ""',
    'summary: 关键词只出现在标签里。',
    'created: 2026-08-19T00:00:00.000Z',
    '---',
    '# 标签检索测试',
    '正文不包含特殊关键词。'
  ].join('\n');
  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'inbox', name: '标签检索测试', content: tagOnlyContent });
  const tagSearch = await call('/api/dsh-workbench/knowledge/search', 'POST', { query: 'xyzabc', topK: 3 });
  assert.ok(tagSearch.results.some((item) => item.path === 'inbox/标签检索测试.md'), 'tags should be part of the index');

  // directly-written file is picked up without a manual sync (stale index rescan)
  await writeFile(join(vaultRoot, '01-Inbox', '直接写入条目.md'), [
    '---',
    'title: 直接写入条目',
    'tags: []',
    'confidence: medium',
    'status: published',
    'related: ""',
    'summary: stalecheck123 用于验证自动重建。',
    'created: 2026-08-19T00:00:00.000Z',
    '---',
    '# 直接写入条目',
    '这是绕过接口直接写入 vault 的文件，搜索应自动索引到。'
  ].join('\n'), 'utf8');
  const staleSearch = await call('/api/dsh-workbench/knowledge/search', 'POST', { query: 'stalecheck123', topK: 3 });
  assert.ok(staleSearch.results.some((item) => item.path === 'inbox/直接写入条目.md'), 'search should auto-rescan stale vault');

  // asset overview groups typed entries + templates + experts
  const overview = await call('/api/dsh-workbench/knowledge/overview', 'GET');
  assert.ok(overview.skills.some((item) => item.title === '技能-代码审查'));
  assert.ok(overview.projects.some((item) => item.title === '项目-工作台'));
  assert.ok(overview.workflows.some((item) => item.title === '工作流-发布'));
  assert.ok(overview.notes.some((item) => item.title === '直接写入条目'), 'plain notes should be grouped separately');
  assert.ok(overview.skills.every((item) => item.name), 'overview items should carry file name for preview/obsidian');
  assert.ok(!overview.skills.some((item) => item.title === '项目-工作台'), 'groups should be mutually exclusive');
  assert.ok(!overview.notes.some((item) => item.title === '技能-代码审查'), 'typed skill should not leak into notes');
  assert.ok(overview.workflowTemplates.length >= 4, 'default workflow templates should be listed');
  assert.ok(Array.isArray(overview.experts));
  assert.ok(Array.isArray(overview.workspaceProjects));

  const badVector = await call('/api/dsh-workbench/knowledge/vector', 'POST', { config: { provider: 'openai', model: 'text-embedding-3-small', apiKey: '', baseUrl: '' } });
  assert.equal(badVector.saved, false);
  assert.ok(badVector.status.error);
  const finalSync = await call('/api/dsh-workbench/knowledge/sync', 'POST');
  assert.equal(finalSync.entries.length, 11, 'existing 6 + skill/project/workflow/tag-only/direct-write after removing fastapi');

  // ---- v4 quality gate: precheck / publish / quality / raw / archive / routing ----
  const precheckDup = await call('/api/dsh-workbench/knowledge/precheck', 'POST', {
    title: '技能-代码审查',
    content: skillContent,
    source: '手册'
  });
  assert.ok(precheckDup.exactTitle, 'precheck should detect an existing title');
  assert.ok(precheckDup.blocks.length >= 1);

  const qualityConfig = await call('/api/dsh-workbench/knowledge/quality', 'POST', {
    reviewMode: 'auto',
    autoPublishLowRisk: true,
    forgetMode: 'prompt',
    forgetAutoArchive: false
  });
  assert.equal(qualityConfig.reviewMode, 'auto');
  assert.equal(qualityConfig.forgetMode, 'prompt');

  const rawCaptured = await call('/api/dsh-workbench/knowledge/raw', 'POST', {
    name: '源材料-订单讨论',
    source: '会话原文',
    content: '某次讨论订单中台选型的完整记录……'
  });
  assert.ok(rawCaptured.path.startsWith('raw/'));
  assert.equal(rawCaptured.entry.status, 'draft');
  const rawSearch = await call('/api/dsh-workbench/knowledge/search', 'POST', { query: '订单中台选型', topK: 5 });
  assert.ok(!rawSearch.results.some((item) => item.path.startsWith('raw/')), 'raw layer should be excluded from default retrieval');

  const draftBefore = await call('/api/dsh-workbench/knowledge/write', 'POST', {
    folder: 'inbox',
    name: '待发布条目',
    content: [
      '---',
      'title: 待发布条目',
      'tags: []',
      'confidence: medium',
      'status: review',
      'source: 思考',
      'related: ""',
      'summary: 待发布条目用于验证发布流转。',
      'created: 2026-08-19T00:00:00.000Z',
      '---',
      '# 待发布条目',
      '这条内容在发布前不应被默认检索到。'
    ].join('\n')
  });
  const reviewSearch = await call('/api/dsh-workbench/knowledge/search', 'POST', { query: '待发布条目', topK: 5 });
  assert.ok(!reviewSearch.results.some((item) => item.path === draftBefore.entry.path), 'review entries should not pollute default retrieval');

  const published = await call('/api/dsh-workbench/knowledge/publish', 'POST', {
    path: draftBefore.entry.path,
    moveToAtomic: true,
    verifiedBy: 'smoke'
  });
  assert.equal(published.entry.status, 'published');
  assert.equal(published.entry.verifiedBy, 'smoke');
  assert.equal(published.moved, true);
  assert.ok(published.path.startsWith('atomic/'));
  const publishedSearch = await call('/api/dsh-workbench/knowledge/search', 'POST', { query: '待发布条目', topK: 5 });
  assert.ok(publishedSearch.results.some((item) => item.path === published.path), 'published entry should be retrievable');

  const archived = await call('/api/dsh-workbench/knowledge/archive', 'POST', { path: published.path, restore: false });
  assert.equal(archived.archived, true);
  assert.ok(archived.path.startsWith('archive/'));
  assert.equal(archived.entry.status, 'deprecated');
  const archivedSearch = await call('/api/dsh-workbench/knowledge/search', 'POST', { query: '待发布条目', topK: 5 });
  assert.ok(!archivedSearch.results.some((item) => item.path === archived.path), 'archived entries should not be retrieved by default');
  const restored = await call('/api/dsh-workbench/knowledge/archive', 'POST', { path: archived.path, restore: true });
  assert.equal(restored.restored, true);
  assert.equal(restored.entry.status, 'published');

  const vectorRouteSearch = await call('/api/dsh-workbench/knowledge/search', 'POST', { query: '订单中台为什么选择 FastAPI 异步消息架构', topK: 5 });
  assert.ok(['bm25-graph', 'graph', 'vector', 'hybrid', 'iterative'].includes(vectorRouteSearch.mode), 'mode should be one of the route profiles');
  const relationSearch = await call('/api/dsh-workbench/knowledge/search', 'POST', { query: 'FastAPI 和 异步消息之间是什么关系', topK: 5 });
  assert.equal(relationSearch.routing.mode, 'graph', 'relation-style query should classify to graph');
  assert.ok(['graph', 'iterative'].includes(relationSearch.mode), 'relation-style query should use graph or bounded iteration');

  const maintainReport = await call('/api/dsh-workbench/knowledge/maintain', 'POST');
  assert.ok(Array.isArray(maintainReport.archived), 'maintain should report archived list');
  assert.ok(maintainReport.stale.every((item) => item && typeof item === 'object'), 'stale items should carry suggestion metadata');

  // ---- v6: experience type + semi-auto consolidation ----
  const experienceContent = [
    '---',
    'title: 经验-订单中台选型',
    'type: experience',
    'tags: [项目经验]',
    'confidence: high',
    'status: published',
    'source: 项目复盘',
    'project: D:\\order',
    'related: ""',
    'summary: 订单中台选 FastAPI 优于同步框架。',
    'context: 订单中台，高并发长流程',
    'result: 压测通过，性能达标',
    'reusable: 高并发长流程场景优先异步框架',
    'created: 2026-08-19T00:00:00.000Z',
    '---',
    '# 经验-订单中台选型',
    '在订单中台项目中验证了异步框架的优势。'
  ].join('\n');
  const expWritten = await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'atomic', name: '经验-订单中台选型', content: experienceContent });
  assert.equal(expWritten.entry.type, 'experience');
  assert.equal(expWritten.entry.context, '订单中台，高并发长流程');
  assert.equal(expWritten.entry.reusable, '高并发长流程场景优先异步框架');
  const overviewWithExp = await call('/api/dsh-workbench/knowledge/overview', 'GET');
  assert.ok(overviewWithExp.experiences.some((item) => item.title === '经验-订单中台选型'), 'experience should be grouped separately');
  assert.ok(!overviewWithExp.experiences.some((item) => item.title === '项目经验模板'), 'experience template should not leak into experiences group');
  assert.ok(!overviewWithExp.projects.some((item) => item.title === '经验-订单中台选型'), 'experience should not leak into projects');
  assert.ok(!overviewWithExp.notes.some((item) => item.title === '经验-订单中台选型'), 'experience should not leak into notes');
  const cons = await call('/api/dsh-workbench/knowledge/consolidations', 'GET');
  const pendingItem = cons.suggestions.find((item) => item.from === 'atomic/经验-订单中台选型.md');
  assert.ok(pendingItem, 'consolidation draft should be generated for a fresh published experience');
  const applied = await call('/api/dsh-workbench/knowledge/consolidations', 'POST', { action: 'apply', id: pendingItem.id });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.ok(applied.entry && applied.entry.type === 'note', 'consolidated output should be a knowledge note');
  const sourceRead = await call('/api/dsh-workbench/knowledge/read?path=' + encodeURIComponent('atomic/经验-订单中台选型.md'), 'GET');
  assert.ok(sourceRead.content.includes(pendingItem.title), 'source experience should gain a backlink to the consolidated knowledge');

  console.log('knowledge smoke test passed');
  smokePassed = true;
} finally {
  try {
    if (typeof mockEmbed.closeAllConnections === 'function') mockEmbed.closeAllConnections();
  } catch (e) { /* ignore */ }
  try {
    await new Promise((resolvePromise) => mockEmbed.close(resolvePromise));
  } catch (e) { /* already closed */ }
  await rm(tempHome, { recursive: true, force: true });
  if (smokePassed) process.exit(0);
}
