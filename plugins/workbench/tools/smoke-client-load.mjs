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
console.log('client bundle load smoke passed');
