/**
 * dsh-workbench — host plugin (P2: preset/file IO + git graph).
 *
 * Serves loopback-only JSON routes on the host webserver (same pattern as
 * dsh-usage-stats): the browser fetches same-origin `/api/dsh-workbench/*`.
 *
 * Routes:
 *   GET  /api/dsh-workbench/fs/list?path=<abs>            → directory entries
 *   GET  /api/dsh-workbench/fs/read?path=<abs>            → utf-8 file text (≤512KB)
 *   POST /api/dsh-workbench/fs/write  {path, content}     → write utf-8 file
 *   GET  /api/dsh-workbench/preset/read?id=<id>&file=agent.cordis.yml|preset.yml
 *   POST /api/dsh-workbench/preset/write {id, file, content}
 *   GET  /api/dsh-workbench/git/graph?path=<abs>          → git log --graph text
 *   GET  /api/dsh-workbench/tasks/list?projectPath=<path> → persistent workbench tasks
 *   POST /api/dsh-workbench/tasks/mutate                  → atomic add/update/remove/import
 *
 * Command:
 *   /todo [add <content>|done <content>|start <content>|pending <content>|
 *          remove <content>|clear|replace <json>|show]
 *       UI-facing task-board write channel: reads the current `todos`
 *       projection, applies the requested change, and appends a whole-list
 *       `todo/write` snapshot (last-write-wins, same semantics as the model's
 *       `todo_write` tool). `recordInput: false` keeps the JSON out of
 *       `command/run` args — the `todo/write` event is the authoritative
 *       domain event.
 *
 * preset/* is confined to the DSH home (DSH_HOME, default ~/.dsh) under
 * .agent-presets/<id>/. Filesystem and Git routes are confined to canonical
 * paths owned by ctx.workspaceRegistry.
 */
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { readdir, readFile, writeFile, stat, lstat, realpath, mkdir, rename } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const name = 'dsh-workbench';
const DSH_ROOT = resolve((process.env.DSH_HOME ?? '').trim() || join(homedir(), '.dsh'));
const PRESET_ROOT = join(DSH_ROOT, '.agent-presets');
const MAX_READ_BYTES = 512 * 1024;
const MAX_BODY_BYTES = 768 * 1024;
const MAX_TASK_STORE_BYTES = 8 * 1024 * 1024;
const PRESET_FILES = new Set(['agent.cordis.yml', 'preset.yml']);
const DIAG_LOG = join(DSH_ROOT, 'dsh-workbench-host.log');
const TASK_STORE = join(DSH_ROOT, 'dsh-workbench-tasks.json');
const TODO_STATUSES = ['pending', 'in_progress', 'completed'];
const TASK_STATUSES = ['inbox', 'pending', 'in_progress', 'blocked', 'completed'];
const TASK_PRIORITIES = ['low', 'medium', 'high'];
const TASK_OWNERS = ['human', 'agent', 'hybrid'];
const IDEA_STATUSES = ['inbox', 'considering', 'promoted', 'snoozed', 'archived'];
const IDEA_RECOMMENDATIONS = ['task', 'orchestration', 'later', 'archive'];
const ORCHESTRATION_PHASES = ['idea', 'planning', 'planned', 'running', 'review', 'changes_requested', 'accepted', 'failed', 'cancelled'];
const ORCHESTRATION_AGENT_STATUSES = ['planned', 'waiting', 'running', 'completed', 'failed', 'cancelled'];
let taskMutationQueue = Promise.resolve();

// Edit-dialog chat: current default route; refine later via settings.
const CHAT_PROVIDER = 'deepseek-official';
const CHAT_MODEL = 'deepseek-v4-flash';
let chatLlm = null;
let chatCounter = 0;
let orchestrationSubagents = null;
let orchestrationAgents = null;
let workspaceRegistry = null;
const orchestrationControllers = new Map();
let modelCatalogCache = { expiresAt: 0, items: [] };

/** Diagnostic trail for host loading issues (also tells us module load failed when absent). */
function diag(msg) {
  try { appendFileSync(DIAG_LOG, new Date().toISOString() + ' ' + msg + '\n'); } catch (e) { /* never throw */ }
}

/** Loopback fence: same-origin local requests only (mirrors usage-stats). */
function isLoopbackRequest(request) {
  const address = request.socket && request.socket.remoteAddress;
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false;
  const host = request.headers.host;
  if (typeof host !== 'string') return false;
  let hostUrl;
  try { hostUrl = new URL(`http://${host}`); } catch { return false; }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false;
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try { return new URL(origin).host === hostUrl.host; } catch { return false; }
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function bad(res, code, message) { writeJson(res, 400, { error: code, message }); }
function fail(res, error) { writeJson(res, 500, { error: 'internal', message: String((error && error.message) || error) }); }
function fence(req, res) {
  if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden' }); return false; }
  if (req.method !== 'GET' && req.method !== 'POST') { writeJson(res, 405, { error: 'method not allowed' }); return false; }
  return true;
}

/** GET: read a query param (POST bodies are parsed by each handler). */
function paramOf(req, key) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  return url.searchParams.get(key);
}

function inside(root, target) {
  const normalize = (value) => {
    const normalized = resolve(value);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const r = normalize(root);
  const t = normalize(target);
  return t === r || t.startsWith(r + sep);
}

class WorkspacePathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkspacePathError';
  }
}

/** Resolve before checking so symlinks and Windows junctions cannot escape. */
async function authorizeWorkspacePath(input, expectedKind) {
  const requested = String(input || '');
  if (requested === '' || requested.includes('\0') || !isAbsolute(requested)) {
    throw new WorkspacePathError('an absolute workspace path is required');
  }
  if (workspaceRegistry === null) throw new WorkspacePathError('workspace registry is unavailable');

  let canonical;
  try { canonical = await realpath(requested); } catch {
    throw new WorkspacePathError('path does not exist or cannot be resolved');
  }
  const info = await stat(canonical);
  if (expectedKind === 'file' && !info.isFile()) throw new WorkspacePathError('path is not a regular file');
  if (expectedKind === 'directory' && !info.isDirectory()) throw new WorkspacePathError('path is not a directory');

  const roots = workspaceRegistry.list().map((workspace) => workspace.path);
  if (!roots.some((root) => inside(root, canonical))) {
    throw new WorkspacePathError('path is outside registered workspaces');
  }
  return { canonical, info };
}

function pathFail(res, error) {
  if (error instanceof WorkspacePathError) {
    writeJson(res, 403, { error: 'workspace-path-forbidden', message: error.message });
    return;
  }
  fail(res, error);
}

/** Resolve a preset target through its real parent so junctions cannot escape. */
async function authorizePresetPath(id, file, allowMissingFile = false) {
  await mkdir(PRESET_ROOT, { recursive: true });
  const canonicalRoot = await realpath(PRESET_ROOT);
  const canonicalPresetDir = await realpath(join(canonicalRoot, id));
  if (!inside(canonicalRoot, canonicalPresetDir)) throw new WorkspacePathError('preset directory escapes preset root');
  const dirInfo = await stat(canonicalPresetDir);
  if (!dirInfo.isDirectory()) throw new WorkspacePathError('preset path is not a directory');

  const target = join(canonicalPresetDir, file);
  try {
    const linkInfo = await lstat(target);
    if (linkInfo.isSymbolicLink()) throw new WorkspacePathError('preset file cannot be a symbolic link');
    const canonicalTarget = await realpath(target);
    if (!inside(canonicalRoot, canonicalTarget)) throw new WorkspacePathError('preset file escapes preset root');
    const info = await stat(canonicalTarget);
    if (!info.isFile()) throw new WorkspacePathError('preset path is not a regular file');
    return { canonical: canonicalTarget, info };
  } catch (error) {
    if (allowMissingFile && error && error.code === 'ENOENT') return { canonical: target, info: null };
    throw error;
  }
}

function runGit(dir, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile('git', ['-C', dir, ...args], { maxBuffer: 2 * 1024 * 1024, timeout: 15000 }, (err, stdout) => {
      if (err) { rejectPromise(err); return; }
      resolvePromise(String(stdout));
    });
  });
}

function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) { tooLarge = true; return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) { rejectPromise(new Error(`request body exceeds ${maxBytes} bytes`)); return; }
      resolvePromise(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', rejectPromise);
  });
}

function taskProjectKey(value) {
  const text = String(value || '').trim();
  if (text === '') return '';
  const normalized = resolve(text);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function cleanTaskText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanTaskDate(value) {
  const text = String(value || '').trim();
  if (text === '') return '';
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(text)) {
    throw new Error('invalid task date');
  }
  return text;
}

function cleanTaskLabels(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((label) => cleanTaskText(label, 40)).filter(Boolean))].slice(0, 12);
}

function cleanTemplate(raw) {
  if (raw === null || typeof raw !== 'object') throw new Error('invalid task template');
  const title = cleanTaskText(raw.title, 200);
  if (title === '') throw new Error('template title required');
  const now = new Date().toISOString();
  const sourceSteps = Array.isArray(raw.steps) ? raw.steps : [];
  const steps = sourceSteps.slice(0, 200).map((step, index) => {
    const stepTitle = cleanTaskText(step && (step.title || step.content), 500);
    if (stepTitle === '') throw new Error('template step title required');
    const duration = Number(step && step.durationMinutes);
    return {
      title: stepTitle,
      priority: TASK_PRIORITIES.includes(step && step.priority) ? step.priority : 'medium',
      owner: TASK_OWNERS.includes(step && step.owner) ? step.owner : 'agent',
      notes: cleanTaskText(step && step.notes, 10000),
      durationMinutes: Number.isFinite(duration) ? Math.max(0, Math.min(14400, Math.round(duration))) : 0,
      labels: cleanTaskLabels(step && step.labels),
      order: index
    };
  });
  if (steps.length === 0) throw new Error('template steps required');
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : randomUUID(),
    title,
    description: cleanTaskText(raw.description, 2000),
    steps,
    sourceSessionId: String(raw.sourceSessionId || ''),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
  };
}

