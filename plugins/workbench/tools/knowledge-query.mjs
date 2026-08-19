#!/usr/bin/env node
/**
 * knowledge-query — MCP-style CLI for the workbench knowledge base.
 *
 * Standalone (uses DSH_HOME or the default ~/.dsh vault):
 *   node tools/knowledge-query.mjs "订单中台为什么用 FastAPI" --topK 5
 *
 * Against a running workbench (pass its dynamic API port):
 *   node tools/knowledge-query.mjs "问题" --api http://127.0.0.1:PORT
 *
 * Options:
 *   --project <path>    bind a retrieval profile
 *   --topK <n>          result count (default profile topK)
 *   --budget <tokens>   context token budget (default profile)
 *   --json              print raw JSON
 */
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

const args = process.argv.slice(2);
const query = args.find((arg) => !arg.startsWith('--'));
function opt(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}
const apiBase = opt('--api', '');
const project = opt('--project', '');
const topK = Number(opt('--topK', 0)) || undefined;
const budget = Number(opt('--budget', 0)) || undefined;
const asJson = args.includes('--json');

if (!query) {
  console.error('usage: node tools/knowledge-query.mjs "<query>" [--project <path>] [--topK n] [--budget tokens] [--json]');
  process.exit(1);
}

async function queryApi() {
  const response = await fetch(apiBase.replace(/\/+$/, '') + '/api/dsh-workbench/knowledge/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, project, topK, tokenBudget: budget })
  });
  if (!response.ok) throw new Error('api error ' + response.status + ' ' + (await response.text()).slice(0, 300));
  return response.json();
}

async function queryInProcess() {
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
  const { apply } = await import('../lib/host/index.js?' + Date.now());
  apply(ctx);
  const req = new PassThrough();
  req.method = 'POST';
  req.url = '/api/dsh-workbench/knowledge/search';
  req.socket = { remoteAddress: '127.0.0.1' };
  req.headers = { host: '127.0.0.1:9999' };
  let status = 0;
  let text = '';
  const res = { writeHead(code) { status = code; }, end(value) { text += value || ''; } };
  queueMicrotask(() => req.end(JSON.stringify({ query, project, topK, tokenBudget: budget })));
  await routes.get('/api/dsh-workbench/knowledge/search').handler(req, res);
  assert.equal(status, 200, text);
  return JSON.parse(text);
}

const result = apiBase ? await queryApi() : await queryInProcess();
if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('路由模式：' + (result.mode || 'n/a') + '（' + ((result.routing && result.routing.reason) || '') + '）');
  console.log('实际路由：' + (result.routes || []).join(' + ') + '  向量：' + (result.vectorStatus || 'n/a') + '  估算 token：' + result.estimatedTokens);
  if (result.selfCheck && result.selfCheck.caution) {
    console.log('⚠ 自纠错提示：' + (result.selfCheck.reasons || []).join('；'));
  }
  for (const item of result.results || []) {
    console.log('\n[' + (item.computedConfidence || item.confidence) + '] ' + item.title + '（声明 ' + item.confidence + ' · ' + (item.status || '') + ' · ' + (item.staleness || '') + '）');
    console.log('  路径：' + item.path);
    console.log('  检索分：' + item.retrievalScore + ' · 来源：' + (item.source || '-'));
    if (item.heading) console.log('  小节：' + item.heading);
    console.log('  摘要：' + String(item.snippet || item.summary || '').slice(0, 180));
    if (item.confidenceBasis && item.confidenceBasis.reasons && item.confidenceBasis.reasons.length) {
      console.log('  置信度依据：' + item.confidenceBasis.reasons.join('；'));
    }
  }
  if (!(result.results || []).length) console.log('\n（无结果）');
}
