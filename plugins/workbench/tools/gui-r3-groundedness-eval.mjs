#!/usr/bin/env node
/**
 * gui-r3-groundedness-eval — real desktop R3 verification (A2 + A3).
 *
 * Connects to the running DeepSeek Harness Desktop renderer via CDP,
 * derives the loopback API origin, then:
 *   A2: POST a crafted cited answer to /knowledge/audit and asserts the
 *       sentence-level scorer runs in hybrid mode (local BGE via bge-node).
 *   A3: POST /knowledge/groundedness/generate {count: N} to produce real
 *       answers from the 50-question eval set against the live knowledge
 *       base, then GET /knowledge/groundedness and applies the R3 gate
 *       (samples >= 20, groundedness >= 0.85), exiting 1 on failure.
 *
 * Usage:
 *   node tools/gui-r3-groundedness-eval.mjs [debugPort] [--count 20]
 */
import assert from 'node:assert/strict';

const debugPort = process.argv[2] || '9224';
const countArg = (process.argv.find((arg) => arg.startsWith('--count=')) || '--count=20').slice('--count='.length);
const count = Math.max(1, Math.min(50, Number(countArg) || 20));
const gateOnly = process.argv.includes('--gate-only');
const fresh = process.argv.includes('--fresh');
const cacheProbe = process.argv.includes('--cache-probe');
const setAudit = (process.argv.find((arg) => arg.startsWith('--set-audit=')) || '').slice('--set-audit='.length);

const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:')) || targets.find((item) => item.type === 'page');
if (!target) throw new Error('no desktop page target on CDP ' + debugPort);
const apiBase = new URL(target.url).origin;
console.log('CDP 目标：' + target.url);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const callback = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) callback.reject(new Error(message.error.message));
  else callback.resolve(message.result);
});

function send(method, params = {}, timeoutMs = 60000) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('CDP timeout: ' + method));
    }, timeoutMs);
    pending.set(id, {
      resolve(value) { clearTimeout(timer); resolve(value); },
      reject(error) { clearTimeout(timer); reject(error); }
    });
  });
}

async function evaluate(expression, timeoutMs = 60000) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function pageApi(path, method = 'GET', body, timeoutMs = 60000) {
  const expression = `(async () => {
    const response = await fetch(${JSON.stringify(apiBase + path)}, {
      method: ${JSON.stringify(method)},
      headers: { 'content-type': 'application/json' },
      body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))}
    });
    const text = await response.text();
    if (!response.ok) throw new Error(response.status + ': ' + text.slice(0, 300));
    return text ? JSON.parse(text) : {};
  })()`;
  return evaluate(expression, timeoutMs);
}

const REFS = [
  { id: '知识1', title: '工作台-看门狗机制', confidence: 'high', snippet: '工作台看门狗每 5 秒检查一次会话健康状态，发现渲染进程无响应时自动重启，并记录重启原因。' },
  { id: '知识2', title: '工作台-知识库评测', confidence: 'high', snippet: '知识库评测集包含 50 道题，recall@5 达到 1.00，路由准确率 0.96。' }
];

if (cacheProbe) {
  const first = await pageApi('/api/dsh-workbench/knowledge/auto', 'POST', { query: '工作台看门狗机制是什么', sessionId: 'cache-probe' });
  const second = await pageApi('/api/dsh-workbench/knowledge/auto', 'POST', { query: '工作台看门狗机制是什么', sessionId: 'cache-probe' });
  console.log('第一次检索：reused=' + (first.reused === true) + ' 命中=' + (first.refs || []).length);
  console.log('第二次检索：reused=' + (second.reused === true) + ' 命中=' + (second.refs || []).length);
} else if (setAudit) {
  const { config } = await pageApi('/api/dsh-workbench/knowledge/auto/config', 'POST', { auditLevel: setAudit });
  console.log('已设置 auditLevel=' + config.auditLevel + '（enabled=' + config.enabled + '，gate=' + config.gate + '）');
} else if (!gateOnly) {
  if (fresh) {
    await pageApi('/api/dsh-workbench/knowledge/traces', 'POST', { action: 'clear' });
    console.log('已清空旧 trace，开始全新采样。');
  }
  console.log('--- A2 混合评分复验 ---');
  const probe = await pageApi('/api/dsh-workbench/knowledge/audit', 'POST', {
    answer: '看门狗每 5 秒检查一次会话健康状态，发现无响应会重启渲染进程[知识1]。知识库评测 recall@5 达到 1.00[知识2]。',
    refs: REFS,
    level: 'ref+groundedness',
    deep: true
  });
  console.log('评分方法：' + probe.groundednessMethod + '；rate=' + probe.groundednessRate + '；valid=' + probe.valid + '；逐句=' + JSON.stringify(probe.groundednessSummary));
  if (probe.groundednessMethod !== 'hybrid') {
    console.error('A2 未通过：期望 hybrid（本地 BGE），实际 ' + probe.groundednessMethod);
    process.exit(1);
  }
  assert.equal(probe.valid, true, 'crafted cited answer should pass deep audit in the desktop app');
  console.log('A2 通过：桌面应用内混合评分生效。');

  console.log('--- A3 生成真实样本（' + count + ' 题）---');
  const before = await pageApi('/api/dsh-workbench/knowledge/groundedness', 'GET');
  console.log('生成前：编排样本 ' + before.summary.orchestrationSamples + '，trace 样本 ' + before.summary.traceSamples + '，逐句样本 ' + before.summary.claimSamples);
  const report = await pageApi('/api/dsh-workbench/knowledge/groundedness/generate', 'POST', { count }, 900000);
  console.log('生成结果：' + report.generated + ' 题 / 审计 ' + report.audited + '，逐句样本 +' + report.claimSamples + '，groundedness=' + report.groundednessRate + '（目标 ' + report.target + '）');
  for (const item of report.results || []) {
    console.log('  ' + (item.audit ? ('rate=' + (item.audit.rate ?? '-') + ' completeness=' + (item.completeness ?? '-') + (item.audit.fixed ? ' 已修正(' + item.audit.fixMethod + ')' : '')) : '跳过') + ' [' + item.refs + ' 引用] ' + item.question.slice(0, 48));
    if (item.answerPreview) console.log('    回答：' + item.answerPreview.replace(/\n/g, ' '));
  }
}

const after = await pageApi('/api/dsh-workbench/knowledge/groundedness', 'GET');
const samples = after.summary.claimSamples || 0;
const rate = after.summary.groundednessRate;
const completeness = after.summary.completeness;
console.log('--- R3 门禁 ---');
console.log('逐句样本 ' + samples + '（目标 ≥ 20）· groundedness ' + rate + '（目标 ≥ 0.85）· completeness ' + (completeness ?? 'n/a') + '（目标 ≥ 0.8）');
if (samples < 20 || rate === null || rate < 0.85 || (completeness !== null && completeness !== undefined && completeness < 0.8)) {
  console.error('R3 门禁未通过');
  process.exit(1);
}
console.log('R3 门禁通过。');

const evalStore = await pageApi('/api/dsh-workbench/knowledge/eval', 'GET').catch(() => null);
if (evalStore && evalStore.lastRun && evalStore.lastRun.runtime) {
  console.log('运行时统计：自动检索 ' + evalStore.lastRun.runtime.autoRetrievals + ' 次 · 缓存命中率 ' + evalStore.lastRun.runtime.cacheHitRate + ' · 真实知识库调用 ' + evalStore.lastRun.runtime.realKnowledgeCalls + ' · 真实 Web 调用 ' + evalStore.lastRun.runtime.realWebCalls);
}
ws.close();