function cleanTask(raw) {
  if (raw === null || typeof raw !== 'object') throw new Error('invalid task record');
  const title = String(raw.title || '').trim();
  if (title === '' || title.length > 500) throw new Error('task title must be 1-500 characters');
  const status = TASK_STATUSES.includes(raw.status) ? raw.status : 'pending';
  const priority = TASK_PRIORITIES.includes(raw.priority) ? raw.priority : 'medium';
  const owner = TASK_OWNERS.includes(raw.owner) ? raw.owner : (raw.sourceSessionId ? 'agent' : 'human');
  const duration = Number(raw.durationMinutes);
  const now = new Date().toISOString();
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : randomUUID(),
    title,
    status,
    priority,
    owner,
    notes: cleanTaskText(raw.notes, 10000),
    plannedFor: cleanTaskDate(raw.plannedFor),
    startAt: cleanTaskDate(raw.startAt),
    dueAt: cleanTaskDate(raw.dueAt),
    durationMinutes: Number.isFinite(duration) ? Math.max(0, Math.min(14400, Math.round(duration))) : 0,
    labels: cleanTaskLabels(raw.labels),
    blockedReason: cleanTaskText(raw.blockedReason, 1000),
    groupId: String(raw.groupId || ''),
    groupTitle: cleanTaskText(raw.groupTitle, 200),
    groupOrder: Number.isSafeInteger(raw.groupOrder) && raw.groupOrder >= 0 ? raw.groupOrder : 0,
    projectPath: String(raw.projectPath || ''),
    sourceSessionId: String(raw.sourceSessionId || ''),
    completedAt: status === 'completed' ? (typeof raw.completedAt === 'string' && raw.completedAt !== '' ? raw.completedAt : now) : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
  };
}

function cleanIdea(raw) {
  if (raw === null || typeof raw !== 'object') throw new Error('invalid idea record');
  const body = cleanTaskText(raw.body || raw.idea, 12000);
  if (body === '') throw new Error('idea body required');
  const now = new Date().toISOString();
  const impact = Number(raw.impact);
  const effort = Number(raw.effort);
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : randomUUID(),
    title: cleanTaskText(raw.title, 200) || body.slice(0, 80),
    body,
    projectPath: String(raw.projectPath || ''),
    sourceSessionId: String(raw.sourceSessionId || ''),
    status: IDEA_STATUSES.includes(raw.status) ? raw.status : 'inbox',
    tags: cleanTaskLabels(raw.tags),
    impact: Number.isFinite(impact) ? Math.max(0, Math.min(5, Math.round(impact))) : 0,
    effort: Number.isFinite(effort) ? Math.max(0, Math.min(5, Math.round(effort))) : 0,
    aiSummary: cleanTaskText(raw.aiSummary, 4000),
    aiRecommendation: IDEA_RECOMMENDATIONS.includes(raw.aiRecommendation) ? raw.aiRecommendation : '',
    aiRationale: cleanTaskText(raw.aiRationale, 4000),
    questions: Array.isArray(raw.questions) ? raw.questions.map((item) => cleanTaskText(item, 1000)).filter(Boolean).slice(0, 8) : [],
    linkedTaskIds: Array.isArray(raw.linkedTaskIds) ? [...new Set(raw.linkedTaskIds.map(String).filter(Boolean))].slice(0, 100) : [],
    linkedOrchestrationId: String(raw.linkedOrchestrationId || ''),
    snoozedUntil: cleanTaskDate(raw.snoozedUntil),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
  };
}

function cleanOrchestrationAgent(raw, fallbackName, fallbackRole) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    id: cleanTaskText(value.id, 80) || randomUUID(),
    name: cleanTaskText(value.name, 120) || fallbackName,
    role: cleanTaskText(value.role, 300) || fallbackRole,
    mission: cleanTaskText(value.mission || value.task, 6000),
    rationale: cleanTaskText(value.rationale, 2000),
    acceptance: cleanTaskText(value.acceptance, 3000),
    provider: cleanTaskText(value.provider, 160),
    model: cleanTaskText(value.model, 240),
    modelReason: cleanTaskText(value.modelReason, 1000),
    usedProvider: cleanTaskText(value.usedProvider, 160),
    usedModel: cleanTaskText(value.usedModel, 240),
    dependsOn: Array.isArray(value.dependsOn) ? [...new Set(value.dependsOn.map((item) => cleanTaskText(item, 120)).filter(Boolean))].slice(0, 12) : [],
    status: ORCHESTRATION_AGENT_STATUSES.includes(value.status) ? value.status : 'planned',
    sessionId: String(value.sessionId || ''),
    output: cleanTaskText(value.output, 30000),
    error: cleanTaskText(value.error, 4000),
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : '',
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : ''
  };
}

function cleanOrchestrationPlan(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const rawWorkers = Array.isArray(value.workers) ? value.workers.slice(0, 6) : [];
  const workers = rawWorkers.map((worker, index) => cleanOrchestrationAgent({ ...worker, id: cleanTaskText(worker && worker.id, 80) || ('worker-' + (index + 1)) }, '子代理 ' + (index + 1), '执行代理'));
  const known = new Map();
  workers.forEach((worker) => {
    known.set(worker.id.toLocaleLowerCase(), worker.id);
    known.set(worker.name.toLocaleLowerCase(), worker.id);
  });
  workers.forEach((worker) => {
    worker.dependsOn = [...new Set(worker.dependsOn.map((item) => known.get(String(item).toLocaleLowerCase())).filter((id) => id && id !== worker.id))];
  });
  if (workers.length === 0) throw new Error('AI plan did not produce any subagents');
  const maxParallel = Number(value.maxParallel);
  return {
    title: cleanTaskText(value.title, 200),
    summary: cleanTaskText(value.summary, 4000),
    strategy: cleanTaskText(value.strategy, 4000),
    mainAgent: cleanOrchestrationAgent(value.mainAgent, '主协调代理', '负责拆解、汇总与质量控制'),
    workers,
    acceptanceCriteria: Array.isArray(value.acceptanceCriteria) ? value.acceptanceCriteria.map((item) => cleanTaskText(item, 1000)).filter(Boolean).slice(0, 12) : [],
    maxParallel: Number.isFinite(maxParallel) ? Math.max(1, Math.min(4, Math.round(maxParallel))) : Math.min(3, workers.length)
  };
}

function cleanPlanVersion(raw, fallbackVersion) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    version: Number.isSafeInteger(value.version) && value.version > 0 ? value.version : fallbackVersion,
    plan: cleanOrchestrationPlan(value.plan || value),
    feedback: cleanTaskText(value.feedback, 6000),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString()
  };
}

function cleanOrchestrationRun(raw, fallbackAttempt) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    id: typeof value.id === 'string' && value.id !== '' ? value.id : randomUUID(),
    attempt: Number.isSafeInteger(value.attempt) && value.attempt > 0 ? value.attempt : fallbackAttempt,
    planVersion: Number.isSafeInteger(value.planVersion) && value.planVersion > 0 ? value.planVersion : 1,
    status: ['review', 'accepted', 'changes_requested', 'failed', 'cancelled'].includes(value.status) ? value.status : 'failed',
    mainAgent: value.mainAgent && typeof value.mainAgent === 'object' ? cleanOrchestrationAgent(value.mainAgent, '主协调代理', '负责拆解、汇总与质量控制') : null,
    workers: Array.isArray(value.workers) ? value.workers.map((worker, index) => cleanOrchestrationAgent(worker, '子代理 ' + (index + 1), '执行代理')).slice(0, 6) : [],
    finalReport: cleanTaskText(value.finalReport, 30000),
    runtimeError: cleanTaskText(value.runtimeError, 6000),
    reviewNote: cleanTaskText(value.reviewNote, 6000),
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : '',
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : ''
  };
}

function cleanOrchestration(raw) {
  if (raw === null || typeof raw !== 'object') throw new Error('invalid orchestration record');
  const idea = cleanTaskText(raw.idea, 12000);
  if (idea === '') throw new Error('orchestration idea required');
  const now = new Date().toISOString();
  const phase = ORCHESTRATION_PHASES.includes(raw.phase) ? raw.phase : 'idea';
  const currentPlan = raw.plan && typeof raw.plan === 'object' ? cleanOrchestrationPlan(raw.plan) : null;
  const planVersions = Array.isArray(raw.planVersions) ? raw.planVersions.map((version, index) => cleanPlanVersion(version, index + 1)).slice(-20) : [];
  if (planVersions.length === 0 && currentPlan) planVersions.push(cleanPlanVersion({ version: 1, plan: currentPlan, feedback: raw.feedback, createdAt: raw.updatedAt || now }, 1));
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : randomUUID(),
    title: cleanTaskText(raw.title, 200) || idea.slice(0, 80),
    idea,
    projectPath: String(raw.projectPath || ''),
    sourceSessionId: String(raw.sourceSessionId || ''),
    phase,
    plan: currentPlan,
    mainAgent: raw.mainAgent && typeof raw.mainAgent === 'object' ? cleanOrchestrationAgent(raw.mainAgent, '主协调代理', '负责拆解、汇总与质量控制') : null,
    workers: Array.isArray(raw.workers) ? raw.workers.map((worker, index) => cleanOrchestrationAgent(worker, '子代理 ' + (index + 1), '执行代理')).slice(0, 6) : [],
    maxParallel: Number.isSafeInteger(raw.maxParallel) ? Math.max(1, Math.min(4, raw.maxParallel)) : 3,
    attempt: Number.isSafeInteger(raw.attempt) && raw.attempt >= 0 ? raw.attempt : 0,
    feedback: cleanTaskText(raw.feedback, 6000),
    planningNote: cleanTaskText(raw.planningNote, 200),
    finalReport: cleanTaskText(raw.finalReport, 30000),
    runtimeError: cleanTaskText(raw.runtimeError, 6000),
    acceptedNote: cleanTaskText(raw.acceptedNote, 6000),
    planVersions,
    runs: Array.isArray(raw.runs) ? raw.runs.map((run, index) => cleanOrchestrationRun(run, index + 1)).slice(-30) : [],
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '',
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : '',
    acceptedAt: typeof raw.acceptedAt === 'string' ? raw.acceptedAt : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
  };
}

