#!/usr/bin/env node
/**
 * run-groundedness-eval — R3 sentence-level groundedness harness.
 *
 * In-process self-test (no arguments): crafts answers against real ref shapes,
 * asserts the deep audit verdicts and one-pass auto-fix, then exits non-zero on
 * failure. Requires no LLM and no vector model (uses the rule scorer).
 *
 * Against a running workbench:
 *   node tools/run-groundedness-eval.mjs --api http://127.0.0.1:PORT
 *   node tools/run-groundedness-eval.mjs --api http://127.0.0.1:PORT --generate 20
 *   node tools/run-groundedness-eval.mjs --api http://127.0.0.1:PORT --gate [--samples 20] [--rate 0.85]
 *
 * --generate asks the host to answer the 50-question eval set with the real
 * knowledge base (live LLM required) and stores the deep audit traces.
 * --gate exits 1 when samples/rate fall below the R3 targets (fail-exit gate).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const args = process.argv.slice(2);
function opt(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}
const apiBase = opt('--api', '');
const generateCount = Math.max(0, Number(opt('--generate', '0')) || 0);
const gate = args.includes('--gate');
const requireSamples = Math.max(1, Number(opt('--samples', '20')) || 20);
const minRate = Number(opt('--rate', '0.85')) || 0.85;
const hybrid = args.includes('--hybrid');

async function callApi(path, method, body) {
  const response = await fetch(apiBase.replace(/\/+$/, '') + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error('api error ' + response.status + ' ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

function makeInProcess(vectorProvider) {
  const home = mkdtempSync(join(tmpdir(), 'wb-groundedness-'));
  writeFileSync(join(home, 'dsh-workbench-knowledge-vector.json'), JSON.stringify(vectorProvider === 'hybrid'
    ? { provider: 'bge-local', model: 'bge-small-zh-v1.5', apiKey: '', baseUrl: '', python: '' }
    : { provider: 'none', model: '', apiKey: '', baseUrl: '', python: '' }));
  writeFileSync(join(home, 'dsh-workbench-knowledge-auto.json'), JSON.stringify({ enabled: true, auditLevel: 'ref+groundedness' }));
  process.env.DSH_HOME = home;
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
  const ready = (async () => {
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
  return { call: async (path, method, body) => (await ready)(path, method, body), cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

const REFS = [
  { id: '知识1', title: '工作台-看门狗机制', confidence: 'high', snippet: '工作台看门狗每 5 秒检查一次会话健康状态，发现渲染进程无响应时自动重启，并记录重启原因。' },
  { id: '知识2', title: '工作台-知识库评测', confidence: 'high', snippet: '知识库评测集包含 50 道题，recall@5 达到 1.00，路由准确率 0.96。' }
];

async function runSelfTest(call, label) {
  const grounded = await call('/api/dsh-workbench/knowledge/audit', 'POST', {
    answer: '看门狗每 5 秒检查一次会话健康状态，发现无响应会重启渲染进程[知识1]。知识库评测 recall@5 达到 1.00[知识2]。',
    refs: REFS,
    level: 'ref+groundedness'
  });
  assert.equal(grounded.valid, true, 'fully cited answer should pass');
  assert.equal(grounded.groundednessRate, 1, 'rate should be 1.0');
  assert.equal(grounded.fix.attempted, false, 'no fix needed when rate >= target');
  if (label === 'hybrid' && grounded.groundednessMethod !== 'hybrid') {
    console.warn('注意：当前环境无法加载本地 BGE 运行时（需应用内置的 onnxruntime/transformers），混合评分未实测，规则评分已通过；请在桌面应用内用 --hybrid 复验。');
  }

  const flawed = await call('/api/dsh-workbench/knowledge/audit', 'POST', {
    answer: '工作台看门狗会定期检查会话健康状态，异常时自动重启渲染进程。[知识1] 知识库评测集有 50 道题，路由准确率接近 0.96。[知识2] 看门狗还能自动编写并部署生产代码。',
    refs: REFS,
    level: 'ref+groundedness'
  });
  assert.equal(flawed.fix.applied, true, 'unsupported claim should trigger one auto-fix pass');
  assert.ok(flawed.text.includes('（未验证）'), 'auto-fix should mark the unsupported claim');
  assert.equal(flawed.groundednessSummary.violations, 0, 'marked-unverified claim is abstained, not a violation');
  assert.equal(flawed.groundednessSummary.abstained, 1, 'exactly one abstained claim');
  assert.equal(flawed.valid, true, 'honest abstain keeps audit valid');

  const summary = await call('/api/dsh-workbench/knowledge/groundedness', 'GET');
  assert.ok(summary.summary.traceSamples >= 2, 'deep audits should be recorded as traces');
  console.log('逐句 groundedness 自检（' + label + '）通过：grounded=1.00 / flawed 修正后未验证句计入 abstain、violations=0，traces=' + summary.summary.traceSamples);
}

if (!apiBase) {
  const harness = makeInProcess(hybrid ? 'hybrid' : 'rule');
  try {
    await runSelfTest(harness.call, hybrid ? 'hybrid' : 'rule');
  } finally {
    harness.cleanup();
  }
} else if (generateCount > 0) {
  const report = await callApi('/api/dsh-workbench/knowledge/groundedness/generate', 'POST', { count: generateCount });
  console.log('已生成 groundedness 样本：' + report.generated + ' 题 / 审计 ' + report.audited + '，逐句样本 ' + report.claimSamples + '，groundedness = ' + report.groundednessRate + '（目标 ' + report.target + '）');
  for (const item of report.results || []) {
    console.log('  ' + (item.audit ? (item.audit.rate ?? '-') : '跳过') + ' [' + item.refs + ' 条引用] ' + item.question.slice(0, 48));
  }
} else if (gate) {
  const { summary } = await callApi('/api/dsh-workbench/knowledge/groundedness', 'GET');
  const samples = summary.claimSamples || 0;
  const rate = summary.groundednessRate;
  console.log('groundedness 门禁：逐句样本 ' + samples + ' / ' + requireSamples + '，groundedness = ' + rate + ' / ' + minRate);
  if (samples < requireSamples || rate === null || rate < minRate) {
    console.error('R3 门禁未通过：样本不足或 groundedness 低于目标。可先运行 --generate 补充样本，或在实际使用中积累。');
    process.exit(1);
  }
  console.log('R3 门禁通过。');
} else {
  const { summary, samples } = await callApi('/api/dsh-workbench/knowledge/groundedness', 'GET');
  console.log('groundedness 汇总：编排样本 ' + summary.orchestrationSamples + '，trace 样本 ' + summary.traceSamples + '，逐句样本 ' + summary.claimSamples + '，groundedness = ' + summary.groundednessRate + '（目标 ' + summary.target + '，方法 ' + summary.method + '）');
  for (const sample of (samples || []).slice(-10)) {
    console.log('  ' + (sample.rate ?? '-') + ' [' + sample.source + '] ' + (sample.claims ? 'claims ' + sample.claims.claims + ' / violations ' + sample.claims.violations : '') + (sample.fixed ? ' 已修正' : ''));
  }
}
