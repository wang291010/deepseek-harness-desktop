import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const nodeRequire = createRequire(import.meta.url);
const toolDir = dirname(fileURLToPath(import.meta.url));
const hostModuleRoot = resolve(
  process.argv[2] || process.env.DSH_HOST_NODE_MODULES || join(toolDir, '..', '..', '..', 'desktop-source', 'dsh-plugin-desktop', 'node_modules')
);
const runtimeRequire = existsSync(join(hostModuleRoot, 'react', 'package.json'))
  ? createRequire(join(hostModuleRoot, '__workbench_smoke__.cjs'))
  : nodeRequire;
const style = { setProperty() {}, removeProperty() {} };
const element = () => ({ dataset: {}, style: { ...style }, appendChild() {}, remove() {}, setAttribute() {}, removeAttribute() {} });
let loaded;
globalThis.document = {
  body: { ...element(), classList: { toggle() {} }, dataset: {} },
  head: { append() {}, appendChild() {} },
  documentElement: { style: { ...style } },
  querySelector: () => null,
  createElement: element,
  getElementById: () => null
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
globalThis.location = { reload() {} };
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  __ModuleLoader__: {
    load(definition) {
      const primitives = new Proxy({}, { get: () => function Icon() { return null; } });
      loaded = definition.factory((id) => {
        if (id === 'react') return runtimeRequire('react');
        if (id === 'react-dom') return runtimeRequire('react-dom');
        if (id === 'react/jsx-runtime') return runtimeRequire('react/jsx-runtime');
        if (id === '@deepseek-ai/dsh-client-runtime/client') return { defineStore: (definitionValue) => definitionValue };
        if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
        throw new Error('unexpected client dependency: ' + id);
      });
    }
  }
};

await import('../lib/client.js?' + Date.now());
assert.equal(typeof loaded.apply, 'function');
assert(Array.isArray(loaded.inject));
assert(loaded.inject.includes('theme'));
const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
assert.equal(clientSource.includes('wbFetchJson("/api/dsh-workbench/knowledge/auto",'), false, 'native message submission must not wait for legacy pre-retrieval');
assert.equal(clientSource.includes('autoKbPanel &&'), false, 'legacy floating knowledge panel must stay removed');
const aiTerminalStart = clientSource.indexOf('if (data.status === "completed")');
const aiTerminalEnd = clientSource.indexOf('} else if (data.status === "failed")', aiTerminalStart);
const aiTerminalBlock = clientSource.slice(aiTerminalStart, aiTerminalEnd);
assert.ok(aiTerminalStart >= 0 && aiTerminalEnd > aiTerminalStart, 'AI review terminal polling block must exist');
assert.ok(aiTerminalBlock.indexOf('const { data: detail }') < aiTerminalBlock.indexOf('setReviewAiJob(data)'), 'AI review must load result detail before publishing completed job state');
assert.equal(clientSource.includes('reviewAiJob && reviewAiJob.status, reviewPath, loadReviews'), false, 'completed status must not clean up its own in-flight detail request');
assert.ok(clientSource.includes('AI 修改对照'), 'AI edit comparison mode must be available');
assert.ok(clientSource.includes('只看修改'), 'AI edit changes-only mode must be available');
assert.ok(clientSource.includes('wb-ai-edit-list-label'), 'review queue must expose AI edit state');
assert.ok(clientSource.includes('aiAppliedContent'), 'AI-applied content fingerprint must be persisted on save');
assert.ok(clientSource.includes('只读并行:'), 'G1 read-only auto-parallel toggle must be visible');
assert.ok(clientSource.includes('localStorage.getItem(readParallelKey) !== "off"'), 'G1 read-only auto-parallel must default on');
assert.ok(clientSource.includes('将并行 '), 'G1 composer must preview the detected parallel worker count');
assert.ok(clientSource.includes('建议并行写操作'), 'G2 write suggestion card must be present');
assert.ok(clientSource.includes('写操作不会自动开始'), 'G2 card must preserve confirmation-before-write semantics');
console.log('client bundle load smoke passed');