async function readTaskStore() {
  try {
    const linkInfo = await lstat(TASK_STORE);
    if (linkInfo.isSymbolicLink() || !linkInfo.isFile()) throw new Error('task store must be a regular non-symbolic file');
    if (linkInfo.size > MAX_TASK_STORE_BYTES) throw new Error(`task store exceeds ${MAX_TASK_STORE_BYTES} bytes`);
    const parsed = JSON.parse(await readFile(TASK_STORE, 'utf8'));
    if (!parsed || ![1, 2, 3, 4].includes(parsed.version) || !Array.isArray(parsed.tasks)) throw new Error('unsupported task store format');
    return {
      version: 4,
      revision: Number.isSafeInteger(parsed.revision) && parsed.revision >= 0 ? parsed.revision : 0,
      tasks: parsed.tasks.map(cleanTask),
      templates: Array.isArray(parsed.templates) ? parsed.templates.map(cleanTemplate) : [],
      ideas: Array.isArray(parsed.ideas) ? parsed.ideas.map(cleanIdea) : [],
      orchestrations: Array.isArray(parsed.orchestrations) ? parsed.orchestrations.map(cleanOrchestration) : []
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { version: 4, revision: 0, tasks: [], templates: [], ideas: [], orchestrations: [] };
    throw error;
  }
}

async function writeTaskStore(store) {
  store.version = 4;
  await mkdir(DSH_ROOT, { recursive: true });
  const temp = TASK_STORE + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, JSON.stringify(store, null, 2) + '\n', 'utf8');
  await rename(temp, TASK_STORE);
}

function tasksForProject(tasks, projectPath) {
  const key = taskProjectKey(projectPath);
  return tasks.filter((task) => taskProjectKey(task.projectPath) === key);
}

function tasksForScope(tasks, projectPath, scope) {
  if (scope === 'all') return tasks;
  if (scope === 'global') return tasksForProject(tasks, '');
  return tasksForProject(tasks, projectPath);
}

function orchestrationsForScope(orchestrations, projectPath, scope) {
  if (scope === 'all') return orchestrations;
  const key = scope === 'global' ? '' : taskProjectKey(projectPath);
  return orchestrations.filter((item) => taskProjectKey(item.projectPath) === key);
}

function ideasForScope(ideas, projectPath, scope) {
  if (scope === 'all') return ideas;
  const key = scope === 'global' ? '' : taskProjectKey(projectPath);
  return ideas.filter((item) => taskProjectKey(item.projectPath) === key);
}

