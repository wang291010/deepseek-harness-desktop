#!/usr/bin/env node
/**
 * gui-r4-rerank-compare — R4 rerank comparison on the real desktop app (B2).
 *
 * Runs the 50-question eval set against the running workbench with each rerank
 * mode and prints a comparison: recall@5, top1 hit rate, avg top1 relevance,
 * latency and token cost. Saves the full JSON report next to the script by
 * default (override with --out <dir>).
 *
 * Usage:
 *   node tools/gui-r4-rerank-compare.mjs [debugPort] [--modes none,local,cross] [--with-llm] [--out <dir>]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const debugPort = process.argv[2] || '9224';
const outDir = (process.argv.find((arg) => arg.startsWith('--out=')) || '').slice('--out='.length) || process.cwd();
const withLlm = process.argv.includes('--with-llm');
const modesArg = (process.argv.find((arg) => arg.startsWith('--modes=')) || '').slice('--modes='.length);
const modes = modesArg ? modesArg.split(',').map((item) => item.trim()).filter(Boolean) : (withLlm ? ['none', 'local', 'cross', 'llm'] : ['none', 'local', 'cross']);

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

function send(method, params = {}, timeoutMs = 900000) {
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

async function evaluate(expression, timeoutMs = 900000) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function pageApi(path, method = 'GET', body) {
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
  return evaluate(expression);
}

const reports = [];
for (const mode of modes) {
  console.log('跑评测（rerank=' + mode + '）……');
  const report = await pageApi('/api/dsh-workbench/knowledge/eval/run', 'POST', { topK: 5, rerank: mode });
  reports.push(report);
  console.log('  完成：recall@5=' + report.recallAtK + ' top1=' + report.top1HitRate + ' 相关性=' + (report.avgTop1Relevance ?? 'n/a') + ' 耗时=' + report.avgLatencyMs + 'ms');
}

console.log('');
console.log('模式 | recall@5 | top1 命中 | avg 相关性 | 平均耗时 | 平均 token | 路由');
for (const report of reports) {
  console.log(
    (report.rerankMode || 'default') +
    ' | ' + report.recallAtK +
    ' | ' + report.top1HitRate +
    ' | ' + (report.avgTop1Relevance ?? 'n/a') +
    ' | ' + report.avgLatencyMs + 'ms' +
    ' | ' + report.avgTokens +
    ' | ' + (report.iterativeRate ?? '-')
  );
}

await mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const file = join(outDir, 'r4-rerank-compare-' + stamp + '.json');
await writeFile(file, JSON.stringify({ ranAt: new Date().toISOString(), modes, reports }, null, 2) + '\n');
console.log('报告已保存：' + file);
ws.close();
