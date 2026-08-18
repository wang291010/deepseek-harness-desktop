import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const home = await mkdtemp(join(tmpdir(), 'dsh-workbench-style-'));
process.env.DSH_HOME = home;
const routes = new Map();
const sections = [];
const ctx = {
  inject(names, callback) {
    if (names.includes('webServer')) {
      callback({
        webServer: { register(route) { routes.set(route.path, route); return () => {}; } },
        llm: {},
        workspaceRegistry: { list: () => [] }
      });
    } else if (names.includes('subagents')) {
      callback({ subagents: { list: () => [] }, agents: {} });
    } else if (names.includes('systemPrompt')) {
      callback({
        effect(fn) { return fn(); },
        systemPrompt: { section(definition) { sections.push(definition); return () => {}; } }
      });
    } else if (names.includes('commands')) {
      callback({ commands: { register: () => [] }, sessionProjections: {} });
    }
  },
  on() {}
};

function request(method, url, body) {
  const req = new PassThrough();
  req.method = method;
  req.url = url;
  req.socket = { remoteAddress: '127.0.0.1' };
  req.headers = { host: '127.0.0.1:9999' };
  queueMicrotask(() => req.end(body === undefined ? '' : JSON.stringify(body)));
  return req;
}

async function call(path, method, body) {
  const route = routes.get(path);
  assert(route, `route missing: ${path}`);
  let status = 0;
  let text = '';
  const res = { writeHead(code) { status = code; }, end(value) { text += value || ''; } };
  await route.handler(request(method, path, body), res);
  assert.equal(status, 200, text);
  return JSON.parse(text);
}

try {
  const { apply } = await import('../lib/host/index.js?' + Date.now());
  apply(ctx);
  const initial = await call('/api/dsh-workbench/style/read', 'GET');
  assert.equal(initial.version, 1);
  assert.equal(initial.settings.accent, '#ff9f0a');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].text(), '');

  const saved = await call('/api/dsh-workbench/style/write', 'POST', {
    settings: {
      accent: '#3478F6',
      surfaceOpacity: 2,
      darken: -1,
      fontScale: 9,
      radius: 99,
      density: 'unknown',
      conversationStyle: 'custom',
      customConversationStyle: '用简洁中文回答',
      wallpaper: 'data:text/plain;base64,SGVsbG8='
    },
    presets: [{ id: 'review', name: '回归', settings: { accent: '#00a67e', wallpaper: 'data:image/png;base64,AAAA' } }]
  });
  assert.equal(saved.revision, 1);
  assert.equal(saved.settings.accent, '#3478f6');
  assert.equal(saved.settings.surfaceOpacity, 1);
  assert.equal(saved.settings.darken, 0);
  assert.equal(saved.settings.fontScale, 1.2);
  assert.equal(saved.settings.radius, 14);
  assert.equal(saved.settings.density, 'comfortable');
  assert.equal(saved.settings.wallpaper, '');
  assert.equal(saved.presets[0].settings.wallpaper, '');
  assert.equal(sections[0].text(), 'Conversation style selected by the user:\n用简洁中文回答');

  const persisted = JSON.parse(await readFile(join(home, 'dsh-workbench-style.json'), 'utf8'));
  assert.equal(persisted.revision, 1);
  const roundTrip = await call('/api/dsh-workbench/style/read', 'GET');
  assert.deepEqual(roundTrip, saved);
  console.log('style smoke test passed');
} finally {
  await rm(home, { recursive: true, force: true });
}