async function mutateTasks(body) {
  const store = await readTaskStore();
  const action = String(body.action || '');
  const now = new Date().toISOString();
  if (action === 'add') {
    store.tasks.push(cleanTask({
      title: body.title,
      status: body.status,
      priority: body.priority,
      owner: body.owner,
      notes: body.notes,
      plannedFor: body.plannedFor,
      startAt: body.startAt,
      dueAt: body.dueAt,
      durationMinutes: body.durationMinutes,
      labels: body.labels,
      blockedReason: body.blockedReason,
      groupId: body.groupId,
      groupTitle: body.groupTitle,
      groupOrder: body.groupOrder,
      projectPath: body.projectPath,
      sourceSessionId: body.sourceSessionId,
      createdAt: now,
      updatedAt: now
    }));
  } else if (action === 'update') {
    const index = store.tasks.findIndex((task) => task.id === body.id);
    if (index < 0) throw new Error('task not found');
    const current = store.tasks[index];
    const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
    const nextStatus = patch.status === undefined ? current.status : patch.status;
    store.tasks[index] = cleanTask({
      ...current,
      title: patch.title === undefined ? current.title : patch.title,
      status: nextStatus,
      priority: patch.priority === undefined ? current.priority : patch.priority,
      owner: patch.owner === undefined ? current.owner : patch.owner,
      notes: patch.notes === undefined ? current.notes : patch.notes,
      plannedFor: patch.plannedFor === undefined ? current.plannedFor : patch.plannedFor,
      startAt: patch.startAt === undefined ? current.startAt : patch.startAt,
      dueAt: patch.dueAt === undefined ? current.dueAt : patch.dueAt,
      durationMinutes: patch.durationMinutes === undefined ? current.durationMinutes : patch.durationMinutes,
      labels: patch.labels === undefined ? current.labels : patch.labels,
      blockedReason: patch.blockedReason === undefined ? current.blockedReason : patch.blockedReason,
      groupId: patch.groupId === undefined ? current.groupId : patch.groupId,
      groupTitle: patch.groupTitle === undefined ? current.groupTitle : patch.groupTitle,
      groupOrder: patch.groupOrder === undefined ? current.groupOrder : patch.groupOrder,
      completedAt: nextStatus === 'completed' ? (current.completedAt || now) : '',
      updatedAt: now
    });
  } else if (action === 'remove') {
    const before = store.tasks.length;
    store.tasks = store.tasks.filter((task) => task.id !== body.id);
    if (store.tasks.length === before) throw new Error('task not found');
  } else if (action === 'import') {
    const items = Array.isArray(body.items) ? body.items : [];
    const importMode = ['independent', 'group', 'template'].includes(body.importMode) ? body.importMode : 'independent';
    const groupTitle = cleanTaskText(body.groupTitle, 200) || ('Agent 计划 · ' + now.slice(0, 10));
    if (importMode === 'template') {
      store.templates.push(cleanTemplate({
        title: groupTitle,
        description: body.description,
        steps: items,
        sourceSessionId: body.sourceSessionId,
        createdAt: now,
        updatedAt: now
      }));
      store.revision += 1;
      await writeTaskStore(store);
      return store;
    }
    const projectKey = taskProjectKey(body.projectPath);
    const existing = new Set(store.tasks
      .filter((task) => taskProjectKey(task.projectPath) === projectKey)
      .map((task) => task.title.toLocaleLowerCase()));
    const groupId = importMode === 'group' ? randomUUID() : '';
    for (const [index, item] of items.slice(0, 200).entries()) {
      const title = String(item && (item.title || item.content) || '').trim();
      if (title === '' || (importMode === 'independent' && existing.has(title.toLocaleLowerCase()))) continue;
      store.tasks.push(cleanTask({
        title,
        status: item.status,
        priority: item.priority || body.priority,
        owner: item.owner || 'agent',
        notes: item.notes,
        durationMinutes: item.durationMinutes,
        labels: item.labels,
        groupId,
        groupTitle: groupId ? groupTitle : '',
        groupOrder: index,
        projectPath: body.projectPath,
        sourceSessionId: body.sourceSessionId,
        createdAt: now,
        updatedAt: now
      }));
      existing.add(title.toLocaleLowerCase());
    }
  } else if (action === 'template_apply') {
    const template = store.templates.find((item) => item.id === body.templateId);
    if (!template) throw new Error('template not found');
    const groupId = randomUUID();
    const groupTitle = cleanTaskText(body.groupTitle, 200) || template.title;
    for (const step of template.steps) {
      store.tasks.push(cleanTask({
        title: step.title,
        status: 'pending',
        priority: step.priority,
        owner: step.owner,
        notes: step.notes,
        durationMinutes: step.durationMinutes,
        labels: step.labels,
        groupId,
        groupTitle,
        groupOrder: step.order,
        projectPath: body.projectPath,
        sourceSessionId: body.sourceSessionId || template.sourceSessionId,
        createdAt: now,
        updatedAt: now
      }));
    }
  } else if (action === 'template_remove') {
    const before = store.templates.length;
    store.templates = store.templates.filter((item) => item.id !== body.templateId);
    if (store.templates.length === before) throw new Error('template not found');
  } else if (action === 'idea_create') {
    store.ideas.push(cleanIdea({
      title: body.title,
      body: body.body || body.idea,
      projectPath: body.projectPath,
      sourceSessionId: body.sourceSessionId,
      tags: body.tags,
      status: 'inbox',
      createdAt: now,
      updatedAt: now
    }));
  } else if (action === 'idea_update') {
    const index = store.ideas.findIndex((item) => item.id === body.id);
    if (index < 0) throw new Error('idea not found');
    const current = store.ideas[index];
    const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
    store.ideas[index] = cleanIdea({ ...current, ...patch, id: current.id, updatedAt: now });
  } else if (action === 'idea_set_analysis') {
    const index = store.ideas.findIndex((item) => item.id === body.id);
    if (index < 0) throw new Error('idea not found');
    const current = store.ideas[index];
    const analysis = body.analysis && typeof body.analysis === 'object' ? body.analysis : {};
    store.ideas[index] = cleanIdea({
      ...current,
      title: analysis.title || current.title,
      status: current.status === 'inbox' ? 'considering' : current.status,
      aiSummary: analysis.summary,
      aiRecommendation: analysis.recommendation,
      aiRationale: analysis.rationale,
      tags: Array.isArray(analysis.tags) ? analysis.tags : current.tags,
      impact: analysis.impact,
      effort: analysis.effort,
      questions: analysis.questions,
      updatedAt: now
    });
  } else if (action === 'idea_convert_task') {
    const index = store.ideas.findIndex((item) => item.id === body.id);
    if (index < 0) throw new Error('idea not found');
    const idea = store.ideas[index];
    const task = cleanTask({
      title: idea.title,
      notes: [idea.body, idea.aiSummary ? 'AI 摘要：' + idea.aiSummary : '', idea.aiRationale ? 'AI 建议：' + idea.aiRationale : ''].filter(Boolean).join('\n\n'),
      status: 'inbox', priority: idea.impact >= 4 ? 'high' : idea.impact >= 2 ? 'medium' : 'low', owner: 'human', labels: idea.tags,
      projectPath: idea.projectPath, sourceSessionId: body.sourceSessionId || idea.sourceSessionId, createdAt: now, updatedAt: now
    });
    store.tasks.push(task);
    store.ideas[index] = cleanIdea({ ...idea, status: 'promoted', linkedTaskIds: [...idea.linkedTaskIds, task.id], updatedAt: now });
  } else if (action === 'idea_convert_orchestration') {
    const index = store.ideas.findIndex((item) => item.id === body.id);
    if (index < 0) throw new Error('idea not found');
    const idea = store.ideas[index];
    if (idea.linkedOrchestrationId && store.orchestrations.some((item) => item.id === idea.linkedOrchestrationId)) throw new Error('idea already has an AI orchestration');
    const orchestration = cleanOrchestration({
      title: idea.title, idea: idea.body, projectPath: idea.projectPath,
      sourceSessionId: body.sourceSessionId || idea.sourceSessionId, phase: 'idea', createdAt: now, updatedAt: now
    });
    store.orchestrations.push(orchestration);
    store.ideas[index] = cleanIdea({ ...idea, status: 'promoted', linkedOrchestrationId: orchestration.id, updatedAt: now });
  } else if (action === 'idea_remove') {
    const before = store.ideas.length;
    store.ideas = store.ideas.filter((item) => item.id !== body.id);
    if (store.ideas.length === before) throw new Error('idea not found');
  } else if (action === 'orchestration_create') {
    store.orchestrations.push(cleanOrchestration({
      title: body.title,
      idea: body.idea,
      projectPath: body.projectPath,
      sourceSessionId: body.sourceSessionId,
      phase: 'idea',
      createdAt: now,
      updatedAt: now
    }));
  } else if (action === 'orchestration_set_planning') {
    const index = store.orchestrations.findIndex((item) => item.id === body.id);
    if (index < 0) throw new Error('orchestration not found');
    const current = store.orchestrations[index];
    store.orchestrations[index] = cleanOrchestration({
      ...current,
      phase: 'planning',
      planningNote: cleanTaskText(body.planningNote, 200) || 'AI 正在生成方案…',
      runtimeError: '',
      updatedAt: now
    });
  } else if (action === 'orchestration_plan_failed') {
    const index = store.orchestrations.findIndex((item) => item.id === body.id);
    if (index < 0) throw new Error('orchestration not found');
    const current = store.orchestrations[index];
    store.orchestrations[index] = cleanOrchestration({
      ...current,
      phase: 'failed',
      planningNote: '',
      runtimeError: '方案生成失败：' + cleanTaskText(body.error, 6000),
      updatedAt: now
    });
  } else if (action === 'orchestration_set_plan') {
    const index = store.orchestrations.findIndex((item) => item.id === body.id);
    if (index < 0) throw new Error('orchestration not found');
    const current = store.orchestrations[index];
    const plan = cleanOrchestrationPlan(body.plan);
    const nextVersion = current.planVersions.reduce((max, entry) => Math.max(max, entry.version), 0) + 1;
    store.orchestrations[index] = cleanOrchestration({
      ...current,
      title: plan.title || current.title,
      phase: 'planned',
      planningNote: '',
      plan,
      mainAgent: { ...plan.mainAgent, status: 'planned', sessionId: '', output: '', error: '' },
      workers: plan.workers.map((worker) => ({ ...worker, status: 'planned', sessionId: '', output: '', error: '' })),
      maxParallel: plan.maxParallel,
      planVersions: [...current.planVersions, { version: nextVersion, plan, feedback: cleanTaskText(body.feedback, 6000), createdAt: now }],
      feedback: cleanTaskText(body.feedback, 6000) || current.feedback,
      finalReport: '',
      runtimeError: '',
      completedAt: '',
      updatedAt: now
    });
  } else if (action === 'orchestration_set_agent_model') {
    const index = store.orchestrations.findIndex((item) => item.id === body.id);
    if (index < 0) throw new Error('orchestration not found');
    const current = store.orchestrations[index];
    if (!current.plan || current.phase === 'running') throw new Error('agent models can only be edited before execution');
    const agentId = String(body.agentId || '');
    const provider = cleanTaskText(body.provider, 160);
    const model = cleanTaskText(body.model, 240);
    if ((provider === '') !== (model === '')) throw new Error('provider and model must be set together');
    const patchAgent = (agent) => agent && agent.id === agentId ? { ...agent, provider, model, modelReason: body.modelReason || (model ? '用户手动选择' : '继承父代理') } : agent;
    const nextPlan = cleanOrchestrationPlan({ ...current.plan, mainAgent: patchAgent(current.plan.mainAgent), workers: current.plan.workers.map(patchAgent) });
    const versions = current.planVersions.map((entry, versionIndex) => versionIndex === current.planVersions.length - 1 ? { ...entry, plan: nextPlan } : entry);
    store.orchestrations[index] = cleanOrchestration({
      ...current, plan: nextPlan, mainAgent: patchAgent(current.mainAgent), workers: current.workers.map(patchAgent), planVersions: versions, updatedAt: now
    });
  } else if (action === 'orchestration_start') {
    const index = store.orchestrations.findIndex((item) => item.id === body.id);
    if (index < 0) throw new Error('orchestration not found');
    const current = store.orchestrations[index];
    if (!current.plan || current.workers.length === 0) throw new Error('generate an AI plan before execution');
    if (!current.sourceSessionId) throw new Error('source session required for agent execution');
    if (current.phase === 'running') throw new Error('orchestration is already running');
    store.orchestrations[index] = cleanOrchestration({
      ...current,
      phase: 'running',
      attempt: current.attempt + 1,
      mainAgent: { ...current.mainAgent, status: 'waiting', sessionId: '', output: '', error: '', usedProvider: '', usedModel: '', startedAt: '', completedAt: '' },
      workers: current.workers.map((worker) => ({ ...worker, status: 'planned', sessionId: '', output: '', error: '', usedProvider: '', usedModel: '', startedAt: '', completedAt: '' })),
      finalReport: '',
      runtimeError: '',
      startedAt: now,
      completedAt: '',
      updatedAt: now
    });
  } else if (action === 'orchestration_accept') {
    const index = store.orchestrations.findIndex((item) => item.id === body.id);
    if (index < 0) throw new Error('orchestration not found');
    const current = store.orchestrations[index];
    if (current.phase !== 'review') throw new Error('only work awaiting review can be accepted');
    const runs = current.runs.map((run, runIndex) => runIndex === current.runs.length - 1 && run.attempt === current.attempt ? { ...run, status: 'accepted', reviewNote: body.note } : run);
    store.orchestrations[index] = cleanOrchestration({ ...current, phase: 'accepted', acceptedNote: body.note, acceptedAt: now, runs, updatedAt: now });
  } else if (action === 'orchestration_request_changes') {
    const index = store.orchestrations.findIndex((item) => item.id === body.id);
    if (index < 0) throw new Error('orchestration not found');
    const current = store.orchestrations[index];
    const feedback = cleanTaskText(body.feedback, 6000);
    if (feedback === '') throw new Error('change feedback required');
    const runs = current.runs.map((run, runIndex) => runIndex === current.runs.length - 1 && run.attempt === current.attempt ? { ...run, status: 'changes_requested', reviewNote: feedback } : run);
    store.orchestrations[index] = cleanOrchestration({ ...current, phase: 'changes_requested', feedback, runs, updatedAt: now });
  } else if (action === 'orchestration_cancel') {
    const index = store.orchestrations.findIndex((item) => item.id === body.id);
    if (index < 0) throw new Error('orchestration not found');
    const current = store.orchestrations[index];
    const next = cleanOrchestration({
      ...current,
      phase: 'cancelled',
      workers: current.workers.map((worker) => worker.status === 'running' || worker.status === 'planned' || worker.status === 'waiting' ? { ...worker, status: 'cancelled', error: '用户终止执行', completedAt: now } : worker),
      mainAgent: current.mainAgent && (current.mainAgent.status === 'running' || current.mainAgent.status === 'waiting') ? { ...current.mainAgent, status: 'cancelled', error: '用户终止执行', completedAt: now } : current.mainAgent,
      runtimeError: '用户终止执行',
      completedAt: now,
      updatedAt: now
    });
    store.orchestrations[index] = cleanOrchestration({ ...next, runs: runsWithSnapshot(next, 'cancelled', now) });
  } else if (action === 'orchestration_resume') {
    const index = store.orchestrations.findIndex((item) => item.id === body.id);
    if (index < 0) throw new Error('orchestration not found');
    const current = store.orchestrations[index];
    if (current.phase !== 'failed' && current.phase !== 'cancelled') throw new Error('只有异常中止或已终止的协作任务可以继续执行');
    if (!current.plan || current.workers.length === 0) throw new Error('没有可继续执行的方案，请重新生成方案');
    const resumedWorkers = current.workers.map((worker) => worker.status === 'completed' ? worker : {
      ...worker, status: 'planned', sessionId: '', output: '', error: '', startedAt: '', completedAt: ''
    });
    store.orchestrations[index] = cleanOrchestration({
      ...current,
      phase: 'running',
      attempt: current.attempt + 1,
      mainAgent: { ...current.mainAgent, status: 'waiting', sessionId: '', output: '', error: '', startedAt: '', completedAt: '' },
      workers: resumedWorkers,
      finalReport: '',
      runtimeError: '',
      startedAt: now,
      completedAt: '',
      updatedAt: now
    });
  } else if (action === 'orchestration_remove') {
    const before = store.orchestrations.length;
    store.orchestrations = store.orchestrations.filter((item) => item.id !== body.id);
    if (store.orchestrations.length === before) throw new Error('orchestration not found');
  } else {
    throw new Error('unsupported task action');
  }
  store.revision += 1;
  await writeTaskStore(store);
  return store;
}

