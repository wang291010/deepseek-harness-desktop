import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const fixes = [
  {
    file: 'node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js',
    from: [`this.watched = current;
\t\t\t\tthis.sweepDeferred();
\t\t\t\tconst record = this.resolve(current);`, `const previous = this.watched;
\t\t\t\tthis.watched = current;
\t\t\t\tthis.sweepDeferred();
\t\t\t\tif (previous !== void 0 && previous !== current) {
\t\t\t\t\tconst previousRecord = this.scopes.get(previous);
\t\t\t\t\tif (previousRecord !== void 0) {
\t\t\t\t\t\tthis.scopes.delete(previous);
\t\t\t\t\t\tthis.deferredRemovals.delete(previous);
\t\t\t\t\t\tthis.dropScope(previous, previousRecord);
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\tconst record = this.resolve(current);`],
    to: `const previous = this.watched;
\t\t\t\tthis.watched = current;
\t\t\t\tthis.sweepDeferred();
\t\t\t\tconst record = this.resolve(current);
\t\t\t\tif (previous !== void 0 && previous !== current) {
\t\t\t\t\tconst previousRecord = this.scopes.get(previous);
\t\t\t\t\tif (previousRecord !== void 0) {
\t\t\t\t\t\tconst disposePrevious = () => {
\t\t\t\t\t\t\tif (this.watched === previous || this.scopes.get(previous) !== previousRecord) return;
\t\t\t\t\t\t\tthis.scopes.delete(previous);
\t\t\t\t\t\t\tthis.deferredRemovals.delete(previous);
\t\t\t\t\t\t\tthis.dropScope(previous, previousRecord);
\t\t\t\t\t\t};
\t\t\t\t\t\tif (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(disposePrevious, { timeout: 500 });
\t\t\t\t\t\telse setTimeout(disposePrevious, 0);
\t\t\t\t\t}
\t\t\t\t}`,
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js',
    from: 'import { ReasoningEffortId, createUserMessage, errorChain, freezeMessage } from "@deepseek-ai/dsh-llm";\nimport { isAppendSurfaceEvent, isJsonValue } from "@deepseek-ai/dsh-session";',
    to: 'import { ReasoningEffortId, createUserMessage, errorChain, freezeMessage } from "@deepseek-ai/dsh-llm";\nimport { isTokenDelta } from "@deepseek-ai/dsh-llm/message";\nimport { isAppendSurfaceEvent, isJsonValue, isSurfaceEvent } from "@deepseek-ai/dsh-session";',
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js',
    from: 'const inspectServable = (sessionId) => inspectApiRemoteSession(ctx, sessionId);',
    to: 'const inspectServable = (sessionId, signal) => inspectApiRemoteSession(ctx, sessionId, signal);',
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js',
    from: `function historyPage(ctx, events, beforeSeq, maxMessages, scope) {
	const page = paginate(events, beforeSeq, maxMessages ?? DEFAULT_MAX_MESSAGES);
	return {
		events: page.events.map((event) => {
			const view = viewFor(ctx, event, (callId) => backscanArgs(page.events, callId), scope);
			return {
				event,
				...view === void 0 ? {} : { view }
			};
		}),
		hasMore: page.hasMore
	};
}`,
    to: `function assistantStepKey(turn, step) {
	return \`\${turn}\\u0000\${step}\`;
}
function reduceHistoryEvents(events) {
	const completedSteps = new Set();
	for (const event of events) {
		if (event.type === "assistant/message" && isAppendSurfaceEvent(event)) {
			completedSteps.add(assistantStepKey(event.data.turn, event.data.step));
		}
	}
	const keptFirstDelta = new Set();
	const reduced = [];
	for (const event of events) {
		if (event.type === "assistant/chunk" && completedSteps.has(assistantStepKey(event.data.turn, event.data.step))) {
			const key = assistantStepKey(event.data.turn, event.data.step);
			if (keptFirstDelta.has(key) || !isTokenDelta(event.data.chunk)) continue;
			keptFirstDelta.add(key);
		}
		if (!isSurfaceEvent(event) || event.sourceEventSeqs === void 0) {
			reduced.push(event);
		} else {
			const { sourceEventSeqs: _omitted, ...rest } = event;
			reduced.push(rest);
		}
	}
	return reduced;
}
function historyPage(ctx, events, beforeSeq, maxMessages, scope) {
	const page = paginate(events, beforeSeq, maxMessages ?? DEFAULT_MAX_MESSAGES);
	const shipped = reduceHistoryEvents(page.events);
	return {
		events: shipped.map((event) => {
			const view = viewFor(ctx, event, (callId) => backscanArgs(page.events, callId), scope);
			return {
				event,
				...view === void 0 ? {} : { view }
			};
		}),
		hasMore: page.hasMore
	};
}`,
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js',
    from: 'async function historySourceFor(sessionId) {',
    to: 'async function historySourceFor(sessionId, signal) {',
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js',
    from: 'const inspected = await inspectServable(sessionId);\n\t\treturn {',
    to: 'const inspected = await inspectServable(sessionId, signal);\n\t\treturn {',
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js',
    from: 'async history(request) {\n\t\t\t\tconst { sessionId, beforeSeq, maxMessages } = request.payload;',
    to: 'async history(request, signal) {\n\t\t\t\tconst { sessionId, beforeSeq, maxMessages } = request.payload;',
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js',
    from: 'const source = await historySourceFor(sessionId);',
    to: 'const source = await historySourceFor(sessionId, signal);',
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js',
    from: '"session.history": {\n\t\tschema: sessionHistoryRequestSchema,\n\t\tinvoke: (api, r) => api.sessions.history(r)\n\t},',
    to: '"session.history": {\n\t\tschema: sessionHistoryRequestSchema,\n\t\tinvoke: (api, r, signal) => api.sessions.history(r, signal)\n\t},',
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/fetch/handler.js',
    from: "'session.history': { schema: sessionHistoryRequestSchema, invoke: (api, r) => api.sessions.history(r) },",
    to: "'session.history': { schema: sessionHistoryRequestSchema, invoke: (api, r, signal) => api.sessions.history(r, signal) },",
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-api-remotes/lib/index.js',
    from: 'async function inspectApiRemoteSession(ctx, sessionId) {\n\tconst persistence = ctx.get("sessionPersistence");',
    to: 'async function inspectApiRemoteSession(ctx, sessionId, signal) {\n\tsignal?.throwIfAborted();\n\tconst persistence = ctx.get("sessionPersistence");',
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-api-remotes/lib/index.js',
    from: '\tconst meta = (await persistence.list()).find((candidate) => candidate.id === sessionId);\n\tif (meta === void 0 || meta.cwd === void 0)',
    to: '\tconst meta = (await persistence.list(signal)).find((candidate) => candidate.id === sessionId);\n\tsignal?.throwIfAborted();\n\tif (meta === void 0 || meta.cwd === void 0)',
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-api-remotes/lib/index.js',
    from: '\tconst inspected = await persistence.inspect(sessionId);\n\tif (inspected.meta.cwd === void 0)',
    to: '\tconst inspected = await persistence.inspect(sessionId, signal);\n\tsignal?.throwIfAborted();\n\tif (inspected.meta.cwd === void 0)',
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js',
    from: 'const inspectServable = (sessionId) => inspectApiRemoteSession(ctx, sessionId);',
    to: 'const inspectServable = (sessionId, signal) => inspectApiRemoteSession(ctx, sessionId, signal);',
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js',
    from: 'async function historySourceFor(sessionId) {',
    to: 'async function historySourceFor(sessionId, signal) {',
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js',
    from: 'const inspected = await inspectServable(sessionId);\n        return { kind: \'detached\', header: inspected.meta, events: inspected.events };',
    to: 'const inspected = await inspectServable(sessionId, signal);\n        return { kind: \'detached\', header: inspected.meta, events: inspected.events };',
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js',
    from: 'async history(request) {\n                const { sessionId, beforeSeq, maxMessages } = request.payload;',
    to: 'async history(request, signal) {\n                const { sessionId, beforeSeq, maxMessages } = request.payload;',
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js',
    from: 'const source = await historySourceFor(sessionId);',
    to: 'const source = await historySourceFor(sessionId, signal);',
  },
];

for (const fix of fixes) {
  const path = resolve(root, fix.file);
  const source = await readFile(path, 'utf8');
  if (source.includes(fix.to)) continue;
  const from = Array.isArray(fix.from) ? fix.from.find((candidate) => source.includes(candidate)) : fix.from;
  if (from === void 0) {
    throw new Error(`upstream runtime fix no longer matches: ${fix.file}`);
  }
  await writeFile(path, source.replace(from, fix.to), 'utf8');
}
