import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
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
        if (id === 'react') return nodeRequire('react');
        if (id === 'react-dom') return nodeRequire('react-dom');
        if (id === 'react/jsx-runtime') return nodeRequire('react/jsx-runtime');
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
console.log('client bundle load smoke passed');