function contentBlocksText(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks.filter((block) => block && block.type === 'text').map((block) => String(block.text || '')).join('').trim();
}

async function streamLlmText(system, prompt, options = {}) {
  if (chatLlm === null) throw new Error('LLM service unavailable');
  const messages = [{
    id: 'wb-orchestration-' + (++chatCounter),
    role: 'user',
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'user' }
  }];
  const out = [];
  for await (const chunk of chatLlm.stream({
    provider: CHAT_PROVIDER,
    model: CHAT_MODEL,
    system,
    messages,
    temperature: options.temperature ?? 0.25,
    maxTokens: options.maxTokens ?? 5000
  })) {
    if (chunk.type === 'text-delta') out.push(chunk.text);
  }
  return out.join('').trim();
}

function parseJsonObject(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(raw); } catch (firstError) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw firstError;
  }
}

async function listOrchestrationModels() {
  if (Date.now() < modelCatalogCache.expiresAt) return modelCatalogCache.items;
  if (chatLlm === null || typeof chatLlm.listProviders !== 'function' || typeof chatLlm.listModels !== 'function') return [];
  const providers = chatLlm.listProviders();
  const groups = await Promise.all(providers.map(async (provider) => {
    try {
      const models = await chatLlm.listModels(provider.id);
      return models.map((model) => ({ provider: provider.id, providerName: provider.name || provider.id, id: model.id, name: model.name || model.id }));
    } catch { return []; }
  }));
  const items = groups.flat().slice(0, 200);
  modelCatalogCache = { expiresAt: Date.now() + 60000, items };
  return items;
}

async function analyzeIdea(record) {
  const system = [
    '你是个人工作台的想法整理助手。你的任务是帮助用户判断下一步，不要擅自执行。',
    '只输出 JSON。建议必须是 task、orchestration、later、archive 之一。',
    '简单、单步骤且风险低的事项优先 task；需要并行专业角色、交叉验证或复杂交付才建议 orchestration。'
  ].join('\n');
  const prompt = [
    '项目：' + (record.projectPath || '全局'),
    '想法标题：' + record.title,
    '原始想法：\n' + record.body,
    '返回结构：',
    JSON.stringify({ title: '整理后的标题', summary: '一句话摘要', recommendation: 'task', rationale: '为什么这样处理', tags: ['标签'], impact: 3, effort: 2, questions: ['执行前值得确认的问题'] }, null, 2),
    'impact 和 effort 使用 1-5。不要编造已经存在的证据。'
  ].join('\n\n');
  const value = parseJsonObject(await streamLlmText(system, prompt, { maxTokens: 2500 }));
  return {
    title: cleanTaskText(value.title, 200),
    summary: cleanTaskText(value.summary, 4000),
    recommendation: IDEA_RECOMMENDATIONS.includes(value.recommendation) ? value.recommendation : 'later',
    rationale: cleanTaskText(value.rationale, 4000),
    tags: cleanTaskLabels(value.tags),
    impact: Number(value.impact),
    effort: Number(value.effort),
    questions: Array.isArray(value.questions) ? value.questions : []
  };
}

async function generateOrchestrationPlan(record, feedback, models, policy) {
  const modelList = Array.isArray(models) ? models : [];
  const modelChoices = modelList.map((item) => item.provider + ' :: ' + item.id + ' (' + item.name + ')').join('\n');
  const system = [
    '你是一个谨慎的多代理任务编排器。把用户的粗略想法转成可审查、可执行、可验收的方案。',
    '只输出一个 JSON 对象，不要 Markdown，不要解释。主代理负责最终汇总和质量控制；子代理负责边界清晰的工作包。',
    '优先 2-4 个子代理，最多 6 个。可并行的任务不要添加依赖；确有先后关系时，dependsOn 使用子代理 name。',
    '每个任务必须带明确验收标准，不得声称已经执行。',
    '如果提供了模型目录，只能从目录中为代理选择 provider/model；没有合适选项时两者留空以继承父代理。'
  ].join('\n');
  const prompt = [
    '项目路径：' + (record.projectPath || '全局任务'),
    '用户想法：\n' + record.idea,
    feedback ? '用户修改意见：\n' + feedback : '',
    '模型策略：' + (policy || 'balanced') + '（quality=质量优先，balanced=平衡，economy=节省，manual=不自动分配）',
    modelChoices ? '当前已配置模型目录：\n' + modelChoices : '当前没有可用模型目录，所有代理继承父代理模型。',
    '返回以下结构：',
    JSON.stringify({
      title: '简短标题',
      summary: '方案摘要',
      strategy: '执行策略与汇总方式',
      maxParallel: 3,
      mainAgent: { name: '主代理名称', role: '主代理角色', mission: '主代理职责', rationale: '为什么由该角色主导', provider: '', model: '', modelReason: '选择或继承理由' },
      workers: [{ name: '子代理名称', role: '专业角色', task: '完整工作包（包含必要上下文）', dependsOn: [], acceptance: '该子任务的验收标准', provider: '', model: '', modelReason: '选择或继承理由' }],
      acceptanceCriteria: ['最终由用户验收的标准']
    }, null, 2)
  ].filter(Boolean).join('\n\n');
  const plan = cleanOrchestrationPlan(parseJsonObject(await streamLlmText(system, prompt, { maxTokens: 6000 })));
  const allowed = new Set(modelList.map((item) => item.provider + '\u0000' + item.id));
  const validateAgentModel = (agent) => {
    if (!agent) return agent;
    if (policy === 'manual') return { ...agent, provider: '', model: '', modelReason: '等待用户手动选择，当前继承主会话' };
    if (!agent.provider || !agent.model) return { ...agent, provider: '', model: '', modelReason: agent.modelReason || '继承主会话模型' };
    if (!allowed.has(agent.provider + '\u0000' + agent.model)) return { ...agent, provider: '', model: '', modelReason: 'AI 建议的模型当前不可用，已安全回退为继承主会话' };
    return agent;
  };
  return cleanOrchestrationPlan({ ...plan, mainAgent: validateAgentModel(plan.mainAgent), workers: plan.workers.map(validateAgentModel) });
}

function queueOrchestrationPatch(id, update) {
  const operation = taskMutationQueue.then(async () => {
    const store = await readTaskStore();
    const index = store.orchestrations.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('orchestration not found');
    const current = store.orchestrations[index];
    store.orchestrations[index] = cleanOrchestration(update(current) || current);
    store.revision += 1;
    await writeTaskStore(store);
    return store.orchestrations[index];
  });
  taskMutationQueue = operation.catch(() => {});
  return operation;
}

async function orchestrationSnapshot(id) {
  const store = await readTaskStore();
  return store.orchestrations.find((item) => item.id === id) || null;
}

function workerPrompt(orchestration, worker) {
  const byId = new Map(orchestration.workers.map((item) => [item.id, item]));
  const dependencyContext = worker.dependsOn.map((id) => {
    const dependency = byId.get(id);
    if (!dependency) return '';
    return '### ' + dependency.name + '\n状态：' + dependency.status + '\n结果：\n' + (dependency.output || dependency.error || '无结果');
  }).filter(Boolean).join('\n\n');
  return [
    '你是“' + worker.name + '”，角色：' + worker.role + '。',
    '这是工作台中已经由用户确认执行的一项多代理任务。只完成分配给你的工作包，不要擅自扩大范围。',
    '项目路径：' + (orchestration.projectPath || '全局任务'),
    '总目标：\n' + orchestration.idea,
    '你的任务：\n' + worker.mission,
    worker.acceptance ? '你的验收标准：\n' + worker.acceptance : '',
    orchestration.feedback ? '用户最新反馈：\n' + orchestration.feedback : '',
    dependencyContext ? '依赖任务的结果：\n' + dependencyContext : '',
    '完成后给出结构清晰的交接报告：完成内容、证据/产物、验证结果、风险和建议。'
  ].filter(Boolean).join('\n\n');
}

