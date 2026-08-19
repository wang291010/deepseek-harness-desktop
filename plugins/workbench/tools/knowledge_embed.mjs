#!/usr/bin/env node
/**
 * Local BGE embedding bridge (Node/WASM) for the workbench knowledge base.
 *
 * Same stdin/stdout contract as knowledge_embed.py:
 *   reads {"texts": [...]} from stdin, prints {"dims": N, "vectors": [[...]]}.
 *
 * Uses @huggingface/transformers (onnxruntime-web WASM) so no system Python or
 * native modules are required. Model dir:
 *   env KNOWLEDGE_BGE_MODEL_DIR overrides; otherwise ~/.cache/knowledge-bge/<model>.
 */
import { pipeline } from '@huggingface/transformers';
import { homedir } from 'node:os';
import { join } from 'node:path';

function modelArg() {
  const args = process.argv.slice(2);
  const index = args.indexOf('--model');
  return index >= 0 && args[index + 1] ? args[index + 1] : 'bge-small-zh-v1.5';
}

const modelDir = (process.env.KNOWLEDGE_BGE_MODEL_DIR || '').trim() || join(homedir(), '.cache', 'knowledge-bge', modelArg());
let extractorPromise = null;
function getExtractor() {
  if (!extractorPromise) extractorPromise = pipeline('feature-extraction', modelDir);
  return extractorPromise;
}

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

const payload = JSON.parse(raw || '{"texts": []}');
const texts = Array.isArray(payload && payload.texts) ? payload.texts.map((text) => String(text || '').slice(0, 4000)) : [];
if (texts.length === 0) {
  process.stdout.write(JSON.stringify({ dims: 0, vectors: [] }) + '\n');
  process.exit(0);
}

try {
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  const vectors = output.tolist();
  process.stdout.write(JSON.stringify({ dims: vectors.length ? vectors[0].length : 0, vectors }) + '\n');
  process.exit(0);
} catch (error) {
  process.stderr.write(String((error && error.stack) || error) + '\n');
  process.exit(2);
}
