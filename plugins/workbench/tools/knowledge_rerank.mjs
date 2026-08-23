#!/usr/bin/env node
/**
 * Local BGE cross-encoder reranker bridge (Node/WASM) for the workbench KB.
 *
 * Same stdin/stdout contract as knowledge_embed.mjs:
 *   reads  {"query": "...", "candidates": [{"text": "..."}]}
 *   prints {"scores": [0.1, ...], "order": [1, 0, ...]}  (order is candidate
 *   indexes sorted by score descending).
 *
 * Model: bge-reranker-v2-m3 (ONNX, int8) via @huggingface/transformers.
 * Model dir: env KNOWLEDGE_RERANK_MODEL_DIR overrides; otherwise
 *   ~/.cache/knowledge-bge/bge-reranker-v2-m3.
 */
import { AutoModelForSequenceClassification, AutoTokenizer } from '@huggingface/transformers';
import { homedir } from 'node:os';
import { join } from 'node:path';

const modelArg = () => {
  const args = process.argv.slice(2);
  const index = args.indexOf('--model');
  return index >= 0 && args[index + 1] ? args[index + 1] : 'bge-reranker-v2-m3';
};
const modelDir = (process.env.KNOWLEDGE_RERANK_MODEL_DIR || '').trim() || join(homedir(), '.cache', 'knowledge-bge', modelArg());
let rerankerPromise = null;
async function getReranker() {
  if (!rerankerPromise) {
    rerankerPromise = Promise.all([
      AutoTokenizer.from_pretrained(modelDir),
      AutoModelForSequenceClassification.from_pretrained(modelDir)
    ]);
  }
  return rerankerPromise;
}

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

const payload = JSON.parse(raw || '{"query": "", "candidates": []}');
const query = String(payload.query || '').slice(0, 1000);
const candidates = Array.isArray(payload.candidates)
  ? payload.candidates.map((item) => String((item && item.text) || '').slice(0, 2000))
  : [];
if (!query || candidates.length === 0) {
  process.stdout.write(JSON.stringify({ scores: [], order: [] }) + '\n');
  process.exit(0);
}

try {
  const [tokenizer, model] = await getReranker();
  const inputs = await tokenizer(candidates.map(() => query), {
    text_pair: candidates,
    padding: true,
    truncation: true
  });
  const outputs = await model(inputs);
  const logits = outputs.logits && typeof outputs.logits.tolist === 'function' ? outputs.logits.tolist() : [];
  const scores = logits.map((row) => {
    const value = Array.isArray(row) ? Number(row[row.length - 1]) || 0 : Number(row) || 0;
    return Math.round(1 / (1 + Math.exp(-value)) * 10000) / 10000;
  });
  const order = scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.index);
  process.stdout.write(JSON.stringify({ scores, order }) + '\n');
  process.exit(0);
} catch (error) {
  process.stderr.write(String((error && error.stack) || error) + '\n');
  process.exit(2);
}