async function runOrchestrationWorker(orchestrationId, workerId, parent, controller) {
  const startedAt = new Date().toISOString();
  let run;
  try {
    const current = await orchestrationSnapshot(orchestrationId);
    if (!current || current.phase !== 'running') return;
    const worker = current.workers.find((item) => item.id === workerId);
    if (!worker) throw new Error('worker not found');
    await queueOrchestrationPatch(orchestrationId, (item) => ({
      ...item,
      workers: item.workers.map((entry) => entry.id === workerId ? { ...entry, status: 'running', startedAt, error: '' } : entry),
      updatedAt: startedAt
    }));
    run = await orchestrationSubagents.start('spawn', {
      label: worker.name,
      prompt: [{ type: 'text', text: workerPrompt(current, worker) }],
      parent,
      signal: controller.signal,
      persona: '你是' + worker.role + '。保持专业、独立验证，并以可交接的证据为准。',
      ...(worker.provider && worker.model ? { agentOptions: { provider: worker.provider, model: worker.model } } : {}),
      maxDepth: 2
    });
    const usedProvider = run.localAgent && run.localAgent.options ? String(run.localAgent.options.provider || worker.provider || '') : worker.provider;
    const usedModel = run.localAgent && run.localAgent.options ? String(run.localAgent.options.model || worker.model || '') : worker.model;
    await queueOrchestrationPatch(orchestrationId, (item) => ({
      ...item,
      workers: item.workers.map((entry) => entry.id === workerId ? { ...entry, sessionId: String(run.id), usedProvider, usedModel } : entry),
      updatedAt: new Date().toISOString()
    }));
    const result = await run.result;
    const completedAt = new Date().toISOString();
    const output = contentBlocksText(result.output);
    const successful = result.stopReason === 'completed';
    await queueOrchestrationPatch(orchestrationId, (item) => item.phase === 'cancelled' ? item : ({
      ...item,
      workers: item.workers.map((entry) => entry.id === workerId ? { ...entry, status: successful ? 'completed' : 'failed', output, error: successful ? '' : ('子代理结束原因：' + result.stopReason), completedAt } : entry),
      updatedAt: completedAt
    }));
  } catch (error) {
    const completedAt = new Date().toISOString();
    await queueOrchestrationPatch(orchestrationId, (item) => item.phase === 'cancelled' ? item : ({
      ...item,
      workers: item.workers.map((entry) => entry.id === workerId ? { ...entry, status: controller.signal.aborted ? 'cancelled' : 'failed', error: String((error && error.message) || error), completedAt } : entry),
      updatedAt: completedAt
    })).catch(() => {});
  } finally {
    if (run) await run.dispose().catch(() => {});
  }
}

function coordinatorPrompt(orchestration) {
  const results = orchestration.workers.map((worker) => [
    '## ' + worker.name + '（' + worker.role + '）',
    '状态：' + worker.status,
    '任务：' + worker.mission,
    '结果：\n' + (worker.output || worker.error || '无结果')
  ].join('\n')).join('\n\n').slice(0, 50000);
  return [
    '你是本次任务的主代理“' + orchestration.mainAgent.name + '”，角色：' + orchestration.mainAgent.role + '。',
    '用户已经确认执行，现在所有子代理都已结束。请进行最终汇总和质量把关，但不要替用户宣告验收通过。',
    '项目路径：' + (orchestration.projectPath || '全局任务'),
    '原始想法：\n' + orchestration.idea,
    orchestration.plan && orchestration.plan.strategy ? '执行策略：\n' + orchestration.plan.strategy : '',
    orchestration.feedback ? '用户最新反馈：\n' + orchestration.feedback : '',
    '子代理交接：\n' + results,
    orchestration.plan && orchestration.plan.acceptanceCriteria.length ? '最终验收标准：\n- ' + orchestration.plan.acceptanceCriteria.join('\n- ') : '',
    '输出一份给用户验收的最终报告：结论、各子任务完成情况、产物/证据、验证结果、未完成项与风险、建议验收步骤。'
  ].filter(Boolean).join('\n\n');
}

function runsWithSnapshot(item, status, completedAt, overrides = {}) {
  if (!item.attempt) return item.runs;
  const planVersion = item.planVersions.length ? item.planVersions[item.planVersions.length - 1].version : 1;
  const run = cleanOrchestrationRun({
    id: overrides.id,
    attempt: item.attempt,
    planVersion,
    status,
    mainAgent: overrides.mainAgent === undefined ? item.mainAgent : overrides.mainAgent,
    workers: overrides.workers === undefined ? item.workers : overrides.workers,
    finalReport: overrides.finalReport === undefined ? item.finalReport : overrides.finalReport,
    runtimeError: overrides.runtimeError === undefined ? item.runtimeError : overrides.runtimeError,
    reviewNote: overrides.reviewNote,
    startedAt: item.startedAt,
    completedAt
  }, item.attempt);
  const existing = item.runs.find((entry) => entry.attempt === item.attempt);
  if (existing) run.id = existing.id;
  return [...item.runs.filter((entry) => entry.attempt !== item.attempt), run].slice(-30);
}

async function runOrchestration(orchestrationId) {
  if (orchestrationControllers.has(orchestrationId)) return;
  const controller = new AbortController();
  orchestrationControllers.set(orchestrationId, controller);
  try {
    let orchestration = await orchestrationSnapshot(orchestrationId);
    if (!orchestration || orchestration.phase !== 'running') return;
    if (orchestrationSubagents === null || orchestrationAgents === null) throw new Error('DSH subagent runtime unavailable; restart the desktop host and try again');
    let parent = orchestrationAgents.get(orchestration.sourceSessionId);
    const requestedProject = taskProjectKey(orchestration.projectPath);
    const parentProject = parent && parent.session && parent.session.header ? taskProjectKey(parent.session.header.cwd || '') : '';
    if (requestedProject && parentProject !== requestedProject) {
      parent = orchestrationAgents.roots().find((agent) => agent.session && agent.session.header && taskProjectKey(agent.session.header.cwd || '') === requestedProject);
    }
    if (!parent) throw new Error('所选项目当前没有在线主会话；请先打开该项目中的任一会话，再回到任务中心重新执行');
    if (requestedProject && (!parent.session || !parent.session.header || taskProjectKey(parent.session.header.cwd || '') !== requestedProject)) {
      throw new Error('执行会话与所选项目不一致；请先打开该项目中的任一会话，再重新执行');
    }
    if (String(parent.id) !== orchestration.sourceSessionId) {
      await queueOrchestrationPatch(orchestrationId, (item) => ({ ...item, sourceSessionId: String(parent.id), updatedAt: new Date().toISOString() }));
      orchestration = await orchestrationSnapshot(orchestrationId);
    }
    const pending = new Set(orchestration.workers.filter((worker) => worker.status !== 'completed').map((worker) => worker.id));
    while (pending.size > 0) {
      if (controller.signal.aborted) throw new Error('用户终止执行');
      orchestration = await orchestrationSnapshot(orchestrationId);
      if (!orchestration || orchestration.phase !== 'running') return;
      const byId = new Map(orchestration.workers.map((worker) => [worker.id, worker]));
      const ready = [...pending].filter((id) => {
        const worker = byId.get(id);
        return worker && worker.dependsOn.every((dependencyId) => {
          const dependency = byId.get(dependencyId);
          return dependency && ['completed', 'failed', 'cancelled'].includes(dependency.status);
        });
      });
      if (ready.length === 0) {
        const completedAt = new Date().toISOString();
        await queueOrchestrationPatch(orchestrationId, (item) => ({
          ...item,
          workers: item.workers.map((worker) => pending.has(worker.id) ? { ...worker, status: 'failed', error: '依赖关系无法满足或存在循环', completedAt } : worker),
          updatedAt: completedAt
        }));
        break;
      }
      const batch = ready.slice(0, orchestration.maxParallel || 3);
      batch.forEach((id) => pending.delete(id));
      await Promise.all(batch.map((id) => runOrchestrationWorker(orchestrationId, id, parent, controller)));
    }
    if (controller.signal.aborted) throw new Error('用户终止执行');
    orchestration = await orchestrationSnapshot(orchestrationId);
    if (!orchestration || orchestration.phase !== 'running') return;
    const mainStartedAt = new Date().toISOString();
    await queueOrchestrationPatch(orchestrationId, (item) => ({ ...item, mainAgent: { ...item.mainAgent, status: 'running', startedAt: mainStartedAt }, updatedAt: mainStartedAt }));
    orchestration = await orchestrationSnapshot(orchestrationId);
    let mainRun;
    try {
      mainRun = await orchestrationSubagents.start('spawn', {
        label: orchestration.mainAgent.name,
        prompt: [{ type: 'text', text: coordinatorPrompt(orchestration) }],
        parent,
        signal: controller.signal,
        persona: '你是' + orchestration.mainAgent.role + '。你负责整合证据、指出缺口并把结果交给用户验收。',
        ...(orchestration.mainAgent.provider && orchestration.mainAgent.model ? { agentOptions: { provider: orchestration.mainAgent.provider, model: orchestration.mainAgent.model } } : {}),
        maxDepth: 2
      });
      const usedProvider = mainRun.localAgent && mainRun.localAgent.options ? String(mainRun.localAgent.options.provider || orchestration.mainAgent.provider || '') : orchestration.mainAgent.provider;
      const usedModel = mainRun.localAgent && mainRun.localAgent.options ? String(mainRun.localAgent.options.model || orchestration.mainAgent.model || '') : orchestration.mainAgent.model;
      await queueOrchestrationPatch(orchestrationId, (item) => ({ ...item, mainAgent: { ...item.mainAgent, sessionId: String(mainRun.id), usedProvider, usedModel }, updatedAt: new Date().toISOString() }));
      const result = await mainRun.result;
      const completedAt = new Date().toISOString();
      const output = contentBlocksText(result.output);
      const successful = result.stopReason === 'completed';
      const workerFailures = orchestration.workers.filter((worker) => worker.status !== 'completed').length;
      await queueOrchestrationPatch(orchestrationId, (item) => {
        if (item.phase === 'cancelled') return item;
        const mainAgent = { ...item.mainAgent, status: successful ? 'completed' : 'failed', output, error: successful ? '' : ('主代理结束原因：' + result.stopReason), completedAt };
        const runtimeError = successful && workerFailures > 0 ? workerFailures + ' 个子代理未正常完成，请在验收时重点检查。' : successful ? '' : ('主代理结束原因：' + result.stopReason);
        const next = { ...item, phase: successful ? 'review' : 'failed', mainAgent, finalReport: output, runtimeError, completedAt, updatedAt: completedAt };
        return { ...next, runs: runsWithSnapshot(next, successful ? 'review' : 'failed', completedAt) };
      });
    } finally {
      if (mainRun) await mainRun.dispose().catch(() => {});
    }
  } catch (error) {
    const completedAt = new Date().toISOString();
    await queueOrchestrationPatch(orchestrationId, (item) => {
      if (item.phase === 'cancelled') return item;
      const status = controller.signal.aborted ? 'cancelled' : 'failed';
      const next = { ...item, phase: status, runtimeError: String((error && error.message) || error), completedAt, updatedAt: completedAt };
      return { ...next, runs: runsWithSnapshot(next, status, completedAt) };
    }).catch(() => {});
  } finally {
    orchestrationControllers.delete(orchestrationId);
  }
}

