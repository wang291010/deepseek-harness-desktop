#!/usr/bin/env node
/**
 * smoke-knowledge-auto — conversation auto-retrieval smoke test.
 *
 * Verifies:
 *   1. /knowledge/auto retrieves and builds a bounded, cited block.
 *   2. Gating skips casual turns (no token cost).
 *   3. Low-confidence miss still instructs web verification (webFallback).
 *   4. Config endpoint can disable the feature.
 *   5. orchestration_create attaches knowledgeRefs automatically.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-workbench-knowledge-auto-'));
process.env.USERPROFILE = tempHome;
process.env.HOME = tempHome;
process.env.DSH_HOME = tempHome;

const routes = new Map();
const promptSections = new Map();
const registeredTools = new Map();
const eventListeners = new Map();
let kbSectionText = null;
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
    } else if (names.includes('tools')) {
      callback({
        tools: { register(tool) { registeredTools.set(tool.name, tool); return () => registeredTools.delete(tool.name); } },
        systemPrompt: {
          section(section) { promptSections.set(section.name, section); return () => promptSections.delete(section.name); }
        }
      });
    } else if (names.includes('systemPrompt')) {
      callback({
        effect(cb) { const result = cb(); return () => (typeof result === 'function' ? result() : undefined); },
        systemPrompt: {
          section(section) {
            promptSections.set(section.name, section);
            if (section.name === 'dsh-workbench:knowledge-context') kbSectionText = section.text;
            return () => {};
          }
        }
      });
    }
  },
  on(name, listener) {
    const listeners = eventListeners.get(name) || [];
    listeners.push(listener);
    eventListeners.set(name, listeners);
    return () => eventListeners.set(name, (eventListeners.get(name) || []).filter((item) => item !== listener));
  }
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

let passed = false;
try {
  const { apply } = await import('../lib/host/index.js?' + Date.now());
  apply(ctx);

  // Disable vector for deterministic local tests (BM25 + graph only).
  await call('/api/dsh-workbench/knowledge/vector', 'POST', { config: { provider: 'none' } });

  const atomicContent = [
    '---',
    'title: 看门狗重试策略',
    'tags: [多AI, 看门狗, 可靠性]',
    'confidence: high',
    'status: published',
    'claimType: fact',
    'staleness: STABLE',
    'summary: 子代理超时自动重试最多 2 次，全部失败则标记人工介入并跳过主代理。',
    'source: 工作台开发沉淀',
    'created: 2026-08-20T00:00:00.000Z',
    '---',
    '# 看门狗重试策略',
    '子代理单次超时默认 15 分钟，失败自动重试最多 2 次；全部失败标记"执行异常/需人工介入"。'
  ].join('\n');

  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'atomic', name: '看门狗重试策略', content: atomicContent });
  await call('/api/dsh-workbench/knowledge/sync', 'POST');

  const knowledgeSearchTool = registeredTools.get('knowledge_search');
  const knowledgeReadTool = registeredTools.get('knowledge_read');
  assert.ok(knowledgeSearchTool, 'knowledge_search tool should be registered');
  assert.ok(knowledgeReadTool, 'knowledge_read tool should be registered');
  assert.equal(knowledgeSearchTool.isConcurrencySafe(), true, 'knowledge_search should opt into parallel tool scheduling');
  const toolPrompt = promptSections.get('dsh-workbench:knowledge-tools');
  assert.ok(toolPrompt && String(toolPrompt.text).includes('knowledge_read'), 'knowledge tool prompt should be registered');
  assert.ok(String(toolPrompt.text).includes('same assistant tool-call batch'), 'freshness prompt should require a concurrent knowledge/Web call batch');
  assert.ok(String(toolPrompt.text).includes('clickable [source title](URL)'), 'web-backed claims should require real clickable citations');
  assert.ok(String(toolPrompt.text).includes('Do not repeat knowledge_search'), 'sufficient coverage should discourage redundant searches');
  const traceWrapper = (eventListeners.get('tools/execute') || [])[0];
  assert.equal(typeof traceWrapper, 'function', 'knowledge/Web trace wrapper should be registered');

  await call('/api/dsh-workbench/knowledge/traces', 'POST', { action: 'clear' });
  const traceEvents = [
    { type: 'tool/call', data: { turn: 2, step: 3, callId: 'kb-parallel', name: 'knowledge_search' } },
    { type: 'tool/call', data: { turn: 2, step: 3, callId: 'web-parallel', name: 'web_search' } }
  ];
  const makeTraceExec = (name, callId, sessionId, events, args) => ({
    name, callId, rootCallId: callId, arguments: args,
    agent: { id: sessionId, session: { events } },
    signal: new AbortController().signal
  });
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await Promise.all([
    traceWrapper(
      makeTraceExec('knowledge_search', 'kb-parallel', 'trace-session-a', traceEvents, { query: '工作台当前方案与最新实践' }),
      async () => {
        await delay(35);
        return { isError: false, value: { coverage: 'gray', coverageScore: 0.5, action: 'parallel-kb-web', results: [{ path: 'atomic/x.md' }], estimatedTokens: 100, retrievalTokens: 150, latencyMs: 30, iterations: 1 }, content: [] };
      }
    ),
    traceWrapper(
      makeTraceExec('web_search', 'web-parallel', 'trace-session-a', traceEvents, { query: 'RAG 2026 latest', apiKey: 'secret-must-not-persist' }),
      async () => {
        await delay(20);
        return { isError: false, value: { results: [{ url: 'https://example.com/current', title: 'Current' }] }, content: [{ type: 'text', text: 'bounded web result' }] };
      }
    )
  ]);
  const isolatedEvents = [{ type: 'tool/call', data: { turn: 1, step: 1, callId: 'web-failure', name: 'web_fetch' } }];
  await traceWrapper(
    makeTraceExec('web_fetch', 'web-failure', 'trace-session-b', isolatedEvents, { url: 'https://example.com/private?token=also-secret' }),
    async () => ({ isError: true, error: { message: 'network unavailable', info: { code: 'NETWORK' } }, content: [] })
  );
  const sessionATraces = await call('/api/dsh-workbench/knowledge/traces?sessionId=trace-session-a&limit=10', 'GET');
  assert.equal(sessionATraces.totalMatched, 2, 'trace filtering should isolate one session');
  assert.equal(sessionATraces.summary.hasParallelEvidence, true, 'overlapping knowledge/Web calls should produce parallel evidence');
  assert.equal(sessionATraces.summary.parallelBatches, 1);
  assert.ok(sessionATraces.summary.overlapPairs[0].overlapMs > 0, 'parallel evidence should include a positive overlap duration');
  const knowledgeTrace = sessionATraces.traces.find((trace) => trace.tool === 'knowledge_search');
  assert.equal(knowledgeTrace.result.estimatedTokens, 100, 'token metrics must remain available after redaction');
  assert.equal(knowledgeTrace.result.retrievalTokens, 150, 'retrieval token metrics must remain available after redaction');
  const sessionBTraces = await call('/api/dsh-workbench/knowledge/traces?sessionId=trace-session-b&limit=10', 'GET');
  assert.equal(sessionBTraces.totalMatched, 1);
  assert.equal(sessionBTraces.summary.failed, 1, 'failed tools should remain observable');
  assert.equal(sessionBTraces.traces[0].result.errorCode, 'NETWORK');
  const traceStoreText = await readFile(join(tempHome, 'dsh-workbench-knowledge-traces.json'), 'utf8');
  assert.equal(traceStoreText.includes('secret-must-not-persist'), false, 'sensitive arguments must be redacted before persistence');
  assert.equal(traceStoreText.includes('also-secret'), false, 'sensitive URL query parameters must be redacted before persistence');
  const clearedSession = await call('/api/dsh-workbench/knowledge/traces', 'POST', { action: 'clear', sessionId: 'trace-session-b' });
  assert.equal(clearedSession.summary.total, 2, 'session-scoped clear should retain other sessions');
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    () => knowledgeSearchTool.execute({ query: '不应执行的检索' }, { signal: aborted.signal }),
    { name: 'AbortError' }
  );

  // 1. Knowledge query triggers retrieval, builds bounded cited block.
  const hit = await call('/api/dsh-workbench/knowledge/auto', 'POST', { query: '子代理超时了应该怎么处理？重试机制是什么', sessionId: 's1' });
  assert.equal(hit.inject, true, JSON.stringify(hit));
  assert.ok(hit.refs.length >= 1, 'expected at least one knowledge ref');
  assert.equal(hit.refs[0].id, '知识1');
  assert.ok(hit.block.includes('[知识1]'), 'block should cite 知识1');
  assert.ok(hit.block.includes('路径：'), 'block should carry source path');
  if (hit.meta.coverage.level === 'sufficient') assert.ok(hit.block.includes('覆盖充分'), 'sufficient coverage should stay on the knowledge path');
  else assert.ok(hit.block.includes('web_search'), 'non-sufficient coverage should instruct web verification');
  assert.ok(hit.block.includes('未验证'), 'block should mandate unverified marking');
  assert.ok(hit.meta.estimatedTokens <= 800, 'token budget must stay bounded');
  assert.ok(hit.meta.coverage && ['sufficient', 'gray', 'insufficient'].includes(hit.meta.coverage.level), 'auto retrieval should expose coverage routing');
  assert.ok(hit.meta.iterations >= 1 && hit.meta.iterations <= 2, 'iteration count should be bounded');
  assert.ok(hit.meta.latencyMs >= 0, 'retrieval should expose latency');
  assert.ok(hit.meta.retrievalTokens >= 0, 'retrieval should expose process token estimate');
  assert.ok(kbSectionText, 'knowledge-context system prompt section should be registered');
  const renderedSection = kbSectionText({ agent: { id: 's1' } });
  assert.ok(renderedSection.includes('[知识1]'), 'AI system prompt should receive the KB context');
  assert.ok(renderedSection.includes('使用规则'), 'AI system prompt should include usage rules');

  const toolHit = await knowledgeSearchTool.execute(
    { query: '子代理超时了应该怎么处理？重试机制是什么' },
    { signal: new AbortController().signal }
  );
  assert.ok(toolHit.results.length >= 1 && toolHit.results.length <= 5, 'knowledge_search should return bounded summaries');
  assert.ok(['sufficient', 'gray', 'insufficient'].includes(toolHit.coverage), 'knowledge_search should expose coverage');
  assert.ok(['knowledge-only', 'parallel-kb-web', 'web-primary'].includes(toolHit.action), 'knowledge_search should expose fallback action');
  assert.equal('content' in toolHit.results[0], false, 'knowledge_search must not return full note content');
  assert.ok(knowledgeSearchTool.output.render({}, toolHit)[0].text.includes('[知识1《'), 'tool rendering should expose a complete citation label');

  const helpful = await call('/api/dsh-workbench/knowledge/feedback', 'POST', {
    question: '子代理超时了应该怎么处理？重试机制是什么',
    rating: 'helpful',
    paths: [toolHit.results[0].path]
  });
  assert.equal(helpful.rating, 'helpful');
  assert.deepEqual(helpful.paths, [toolHit.results[0].path]);
  const qualityAfterFeedback = await call('/api/dsh-workbench/knowledge/quality', 'GET');
  assert.equal(qualityAfterFeedback.usage[toolHit.results[0].path].helpful, 1, 'helpful feedback should strengthen the cited entry');
  const evalAfterFeedback = await call('/api/dsh-workbench/knowledge/eval', 'GET');
  const helpfulCandidate = evalAfterFeedback.candidates.find((item) => item.question.includes('子代理超时了应该怎么处理'));
  assert.ok(helpfulCandidate && helpfulCandidate.expected.includes(toolHit.results[0].path), 'helpful feedback should seed an evaluation candidate with the expected path');
  const promoted = await call('/api/dsh-workbench/knowledge/eval/candidate', 'POST', { id: helpfulCandidate.id, action: 'promote' });
  assert.ok(promoted.items.some((item) => item.question === helpfulCandidate.question), 'feedback candidate should promote into the regression set');
  assert.ok(!promoted.candidates.some((item) => item.id === helpfulCandidate.id), 'promoted candidate should leave the candidate pool');
  const routeEvalItem = promoted.items.find((item) => item.question === helpfulCandidate.question);
  await call('/api/dsh-workbench/knowledge/eval/update', 'POST', {
    id: routeEvalItem.id,
    patch: { expectedStrategy: 'single', expectedWeb: 'none' }
  });
  const routeReport = await call('/api/dsh-workbench/knowledge/eval/run', 'POST', { topK: 5 });
  const routeReportSummary = JSON.stringify({
    routeAccuracy: routeReport.routeAccuracy,
    simpleSinglePassRate: routeReport.simpleSinglePassRate,
    webRouteAccuracy: routeReport.webRouteAccuracy,
    results: routeReport.results
  });
  assert.equal(routeReport.routeSamples, 1, routeReportSummary);
  assert.equal(routeReport.routeAccuracy, 1, routeReportSummary);
  assert.equal(routeReport.simpleSinglePassRate, 1, routeReportSummary);
  assert.equal(routeReport.webRouteAccuracy, 1, routeReportSummary);

  const toolRead = await knowledgeReadTool.execute(
    { path: toolHit.results[0].path },
    { signal: new AbortController().signal }
  );
  assert.equal(toolRead.path, toolHit.results[0].path);
  assert.ok(toolRead.content.includes('子代理单次超时'), 'knowledge_read should read a published entry');
  const legacyContent = atomicContent
    .replace('title: 看门狗重试策略', 'title: 旧版无状态条目')
    .replace('status: published\n', '')
    .replace(/看门狗重试策略/g, '旧版无状态条目');
  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'atomic', name: '旧版无状态条目', content: legacyContent });
  await call('/api/dsh-workbench/knowledge/sync', 'POST');
  const legacyRead = await knowledgeReadTool.execute(
    { path: 'atomic/旧版无状态条目.md' },
    { signal: new AbortController().signal }
  );
  assert.ok(legacyRead.content.includes('旧版无状态条目'), 'knowledge_read should support legacy reviewed atomic entries without an explicit status');
  await assert.rejects(
    () => knowledgeReadTool.execute({ path: '../dsh-workbench-tasks.json' }, { signal: new AbortController().signal }),
    /invalid knowledge path/
  );

  // 2. Gating skips casual turns.
  const casual = await call('/api/dsh-workbench/knowledge/auto', 'POST', { query: '你好', sessionId: 's1' });
  assert.equal(casual.inject, false);
  assert.equal(casual.block, '');
  assert.equal(casual.refs.length, 0);

  // 3. Low-confidence miss still instructs web verification.
  const miss = await call('/api/dsh-workbench/knowledge/auto', 'POST', { query: '最新的价格政策是什么', sessionId: 's1' });
  assert.equal(miss.inject, true, 'webFallback should keep a miss note injected');
  assert.equal(miss.refs.length, 0);
  assert.ok(miss.block.includes('未命中高置信度'), 'miss note should be explicit');
  assert.ok(miss.block.includes('web_search'), 'miss note should instruct web search');

  const toolMiss = await knowledgeSearchTool.execute(
    { query: '量子奶茶火箭的内部价格政策与保修周期' },
    { signal: new AbortController().signal }
  );
  assert.equal(toolMiss.results.length, 0, 'tool miss should not fabricate results');
  assert.equal(toolMiss.action, 'web-primary');
  const evalStore = JSON.parse(await readFile(join(tempHome, 'dsh-workbench-knowledge-eval.json'), 'utf8'));
  assert.ok(evalStore.candidates.some((item) => item.question.includes('量子奶茶火箭')), 'tool miss should enter the evaluation candidate pool');

  const reviewContent = atomicContent.replace('status: published', 'status: review').replace(/看门狗重试策略/g, '待审核读取限制');
  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'atomic', name: '待审核读取限制', content: reviewContent });
  const longContent = atomicContent + '\n' + '长内容。'.repeat(3000);
  await call('/api/dsh-workbench/knowledge/write', 'POST', { folder: 'atomic', name: '长内容读取限制', content: longContent.replace(/看门狗重试策略/g, '长内容读取限制') });
  await call('/api/dsh-workbench/knowledge/sync', 'POST');
  await assert.rejects(
    () => knowledgeReadTool.execute({ path: 'atomic/待审核读取限制.md' }, { signal: new AbortController().signal }),
    /not published/
  );
  const truncatedRead = await knowledgeReadTool.execute(
    { path: 'atomic/长内容读取限制.md' },
    { signal: new AbortController().signal }
  );
  assert.equal(truncatedRead.truncated, true, 'knowledge_read should enforce output truncation');
  assert.ok(truncatedRead.content.length <= 6000, 'knowledge_read output should stay within its character cap');
  await writeFile(
    join(tempHome, 'knowledge', '02-Atomic', '长内容读取限制.md'),
    longContent.replace(/看门狗重试策略/g, '长内容读取限制').replace('status: published', 'status: review'),
    'utf8'
  );
  await assert.rejects(
    () => knowledgeReadTool.execute({ path: 'atomic/长内容读取限制.md' }, { signal: new AbortController().signal }),
    /not published/,
    'knowledge_read should reject a file downgraded after the last index sync'
  );

  // 4. Config can disable the feature (zero cost).
  const cfg0 = await call('/api/dsh-workbench/knowledge/auto/config', 'GET');
  assert.equal(cfg0.config.enabled, true);
  const cfg1 = await call('/api/dsh-workbench/knowledge/auto/config', 'POST', { enabled: false });
  assert.equal(cfg1.config.enabled, false);
  const disabled = await call('/api/dsh-workbench/knowledge/auto', 'POST', { query: '子代理超时应该怎么处理', sessionId: 's1' });
  assert.equal(disabled.inject, false);
  assert.equal(disabled.reason, 'disabled');
  await call('/api/dsh-workbench/knowledge/auto/config', 'POST', { enabled: true });

  const configured = await call('/api/dsh-workbench/knowledge/auto/config', 'POST', {
    gate: 'rule', routing: 'force-iterative', maxIterations: 2, rerank: 'local',
    thresholds: { insufficient: 0.4, gray: 0.8 }, auditLevel: 'ref-only'
  });
  assert.equal(configured.config.gate, 'rule');
  assert.equal(configured.config.routing, 'force-iterative');
  assert.equal(configured.config.maxIterations, 2);
  assert.equal(configured.config.rerank, 'local');
  const normalizedThresholds = await call('/api/dsh-workbench/knowledge/auto/config', 'POST', {
    thresholds: { insufficient: 0.9, gray: 0.2 }
  });
  assert.equal(normalizedThresholds.config.thresholds.insufficient, 0.9);
  assert.equal(normalizedThresholds.config.thresholds.gray, 0.9, 'gray threshold cannot be lower than insufficient');

  const audit = await call('/api/dsh-workbench/knowledge/audit', 'POST', {
    answer: '子代理超时后会自动重试。[知识1《看门狗重试策略》· 置信度 high]',
    refs: hit.refs
  });
  assert.equal(audit.valid, true, JSON.stringify(audit));
  const badAudit = await call('/api/dsh-workbench/knowledge/audit', 'POST', {
    answer: '结论来自不存在的条目。[知识9《不存在》· 置信度 high]',
    refs: hit.refs
  });
  assert.equal(badAudit.valid, false);
  assert.ok(badAudit.invalid.length >= 1);
  const missingAudit = await call('/api/dsh-workbench/knowledge/audit', 'POST', {
    answer: '子代理超时后会自动重试。', refs: hit.refs
  });
  assert.equal(missingAudit.valid, false);
  assert.equal(missingAudit.abstainRequired, true);

  await call('/api/dsh-workbench/knowledge/auto/config', 'POST', {
    enabled: true, gate: 'both', routing: 'auto', maxIterations: 2, rerank: 'none',
    thresholds: { insufficient: 0.42, gray: 0.55 }, auditLevel: 'ref-only'
  });

  // 5.1 零结果检索自动进候选池（自生长：聊天/搜索未命中沉淀）
  const missToolHit = await knowledgeSearchTool.execute(
    { query: '完全不存在的词xyz987654321' },
    { signal: new AbortController().signal }
  );
  assert.equal(missToolHit.results.length, 0, 'nonsense query should return no results');
  const evalAfterMiss = await call('/api/dsh-workbench/knowledge/eval', 'GET');
  const missCandidate = evalAfterMiss.candidates.find((item) => item.question.includes('完全不存在的词xyz987654321'));
  assert.ok(missCandidate, 'zero-result knowledge_search should be recorded into the candidate pool');

  // 5. orchestration_create attaches knowledgeRefs automatically.
  const created = await call('/api/dsh-workbench/tasks/mutate', 'POST', {
    action: 'orchestration_create',
    title: '看门狗机制调研',
    idea: '梳理看门狗重试机制的原理和最佳实践，子代理超时如何处理',
    sourceSessionId: 's1',
    projectPath: '',
    quick: false,
    attachments: [],
    sourceRefs: []
  });
  const createdRecord = created.orchestrations.find((item) => item.idea.startsWith('梳理看门狗'));
  assert.ok(createdRecord, 'orchestration should be created');
  assert.ok(createdRecord.knowledgeRefs.length >= 1, 'orchestration should carry auto knowledge refs');
  assert.ok(createdRecord.knowledgeMeta && createdRecord.knowledgeMeta.routes.length > 0, 'orchestration should carry retrieval meta');

  passed = true;
} finally {
  try { await rm(tempHome, { recursive: true, force: true }); } catch (e) { /* keep for inspection */ }
}

console.log(passed ? 'smoke-knowledge-auto: PASS' : 'smoke-knowledge-auto: FAIL');
if (!passed) process.exitCode = 1;
