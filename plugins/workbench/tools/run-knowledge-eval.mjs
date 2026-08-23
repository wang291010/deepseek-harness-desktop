#!/usr/bin/env node
/**
 * run-knowledge-eval — evaluation harness for the workbench knowledge base.
 *
 * Standalone (uses DSH_HOME or the default ~/.dsh vault):
 *   node tools/run-knowledge-eval.mjs
 *
 * Against a running workbench:
 *   node tools/run-knowledge-eval.mjs --api http://127.0.0.1:PORT
 *
 * Add an eval item:
 *   node tools/run-knowledge-eval.mjs --add "问题" --expected "atomic/文档.md,titles/其他.md"
 */
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

const args = process.argv.slice(2);
function opt(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}
const apiBase = opt('--api', '');
const addQuestion = opt('--add', '');
const expectedRaw = opt('--expected', '');
const rerankMode = opt('--rerank', '');
const gate = args.includes('--gate');

async function callApi(path, method, body) {
  const response = await fetch(apiBase.replace(/\/+$/, '') + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) throw new Error('api error ' + response.status + ' ' + (await response.text()).slice(0, 300));
  return response.json();
}

function makeInProcess() {
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
  return (async () => {
    const { apply } = await import('../lib/host/index.js?' + Date.now());
    apply(ctx);
    return async (path, method, body) => {
      const req = new PassThrough();
      req.method = method;
      req.url = path;
      req.socket = { remoteAddress: '127.0.0.1' };
      req.headers = { host: '127.0.0.1:9999' };
      let status = 0;
      let text = '';
      const res = { writeHead(code) { status = code; }, end(value) { text += value || ''; } };
      queueMicrotask(() => req.end(body === undefined ? '' : JSON.stringify(body)));
      await routes.get(path).handler(req, res);
      assert.equal(status, 200, text);
      return JSON.parse(text);
    };
  })();
}

const call = apiBase ? callApi : await makeInProcess();

if (addQuestion) {
  const expected = expectedRaw.split(',').map((item) => item.trim()).filter(Boolean);
  const added = await call('/api/dsh-workbench/knowledge/eval/add', 'POST', { question: addQuestion, expected, answerHints: '' });
  console.log('已添加评测题：' + added.item.id + '（共 ' + added.items.length + ' 题）');
}

const store = await call('/api/dsh-workbench/knowledge/eval', 'GET');
console.log('评测题：' + (store.items || []).length + ' 条；候选：' + (store.candidates || []).length + ' 条');
if (!(store.items || []).length) {
  console.log('（暂无评测题，用 --add 添加后再跑）');
} else {
  const report = await call('/api/dsh-workbench/knowledge/eval/run', 'POST', { topK: 5, rerank: rerankMode || undefined });
  console.log('recall@5 = ' + report.recallAtK + '  平均 token = ' + report.avgTokens + '  平均耗时 = ' + report.avgLatencyMs + 'ms');
  console.log('重排 = ' + (report.rerankMode || 'default') + '  top1 命中率 = ' + report.top1HitRate + '  平均 top1 相关性 = ' + (report.avgTop1Relevance ?? 'n/a'));
  console.log('平均覆盖 = ' + report.avgCoverage + '  平均检索 token = ' + report.avgRetrievalTokens + '  联网回退率 = ' + report.webFallbackRate + '  迭代率 = ' + report.iterativeRate);
  if (report.onlineAudit) {
    console.log('在线引用审计 = ' + report.onlineAudit.citationSamples + ' 条  有效率 = ' + (report.onlineAudit.citationValidRate ?? '待采样') + '  groundedness = ' + (report.onlineAudit.groundedness ?? '待采样'));
  }
  if (report.acceptance) {
    console.log('验收门槛：' + (report.acceptance.ready ? '通过' : '未就绪'));
    for (const check of report.acceptance.checks || []) {
      console.log('  ' + (check.passed ? '通过' : '未通过') + ' ' + check.label + '：' + (check.actual ?? '无样本') + ' / 目标 ' + check.target);
    }
  }
  for (const item of report.results || []) {
    console.log('  ' + (item.hits === item.expected ? '✅' : '❌') + ' [' + item.hits + '/' + item.expected + '] ' + item.question.slice(0, 60));
  }
  if (gate) {
    const failures = [];
    if (report.items < 50) failures.push('评测题数 ' + report.items + ' < 50');
    if (report.recallAtK < 0.9) failures.push('recall@5 ' + report.recallAtK + ' < 0.9');
    if (report.top1HitRate !== undefined && report.top1HitRate < 0.75) failures.push('top1 命中率 ' + report.top1HitRate + ' < 0.75');
    if (report.completeness !== undefined && report.completeness !== null && report.completeness < 0.8) failures.push('completeness ' + report.completeness + ' < 0.8');
    if (report.faithfulness !== undefined && report.faithfulness !== null && report.faithfulness < 0.85) failures.push('faithfulness ' + report.faithfulness + ' < 0.85');
    if (failures.length) {
      console.error('离线门禁未通过：' + failures.join('；'));
      process.exit(1);
    }
    console.log('离线门禁通过：题数 ' + report.items + '，recall@5 ' + report.recallAtK + '，top1 ' + report.top1HitRate);
  }
}