function orchestrationRuntimeInfo() {
  return {
    available: orchestrationSubagents !== null && orchestrationAgents !== null,
    providers: orchestrationSubagents === null ? [] : orchestrationSubagents.list()
  };
}

function recoverInterruptedOrchestrations() {
  const operation = taskMutationQueue.then(async () => {
    const store = await readTaskStore();
    const now = new Date().toISOString();
    let changed = false;
    store.orchestrations = store.orchestrations.map((item) => {
      if (item.phase !== 'running' && item.phase !== 'planning') return item;
      changed = true;
      const next = cleanOrchestration({
        ...item,
        phase: 'failed',
        workers: item.workers.map((worker) => ['running', 'waiting', 'planned'].includes(worker.status) ? { ...worker, status: 'failed', error: '桌面端重启中断了本次执行', completedAt: now } : worker),
        mainAgent: item.mainAgent && ['running', 'waiting', 'planned'].includes(item.mainAgent.status) ? { ...item.mainAgent, status: 'failed', error: '桌面端重启中断了本次执行', completedAt: now } : item.mainAgent,
        runtimeError: '桌面端重启中断了本次执行；已完成步骤已保留，可以点击“继续执行”从未完成步骤接着跑。',
        completedAt: now,
        updatedAt: now
      });
      return cleanOrchestration({ ...next, runs: runsWithSnapshot(next, 'failed', now) });
    });
    if (changed) {
      store.revision += 1;
      await writeTaskStore(store);
    }
  });
  taskMutationQueue = operation.catch(() => {});
  return operation;
}

// ---------------------------------------------------------------------------
// /todo command — UI-facing task-board write channel.
// Reads the current `todos` projection for the invoking agent, applies the
// requested change, and appends a whole-list `todo/write` snapshot (the same
// last-write-wins event the model's `todo_write` tool emits). Clients invoke
// it via `session.command('/todo ...')`; the browser task board sends
// `replace <json>` with the complete new list after local edits.
// ---------------------------------------------------------------------------
function currentTodos(sessionProjections, agent) {
  try {
    const snapshot = sessionProjections.snapshot(agent.session);
    const list = snapshot && snapshot.values && snapshot.values.todos;
    if (Array.isArray(list)) return list.map((t) => ({ content: t.content, status: t.status }));
  } catch (e) { /* fall back to empty */ }
  return [];
}

function validateTodos(raw) {
  const seen = new Set();
  const todos = [];
  for (const item of raw) {
    const content = String((item && item.content) ?? '').trim();
    const status = String((item && item.status) ?? '');
    if (content.length === 0) throw new Error('invalid todo: `content` must be a non-empty string');
    if (seen.has(content)) throw new Error(`invalid todos: duplicate content ${JSON.stringify(content)}`);
    if (!TODO_STATUSES.includes(status)) throw new Error(`invalid todo status: ${JSON.stringify(status)}`);
    seen.add(content);
    todos.push({ content, status });
  }
  return todos;
}

function todoUsage() {
  return 'Usage: /todo [add <内容>|done <内容>|start <内容>|pending <内容>|remove <内容>|clear|replace <json>|show]';
}

function renderTodos(title, todos) {
  const lines = todos.map((t) => `${t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]'} ${t.content}`);
  return {
    kind: 'success',
    text: [title, ...(lines.length > 0 ? lines : ['（空）'])].join('\n')
  };
}

function executeTodoCommand(invocation, sessionProjections) {
  const raw = String(invocation.rawInput || '').trim();
  if (raw.length === 0) {
    return renderTodos('当前任务列表', currentTodos(sessionProjections, invocation.agent));
  }
  const space = raw.indexOf(' ');
  const head = (space === -1 ? raw : raw.slice(0, space)).toLowerCase();
  const rest = space === -1 ? '' : raw.slice(space + 1).trim();
  const todos = currentTodos(sessionProjections, invocation.agent);
  try {
    let next;
    switch (head) {
      case 'add': {
        if (rest.length === 0) return { kind: 'error', text: '/todo add 需要任务内容\n' + todoUsage() };
        next = [...todos, { content: rest, status: 'pending' }];
        break;
      }
      case 'done':
      case 'start':
      case 'pending': {
        if (rest.length === 0) return { kind: 'error', text: `/todo ${head} 需要任务内容\n` + todoUsage() };
        const status = head === 'done' ? 'completed' : head === 'start' ? 'in_progress' : 'pending';
        if (!todos.some((t) => t.content === rest)) return { kind: 'error', text: `没有找到任务：${rest}` };
        next = todos.map((t) => (t.content === rest ? { content: t.content, status } : t));
        break;
      }
      case 'remove': {
        if (rest.length === 0) return { kind: 'error', text: '/todo remove 需要任务内容\n' + todoUsage() };
        if (!todos.some((t) => t.content === rest)) return { kind: 'error', text: `没有找到任务：${rest}` };
        next = todos.filter((t) => t.content !== rest);
        break;
      }
      case 'clear':
        next = [];
        break;
      case 'replace': {
        let parsed;
        try { parsed = JSON.parse(rest); } catch { return { kind: 'error', text: '/todo replace 需要 JSON 数组\n' + todoUsage() }; }
        if (!Array.isArray(parsed)) return { kind: 'error', text: '/todo replace 需要 JSON 数组\n' + todoUsage() };
        next = validateTodos(parsed);
        break;
      }
      case 'show':
        return renderTodos('当前任务列表', todos);
      default:
        return { kind: 'error', text: `未知操作：${head}\n` + todoUsage() };
    }
    const validated = validateTodos(next);
    invocation.agent.session.append('todo/write', { todos: validated });
    const count = (s) => validated.filter((t) => t.status === s).length;
    return renderTodos(`任务已更新（${count('pending')} 待办 / ${count('in_progress')} 进行中 / ${count('completed')} 完成）`, validated);
  } catch (error) {
    return { kind: 'error', text: String((error && error.message) || error) };
  }
}

