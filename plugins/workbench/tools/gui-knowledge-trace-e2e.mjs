#!/usr/bin/env node
/**
 * Real desktop E2E for knowledge/Web tool routing and persisted trace evidence.
 *
 * Usage: node tools/gui-knowledge-trace-e2e.mjs [debugPort] [outDir] [--inspect]
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const debugPort = process.argv[2] || '9224';
const outDir = process.argv[3] || process.cwd();
const inspectSessionTitle = (process.argv.find((arg) => arg.startsWith('--inspect-session=')) || '').slice('--inspect-session='.length);
const inspectOnly = process.argv.includes('--inspect') || !!inspectSessionTitle;
const inspectModels = process.argv.includes('--models');
const stopOnly = process.argv.includes('--stop');
const aggregateOnly = process.argv.includes('--aggregate');
const freshConversation = process.argv.includes('--fresh');
const multiSessionSmoke = process.argv.includes('--multi-session-smoke');
const scenarioFilter = (process.argv.find((arg) => arg.startsWith('--scenario=')) || '').slice('--scenario='.length);
await mkdir(outDir, { recursive: true });

const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:')) || targets.find((item) => item.type === 'page');
if (!target) throw new Error('no desktop page target');
const apiBase = new URL(target.url).origin;

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

function send(method, params = {}, timeoutMs = 20000) {
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(expression, timeoutMs = 20000) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    } catch (error) {
      lastError = error;
      if (attempt === 0 && String(error && error.message || error).includes('CDP timeout')) {
        await wait(750);
        continue;
      }
      throw new Error(String(error && error.message || error) + '; expression=' + expression.slice(0, 160), { cause: error });
    }
  }
  throw lastError;
}

async function pageApi(path, method = 'GET', body) {
  const response = await fetch(apiBase + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(response.status + ': ' + text);
  return text ? JSON.parse(text) : {};
}

async function screenshot(name) {
  await send('Page.bringToFront').catch(() => {});
  const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 30000);
  const path = join(outDir, name);
  await writeFile(path, Buffer.from(capture.data, 'base64'));
  return path;
}

async function inspectUi() {
  return evaluate(`(() => ({
    url: location.href,
    title: document.title,
    textareas: [...document.querySelectorAll('textarea')].map((item) => ({
      placeholder: item.placeholder,
      value: item.value.slice(0, 300),
      disabled: item.disabled,
      readOnly: item.readOnly,
      phase: item.dataset.phase || '',
      ariaLabel: item.getAttribute('aria-label') || ''
    })),
    buttons: [...document.querySelectorAll('button')].map((item) => ({
      text: item.innerText.trim().slice(0, 80),
      ariaLabel: item.getAttribute('aria-label') || '',
      title: item.title || '',
      disabled: item.disabled
    })).filter((item) => item.text || item.ariaLabel || item.title).slice(0, 200),
    body: document.body.innerText.slice(0, 2000),
    bodyTail: document.body.innerText.slice(-15000)
  }))()`);
}

async function openFreshConversation() {
  const existing = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('textarea')].filter((item) => item.offsetParent !== null);
    const input = inputs.find((item) => item.hasAttribute('data-phase')) || inputs[inputs.length - 1];
    const isHero = !!input && /描述你想要构建的内容|Describe what you want to build/.test(input.placeholder || '');
    const isUntitled = document.title === 'DeepSeek Harness';
    return { isHero, isUntitled, ready: (isHero || isUntitled) && !!input && !input.disabled && !input.readOnly, placeholder: input && input.placeholder || '' };
  })()`);
  if (existing.ready) return { ready: true, reusedFreshPage: true, placeholder: existing.placeholder };
  const clicked = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const button = buttons.find((item) => ['新建会话', 'New session'].includes(item.getAttribute('aria-label')))
      || buttons.find((item) => ['新建会话', 'New session'].includes(item.title))
      || buttons.find((item) => ['新会话', 'New Session'].includes(item.innerText.trim()));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, 'new conversation button is unavailable');
  await wait(1200);

  const workspaceState = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('textarea')].filter((item) => item.offsetParent !== null);
    const input = inputs.find((item) => item.hasAttribute('data-phase')) || inputs[inputs.length - 1];
    if (!input) return { ready: false, reason: 'no visible textarea' };
    if (!input.readOnly && !input.disabled) return { ready: true, placeholder: input.placeholder };
    if (input.getAttribute('aria-haspopup') === 'menu') {
      input.click();
      return { ready: false, pickerOpened: true, placeholder: input.placeholder };
    }
    return { ready: false, reason: 'composer disabled', placeholder: input.placeholder };
  })()`);
  if (workspaceState.ready) return workspaceState;
  if (!workspaceState.pickerOpened) throw new Error('fresh conversation has no selectable workspace: ' + JSON.stringify(workspaceState));
  await wait(500);
  const selected = await evaluate(`(() => {
    const candidates = [...document.querySelectorAll('button,[role="menuitem"],[role="option"]')]
      .filter((item) => item.offsetParent !== null && !item.disabled);
    const preferred = candidates.find((item) => /YourWorkbench/i.test(item.innerText))
      || candidates.find((item) => /工作区|workspace/i.test(item.innerText) && !/选择|choose/i.test(item.innerText))
      || candidates.find((item) => item.getAttribute('role') === 'menuitem' || item.getAttribute('role') === 'option');
    if (!preferred) return { ok: false, labels: candidates.map((item) => item.innerText.trim()).filter(Boolean).slice(0, 30) };
    const label = preferred.innerText.trim();
    preferred.click();
    return { ok: true, label };
  })()`);
  if (!selected.ok) throw new Error('workspace option unavailable: ' + JSON.stringify(selected));
  await wait(1500);
  return selected;
}

async function submitPrompt(prompt) {
  const submissionStartedAt = Date.now();
  const promptLiteral = JSON.stringify(prompt);
  const countPromptNodes = `(() => [...document.querySelectorAll('body *')].filter((item) => {
    if (item instanceof HTMLTextAreaElement || item instanceof HTMLInputElement) return false;
    if (item.offsetParent === null || item.children.length > 0) return false;
    return item.textContent.trim() === ${promptLiteral};
  }).length)()`;
  const promptNodeCountBefore = await evaluate(countPromptNodes);
  const submitted = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('textarea')].filter((item) => item.offsetParent !== null && !item.disabled && !item.readOnly);
    const input = inputs.find((item) => item.hasAttribute('data-phase')) || inputs[inputs.length - 1];
    if (!input) return { ok: false, reason: 'writable composer missing' };
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, ${promptLiteral});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: input.value === ${promptLiteral}, placeholder: input.placeholder, value: input.value };
  })()`);
  if (!submitted.ok) throw new Error('prompt input failed: ' + JSON.stringify(submitted));
  await wait(250);
  const sendButton = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => {
      if (!['发送消息', 'Send message'].includes(item.getAttribute('aria-label')) || item.disabled || item.offsetParent === null) return false;
      const rect = item.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { clicked: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert.ok(sendButton, 'send button did not become available');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sendButton.x, y: sendButton.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sendButton.x, y: sendButton.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sendButton.x, y: sendButton.y, button: 'left', clickCount: 1 });
  const committed = async () => evaluate(`(() => {
    const inputs = [...document.querySelectorAll('textarea')].filter((item) => item.offsetParent !== null);
    const input = inputs.find((item) => item.hasAttribute('data-phase')) || inputs[inputs.length - 1];
    const promptNodeCount = [...document.querySelectorAll('body *')].filter((item) => {
      if (item instanceof HTMLTextAreaElement || item instanceof HTMLInputElement) return false;
      if (item.offsetParent === null || item.children.length > 0) return false;
      return item.textContent.trim() === ${promptLiteral};
    }).length;
    const valueLength = input && input.value.length || 0;
    const inputCleared = valueLength === 0;
    const userMessageAdded = promptNodeCount > ${promptNodeCountBefore};
    return { committed: inputCleared && userMessageAdded, inputCleared, userMessageAdded, promptNodeCount, promptNodeCountBefore: ${promptNodeCountBefore}, valueLength };
  })()`);
  let lastCommitState = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await wait(250);
    const state = await committed();
    lastCommitState = state;
    if (state.committed) return { ...state, commitLatencyMs: Date.now() - submissionStartedAt };
  }
  const keyboardSubmitted = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('textarea')].filter((item) => item.offsetParent !== null && !item.disabled && !item.readOnly);
    const input = inputs.find((item) => item.hasAttribute('data-phase')) || inputs[inputs.length - 1];
    if (!input || !input.value) return false;
    input.focus();
    return true;
  })()`);
  assert.equal(keyboardSubmitted, true, 'prompt remained in the composer and keyboard retry was unavailable');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await wait(250);
    const state = await committed();
    if (state.committed) return { ...state, commitLatencyMs: Date.now() - submissionStartedAt };
  }
  throw new Error('prompt was not committed after button and Enter submission attempts: ' + JSON.stringify(lastCommitState));
}

async function visibleSessionTitles() {
  return evaluate(`(() => [...document.querySelectorAll('button,a,[role="button"]')]
    .filter((item) => item.offsetParent !== null && item.innerText.trim())
    .map((item) => item.innerText.trim())
    .filter((text) => text.length <= 120))()`);
}

async function sessionRowTitles() {
  return evaluate(`(() => [...document.querySelectorAll('.wb-sp-row .wb-sp-title')]
    .filter((item) => item.offsetParent !== null)
    .map((item) => item.textContent.trim())
    .filter(Boolean))()`);
}

async function clickVisibleText(text) {
  const target = await evaluate(`(() => {
    const wanted = ${JSON.stringify(text)};
    const candidates = [...document.querySelectorAll('button,a,[role="button"],body *')]
      .filter((item) => item.offsetParent !== null && item.textContent.trim().includes(wanted));
    const leaf = candidates.find((item) => item.children.length === 0) || candidates[0];
    if (!leaf) return null;
    const clickable = leaf.closest('button,a,[role="button"]') || leaf;
    const rect = clickable.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, label: clickable.innerText.trim().slice(0, 120) };
  })()`);
  if (!target) return false;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  return target;
}

async function clickVisibleButtonByTitle(title) {
  const target = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.offsetParent !== null && item.title === ${JSON.stringify(title)} && !item.disabled);
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  })()`);
  if (!target) return false;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  return true;
}

async function openNewSessionAndSend(prompt) {
  const before = await visibleSessionTitles();
  const clicked = await clickVisibleButtonByTitle('新建会话');
  assert.equal(clicked, true, 'new session button unavailable');
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = await evaluate(`(() => { const inputs = [...document.querySelectorAll('textarea')].filter((item) => item.offsetParent !== null); const input = inputs.find((item) => item.hasAttribute('data-phase')) || inputs[inputs.length - 1]; return { ready: !!input && !input.disabled && !input.readOnly, value: input && input.value || '', phase: input && input.dataset.phase || '' }; })()`);
    if (state.ready && !state.value && state.phase !== 'inert') break;
    await wait(250);
  }
  const submission = await submitPrompt(prompt);
  assert.ok(submission.commitLatencyMs < 2500, 'multi-session submission delayed by ' + submission.commitLatencyMs + 'ms');
  return { before, submission, titles: await visibleSessionTitles() };
}

async function waitForTurn(timeoutMs = 240000) {
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutMs;
  let observedRunning = false;
  while (Date.now() < deadline) {
    const state = await evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      const stopping = buttons.some((item) => ['停止生成', 'Stop generating'].includes(item.getAttribute('aria-label')));
      const send = buttons.find((item) => ['发送消息', 'Send message'].includes(item.getAttribute('aria-label')));
      const inputs = [...document.querySelectorAll('textarea')].filter((item) => item.offsetParent !== null);
      const input = inputs.find((item) => item.hasAttribute('data-phase')) || inputs[inputs.length - 1];
      return { stopping, canSend: !!send && !send.disabled, phase: input && input.dataset.phase || '', body: document.body.innerText.slice(-3000) };
    })()`);
    if (state.stopping || ['submitting', 'adjudicating'].includes(state.phase)) observedRunning = true;
    if (observedRunning && !state.stopping && !['submitting', 'adjudicating'].includes(state.phase)) return state;
    if (!observedRunning && Date.now() - startedAt >= 3000 && state.canSend && !state.stopping) return state;
    await wait(1000);
  }
  throw new Error('conversation turn did not settle within ' + timeoutMs + 'ms');
}

async function conversationState() {
  return evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const stopping = buttons.some((item) => ['停止生成', 'Stop generating'].includes(item.getAttribute('aria-label')));
    const send = buttons.find((item) => ['发送消息', 'Send message'].includes(item.getAttribute('aria-label')));
    const inputs = [...document.querySelectorAll('textarea')].filter((item) => item.offsetParent !== null);
    const input = inputs.find((item) => item.hasAttribute('data-phase')) || inputs[inputs.length - 1];
    const conversation = document.querySelector('[data-conversation-scroll]');
    const webLinks = [...(conversation || document).querySelectorAll('a[href^="http://"],a[href^="https://"]')]
      .map((item) => ({ text: item.innerText.trim().slice(0, 160), href: item.href }))
      .filter((item) => item.href);
    return { stopping, canSend: !!send && !send.disabled, phase: input && input.dataset.phase || '', body: document.body.innerText.slice(-3000), webLinks };
  })()`);
}

async function stopTurnIfRunning() {
  const stopped = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => ['停止生成', 'Stop generating'].includes(item.getAttribute('aria-label')) && !item.disabled);
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!stopped) return false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = await conversationState();
    if (!state.stopping) return true;
    await wait(500);
  }
  throw new Error('turn did not stop within 30 seconds');
}

function traceDelta(before, after) {
  const known = new Set((before.traces || []).map((trace) => trace.id));
  return (after.traces || []).filter((trace) => !known.has(trace.id));
}

function scenarioSummary(name, prompt, traces, allTraces, bodyTail, webLinks = []) {
  const ids = new Set(traces.map((trace) => trace.id));
  const overlapPairs = (allTraces.summary && allTraces.summary.overlapPairs || []).filter((pair) => ids.has(pair.knowledgeTraceId) && ids.has(pair.webTraceId));
  return {
    name,
    prompt,
    traceCount: traces.length,
    tools: traces.map((trace) => trace.tool),
    sessionIds: [...new Set(traces.map((trace) => trace.sessionId).filter(Boolean))],
    failures: traces.filter((trace) => !trace.success).map((trace) => ({ tool: trace.tool, result: trace.result })),
    overlapPairs,
    webLinks,
    bodyTail
  };
}

async function waitForScenarioEvidence(scenario, before, timeoutMs = 360000) {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let observedRunning = false;
  let validSince = 0;
  let lastError = null;
  let nextStateAt = 0;
  let state = { stopping: true, canSend: false, phase: '', body: '' };
  while (Date.now() < deadline) {
    const after = await pageApi('/api/dsh-workbench/knowledge/traces?limit=1000');
    if (scenario.requiresTurnCompletion || Date.now() >= nextStateAt) {
      state = await conversationState();
      nextStateAt = Date.now() + (scenario.requiresTurnCompletion ? 2000 : 5000);
    }
    if (state.stopping || ['submitting', 'adjudicating'].includes(state.phase)) observedRunning = true;
    const traces = traceDelta(before, after);
    const result = scenarioSummary(scenario.name, scenario.prompt, traces, after, state.body, state.webLinks);
    try {
      scenario.validate(result);
      if (scenario.requiresTurnCompletion) {
        if ((observedRunning || Date.now() - startedAt >= 3000) && !state.stopping && !['submitting', 'adjudicating'].includes(state.phase)) {
          return { result, turnCompleted: true };
        }
      } else {
        if (!validSince) validSince = Date.now();
        if (Date.now() - validSince >= 1500) {
          state = await conversationState();
          result.bodyTail = state.body;
          return { result, turnCompleted: !state.stopping };
        }
      }
      lastError = null;
    } catch (error) {
      validSince = 0;
      lastError = error;
    }
    if (observedRunning && !state.stopping && !['submitting', 'adjudicating'].includes(state.phase) && lastError) throw lastError;
    await wait(1000);
  }
  throw lastError || new Error('scenario evidence did not settle within ' + timeoutMs + 'ms');
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront').catch(() => {});
if (stopOnly) {
  const stopped = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => ['停止生成', 'Stop generating'].includes(item.getAttribute('aria-label')) && !item.disabled);
    if (!button) return false;
    button.click();
    return true;
  })()`);
  console.log(JSON.stringify({ stopped }));
  ws.close();
  process.exit(0);
}
if (inspectOnly) {
  if (inspectSessionTitle) {
    const opened = await evaluate(`(() => {
      const title = ${JSON.stringify(inspectSessionTitle)};
      const direct = [...document.querySelectorAll('button,a,[role="button"]')]
        .find((item) => item.offsetParent !== null && item.innerText.includes(title));
      const textNode = [...document.querySelectorAll('body *')]
        .find((item) => item.offsetParent !== null && item.children.length === 0 && item.textContent.trim() === title);
      const target = direct || textNode && (textNode.closest('button,a,[role="button"]') || textNode.parentElement);
      if (!target) return false;
      target.click();
      return true;
    })()`);
    assert.equal(opened, true, 'session is unavailable: ' + inspectSessionTitle);
    await wait(1800);
  }
  if (inspectModels) {
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((item) => /^(选择模型|Select model)/.test(item.getAttribute('aria-label') || ''));
      if (button) button.click();
      return !!button;
    })()`);
    await wait(500);
  }
  console.log(JSON.stringify(await inspectUi(), null, 2));
  ws.close();
  process.exit(0);
}

if (multiSessionSmoke) {
  const results = [];
  const initialRows = await sessionRowTitles();
  try {
    for (const prompt of ['并行会话一：请只回复 A', '并行会话二：请只回复 B', '并行会话三：请只回复 C']) {
      results.push(await openNewSessionAndSend(prompt));
      await wait(1200);
    }
    let reopened = false;
    for (let attempt = 0; attempt < 20 && !reopened; attempt += 1) {
      reopened = !!(await clickVisibleText('并行会话二'));
      if (!reopened) await wait(250);
    }
    assert.equal(reopened, true, 'second parallel session unavailable');
    await wait(1000);
    const continued = await submitPrompt('回到第二会话后请只回复 B2');
    assert.ok(continued.commitLatencyMs < 2500, 'continued session submission delayed by ' + continued.commitLatencyMs + 'ms');
    const titles = await visibleSessionTitles();
    const finalRows = await sessionRowTitles();
    assert.ok(finalRows.length >= initialRows.length + 3, 'parallel session rows were not all retained');
    assert.ok(document.body.innerText.includes('回到第二会话后请只回复 B2'), 'continued message missing from active session');
    console.log(JSON.stringify({ passed: true, results, continued, titles, initialRows, finalRows }, null, 2));
  } finally {
    ws.close();
  }
  process.exit(0);
}

const scenarios = [
  {
    name: 'internal-knowledge-only',
    prompt: '请根据我的知识库回答：子代理超时后应该怎么处理，最多重试几次？请使用知识库工具并引用来源。',
    validate(result) {
      assert.ok(result.tools.includes('knowledge_search'), 'internal scenario did not call knowledge_search');
      assert.equal(result.tools.some((tool) => tool === 'web_search' || tool === 'web_fetch'), false, 'internal scenario unexpectedly called Web tools');
    }
  },
  {
    name: 'knowledge-plus-current-web',
    prompt: '请结合我的工作台知识库与 2026 年最新的 RAG 业界实践做一个简短对比。这个问题明确需要同时检索内部知识和最新网页，请并行调用知识库与网页搜索工具。',
    requiresTurnCompletion: true,
    validate(result, options = {}) {
      assert.ok(result.tools.includes('knowledge_search'), 'freshness scenario did not call knowledge_search');
      assert.ok(result.tools.some((tool) => tool === 'web_search' || tool === 'web_fetch'), 'freshness scenario did not call Web tools');
      assert.ok(result.overlapPairs.length > 0, 'knowledge and Web calls did not overlap in the same turn/step');
      assert.equal(result.failures.length, 0, 'freshness scenario had failed knowledge/Web tool calls');
      if (options.requireUi !== false) assert.ok(result.webLinks.length > 0, 'freshness answer did not render a clickable Web citation');
    }
  },
  {
    name: 'knowledge-miss-web-fallback',
    prompt: '请查询我的知识库里“量子奶茶火箭的内部价格政策与保修周期”。如果知识库没有可靠内容，必须继续调用网页搜索，并明确哪些内容无法验证。',
    requiresTurnCompletion: true,
    validate(result) {
      assert.ok(result.tools.includes('knowledge_search'), 'miss scenario did not call knowledge_search');
      assert.ok(result.tools.some((tool) => tool === 'web_search' || tool === 'web_fetch'), 'miss scenario did not fall back to Web tools');
    }
  },
  {
    name: 'greeting-zero-retrieval',
    prompt: '你好',
    requiresTurnCompletion: true,
    validate(result) {
      assert.equal(result.traceCount, 0, 'greeting should not call knowledge or Web tools');
    }
  },
  {
    name: 'legacy-knowledge-read',
    prompt: '请先用 knowledge_search 查询子代理超时重试策略，然后必须用 knowledge_read 读取搜索结果中的 atomic/工作台-看门狗机制.md，再根据全文简短回答。',
    validate(result) {
      assert.ok(result.tools.includes('knowledge_search'), 'legacy read scenario did not call knowledge_search');
      assert.ok(result.tools.includes('knowledge_read'), 'legacy read scenario did not call knowledge_read');
      assert.equal(result.failures.length, 0, 'legacy knowledge_read returned a tool error');
    }
  }
];
const selectedScenarios = scenarioFilter ? scenarios.filter((scenario) => scenario.name === scenarioFilter) : scenarios;
assert.ok(selectedScenarios.length > 0, 'unknown E2E scenario: ' + scenarioFilter);

if (aggregateOnly) {
  const persisted = await pageApi('/api/dsh-workbench/knowledge/traces?limit=1000');
  const latestKnowledgeTrace = (pattern) => [...persisted.traces]
    .filter((trace) => trace.tool === 'knowledge_search' && pattern.test(String(trace.arguments && trace.arguments.query || '')))
    .sort((a, b) => b.endedMs - a.endedMs)[0];
  const definitions = [
    { scenario: scenarios[0], trace: latestKnowledgeTrace(/子代理超时/) },
    { scenario: scenarios[1], trace: latestKnowledgeTrace(/RAG|业界实践/) },
    { scenario: scenarios[2], trace: latestKnowledgeTrace(/量子奶茶火箭/) }
  ];
  const aggregatedScenarios = definitions.map(({ scenario, trace }) => {
    assert.ok(trace && trace.sessionId, 'missing persisted trace for ' + scenario.name);
    const traces = persisted.traces.filter((item) => item.sessionId === trace.sessionId);
    const result = scenarioSummary(scenario.name, scenario.prompt, traces, persisted, 'See captured desktop screenshot.');
    scenario.validate(result, { requireUi: false });
    result.turnCompleted = false;
    result.stoppedAfterEvidence = true;
    result.screenshot = join(outDir, 'r2-' + scenario.name + '.png');
    return result;
  });
  const greetingReport = JSON.parse(await readFile(join(outDir, 'r2-knowledge-trace-e2e-greeting-zero-retrieval.json'), 'utf8'));
  const greeting = greetingReport.scenarios && greetingReport.scenarios[0];
  assert.ok(greeting && greeting.traceCount === 0, 'missing passing greeting report');
  greeting.bodyTail = String(greeting.bodyTail || '').slice(-1500);
  aggregatedScenarios.push(greeting);
  const aggregateReport = {
    ranAt: new Date().toISOString(),
    evidenceSource: 'persisted desktop tool traces plus greeting UI report',
    target: { title: target.title, url: target.url },
    scenarios: aggregatedScenarios,
    passed: true,
    completedAt: new Date().toISOString()
  };
  await writeFile(join(outDir, 'r2-knowledge-trace-e2e.json'), JSON.stringify(aggregateReport, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(aggregateReport, null, 2));
  console.log('knowledge trace desktop E2E aggregate passed');
  const closed = new Promise((resolve) => ws.addEventListener('close', resolve, { once: true }));
  ws.close();
  await closed;
} else {
  const report = { ranAt: new Date().toISOString(), scenarioFilter, target: { title: target.title, url: target.url }, scenarios: [] };
  try {
  for (const scenario of selectedScenarios) {
    if (!scenarioFilter || freshConversation) await openFreshConversation();
    const before = await pageApi('/api/dsh-workbench/knowledge/traces?limit=1000');
    const submission = await submitPrompt(scenario.prompt);
    assert.ok(submission.commitLatencyMs < 2500, 'message commit was delayed by ' + submission.commitLatencyMs + 'ms');
    const evidence = await waitForScenarioEvidence(scenario, before);
    const result = evidence.result;
    result.submission = submission;
    result.turnCompleted = evidence.turnCompleted;
    result.screenshot = await screenshot('r2-' + scenario.name + '.png');
    result.stoppedAfterEvidence = scenario.requiresTurnCompletion ? false : await stopTurnIfRunning();
    if (result.stoppedAfterEvidence) await wait(1000);
    report.scenarios.push(result);
  }
  report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = error instanceof Error ? error.stack || error.message : String(error);
    report.ui = await inspectUi().catch(() => null);
    report.failureScreenshot = await screenshot('r2-e2e-failure.png').catch(() => '');
    throw error;
  } finally {
    report.completedAt = new Date().toISOString();
    const reportName = scenarioFilter ? 'r2-knowledge-trace-e2e-' + scenarioFilter + '.json' : 'r2-knowledge-trace-e2e.json';
    await writeFile(join(outDir, reportName), JSON.stringify(report, null, 2) + '\n', 'utf8');
    try { ws.close(); } catch { /* ignore */ }
  }

  console.log(JSON.stringify(report, null, 2));
  console.log('knowledge trace desktop E2E passed');
}