function makeRoutes() {
  return [
    // ---- persistent workbench tasks (separate from per-turn agent todos) ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/tasks/list',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'GET') return bad(res, 'method', 'GET required');
        const projectPath = paramOf(req, 'projectPath') || '';
        const scope = paramOf(req, 'scope') || 'current';
        try {
          const store = await readTaskStore();
          const modelCatalog = await listOrchestrationModels();
          writeJson(res, 200, {
            revision: store.revision,
            projectPath,
            scope,
            tasks: tasksForScope(store.tasks, projectPath, scope),
            templates: store.templates,
            ideas: ideasForScope(store.ideas, projectPath, scope),
            orchestrations: orchestrationsForScope(store.orchestrations, projectPath, scope),
            orchestrationRuntime: orchestrationRuntimeInfo(),
            modelCatalog
          });
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/tasks/mutate',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        const projectPath = String(body.projectPath || '');
        const scope = String(body.scope || 'current');
        try {
          if (body.action === 'idea_analyze') {
            const snapshot = await readTaskStore();
            const record = snapshot.ideas.find((item) => item.id === body.id);
            if (!record) throw new Error('idea not found');
            const analysis = await analyzeIdea(record);
            body = { ...body, action: 'idea_set_analysis', analysis };
          }
          if (body.action === 'orchestration_plan') {
            const snapshot = await readTaskStore();
            const record = snapshot.orchestrations.find((item) => item.id === body.id);
            if (!record) throw new Error('orchestration not found');
            if (record.phase === 'planning') throw new Error('方案正在生成中，请稍候');
            const feedback = cleanTaskText(body.feedback, 6000) || record.feedback;
            const modelPolicy = cleanTaskText(body.modelPolicy, 40) || 'balanced';
            const planRequest = { ...body, feedback, modelPolicy };
            await taskMutationQueue.then(() => mutateTasks({ ...planRequest, action: 'orchestration_set_planning', planningNote: feedback ? '正在按反馈重新编排…' : 'AI 正在生成第一份方案…' }));
            void (async () => {
              try {
                const plan = await generateOrchestrationPlan(record, feedback, await listOrchestrationModels(), modelPolicy);
                await taskMutationQueue.then(() => mutateTasks({ ...planRequest, action: 'orchestration_set_plan', plan }));
              } catch (error) {
                diag('orchestration plan failed: ' + String((error && error.stack) || error));
                await taskMutationQueue.then(() => mutateTasks({ ...planRequest, action: 'orchestration_plan_failed', error: String((error && error.message) || error) })).catch(() => {});
              }
            })();
            const planningStore = await readTaskStore();
            const planningModels = await listOrchestrationModels();
            writeJson(res, 200, {
              ok: true,
              revision: planningStore.revision,
              projectPath,
              scope,
              tasks: tasksForScope(planningStore.tasks, projectPath, scope),
              templates: planningStore.templates,
              ideas: ideasForScope(planningStore.ideas, projectPath, scope),
              orchestrations: orchestrationsForScope(planningStore.orchestrations, projectPath, scope),
              orchestrationRuntime: orchestrationRuntimeInfo(),
              modelCatalog: planningModels
            });
            return;
          }
          if (body.action === 'orchestration_set_agent_model' && (body.provider || body.model)) {
            const modelCatalog = await listOrchestrationModels();
            if (!modelCatalog.some((item) => item.provider === body.provider && item.id === body.model)) throw new Error('selected model is not available in the current DSH catalog');
          }
          if (body.action === 'orchestration_resume' && (orchestrationSubagents === null || orchestrationAgents === null)) {
            throw new Error('代理运行时不可用：请先确认桌面端已正常启动后再试');
          }
          const operation = taskMutationQueue.then(() => mutateTasks(body));
          taskMutationQueue = operation.catch(() => {});
          const store = await operation;
          if (body.action === 'orchestration_cancel') {
            const controller = orchestrationControllers.get(body.id);
            if (controller) controller.abort('user cancelled');
          }
          if (body.action === 'orchestration_start') {
            void runOrchestration(body.id).catch((error) => diag('orchestration run failed: ' + String((error && error.stack) || error)));
          }
          if (body.action === 'orchestration_resume') {
            void runOrchestration(body.id).catch((error) => diag('orchestration resume failed: ' + String((error && error.stack) || error)));
          }
          const modelCatalog = await listOrchestrationModels();
          writeJson(res, 200, {
            ok: true,
            revision: store.revision,
            projectPath,
            scope,
            tasks: tasksForScope(store.tasks, projectPath, scope),
            templates: store.templates,
            ideas: ideasForScope(store.ideas, projectPath, scope),
            orchestrations: orchestrationsForScope(store.orchestrations, projectPath, scope),
            orchestrationRuntime: orchestrationRuntimeInfo(),
            modelCatalog
          });
        } catch (error) {
          bad(res, 'task-mutation-failed', String((error && error.message) || error));
        }
      }
    },
    // ---- fs: list ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/fs/list',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        const dir = paramOf(req, 'path');
        if (!dir) return bad(res, 'path-required', 'path query param required');
        try {
          const { canonical } = await authorizeWorkspacePath(dir, 'directory');
          const names = await readdir(canonical, { withFileTypes: true });
          const entries = await Promise.all(names.map(async (d) => {
            const full = join(canonical, d.name);
            try {
              const s = await stat(full);
              return { name: d.name, isDir: d.isDirectory(), size: s.size, mtime: s.mtimeMs };
            } catch { return { name: d.name, isDir: d.isDirectory(), size: 0, mtime: 0 }; }
          }));
          entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
          writeJson(res, 200, { path: canonical, entries });
        } catch (error) { pathFail(res, error); }
      }
    },
    // ---- fs: read ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/fs/read',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        const target = paramOf(req, 'path');
        if (!target) return bad(res, 'path-required', 'path query param required');
        try {
          const { canonical, info } = await authorizeWorkspacePath(target, 'file');
          if (info.size > MAX_READ_BYTES) return bad(res, 'too-large', `file exceeds ${MAX_READ_BYTES} bytes`);
          const content = await readFile(canonical, 'utf8');
          writeJson(res, 200, { path: canonical, content });
        } catch (error) { pathFail(res, error); }
      }
    },
    // ---- fs: write ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/fs/write',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        const target = String(body.path || '');
        const content = String(body.content ?? '');
        if (!target) return bad(res, 'path-required', 'path required');
        if (target.includes('\0')) return bad(res, 'bad-path', 'invalid path');
        try {
          const { canonical } = await authorizeWorkspacePath(target, 'file');
          if (Buffer.byteLength(content, 'utf8') > MAX_READ_BYTES) return bad(res, 'too-large', `content exceeds ${MAX_READ_BYTES} bytes`);
          await writeFile(canonical, content, 'utf8');
          writeJson(res, 200, { ok: true });
        } catch (error) { pathFail(res, error); }
      }
    },
    // ---- preset: read ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/preset/read',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        const id = paramOf(req, 'id');
        const file = paramOf(req, 'file');
        if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return bad(res, 'bad-id', 'invalid preset id');
        if (!file || !PRESET_FILES.has(file)) return bad(res, 'bad-file', 'invalid preset file');
        const target = join(PRESET_ROOT, id, file);
        if (!inside(PRESET_ROOT, target)) return bad(res, 'bad-path', 'outside preset root');
        try {
          const { canonical, info } = await authorizePresetPath(id, file);
          if (info.size > MAX_READ_BYTES) return bad(res, 'too-large', `file exceeds ${MAX_READ_BYTES} bytes`);
          const content = await readFile(canonical, 'utf8');
          writeJson(res, 200, { id, file, content });
        } catch (error) { fail(res, error); }
      }
    },
    // ---- preset: write ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/preset/write',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        const id = String(body.id || '');
        const file = String(body.file || '');
        const content = String(body.content ?? '');
        if (!/^[A-Za-z0-9._-]+$/.test(id)) return bad(res, 'bad-id', 'invalid preset id');
        if (!PRESET_FILES.has(file)) return bad(res, 'bad-file', 'invalid preset file');
        const target = join(PRESET_ROOT, id, file);
        if (!inside(PRESET_ROOT, target)) return bad(res, 'bad-path', 'outside preset root');
        if (Buffer.byteLength(content, 'utf8') > MAX_READ_BYTES) return bad(res, 'too-large', `content exceeds ${MAX_READ_BYTES} bytes`);
        try {
          const { canonical } = await authorizePresetPath(id, file, true);
          await writeFile(canonical, content, 'utf8');
          writeJson(res, 200, { ok: true });
        } catch (error) { fail(res, error); }
      }
    },
    // ---- git: graph text ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/git/graph',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        const dir = paramOf(req, 'path');
        if (!dir) return bad(res, 'path-required', 'path query param required');
        try {
          const { canonical } = await authorizeWorkspacePath(dir, 'directory');
          const text = await runGit(canonical, ['log', '--graph', '--all', '--date=short', "--pretty=format:%h %ad %d %s", '-n', '80']);
          writeJson(res, 200, { path: canonical, text });
        } catch (error) {
          if (error instanceof WorkspacePathError) { pathFail(res, error); return; }
          writeJson(res, 200, { path: dir, text: '', error: String((error && error.message) || error) });
        }
      }
    },
    // ---- chat: host-side LLM for the expert edit dialog (no session involved) ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/chat',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        const system = String(body.system || '');
        const rawMessages = Array.isArray(body.messages) ? body.messages : [];
        if (rawMessages.length === 0) return bad(res, 'no-messages', 'messages required');
        if (chatLlm === null) return writeJson(res, 200, { reply: '', error: 'LLM service unavailable' });
        const messages = rawMessages.slice(0, 20).map((m) => ({
          id: 'wb-chat-' + (++chatCounter),
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: [{ type: 'text', text: String(m.content || '') }],
          source: m.role === 'assistant' ? { kind: 'model', provider: CHAT_PROVIDER, model: CHAT_MODEL } : { kind: 'user' }
        }));
        try {
          const out = [];
          for await (const chunk of chatLlm.stream({
            provider: CHAT_PROVIDER,
            model: CHAT_MODEL,
            system: system === '' ? undefined : system,
            messages,
            temperature: 0.7,
            maxTokens: 2000
          })) {
            if (chunk.type === 'text-delta') out.push(chunk.text);
          }
          writeJson(res, 200, { reply: out.join('') });
        } catch (error) {
          writeJson(res, 200, { reply: '', error: String((error && error.message) || error) });
        }
      }
    }
  ];
}

function apply(ctx) {
  diag('apply called');
  let disposers = [];
  let commandDisposers = [];
  const register = (webServer) => {
    try {
      const routes = makeRoutes();
      disposers = routes.map((route) => webServer.register(route));
      diag('registered ' + routes.length + ' routes');
    } catch (error) {
      diag('register failed: ' + String((error && error.stack) || error));
    }
  };
  // Do not expose filesystem routes until the durable root authority exists.
  ctx.inject(['webServer', 'llm', 'workspaceRegistry'], (scoped) => {
    diag('webServer + llm + workspaceRegistry injected');
    chatLlm = scoped.llm;
    workspaceRegistry = scoped.workspaceRegistry;
    register(scoped.webServer);
  });
  // Bind the official DSH subagent runtime separately so task routes remain
  // available even while an optional provider is still being composed.
  ctx.inject(['subagents', 'agents'], (scoped) => {
    orchestrationSubagents = scoped.subagents;
    orchestrationAgents = scoped.agents;
    diag('subagents + agents injected: ' + scoped.subagents.list().join(','));
    void recoverInterruptedOrchestrations().catch((error) => diag('orchestration recovery failed: ' + String((error && error.stack) || error)));
  });
  // `/todo` command: needs the command registry + the session-projection seam
  // to read the current list. Wrapped defensively: a registration failure must
  // never take the host (or the whole desktop) down.
  ctx.inject(['commands', 'sessionProjections'], (scoped) => {
    try {
      commandDisposers = scoped.commands.register({
        name: 'todo',
        description: 'update the task board for the current work',
        input: { hint: 'add <内容> | done <内容> | start <内容> | pending <内容> | remove <内容> | clear | replace <json> | show' },
        recordInput: false,
        handler: (invocation) => executeTodoCommand(invocation, scoped.sessionProjections)
      });
      diag('todo command registered');
    } catch (error) {
      diag('todo command register failed: ' + String((error && error.stack) || error));
    }
  });
  ctx.on('dispose', () => {
    for (const controller of orchestrationControllers.values()) controller.abort('host disposed');
    orchestrationControllers.clear();
    orchestrationSubagents = null;
    orchestrationAgents = null;
    workspaceRegistry = null;
    for (const dispose of disposers) dispose();
    for (const dispose of commandDisposers) dispose();
  });
}

export { apply, name };
