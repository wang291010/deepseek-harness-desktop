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
 *   GET  /api/dsh-workbench/style/read                    → durable visual/conversation style
 *   POST /api/dsh-workbench/style/write {settings,presets} → validate and atomically persist style
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
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readdir, readFile, writeFile, stat, lstat, realpath, mkdir, rename, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';

const name = 'dsh-workbench';
const hostRequire = createRequire(import.meta.url);
const DSH_ROOT = resolve((process.env.DSH_HOME ?? '').trim() || join(homedir(), '.dsh'));
const PRESET_ROOT = join(DSH_ROOT, '.agent-presets');
const MAX_READ_BYTES = 512 * 1024;
const MAX_BODY_BYTES = 768 * 1024;
const MAX_TASK_STORE_BYTES = 8 * 1024 * 1024;
const PRESET_FILES = new Set(['agent.cordis.yml', 'preset.yml']);
const DIAG_LOG = join(DSH_ROOT, 'dsh-workbench-host.log');
const TASK_STORE = join(DSH_ROOT, 'dsh-workbench-tasks.json');
const STYLE_STORE = join(DSH_ROOT, 'dsh-workbench-style.json');
const MEMORY_STORE = join(DSH_ROOT, 'dsh-workbench-memory.json');
const AGENTS_STORE = join(DSH_ROOT, 'dsh-workbench-agents.json');
const PROJECT_CONTEXT_STORE = join(DSH_ROOT, 'dsh-workbench-project-contexts.json');
const SESSION_ROOT = join(DSH_ROOT, 'sessions');
const SESSION_CONTEXT_FILE = 'dsh-workbench-session.md';
const SESSION_CONTEXT_MAX_BYTES = 256 * 1024;
const PROJECT_RULE_FILES = ['AGENTS.md', 'CLAUDE.md', 'AGENT_RULES.md', '.cursorrules', 'README.md', 'readme.md'];
const PROJECT_RULE_MAX_BYTES = 96 * 1024;
const ATTACHMENT_ROOT = join(DSH_ROOT, 'attachments');
const MAX_STYLE_STORE_BYTES = 700 * 1024;
const MAX_MEMORY_STORE_BYTES = 2 * 1024 * 1024;
const MAX_MEMORY_SNAPSHOTS = 100;
const MAX_AGENT_POOL_SIZE = 30;
const MAX_PROJECT_CONTEXT_STORE_BYTES = 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_SUMMARY_BYTES = 64 * 1024;
const ATTACHMENT_SUMMARY_CHARS = 4000;
const WORKFLOW_STORE = join(DSH_ROOT, 'dsh-workbench-workflows.json');
const MAX_WORKFLOW_STORE_BYTES = 2 * 1024 * 1024;
const WORKFLOW_SCHEDULE_POLL_MS = 30000;
const KNOWLEDGE_ROOT = join(DSH_ROOT, 'knowledge');
const KNOWLEDGE_INBOX = join(KNOWLEDGE_ROOT, '01-Inbox');
const KNOWLEDGE_ATOMIC = join(KNOWLEDGE_ROOT, '02-Atomic');
const KNOWLEDGE_MOCS = join(KNOWLEDGE_ROOT, '03-MOCs');
const KNOWLEDGE_PROJECTS = join(KNOWLEDGE_ROOT, '04-Projects');
const KNOWLEDGE_TEMPLATES = join(KNOWLEDGE_ROOT, '99-Templates');
const KNOWLEDGE_RAW = join(KNOWLEDGE_ROOT, '00-Raw');
const KNOWLEDGE_ARCHIVE = join(KNOWLEDGE_ROOT, '05-Archive');
const KNOWLEDGE_INDEX_STORE = join(DSH_ROOT, 'dsh-workbench-knowledge-index.json');
const KNOWLEDGE_VECTOR_CONFIG_STORE = join(DSH_ROOT, 'dsh-workbench-knowledge-vector.json');
const KNOWLEDGE_VECTOR_STORE = join(DSH_ROOT, 'dsh-workbench-knowledge-vectors.json');
const KNOWLEDGE_PROFILE_STORE = join(DSH_ROOT, 'dsh-workbench-knowledge-profiles.json');
const KNOWLEDGE_EVAL_STORE = join(DSH_ROOT, 'dsh-workbench-knowledge-eval.json');
const KNOWLEDGE_QUALITY_STORE = join(DSH_ROOT, 'dsh-workbench-knowledge-quality.json');
const KNOWLEDGE_AUTO_STORE = join(DSH_ROOT, 'dsh-workbench-knowledge-auto.json');
const KNOWLEDGE_TRACE_STORE = join(DSH_ROOT, 'dsh-workbench-knowledge-traces.json');
const KNOWLEDGE_STATS_STORE = join(DSH_ROOT, 'dsh-workbench-knowledge-stats.json');
const MAX_KNOWLEDGE_INDEX_BYTES = 32 * 1024 * 1024;
const MAX_KNOWLEDGE_EVAL_BYTES = 2 * 1024 * 1024;
const MAX_KNOWLEDGE_TRACE_BYTES = 2 * 1024 * 1024;
const MAX_KNOWLEDGE_STATS_BYTES = 256 * 1024;
const MAX_KNOWLEDGE_TRACES = 1000;
const KNOWLEDGE_TRACE_TOOLS = new Set(['knowledge_search', 'knowledge_read', 'web_search', 'web_fetch', 'knowledge_audit']);
const KNOWLEDGE_TRACE_SECRET_KEY = /api[-_]?key|authorization|cookie|credential|password|secret|(?:access|refresh|auth)?token$/i;
const KNOWLEDGE_GROUNDEDNESS_TARGET = 0.85;
const KNOWLEDGE_GROUNDEDNESS_MIN_CLAIM_CHARS = 6;
const KNOWLEDGE_GROUNDEDNESS_THRESHOLD = 0.42;
const KNOWLEDGE_GROUNDEDNESS_WEAK_THRESHOLD = 0.3;
const KNOWLEDGE_GROUNDEDNESS_CLAIM_RE = /是|为|应|可以|需要|建议|因此|导致|说明|支持|选择|采用|必须|能|会|有|包含|包括|根据|依据|表明|显示|证明|意味着|推荐|应该|避免|宜|不宜|优先|相比|优于|更快|更低|更少|更多|达到|实现|提供|要求|确保|防止|解决|修复|提升|降低|增加|减少|最好|适合|适用|用于|数据|研究|统计|率|占比|阈值|默认|配置|机制|原理|架构|方法|流程|步骤|规范|标准|原因|影响|区别|对比/;
const KNOWLEDGE_FOLDER_DIRS = {
  raw: KNOWLEDGE_RAW, inbox: KNOWLEDGE_INBOX, atomic: KNOWLEDGE_ATOMIC, mocs: KNOWLEDGE_MOCS,
  projects: KNOWLEDGE_PROJECTS, templates: KNOWLEDGE_TEMPLATES, archive: KNOWLEDGE_ARCHIVE
};
const KNOWLEDGE_FOLDER_IDS = Object.keys(KNOWLEDGE_FOLDER_DIRS);
const KNOWLEDGE_CONFIDENCES = ['high', 'medium', 'low'];
const KNOWLEDGE_TYPES = ['note', 'skill', 'project', 'workflow', 'experience'];
const KNOWLEDGE_STATUSES = ['draft', 'review', 'published', 'deprecated'];
const KNOWLEDGE_CLAIM_TYPES = ['fact', 'hypothesis'];
const KNOWLEDGE_STALENESS = ['STABLE', 'CHECK', 'VOLATILE'];
const KNOWLEDGE_MAX_ENTRY_BYTES = 512 * 1024;
const KNOWLEDGE_MAX_QUERY_CHARS = 1000;
const KNOWLEDGE_MAX_TOPK = 20;
const KNOWLEDGE_MAX_TOKEN_BUDGET = 8000;
const KNOWLEDGE_TOOL_READ_MAX_CHARS = 6000;
const KNOWLEDGE_VECTOR_PROVIDERS = ['none', 'bge-local', 'bge-node', 'openai', 'custom'];
const KNOWLEDGE_DEFAULT_VECTOR_CONFIG = { provider: 'bge-local', model: 'bge-small-zh-v1.5', apiKey: '', baseUrl: '', python: '' };
const KNOWLEDGE_AUTO_DEFAULT_CONFIG = {
  enabled: true,
  gate: 'both',
  routing: 'auto',
  maxIterations: 2,
  rerank: 'none',
  topK: 3,
  tokenBudget: 600,
  minConfidence: 'medium',
  maxRefs: 3,
  cacheTtlMs: 10 * 60 * 1000,
  webFallback: true,
  thresholds: { insufficient: 0.42, gray: 0.55 },
  auditLevel: 'ref-only'
};
const KNOWLEDGE_CHAT_CONTEXT_TTL_MS = 10 * 60 * 1000;
const KNOWLEDGE_CONFIDENCE_SCORE = { high: 0.85, medium: 0.6, low: 0.35 };
const KNOWLEDGE_AUTO_TRIGGER = /什么|怎么|如何|为什么|能否|能不能|可不可以|是否|有没有|多少|哪个|哪些|谁|区别|对比|差异|关系|影响|依赖|介绍|总结|概括|方案|流程|经验|踩坑|问题|原理|机制|架构|设计|配置|使用|注意|建议|最佳实践|做法|步骤|规范|标准|原因|背景|含义|用途|优势|劣势|适合|应该|需要|推荐|选择|评估|测试|部署|上线|修复|排查|解决|追溯/;
const KNOWLEDGE_AUTO_SKIP = /^(你好|您好|hi|hello|嗨|哈喽|早上好|下午好|晚上好|谢谢|感谢|再见|拜拜|好的|收到|知道了|ok|嗯|哦|在吗|在不在|哈哈|可以|没问题|加油)[\s!！。.~～]*$/i;
const KNOWLEDGE_AUTO_FOLLOWUP = /^(继续|展开|详细|具体|然后|那|为什么|再|接着|还有|举例|比如|说说|讲讲|更多|深入|解释|另外|其他)/;
const KNOWLEDGE_EMBED_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'knowledge_embed.py');
const KNOWLEDGE_EMBED_NODE_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'knowledge_embed.mjs');
const KNOWLEDGE_RERANK_NODE_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'knowledge_rerank.mjs');
const KNOWLEDGE_RERANK_MODEL = 'bge-reranker-v2-m3';
const KNOWLEDGE_DEFAULT_PROFILE = {
  mode: 'auto',
  routes: { bm25: true, graph: true, vector: true, hyde: false },
  weights: { bm25: 1, graph: 0.7, vector: 1 },
  topK: 5,
  tokenBudget: 1500,
  rerank: 'none',
  folders: ['inbox', 'atomic', 'mocs', 'projects'],
  projectType: ''
};
const TODO_STATUSES = ['pending', 'in_progress', 'completed'];
const TASK_STATUSES = ['inbox', 'pending', 'in_progress', 'blocked', 'completed'];
const TASK_PRIORITIES = ['low', 'medium', 'high'];
const TASK_OWNERS = ['human', 'agent', 'hybrid'];
const IDEA_STATUSES = ['inbox', 'considering', 'promoted', 'snoozed', 'archived'];
const IDEA_RECOMMENDATIONS = ['task', 'orchestration', 'later', 'archive'];
const ORCHESTRATION_PHASES = ['idea', 'planning', 'planned', 'running', 'refining', 'review', 'changes_requested', 'accepted', 'failed', 'cancelled'];
const ORCHESTRATION_AGENT_STATUSES = ['planned', 'waiting', 'running', 'completed', 'failed', 'cancelled'];
const ORCHESTRATION_WORKER_TIMEOUT_MS = Number(process.env.DSH_WORKBENCH_WORKER_TIMEOUT_MS) > 0 ? Number(process.env.DSH_WORKBENCH_WORKER_TIMEOUT_MS) : 10 * 60 * 1000;
const ORCHESTRATION_WORKER_MAX_RETRIES = Number.isSafeInteger(Number(process.env.DSH_WORKBENCH_WORKER_MAX_RETRIES)) && Number(process.env.DSH_WORKBENCH_WORKER_MAX_RETRIES) >= 0 ? Number(process.env.DSH_WORKBENCH_WORKER_MAX_RETRIES) : 2;
const ORCHESTRATION_MODEL_FAILOVER_MAX = Number.isSafeInteger(Number(process.env.DSH_WORKBENCH_MODEL_FAILOVER_MAX)) && Number(process.env.DSH_WORKBENCH_MODEL_FAILOVER_MAX) >= 0 ? Number(process.env.DSH_WORKBENCH_MODEL_FAILOVER_MAX) : 2;
const ORCHESTRATION_MODEL_FAILOVER_ENABLED = String(process.env.DSH_WORKBENCH_MODEL_FAILOVER || 'on').toLowerCase() !== 'off';
const ATTACHMENT_TYPES = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp'],
  ['pdf', 'application/pdf'], ['txt', 'text/plain'], ['md', 'text/markdown'], ['json', 'application/json'],
  ['js', 'text/javascript'], ['ts', 'text/typescript'], ['py', 'text/x-python'], ['html', 'text/html'],
  ['css', 'text/css'], ['yml', 'text/yaml'], ['yaml', 'text/yaml'], ['csv', 'text/csv'], ['xml', 'text/xml'],
  ['sql', 'text/sql'], ['log', 'text/plain']
]);
const TEXT_ATTACHMENT_EXT = new Set(['txt', 'md', 'json', 'js', 'ts', 'py', 'html', 'css', 'yml', 'yaml', 'csv', 'xml', 'sql', 'log']);
const AGENT_POOL_DEFAULTS = [
  { id: 'code-reviewer', name: '代码审查专家', role: '审查代码质量与潜在缺陷', model: '', capabilities: ['review', 'refactor', 'debug'], prompt: '你是资深代码审查专家，逐项核对可维护性、边界与隐患，输出带证据的结论。' },
  { id: 'architect', name: '架构设计专家', role: '设计技术方案与评估选型', model: '', capabilities: ['design', 'architecture', 'evaluate'], prompt: '你是架构设计专家，输出可评审的技术方案、权衡与风险。' },
  { id: 'documenter', name: '文档生成专家', role: '编写技术/API 文档', model: '', capabilities: ['docs', 'api', 'guide'], prompt: '你是文档专家，产出结构清晰、面向读者的文档。' },
  { id: 'tester', name: '测试专家', role: '设计并执行测试用例', model: '', capabilities: ['test', 'qa', 'coverage'], prompt: '你是测试专家，覆盖关键路径与边界，给出可复现的用例。' },
  { id: 'data-analyst', name: '数据分析专家', role: '处理数据与生成报表', model: '', capabilities: ['data', 'report', 'analysis'], prompt: '你是数据分析专家，核对数据来源并输出可验证的结论。' },
  { id: 'frontend-dev', name: '前端专家', role: 'React/Vue 等前端开发', model: '', capabilities: ['frontend', 'react', 'ui'], prompt: '你是前端专家，兼顾实现质量、可访问性与视觉一致性。' },
  { id: 'backend-dev', name: '后端专家', role: 'API 设计与数据库优化', model: '', capabilities: ['backend', 'api', 'database'], prompt: '你是后端专家，关注接口契约、性能与数据安全。' }
];
const WORKFLOW_DEFAULT_TEMPLATES = [
  { id: 'wf-daily-report', title: '日报/晨报汇总', description: '汇总昨日进展、今日计划与阻塞项，输出一份晨报。', steps: [
    { title: '汇总昨日工作进展', priority: 'medium', owner: 'agent', notes: '列出完成项、关键数字与结论', durationMinutes: 10, labels: ['日报'] },
    { title: '整理今日计划', priority: 'medium', owner: 'agent', notes: '按优先级列出今日要事', durationMinutes: 10, labels: ['日报'] },
    { title: '标记阻塞与风险', priority: 'high', owner: 'agent', notes: '说明需要协调或无法推进的事项', durationMinutes: 5, labels: ['日报'] }
  ] },
  { id: 'wf-meeting-notes', title: '会议纪要整理', description: '把会议记录整理成结论、待办与负责人。', steps: [
    { title: '提炼会议结论', priority: 'medium', owner: 'agent', notes: '从原始记录中提取确定事项', durationMinutes: 10, labels: ['会议'] },
    { title: '整理待办与负责人', priority: 'medium', owner: 'agent', notes: '逐条列出任务、负责人与截止时间', durationMinutes: 10, labels: ['会议'] }
  ] },
  { id: 'wf-research-writing', title: '调研写作流水线', description: '调研 → 大纲 → 成稿 → 校对。', steps: [
    { title: '调研与资料收集', priority: 'medium', owner: 'agent', notes: '列出关键来源与事实', durationMinutes: 20, labels: ['调研'] },
    { title: '生成文章大纲', priority: 'medium', owner: 'agent', notes: '结构清晰、论点明确', durationMinutes: 15, labels: ['调研'] },
    { title: '撰写初稿', priority: 'medium', owner: 'agent', notes: '按大纲展开，引用来源', durationMinutes: 30, labels: ['调研'] },
    { title: '校对与定稿', priority: 'medium', owner: 'agent', notes: '检查事实、错别字与格式', durationMinutes: 10, labels: ['调研'] }
  ] },
  { id: 'wf-table-cleaning', title: '表格数据清洗', description: '检查字段、去重、补全与汇总。', steps: [
    { title: '字段与格式检查', priority: 'medium', owner: 'agent', notes: '核对表头、类型与缺失值', durationMinutes: 10, labels: ['数据'] },
    { title: '去重与补全', priority: 'medium', owner: 'agent', notes: '清理重复行，标记无法补全项', durationMinutes: 10, labels: ['数据'] },
    { title: '生成汇总说明', priority: 'medium', owner: 'agent', notes: '输出清洗前后对比与结论', durationMinutes: 10, labels: ['数据'] }
  ] }
];
let taskMutationQueue = Promise.resolve();
let styleMutationQueue = Promise.resolve();
let projectContextMutationQueue = Promise.resolve();
const sseClients = new Set();
const sseSessions = new Map();

function broadcastTaskEvent(payload) {
  if (sseClients.size === 0) return;
  const data = 'data: ' + JSON.stringify(payload) + '\n\n';
  for (const client of sseClients) {
    try { client.write(data); } catch (e) { sseClients.delete(client); }
  }
}

const STYLE_DEFAULTS = Object.freeze({
  theme: 'system',
  accent: '#ff9f0a',
  wallpaper: '',
  surfaceOpacity: 0.92,
  darken: 0.2,
  blur: 12,
  fontScale: 1,
  radius: 8,
  density: 'comfortable',
  conversationStyle: 'default',
  customConversationStyle: ''
});
const STYLE_THEMES = new Set(['light', 'dark', 'system']);
const STYLE_DENSITIES = new Set(['compact', 'comfortable', 'relaxed']);
const CONVERSATION_STYLES = new Set(['default', 'concise', 'detailed', 'socratic', 'custom']);
const CONVERSATION_PROMPTS = Object.freeze({
  concise: 'Conversation style: be concise and direct. Lead with the answer, keep explanations compact, and avoid repeating the user request.',
  detailed: 'Conversation style: provide structured, thorough explanations with the assumptions, evidence, tradeoffs, and verification steps needed to act confidently.',
  socratic: 'Conversation style: when the request benefits from reflection, guide the user with focused questions and explicit reasoning. Still answer direct factual or execution requests without unnecessary questioning.'
});
let styleState = { version: 1, revision: 0, settings: { ...STYLE_DEFAULTS }, presets: [], sessionStyles: {} };

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
const modelProbeCache = new Map();
const MODEL_PROBE_CACHE_MS = 10 * 60 * 1000;
const MODEL_PROBE_TIMEOUT_MS = 12 * 1000;
const MAX_MODEL_PROBE_COUNT = 12;
const MAX_PROJECT_CONTEXTS = 200;

/** Diagnostic trail for host loading issues (also tells us module load failed when absent). */
function diag(msg) {
  try { appendFileSync(DIAG_LOG, new Date().toISOString() + ' ' + msg + '\n'); } catch (e) { /* never throw */ }
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cleanStyleSettings(value) {
  const input = value && typeof value === 'object' ? value : {};
  const theme = STYLE_THEMES.has(input.theme) ? input.theme : STYLE_DEFAULTS.theme;
  const accent = /^#[0-9a-f]{6}$/i.test(String(input.accent || '')) ? String(input.accent).toLowerCase() : STYLE_DEFAULTS.accent;
  const rawWallpaper = String(input.wallpaper || '');
  const wallpaper = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(rawWallpaper) && rawWallpaper.length <= 620000
    ? rawWallpaper
    : '';
  const density = STYLE_DENSITIES.has(input.density) ? input.density : STYLE_DEFAULTS.density;
  const conversationStyle = CONVERSATION_STYLES.has(input.conversationStyle) ? input.conversationStyle : STYLE_DEFAULTS.conversationStyle;
  return {
    theme,
    accent,
    wallpaper,
    surfaceOpacity: clampNumber(input.surfaceOpacity, STYLE_DEFAULTS.surfaceOpacity, 0.55, 1),
    darken: clampNumber(input.darken, STYLE_DEFAULTS.darken, 0, 0.7),
    blur: clampNumber(input.blur, STYLE_DEFAULTS.blur, 0, 24),
    fontScale: clampNumber(input.fontScale, STYLE_DEFAULTS.fontScale, 0.85, 1.2),
    radius: clampNumber(input.radius, STYLE_DEFAULTS.radius, 0, 14),
    density,
    conversationStyle,
    customConversationStyle: String(input.customConversationStyle || '').trim().slice(0, 1200)
  };
}

function cleanStylePreset(value) {
  const input = value && typeof value === 'object' ? value : {};
  const id = String(input.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || randomUUID();
  const nameValue = String(input.name || '').trim().slice(0, 40);
  const settings = cleanStyleSettings(input.settings);
  settings.wallpaper = '';
  return {
    id,
    name: nameValue || '未命名预设',
    settings,
    createdAt: String(input.createdAt || new Date().toISOString()).slice(0, 40)
  };
}

function cleanStyleStore(value) {
  const input = value && typeof value === 'object' ? value : {};
  const rawSessionStyles = input && typeof input.sessionStyles === 'object' && input.sessionStyles !== null ? input.sessionStyles : {};
  const sessionStyles = {};
  for (const [sessionId, raw] of Object.entries(rawSessionStyles).slice(-200)) {
    const value2 = raw && typeof raw === 'object' ? raw : {};
    const style = CONVERSATION_STYLES.has(value2.conversationStyle) ? value2.conversationStyle : '';
    if (!style) continue;
    sessionStyles[String(sessionId).slice(0, 160)] = { conversationStyle: style, customConversationStyle: String(value2.customConversationStyle || '').trim().slice(0, 1200) };
  }
  return {
    version: 1,
    revision: Number.isSafeInteger(input.revision) && input.revision >= 0 ? input.revision : 0,
    settings: cleanStyleSettings(input.settings),
    presets: Array.isArray(input.presets) ? input.presets.slice(0, 20).map(cleanStylePreset) : [],
    sessionStyles
  };
}

async function readStyleStore() {
  try {
    const info = await lstat(STYLE_STORE);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('style store must be a regular non-symbolic file');
    if (info.size > MAX_STYLE_STORE_BYTES) throw new Error(`style store exceeds ${MAX_STYLE_STORE_BYTES} bytes`);
    styleState = cleanStyleStore(JSON.parse(await readFile(STYLE_STORE, 'utf8')));
    return styleState;
  } catch (error) {
    if (error && error.code === 'ENOENT') return styleState;
    throw error;
  }
}

async function writeStyleStore(store) {
  await mkdir(DSH_ROOT, { recursive: true });
  const temp = STYLE_STORE + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, JSON.stringify(store, null, 2) + '\n', 'utf8');
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(temp, STYLE_STORE);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolvePromise) => setTimeout(resolvePromise, 25 * (attempt + 1)));
    }
  }
  try { await rm(temp, { force: true }); } catch (e) { /* keep the temp for inspection */ }
  throw lastError;
}

let agentsState = { mode: 'free', agents: AGENT_POOL_DEFAULTS };

function cleanAgentPoolEntry(raw, index) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const id = cleanTaskText(value.id, 80);
  return {
    id: id || ('agent-' + (index + 1)),
    name: cleanTaskText(value.name, 120) || id || ('代理 ' + (index + 1)),
    role: cleanTaskText(value.role, 300),
    provider: cleanTaskText(value.provider, 160),
    model: cleanTaskText(value.model, 240),
    capabilities: Array.isArray(value.capabilities) ? [...new Set(value.capabilities.map((item) => cleanTaskText(item, 80)).filter(Boolean))].slice(0, 12) : [],
    prompt: cleanTaskText(value.prompt, 3000)
  };
}

function cleanAgentPool(raw) {
  const input = Array.isArray(raw) ? raw.slice(0, MAX_AGENT_POOL_SIZE) : [];
  const pool = input.map(cleanAgentPoolEntry);
  const seen = new Set();
  return pool.filter((agent) => {
    const key = agent.id.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readAgentsStore() {
  try {
    const info = await lstat(AGENTS_STORE);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('agents store must be a regular non-symbolic file');
    if (info.size > 400 * 1024) throw new Error('agents store exceeds 400KB');
    const parsed = JSON.parse(await readFile(AGENTS_STORE, 'utf8'));
    agentsState = {
      mode: (parsed && parsed.mode) === 'pool' ? 'pool' : 'free',
      agents: cleanAgentPool(parsed && parsed.agents)
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') agentsState = { mode: 'free', agents: cleanAgentPool(AGENT_POOL_DEFAULTS) };
    else throw error;
  }
  return agentsState;
}

async function writeAgentsStore(pool, mode) {
  await mkdir(DSH_ROOT, { recursive: true });
  const cleaned = cleanAgentPool(pool);
  const temp = AGENTS_STORE + '.tmp-' + process.pid + '-' + randomUUID();
  const next = { version: 1, mode: mode === 'pool' ? 'pool' : 'free', agents: cleaned };
  await writeFile(temp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(temp, AGENTS_STORE);
      agentsState = next;
      return agentsState;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolvePromise) => setTimeout(resolvePromise, 25 * (attempt + 1)));
    }
  }
  try { await rm(temp, { force: true }); } catch (e) { /* keep temp for inspection */ }
  throw lastError;
}

let memoryState = { version: 1, revision: 0, snapshots: [] };

function cleanMemorySnapshot(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    id: cleanTaskText(value.id, 120) || randomUUID(),
    at: typeof value.at === 'string' ? value.at : new Date().toISOString(),
    title: cleanTaskText(value.title, 200),
    summary: cleanTaskText(value.summary, 4000),
    findings: Array.isArray(value.findings) ? value.findings.map((item) => cleanTaskText(item, 1000)).filter(Boolean).slice(0, 20) : [],
    decisions: Array.isArray(value.decisions) ? value.decisions.map((item) => cleanTaskText(item, 1000)).filter(Boolean).slice(0, 20) : [],
    pending: Array.isArray(value.pending) ? value.pending.map((item) => cleanTaskText(item, 1000)).filter(Boolean).slice(0, 20) : [],
    sourceOrchestrationId: cleanTaskText(value.sourceOrchestrationId, 120)
  };
}

async function readMemoryStore() {
  try {
    const info = await lstat(MEMORY_STORE);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('memory store must be a regular non-symbolic file');
    if (info.size > MAX_MEMORY_STORE_BYTES) throw new Error(`memory store exceeds ${MAX_MEMORY_STORE_BYTES} bytes`);
    const parsed = JSON.parse(await readFile(MEMORY_STORE, 'utf8'));
    memoryState = {
      version: 1,
      revision: Number.isSafeInteger(parsed.revision) && parsed.revision >= 0 ? parsed.revision : 0,
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots.map(cleanMemorySnapshot).filter((entry) => entry.id).slice(-MAX_MEMORY_SNAPSHOTS) : []
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') memoryState = { version: 1, revision: 0, snapshots: [] };
    else throw error;
  }
  return memoryState;
}

async function writeMemoryStore(store) {
  await mkdir(DSH_ROOT, { recursive: true });
  const next = { version: 1, revision: store.revision, snapshots: (store.snapshots || []).slice(-MAX_MEMORY_SNAPSHOTS) };
  const temp = MEMORY_STORE + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(temp, MEMORY_STORE);
      memoryState = next;
      return next;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolvePromise) => setTimeout(resolvePromise, 25 * (attempt + 1)));
    }
  }
  try { await rm(temp, { force: true }); } catch (e) { /* keep temp for inspection */ }
  throw lastError;
}

async function resolveMemorySnapshots(tokens) {
  const input = Array.isArray(tokens) ? tokens.slice(0, 5).map((token) => String(token || '').trim()).filter(Boolean) : [];
  if (input.length === 0) return [];
  const store = await readMemoryStore();
  const byId = new Map(store.snapshots.map((entry) => [entry.id, entry]));
  return input.map((token) => byId.get(token)).filter(Boolean).map(cleanMemorySnapshot).slice(0, 5);
}

async function generateMemorySnapshot(orchestration) {
  const workersText = (Array.isArray(orchestration.workers) ? orchestration.workers : [])
    .map((worker) => '- ' + worker.name + '：' + String(worker.output || worker.error || '无结果').slice(0, 500))
    .join('\n')
    .slice(0, 30000);
  const fallbackSummary = String(orchestration.finalReport || (orchestration.plan && orchestration.plan.summary) || orchestration.idea || '').slice(0, 3000);
  let summary = fallbackSummary;
  let findings = [];
  let decisions = [];
  let pending = [];
  try {
    if (chatLlm !== null) {
      const text = await streamLlmText(
        '你负责把一次多代理任务的成果压缩成记忆快照。只输出一个 JSON 对象，不要 Markdown，不要解释。',
        [
          '任务：' + (orchestration.idea || ''),
          '最终报告：\n' + String(orchestration.finalReport || '').slice(0, 20000),
          '子代理结果：\n' + workersText,
          '输出结构：{ "summary": "一句话摘要", "findings": ["关键发现，含证据"], "decisions": ["已做的决策"], "pending": ["未完成/待办"] }'
        ].join('\n\n'),
        { maxTokens: 1500 }
      );
      const parsed = parseJsonObject(text);
      summary = cleanTaskText(parsed.summary, 4000) || fallbackSummary;
      findings = Array.isArray(parsed.findings) ? parsed.findings.map((item) => cleanTaskText(item, 1000)).filter(Boolean) : [];
      decisions = Array.isArray(parsed.decisions) ? parsed.decisions.map((item) => cleanTaskText(item, 1000)).filter(Boolean) : [];
      pending = Array.isArray(parsed.pending) ? parsed.pending.map((item) => cleanTaskText(item, 1000)).filter(Boolean) : [];
    }
  } catch (e) { /* fall back to heuristic extraction */ }
  if (findings.length === 0) {
    findings = (Array.isArray(orchestration.workers) ? orchestration.workers : [])
      .map((worker) => worker.name + '：' + String(worker.output || '').slice(0, 200))
      .filter(Boolean)
      .slice(0, 10);
  }
  if (decisions.length === 0 && orchestration.acceptedNote) decisions = [cleanTaskText(orchestration.acceptedNote, 1000)];
  if (pending.length === 0 && orchestration.runtimeError) pending = [cleanTaskText(orchestration.runtimeError, 1000)];
  return cleanMemorySnapshot({
    id: randomUUID(),
    title: orchestration.title || '记忆快照',
    summary,
    findings,
    decisions,
    pending,
    sourceOrchestrationId: orchestration.id
  });
}

function cleanAttachment(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    id: cleanTaskText(value.id, 120) || '',
    name: cleanTaskText(value.name, 240),
    mime: cleanTaskText(value.mime, 120),
    size: Number.isFinite(Number(value.size)) ? Math.max(0, Math.round(Number(value.size))) : 0,
    path: cleanTaskText(value.path, 500),
    summary: cleanTaskText(value.summary, 6000)
  };
}

function cleanLogEntry(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const level = ['info', 'warn', 'error'].includes(value.level) ? value.level : 'info';
  const text = cleanTaskText(value.text, 2000);
  if (!text) return null;
  return {
    at: typeof value.at === 'string' ? value.at : new Date().toISOString(),
    level,
    text,
    agent: cleanTaskText(value.agent, 120)
  };
}

async function attachmentFilePath(id) {
  const safe = cleanTaskText(id, 120);
  if (!/^[0-9a-f-]{36}$/i.test(safe)) throw new Error('invalid attachment id');
  return join(ATTACHMENT_ROOT, safe);
}

async function attachmentSummaryOf(filePath, ext, size) {
  if (!TEXT_ATTACHMENT_EXT.has(ext) || size > ATTACHMENT_SUMMARY_BYTES) return '';
  try {
    const content = await readFile(filePath, 'utf8');
    return content.slice(0, ATTACHMENT_SUMMARY_CHARS);
  } catch (e) {
    return '';
  }
}

async function removeAttachmentFile(id) {
  try {
    const target = await attachmentFilePath(id);
    await rm(target, { force: true });
  } catch (e) { /* best effort */ }
}

async function resolveAttachments(input) {
  const raw = Array.isArray(input) ? input.slice(0, 12) : [];
  const out = [];
  for (const item of raw) {
    const id = cleanTaskText(item && item.id, 120);
    if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
    let filePath;
    let info;
    try {
      filePath = await attachmentFilePath(id);
      info = await stat(filePath);
    } catch (e) {
      continue;
    }
    const name = cleanTaskText(item && item.name, 240) || id;
    const ext = String(name).toLocaleLowerCase().split('.').pop() || '';
    out.push(cleanAttachment({
      id,
      name,
      mime: cleanTaskText(item && item.mime, 120) || ATTACHMENT_TYPES.get(ext) || 'application/octet-stream',
      size: Number.isFinite(Number(item && item.size)) ? Math.round(Number(item && item.size)) : info.size,
      path: filePath,
      summary: await attachmentSummaryOf(filePath, ext, info.size)
    }));
  }
  return out;
}

let workflowState = { version: 1, revision: 0, schedules: [], runs: [] };
let workflowTimer = null;
let workflowInFlight = new Set();

function cleanWorkflowSchedule(raw, index) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const intervalMinutes = Number(value.intervalMinutes);
  return {
    id: cleanTaskText(value.id, 120) || ('schedule-' + (index + 1) + '-' + randomUUID().slice(0, 8)),
    templateId: cleanTaskText(value.templateId, 120),
    projectPath: String(value.projectPath || ''),
    intervalMinutes: Number.isFinite(intervalMinutes) ? Math.max(1, Math.min(10080, Math.round(intervalMinutes))) : 60,
    enabled: value.enabled !== false,
    lastRunAt: typeof value.lastRunAt === 'string' ? value.lastRunAt : '',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString()
  };
}

function cleanWorkflowRun(raw, index) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    id: cleanTaskText(value.id, 120) || ('run-' + (index + 1) + '-' + randomUUID().slice(0, 8)),
    templateId: cleanTaskText(value.templateId, 120),
    templateTitle: cleanTaskText(value.templateTitle, 200),
    projectPath: String(value.projectPath || ''),
    status: ['running', 'done', 'failed'].includes(value.status) ? value.status : 'done',
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : new Date().toISOString(),
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : '',
    error: cleanTaskText(value.error, 4000),
    taskCount: Number.isSafeInteger(value.taskCount) ? value.taskCount : 0
  };
}

async function readWorkflowStore() {
  try {
    const info = await lstat(WORKFLOW_STORE);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('workflow store must be a regular non-symbolic file');
    if (info.size > MAX_WORKFLOW_STORE_BYTES) throw new Error(`workflow store exceeds ${MAX_WORKFLOW_STORE_BYTES} bytes`);
    const parsed = JSON.parse(await readFile(WORKFLOW_STORE, 'utf8'));
    workflowState = {
      version: 1,
      revision: Number.isSafeInteger(parsed.revision) && parsed.revision >= 0 ? parsed.revision : 0,
      schedules: Array.isArray(parsed.schedules) ? parsed.schedules.map(cleanWorkflowSchedule) : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs.map(cleanWorkflowRun).slice(-100) : []
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') workflowState = { version: 1, revision: 0, schedules: [], runs: [] };
    else throw error;
  }
  return workflowState;
}

async function writeWorkflowStore(store) {
  await mkdir(DSH_ROOT, { recursive: true });
  const next = { version: 1, revision: store.revision, schedules: store.schedules || [], runs: (store.runs || []).slice(-100) };
  const temp = WORKFLOW_STORE + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(temp, WORKFLOW_STORE);
      workflowState = next;
      return next;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolvePromise) => setTimeout(resolvePromise, 25 * (attempt + 1)));
    }
  }
  try { await rm(temp, { force: true }); } catch (e) { /* keep temp for inspection */ }
  throw lastError;
}

async function ensureDefaultTemplates() {
  const store = await readTaskStore();
  let changed = false;
  for (const template of WORKFLOW_DEFAULT_TEMPLATES) {
    if (!store.templates.some((item) => item.id === template.id)) {
      store.templates.push(cleanTemplate({ ...template, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
      changed = true;
    }
  }
  if (changed) {
    store.revision += 1;
    await writeTaskStore(store);
  }
  return store.templates;
}

function applyTemplateToStore(store, template, projectPath, sourceSessionId) {
  const groupId = randomUUID();
  const groupTitle = template.title;
  const now = new Date().toISOString();
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
      projectPath,
      sourceSessionId: sourceSessionId || template.sourceSessionId,
      createdAt: now,
      updatedAt: now
    }));
  }
  return groupId;
}

async function runWorkflow(templateId, projectPath, sourceSessionId, trigger) {
  const startedAt = new Date().toISOString();
  const workflows = await readWorkflowStore();
  const runId = randomUUID();
  const store = await readTaskStore();
  const template = store.templates.find((item) => item.id === templateId);
  if (!template) throw new Error('template not found: ' + templateId);
  const record = cleanWorkflowRun({ id: runId, templateId, templateTitle: template.title, projectPath, status: 'running', startedAt });
  workflows.runs = [...workflows.runs, record];
  workflows.revision += 1;
  await writeWorkflowStore(workflows);
  try {
    applyTemplateToStore(store, template, projectPath, sourceSessionId);
    store.revision += 1;
    await writeTaskStore(store);
    const completedAt = new Date().toISOString();
    const final = await readWorkflowStore();
    final.revision += 1;
    final.runs = final.runs.map((item) => item.id === runId ? cleanWorkflowRun({ ...item, status: 'done', completedAt, taskCount: template.steps.length }) : item);
    await writeWorkflowStore(final);
    return final.runs.find((item) => item.id === runId);
  } catch (error) {
    const completedAt = new Date().toISOString();
    const final = await readWorkflowStore();
    final.revision += 1;
    final.runs = final.runs.map((item) => item.id === runId ? cleanWorkflowRun({ ...item, status: 'failed', completedAt, error: String((error && error.message) || error) }) : item);
    await writeWorkflowStore(final);
    return final.runs.find((item) => item.id === runId);
  }
}

async function pollWorkflowSchedules() {
  try {
    const workflows = await readWorkflowStore();
    const now = Date.now();
    for (const schedule of workflows.schedules) {
      if (!schedule.enabled || workflowInFlight.has(schedule.id)) continue;
      const last = schedule.lastRunAt ? new Date(schedule.lastRunAt).getTime() : 0;
      if (now - last < schedule.intervalMinutes * 60000) continue;
      workflowInFlight.add(schedule.id);
      const next = await readWorkflowStore();
      next.revision += 1;
      next.schedules = next.schedules.map((item) => item.id === schedule.id ? { ...item, lastRunAt: new Date().toISOString() } : item);
      await writeWorkflowStore(next);
      runWorkflow(schedule.templateId, schedule.projectPath, '', 'schedule').catch(() => {}).finally(() => workflowInFlight.delete(schedule.id));
    }
  } catch (e) { /* scheduler is best effort */ }
}

let knowledgeIndex = { version: 2, updatedAt: '', stats: null, entries: [] };
let knowledgeVectors = { version: 1, updatedAt: '', dims: 0, vectors: {} };
let vectorConfigCache = null;
let knowledgeProfiles = null;
let knowledgeEvalCache = null;
let knowledgeQualityCache = null;
let knowledgeTraceCache = null;
let knowledgeTraceWriteQueue = Promise.resolve();

async function readKnowledgeQuality() {
  if (knowledgeQualityCache) return knowledgeQualityCache;
  try {
    const info = await lstat(KNOWLEDGE_QUALITY_STORE);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('quality store must be a regular non-symbolic file');
    if (info.size > 1024 * 1024) throw new Error('quality store exceeds size limit');
    const parsed = JSON.parse(await readFile(KNOWLEDGE_QUALITY_STORE, 'utf8'));
    knowledgeQualityCache = {
      reviewMode: parsed.reviewMode === 'auto' ? 'auto' : 'manual',
      autoPublishLowRisk: parsed.autoPublishLowRisk !== false,
      forgetMode: parsed.forgetMode === 'auto' ? 'auto' : 'prompt',
      forgetAutoArchive: parsed.forgetAutoArchive === true,
      conflicts: parsed.conflicts && typeof parsed.conflicts === 'object' ? parsed.conflicts : {},
      usage: parsed.usage && typeof parsed.usage === 'object' ? parsed.usage : {},
      consolidations: Array.isArray(parsed.consolidations) ? parsed.consolidations : []
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      knowledgeQualityCache = { reviewMode: 'manual', autoPublishLowRisk: true, forgetMode: 'prompt', forgetAutoArchive: false, conflicts: {}, usage: {}, consolidations: [] };
    } else throw error;
  }
  return knowledgeQualityCache;
}

async function writeKnowledgeQuality(store) {
  await mkdir(DSH_ROOT, { recursive: true });
  const temp = KNOWLEDGE_QUALITY_STORE + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, JSON.stringify(store, null, 2) + '\n', 'utf8');
  await rename(temp, KNOWLEDGE_QUALITY_STORE);
  knowledgeQualityCache = store;
  return store;
}

async function recordKnowledgeUsage(paths) {
  const list = Array.isArray(paths) ? paths.filter(Boolean) : [];
  if (!list.length) return;
  const quality = await readKnowledgeQuality();
  quality.usage = quality.usage || {};
  let changed = false;
  for (const path of list) {
    const current = quality.usage[path] || { hits: 0, lastHitAt: '' };
    const next = { hits: (Number(current.hits) || 0) + 1, lastHitAt: new Date().toISOString() };
    if (next.hits !== current.hits || next.lastHitAt !== current.lastHitAt) changed = true;
    quality.usage[path] = next;
  }
  if (changed) await writeKnowledgeQuality(quality);
}

function knowledgeSourceCredibility(source) {
  const text = String(source || '').toLowerCase();
  if (/实验|实测|验证|手册|官方|spec|标准|docs|manual/.test(text)) return 0.9;
  if (/文档|设计|architecture|设计文档/.test(text)) return 0.75;
  if (/会话|讨论|session|对话/.test(text)) return 0.65;
  if (/思考|想法|text|文本|蒸馏/.test(text)) return 0.55;
  return 0.6;
}

function computeKnowledgeConfidenceBasis(entry, quality) {
  const sourceCred = knowledgeSourceCredibility(entry.source);
  let verification = 1.0;
  const verifyReasons = [];
  if (entry.status === 'published') {
    verification = entry.verifiedBy || entry.verifiedAt ? 1.0 : 0.9;
    verifyReasons.push(entry.verifiedBy ? '已人工验证（' + entry.verifiedBy + '）' : '已发布（建议补 verifiedBy/At）');
  } else if (entry.status === 'review') {
    verification = 0.5;
    verifyReasons.push('待人工审核（review）');
  } else if (entry.status === 'draft') {
    verification = 0.3;
    verifyReasons.push('草稿（draft）');
  } else {
    verification = 0.15;
    verifyReasons.push('已归档/弃用（deprecated）');
  }
  const conflictHits = (quality.conflicts && quality.conflicts[entry.path]) || [];
  const consistency = conflictHits && conflictHits.length ? 0.6 : 1.0;
  const consistencyReasons = conflictHits && conflictHits.length
    ? ['存在同主题冲突 ' + conflictHits.length + ' 处（维护器标记）'] : [];
  const ageDays = Math.max(0, (Date.now() - new Date(entry.updatedAt || entry.createdAt || Date.now()).getTime()) / 86400000);
  let freshness = 1.0;
  const freshnessReasons = [];
  if (entry.staleness === 'VOLATILE') {
    freshness = Math.max(0.5, Math.exp(-ageDays / 30));
    if (ageDays > 30) freshnessReasons.push('易变信息已 ' + Math.round(ageDays) + ' 天未更新');
  } else if (entry.staleness === 'CHECK') {
    freshness = Math.max(0.5, Math.exp(-ageDays / 90));
    if (ageDays > 90) freshnessReasons.push('需复查信息已 ' + Math.round(ageDays) + ' 天未更新');
  } else if (ageDays > 180) {
    freshness = 0.85;
    freshnessReasons.push('稳定信息超过 180 天未更新');
  }
  const usageRecord = (quality.usage || {})[entry.path];
  let usage = 1.0;
  const usageReasons = [];
  if (usageRecord) {
    const hits = Number(usageRecord.hits) || 0;
    const helpful = Math.max(0, Number(usageRecord.helpful) || 0);
    const unhelpful = Math.max(0, Number(usageRecord.unhelpful) || 0);
    const lastHit = usageRecord.lastHitAt ? Date.parse(usageRecord.lastHitAt) : 0;
    if (hits >= 3) { usage = 1.1; usageReasons.push('被命中 ' + hits + ' 次（使用强化）'); }
    else if (hits >= 1) { usage = 1.05; usageReasons.push('被命中 ' + hits + ' 次'); }
    if (Number.isFinite(lastHit) && lastHit > 0 && Date.now() - lastHit > 90 * 86400000) {
      usage = Math.max(0.9, usage - 0.05);
      usageReasons.push('超过 90 天未被使用');
    }
    if (helpful + unhelpful > 0) {
      const helpfulRatio = (helpful + 1) / (helpful + unhelpful + 2);
      const feedbackFactor = 0.8 + helpfulRatio * 0.4;
      usage = Math.max(0.8, Math.min(1.2, usage * feedbackFactor));
      usageReasons.push('用户反馈：有帮助 ' + helpful + ' / 没帮助 ' + unhelpful);
    }
  } else if (ageDays > 180) {
    usage = 0.9;
    usageReasons.push('从未被使用且超过 180 天');
  }
  const score = Math.max(0, Math.min(1, sourceCred * verification * consistency * freshness * usage));
  const label = score >= 0.72 ? 'high' : score >= 0.45 ? 'medium' : 'low';
  const reasons = [
    '来源可信度 ' + Math.round(sourceCred * 100) + '%',
    ...verifyReasons,
    ...consistencyReasons,
    ...freshnessReasons,
    ...usageReasons
  ].slice(0, 8);
  return {
    score: Math.round(score * 1000) / 1000,
    label,
    reasons,
    sourceCred: Math.round(sourceCred * 1000) / 1000,
    verification: Math.round(verification * 1000) / 1000,
    consistency: Math.round(consistency * 1000) / 1000,
    freshness: Math.round(freshness * 1000) / 1000,
    usage: Math.round(usage * 1000) / 1000
  };
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function defaultKnowledgeStatus(folder) {
  if (folder === 'raw' || folder === 'templates') return 'draft';
  if (folder === 'inbox') return 'review';
  if (folder === 'archive') return 'deprecated';
  return 'published';
}

function cleanKnowledgeEntry(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const folder = KNOWLEDGE_FOLDER_IDS.includes(value.folder) ? value.folder : 'inbox';
  return {
    path: cleanTaskText(value.path, 500),
    folder,
    name: cleanTaskText(value.name, 200),
    title: cleanTaskText(value.title, 300),
    type: KNOWLEDGE_TYPES.includes(value.type) ? value.type : 'note',
    context: cleanTaskText(value.context, 2000),
    result: cleanTaskText(value.result, 2000),
    reusable: cleanTaskText(value.reusable, 2000),
    tags: Array.isArray(value.tags) ? value.tags.map((item) => cleanTaskText(item, 80)).filter(Boolean).slice(0, 20) : [],
    confidence: KNOWLEDGE_CONFIDENCES.includes(value.confidence) ? value.confidence : 'medium',
    status: KNOWLEDGE_STATUSES.includes(value.status) ? value.status : defaultKnowledgeStatus(folder),
    claimType: KNOWLEDGE_CLAIM_TYPES.includes(value.claimType) ? value.claimType : 'fact',
    assumptions: Array.isArray(value.assumptions) ? value.assumptions.map((item) => cleanTaskText(item, 300)).filter(Boolean).slice(0, 10) : [],
    verifiedBy: cleanTaskText(value.verifiedBy, 80),
    verifiedAt: typeof value.verifiedAt === 'string' ? value.verifiedAt : '',
    staleness: KNOWLEDGE_STALENESS.includes(value.staleness) ? value.staleness : 'STABLE',
    computedConfidence: KNOWLEDGE_CONFIDENCES.includes(value.computedConfidence) ? value.computedConfidence : '',
    confidenceBasis: value.confidenceBasis && typeof value.confidenceBasis === 'object' && !Array.isArray(value.confidenceBasis)
      ? {
          score: Number.isFinite(Number(value.confidenceBasis.score)) ? Number(value.confidenceBasis.score) : 0,
          label: KNOWLEDGE_CONFIDENCES.includes(value.confidenceBasis.label) ? value.confidenceBasis.label : 'low',
          reasons: Array.isArray(value.confidenceBasis.reasons) ? value.confidenceBasis.reasons.map((item) => cleanTaskText(item, 200)).filter(Boolean).slice(0, 8) : [],
          sourceCred: Number.isFinite(Number(value.confidenceBasis.sourceCred)) ? Number(value.confidenceBasis.sourceCred) : 0,
          verification: Number.isFinite(Number(value.confidenceBasis.verification)) ? Number(value.confidenceBasis.verification) : 0,
          consistency: Number.isFinite(Number(value.confidenceBasis.consistency)) ? Number(value.confidenceBasis.consistency) : 0,
          freshness: Number.isFinite(Number(value.confidenceBasis.freshness)) ? Number(value.confidenceBasis.freshness) : 0,
          usage: Number.isFinite(Number(value.confidenceBasis.usage)) ? Number(value.confidenceBasis.usage) : 0
        }
      : null,
    related: Array.isArray(value.related) ? value.related.map((item) => cleanTaskText(item, 200)).filter(Boolean).slice(0, 30) : [],
    summary: cleanTaskText(value.summary, 2000),
    source: cleanTaskText(value.source, 80),
    project: cleanTaskText(value.project, 300),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    hash: cleanTaskText(value.hash, 64),
    mtimeMs: Number.isFinite(Number(value.mtimeMs)) ? Number(value.mtimeMs) : 0,
    bodyChars: Number.isFinite(Number(value.bodyChars)) ? Math.max(1, Number(value.bodyChars)) : 1,
    headings: Array.isArray(value.headings) ? value.headings.map((item) => cleanTaskText(item, 200)).filter(Boolean).slice(0, 30) : [],
    terms: value.terms && typeof value.terms === 'object' && !Array.isArray(value.terms)
      ? Object.fromEntries(Object.entries(value.terms).slice(0, 5000).map(([term, tf]) => [cleanTaskText(term, 64), Math.max(1, Math.floor(Number(tf) || 1))]))
      : {}
  };
}

function parseFrontmatter(text) {
  const entry = {
    title: '', type: 'note', context: '', result: '', reusable: '', tags: [], confidence: 'medium', status: '', claimType: '', assumptions: [],
    verifiedBy: '', verifiedAt: '', staleness: '', related: [], summary: '', source: '', project: '', created: '', body: String(text || '')
  };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(entry.body);
  if (!match) {
    entry.title = entry.body.split(/\r?\n/)[0].replace(/^#\s*/, '').slice(0, 300);
    return entry;
  }
  entry.body = entry.body.slice(match[0].length);
  const meta = match[1];
  const line = (key) => { const hit = new RegExp('^' + key + ':[ \\t]*(.+)$', 'm').exec(meta); return hit ? hit[1].trim() : ''; };
  entry.title = line('title') || entry.body.split(/\r?\n/)[0].replace(/^#\s*/, '').slice(0, 300);
  entry.type = KNOWLEDGE_TYPES.includes(line('type')) ? line('type') : 'note';
  entry.context = line('context');
  entry.result = line('result');
  entry.reusable = line('reusable');
  entry.confidence = KNOWLEDGE_CONFIDENCES.includes(line('confidence')) ? line('confidence') : 'medium';
  entry.status = KNOWLEDGE_STATUSES.includes(line('status')) ? line('status') : '';
  entry.claimType = KNOWLEDGE_CLAIM_TYPES.includes(line('claimType')) ? line('claimType') : '';
  entry.staleness = KNOWLEDGE_STALENESS.includes(line('staleness')) ? line('staleness') : '';
  entry.verifiedBy = line('verifiedBy');
  entry.verifiedAt = line('verifiedAt');
  const assumptionLines = [];
  const metaLines = String(match[1] || '').split(/\r?\n/);
  for (let i = 0; i < metaLines.length; i += 1) {
    if (!/^assumptions:\s*$/i.test(metaLines[i])) continue;
    for (let j = i + 1; j < metaLines.length; j += 1) {
      const hit = /^\s*-\s+(.+)$/.exec(metaLines[j]);
      if (!hit) break;
      assumptionLines.push(hit[1].trim());
    }
    break;
  }
  entry.assumptions = assumptionLines.slice(0, 10);
  entry.tags = line('tags').replace(/^\[|\]$/g, '').split(/[,\s]+/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
  entry.related = [...line('related').matchAll(/\[\[([^\]]+)\]\]/g)].map((hit) => hit[1].trim().replace(/\.md$/i, '')).filter(Boolean).slice(0, 30);
  entry.summary = line('summary') || entry.body.replace(/\s+/g, ' ').slice(0, 2000);
  entry.source = line('source');
  entry.project = line('project');
  entry.created = line('created');
  return entry;
}

function tokenizeKnowledgeText(text) {
  const tokens = [];
  const lower = String(text || '').toLowerCase();
  for (const match of lower.matchAll(/[a-z0-9][a-z0-9_\-]*/g)) tokens.push(match[0]);
  for (const match of lower.matchAll(/[\u4e00-\u9fa5]+/g)) {
    const run = match[0];
    for (let i = 0; i + 1 < run.length; i += 1) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}

function countKnowledgeTerms(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return Object.fromEntries(counts);
}

function knowledgeEntryHash(content) {
  return createHash('sha1').update(content).digest('hex');
}

function extractKnowledgeHeadings(body) {
  const headings = [];
  for (const match of String(body || '').matchAll(/^(#{1,4})\s+(.+)$/gm)) headings.push(match[0].trim());
  return headings.slice(0, 30);
}

function computeKnowledgeStats(entries) {
  const now = new Date();
  const weekAgo = now.getTime() - 7 * 24 * 3600 * 1000;
  const links = new Set();
  const titleIndex = new Map();
  entries.forEach((entry) => titleIndex.set(entry.title.toLowerCase(), entry));
  let lowConfidence = 0;
  let weekNew = 0;
  for (const entry of entries) {
    for (const rel of entry.related) {
      const target = titleIndex.get(rel.toLowerCase());
      if (target) links.add(entry.path + '\u0000' + target.path);
    }
    if (entry.folder === 'inbox' && entry.confidence === 'low') lowConfidence += 1;
    const created = entry.createdAt ? new Date(entry.createdAt).getTime() : 0;
    if (Number.isFinite(created) && created >= weekAgo) weekNew += 1;
  }
  const trend = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = day.toISOString().slice(0, 10);
    const count = entries.filter((entry) => (entry.createdAt || '').slice(0, 10) === key).length;
    trend.push({ date: key, count });
  }
  return { documents: entries.length, links: links.size, lowConfidence, weekNew, trend };
}

async function readKnowledgeIndex() {
  try {
    const info = await lstat(KNOWLEDGE_INDEX_STORE);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('knowledge index must be a regular non-symbolic file');
    if (info.size > MAX_KNOWLEDGE_INDEX_BYTES) throw new Error('knowledge index exceeds size limit');
    const parsed = JSON.parse(await readFile(KNOWLEDGE_INDEX_STORE, 'utf8'));
    knowledgeIndex = {
      version: 2,
      updatedAt: parsed.updatedAt || '',
      stats: parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : null,
      entries: Array.isArray(parsed.entries) ? parsed.entries.map(cleanKnowledgeEntry) : []
    };
    if (!knowledgeIndex.stats) knowledgeIndex.stats = computeKnowledgeStats(knowledgeIndex.entries);
  } catch (error) {
    if (error && error.code === 'ENOENT') knowledgeIndex = { version: 2, updatedAt: '', stats: computeKnowledgeStats([]), entries: [] };
    else throw error;
  }
  return knowledgeIndex;
}

async function writeKnowledgeIndex(index) {
  await mkdir(DSH_ROOT, { recursive: true });
  const temp = KNOWLEDGE_INDEX_STORE + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, JSON.stringify(index, null, 2) + '\n', 'utf8');
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await rename(temp, KNOWLEDGE_INDEX_STORE); knowledgeIndex = index; return index; }
    catch (error) { lastError = error; if (attempt < 4) await new Promise((resolvePromise) => setTimeout(resolvePromise, 25 * (attempt + 1))); }
  }
  try { await rm(temp, { force: true }); } catch (e) { /* keep temp */ }
  throw lastError;
}

async function ensureKnowledgeVault() {
  await Promise.all(Object.values(KNOWLEDGE_FOLDER_DIRS).map((dir) => mkdir(dir, { recursive: true })));
  const dashboard = join(KNOWLEDGE_ROOT, 'Dashboard.md');
  try { await stat(dashboard); } catch (e) {
    await writeFile(dashboard, [
      '# 知识库看板',
      '',
      '> 由工作台自动维护。最近 7 天新增条目与低置信度条目会出现在这里。',
      '',
      '## 最近新增',
      '',
      '```dataview',
      'TABLE updatedAt, confidence',
      'FROM "02-Atomic" OR "01-Inbox"',
      'SORT updatedAt DESC LIMIT 20',
      '```',
      '',
      '## 待审核（低置信度）',
      '',
      '```dataview',
      'TABLE updatedAt',
      'FROM "01-Inbox"',
      'WHERE confidence = "low"',
      '```',
      ''
    ].join('\n'), 'utf8');
  }
  const readme = join(KNOWLEDGE_ROOT, 'README.md');
  try { await stat(readme); } catch (e) {
    await writeFile(readme, [
      '# 个人知识库（Obsidian Vault）',
      '',
      '> 由工作台知识库模块维护：蒸馏入库 → 人工审核 → 多路检索 → 自生长维护。',
      '',
      '## 目录结构',
      '',
      '- `00-Raw/`：源材料层（对话/文档原文），默认不进检索，蒸馏前可先捕获到这里。',
      '- `01-Inbox/`：AI 写入区，蒸馏产物先进这里，人工确认后再移动。',
      '- `02-Atomic/`：人类审核区，核心资产，检索默认优先。',
      '- `03-MOCs/`：地图索引，由维护器自动更新。',
      '- `04-Projects/`：按项目沉淀的知识。',
      '- `05-Archive/`：遗忘归档层，默认只提示、需授权归档。',
      '- `99-Templates/`：条目模板。',
      '',
      '## 使用建议',
      '',
      '1. 用 Obsidian 打开本目录即可浏览与编辑；图谱视图看知识关联。',
      '2. 每篇文档带 frontmatter：title / type / tags / confidence / status / claimType / staleness / assumptions / related / summary / source / project / verifiedBy / verifiedAt / created。',
      '3. 入库六步：捕获（00-Raw）→ 预检 → 蒸馏 → 验证 → 发布 → 入索引；只有 published 条目参与默认检索。',
      '4. 检索结果强制溯源（文件路径 + 推导置信度 + 依据 + 检索分 + 来源），需要时再到原始文档核对。',
      ''
    ].join('\n'), 'utf8');
  }
  const obsidianDir = join(KNOWLEDGE_ROOT, '.obsidian');
  try { await stat(join(obsidianDir, 'app.json')); } catch (e) {
    await mkdir(obsidianDir, { recursive: true });
    await writeFile(join(obsidianDir, 'app.json'), JSON.stringify({ vault: true, attachmentFolderPath: '_attachments' }, null, 2) + '\n', 'utf8');
  }
  const template = join(KNOWLEDGE_TEMPLATES, '默认条目模板.md');
  try { await stat(template); } catch (e) {
    await writeFile(template, [
      '---',
      'title: 默认条目模板',
      'tags: []',
      'confidence: medium',
      'status: published',
      'claimType: fact',
      'staleness: STABLE',
      'assumptions:',
      '  - 示例假设',
      'related: ""',
      'summary: 新知识条目的默认骨架。',
      'source: 手册',
      'project: ',
      'verifiedBy: ',
      'verifiedAt: ',
      'created: ' + new Date().toISOString(),
      '---',
      '',
      '# 默认条目模板',
      '',
      '## 结论',
      '',
      '## 方法',
      '',
      '## 决策',
      '',
      '## 待办',
      ''
    ].join('\n'), 'utf8');
  }
  const experienceTemplate = join(KNOWLEDGE_TEMPLATES, '项目经验模板.md');
  try { await stat(experienceTemplate); } catch (e) {
    await writeFile(experienceTemplate, [
      '---',
      'title: 项目经验模板',
      'type: experience',
      'tags: [项目经验]',
      'confidence: medium',
      'status: published',
      'claimType: fact',
      'staleness: CHECK',
      'source: 项目复盘',
      'project: ',
      'related: ""',
      'summary: 一句话：在什么项目/条件下，什么方案更优，验证结果是什么。',
      'context: 情境（项目 / 技术栈 / 约束 / 目标）',
      'result: 验证结果（做了什么、结果如何）',
      'reusable: 可复用结论（什么条件下选什么方案更优）',
      'created: ' + new Date().toISOString(),
      '---',
      '',
      '# 项目经验标题',
      '',
      '## 情境',
      '',
      '## 决策',
      '',
      '## 验证',
      '',
      '## 可复用结论',
      '',
      '## 待办',
      ''
    ].join('\n'), 'utf8');
  }
  return KNOWLEDGE_ROOT;
}

async function scanKnowledgeVault() {
  await ensureKnowledgeVault();
  const previous = new Map((knowledgeIndex.entries || []).map((entry) => [entry.path, entry]));
  const entries = [];
  for (const [folder, dir] of Object.entries(KNOWLEDGE_FOLDER_DIRS)) {
    let names = [];
    try { names = await readdir(dir); } catch (e) { continue; }
    for (const name of names.filter((item) => item.toLocaleLowerCase().endsWith('.md'))) {
      const full = join(dir, name);
      try {
        const info = await stat(full);
        if (!info.isFile() || info.size > KNOWLEDGE_MAX_ENTRY_BYTES) continue;
        const content = await readFile(full, 'utf8');
        const hash = knowledgeEntryHash(content);
        const path = folder + '/' + name;
        const old = previous.get(path);
        if (old && old.hash === hash) { entries.push(cleanKnowledgeEntry(old)); continue; }
        const parsed = parseFrontmatter(content);
        const tokens = tokenizeKnowledgeText(parsed.title + '\n' + parsed.summary + '\n' + parsed.tags.join('\n') + '\n' + parsed.body);
        const bodyChars = Math.max(1, parsed.body.length + parsed.summary.length);
        entries.push(cleanKnowledgeEntry({
          path, folder, name,
          title: parsed.title,
          type: parsed.type,
          context: parsed.context,
          result: parsed.result,
          reusable: parsed.reusable,
          tags: parsed.tags,
          confidence: parsed.confidence,
          status: parsed.status,
          claimType: parsed.claimType,
          assumptions: parsed.assumptions,
          verifiedBy: parsed.verifiedBy,
          verifiedAt: parsed.verifiedAt,
          staleness: parsed.staleness,
          related: parsed.related,
          summary: parsed.summary,
          source: parsed.source,
          project: parsed.project,
          createdAt: parsed.created || (old && old.createdAt) || info.mtime.toISOString(),
          updatedAt: info.mtime.toISOString(),
          hash,
          mtimeMs: info.mtimeMs,
          bodyChars,
          headings: extractKnowledgeHeadings(parsed.body),
          terms: countKnowledgeTerms(tokens)
        }));
      } catch (e) { /* skip unreadable */ }
    }
  }
  const quality = await readKnowledgeQuality();
  for (const entry of entries) {
    entry.confidenceBasis = computeKnowledgeConfidenceBasis(entry, quality);
    entry.computedConfidence = entry.confidenceBasis.label;
  }
  entries.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const index = { version: 2, updatedAt: new Date().toISOString(), stats: computeKnowledgeStats(entries), entries };
  await writeKnowledgeIndex(index);
  return index;
}

async function knowledgeIndexStale() {
  try {
    const index = knowledgeIndex;
    if (!index || !index.entries || !index.entries.length) return true;
    const byPath = new Map(index.entries.map((entry) => [entry.path, entry]));
    for (const [folder, dir] of Object.entries(KNOWLEDGE_FOLDER_DIRS)) {
      let names = [];
      try { names = await readdir(dir); } catch (e) { return true; }
      const seen = new Set();
      for (const name of names.filter((item) => item.toLocaleLowerCase().endsWith('.md'))) {
        const path = folder + '/' + name;
        seen.add(path);
        const entry = byPath.get(path);
        let info = null;
        try { info = await stat(join(dir, name)); } catch (e) { return true; }
        if (!entry || entry.mtimeMs !== info.mtimeMs) return true;
      }
      for (const path of byPath.keys()) {
        if (path.startsWith(folder + '/') && !seen.has(path)) return true;
      }
    }
    return false;
  } catch { return true; }
}

function parsePresetYamlSimple(text) {
  const out = { name: '', skills: [] };
  const lines = String(text || '').split(/\r?\n/);
  let inSkills = false;
  for (const line of lines) {
    const nameHit = /^name:\s*(.+)$/.exec(line);
    if (nameHit) out.name = nameHit[1].trim();
    const inlineSkills = /^skills:\s*\[(.*)\]$/.exec(line);
    if (inlineSkills) {
      out.skills = inlineSkills[1].split(/[,，]/).map((item) => item.trim()).filter(Boolean);
      inSkills = false;
      continue;
    }
    if (/^skills:\s*$/.test(line)) { inSkills = true; continue; }
    if (inSkills) {
      const item = /^\s*-\s+(.+)$/.exec(line);
      if (item) out.skills.push(item[1].trim());
      else if (/^\S/.test(line)) inSkills = false;
    }
  }
  return out;
}

async function knowledgeOverview() {
  const index = await scanKnowledgeVault();
  const entries = index.entries || [];
  const pick = (entry) => ({
    path: entry.path,
    name: entry.name,
    title: entry.title,
    type: entry.type,
    context: entry.context,
    result: entry.result,
    reusable: entry.reusable,
    tags: entry.tags,
    confidence: entry.confidence,
    computedConfidence: entry.computedConfidence || entry.confidence,
    confidenceBasis: entry.confidenceBasis,
    status: entry.status,
    staleness: entry.staleness,
    claimType: entry.claimType,
    summary: entry.summary,
    source: entry.source,
    related: entry.related,
    folder: entry.folder,
    updatedAt: entry.updatedAt
  });
  const tagHit = (entry, tags) => entry.tags.some((tag) => tags.includes(String(tag).toLowerCase()));
  const skills = [];
  const experiences = [];
  const projects = [];
  const workflows = [];
  const notes = [];
  for (const entry of entries) {
    if (['raw', 'archive', 'templates'].includes(entry.folder)) continue;
    if (entry.type === 'skill' || tagHit(entry, ['技能', 'skill', 'skills'])) skills.push(entry);
    else if (entry.type === 'experience' || tagHit(entry, ['项目经验', 'experience'])) experiences.push(entry);
    else if (entry.type === 'project' || entry.folder === 'projects' || tagHit(entry, ['项目', 'project'])) projects.push(entry);
    else if (entry.type === 'workflow' || tagHit(entry, ['工作流', 'workflow'])) workflows.push(entry);
    else if (entry.type === 'note' && !['raw', 'archive', 'templates', 'mocs'].includes(entry.folder)) notes.push(entry);
  }
  const grouped = {
    skills: skills.map(pick),
    experiences: experiences.map(pick),
    projects: projects.map(pick),
    workflows: workflows.map(pick),
    notes: notes.map(pick)
  };
  let workspaceProjects = [];
  try {
    workspaceProjects = (workspaceRegistry ? workspaceRegistry.list() : []).map((workspace) => ({
      path: String(workspace.path || ''),
      name: basename(String(workspace.path || '')) || String(workspace.path || ''),
      workspaceId: String(workspace.workspaceId || '')
    }));
  } catch (e) { workspaceProjects = []; }
  let workflowTemplates = [];
  try {
    const templates = await ensureDefaultTemplates();
    workflowTemplates = (templates || []).map((template) => ({ id: template.id, title: template.title, description: template.description }));
  } catch (e) { workflowTemplates = []; }
  let experts = [];
  try {
    await mkdir(PRESET_ROOT, { recursive: true });
    const ids = await readdir(PRESET_ROOT);
    for (const id of ids) {
      const presetDir = join(PRESET_ROOT, id);
      let info = null;
      try { info = await stat(presetDir); } catch (e) { continue; }
      if (!info.isDirectory()) continue;
      const presetFile = join(presetDir, 'preset.yml');
      try {
        const linkInfo = await lstat(presetFile);
        if (linkInfo.isSymbolicLink()) continue;
        const parsed = parsePresetYamlSimple(await readFile(presetFile, 'utf8'));
        experts.push({ id, name: parsed.name || id, skills: parsed.skills.slice(0, 30) });
      } catch (e) { /* skip unreadable preset */ }
    }
  } catch (e) { experts = []; }
  return {
    stats: index.stats,
    ...grouped,
    workspaceProjects,
    workflowTemplates,
    experts,
    folders: KNOWLEDGE_FOLDER_IDS
  };
}

function knowledgeBm25(entries, queryTokens, topK) {
  if (!entries.length || !queryTokens.length) return [];
  const n = entries.length;
  const df = new Map();
  for (const entry of entries) {
    const seen = new Set();
    for (const term of Object.keys(entry.terms || {})) {
      if (!seen.has(term)) { seen.add(term); df.set(term, (df.get(term) || 0) + 1); }
    }
  }
  let avgLen = 0;
  for (const entry of entries) avgLen += entry.bodyChars || 1;
  avgLen = Math.max(1, avgLen / n);
  const k1 = 1.5;
  const b = 0.75;
  const scored = [];
  for (const entry of entries) {
    let score = 0;
    const dl = Math.max(1, entry.bodyChars || 1);
    for (const term of queryTokens) {
      const dfn = df.get(term);
      if (!dfn) continue;
      const tf = (entry.terms || {})[term] || 0;
      if (!tf) continue;
      const idf = Math.log(1 + (n - dfn + 0.5) / (dfn + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgLen)));
    }
    if (score > 0) scored.push({ id: entry.path, score });
  }
  scored.sort((a, b2) => b2.score - a.score);
  return scored.slice(0, topK);
}

function knowledgeGraphNeighbors(entries) {
  const byTitle = new Map();
  const byTag = new Map();
  for (const entry of entries) {
    byTitle.set(entry.title.toLowerCase(), entry);
    for (const tag of entry.tags) {
      const key = tag.toLowerCase();
      if (!byTag.has(key)) byTag.set(key, []);
      byTag.get(key).push(entry);
    }
  }
  const neighborMap = new Map();
  const add = (a, b) => {
    if (!a || !b || a.path === b.path) return;
    if (!neighborMap.has(a.path)) neighborMap.set(a.path, new Set());
    if (!neighborMap.has(b.path)) neighborMap.set(b.path, new Set());
    neighborMap.get(a.path).add(b.path);
    neighborMap.get(b.path).add(a.path);
  };
  for (const entry of entries) {
    for (const rel of entry.related) {
      const target = byTitle.get(rel.toLowerCase());
      if (target) add(entry, target);
    }
    for (const tag of entry.tags) {
      for (const other of byTag.get(tag.toLowerCase()) || []) add(entry, other);
    }
  }
  return neighborMap;
}

function knowledgeGraphSearch(entries, queryTokens, seeds, topK) {
  const neighbors = knowledgeGraphNeighbors(entries);
  const scores = new Map();
  const push = (entry, weight) => { if (entry) scores.set(entry.path, (scores.get(entry.path) || 0) + weight); };
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const seed of seeds || []) {
    const entry = byPath.get(seed);
    if (!entry) continue;
    push(entry, 1);
    const hops = neighbors.get(entry.path) || new Set();
    for (const hop of hops) {
      push(byPath.get(hop), 0.5);
      for (const hop2 of neighbors.get(hop) || new Set()) push(byPath.get(hop2), 0.25);
    }
  }
  for (const entry of entries) {
    const title = entry.title.toLowerCase();
    const hit = queryTokens.some((token) => title.includes(token) || entry.tags.some((tag) => tag.toLowerCase().includes(token)));
    if (hit) push(entry, 0.6);
  }
  const ranked = [...scores.entries()].map(([id, score]) => ({ id, score }));
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, topK);
}

function knowledgeRrf(rankedLists, weights) {
  const scores = new Map();
  rankedLists.forEach((list, index) => {
    if (!list || !list.length) return;
    const weight = (weights && weights[index]) || 1;
    list.forEach((item, rank) => {
      scores.set(item.id, (scores.get(item.id) || 0) + weight / (60 + rank + 1));
    });
  });
  return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

function cleanVectorConfig(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    provider: KNOWLEDGE_VECTOR_PROVIDERS.includes(value.provider) ? value.provider : KNOWLEDGE_DEFAULT_VECTOR_CONFIG.provider,
    model: cleanTaskText(value.model, 120) || (value.provider === 'bge-local' || !value.provider ? KNOWLEDGE_DEFAULT_VECTOR_CONFIG.model : ''),
    apiKey: cleanTaskText(value.apiKey, 500),
    baseUrl: cleanTaskText(value.baseUrl, 500),
    python: cleanTaskText(value.python, 300)
  };
}

function maskVectorConfig(config) {
  const key = config.apiKey;
  return { ...config, apiKey: key ? (key.length > 8 ? key.slice(0, 4) + '…' + key.slice(-4) : '****') : '' };
}

async function readVectorConfig() {
  if (vectorConfigCache) return vectorConfigCache;
  try {
    const info = await lstat(KNOWLEDGE_VECTOR_CONFIG_STORE);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('vector config must be a regular non-symbolic file');
    if (info.size > 1024 * 1024) throw new Error('vector config exceeds size limit');
    vectorConfigCache = cleanVectorConfig(JSON.parse(await readFile(KNOWLEDGE_VECTOR_CONFIG_STORE, 'utf8')));
  } catch (error) {
    if (error && error.code === 'ENOENT') vectorConfigCache = { ...KNOWLEDGE_DEFAULT_VECTOR_CONFIG };
    else throw error;
  }
  return vectorConfigCache;
}

async function writeVectorConfig(config) {
  const cleaned = cleanVectorConfig(config);
  await mkdir(DSH_ROOT, { recursive: true });
  const temp = KNOWLEDGE_VECTOR_CONFIG_STORE + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, JSON.stringify(cleaned, null, 2) + '\n', 'utf8');
  await rename(temp, KNOWLEDGE_VECTOR_CONFIG_STORE);
  vectorConfigCache = cleaned;
  return cleaned;
}

async function readKnowledgeVectors() {
  try {
    const info = await lstat(KNOWLEDGE_VECTOR_STORE);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('vector store must be a regular non-symbolic file');
    if (info.size > MAX_KNOWLEDGE_INDEX_BYTES) throw new Error('vector store exceeds size limit');
    const parsed = JSON.parse(await readFile(KNOWLEDGE_VECTOR_STORE, 'utf8'));
    knowledgeVectors = {
      version: 1,
      updatedAt: parsed.updatedAt || '',
      dims: Number(parsed.dims) || 0,
      vectors: parsed.vectors && typeof parsed.vectors === 'object' ? parsed.vectors : {}
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') knowledgeVectors = { version: 1, updatedAt: '', dims: 0, vectors: {} };
    else throw error;
  }
  return knowledgeVectors;
}

async function writeKnowledgeVectors(store) {
  await mkdir(DSH_ROOT, { recursive: true });
  const temp = KNOWLEDGE_VECTOR_STORE + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, JSON.stringify(store, null, 2) + '\n', 'utf8');
  await rename(temp, KNOWLEDGE_VECTOR_STORE);
  knowledgeVectors = store;
  return store;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function bgeLocalEmbed(config, texts) {
  return new Promise((resolvePromise, rejectPromise) => {
    const python = config.python || (process.platform === 'win32' ? 'python' : 'python3');
    const child = execFile(python, [KNOWLEDGE_EMBED_SCRIPT, '--model', config.model || 'bge-small-zh-v1.5'], {
      cwd: DSH_ROOT,
      timeout: 180000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        rejectPromise(new Error('bge-local embedding failed: ' + String(stderr || error.message).slice(0, 500)));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolvePromise({ dims: Number(parsed.dims) || 0, vectors: Array.isArray(parsed.vectors) ? parsed.vectors : [] });
      } catch (parseError) {
        rejectPromise(new Error('bge-local invalid output: ' + String(stderr || '').slice(0, 300)));
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ texts }));
  });
}

function bgeNodeEmbed(config, texts) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = execFile(process.execPath, [KNOWLEDGE_EMBED_NODE_SCRIPT, '--model', config.model || 'bge-small-zh-v1.5'], {
      cwd: DSH_ROOT,
      timeout: 180000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    }, (error, stdout, stderr) => {
      if (error) {
        rejectPromise(new Error('bge-node embedding failed: ' + String(stderr || error.message).slice(0, 500)));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolvePromise({ dims: Number(parsed.dims) || 0, vectors: Array.isArray(parsed.vectors) ? parsed.vectors : [] });
      } catch (parseError) {
        rejectPromise(new Error('bge-node invalid output: ' + String(stderr || '').slice(0, 300)));
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ texts }));
  });
}

async function embedKnowledgeTexts(config, texts) {
  if (!config || config.provider === 'none' || !texts || !texts.length) return null;
  const clean = texts.map((text) => String(text || '').slice(0, 4000));
  if (config.provider === 'openai') {
    const base = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    if (!config.apiKey) throw new Error('openai embedding requires an api key');
    const response = await fetch(base + '/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.apiKey },
      body: JSON.stringify({ model: config.model || 'text-embedding-3-small', input: clean })
    });
    if (!response.ok) throw new Error('embedding api error ' + response.status + ' ' + String(await response.text()).slice(0, 300));
    const json = await response.json();
    const data = Array.isArray(json && json.data) ? json.data : [];
    return { dims: data.length && Array.isArray(data[0].embedding) ? data[0].embedding.length : 0, vectors: data.map((item) => (Array.isArray(item.embedding) ? item.embedding : [])) };
  }
  if (config.provider === 'custom') {
    if (!config.baseUrl) throw new Error('custom embedding requires a baseUrl');
    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts: clean, model: config.model })
    });
    if (!response.ok) throw new Error('custom embedding error ' + response.status);
    const json = await response.json();
    const data = Array.isArray(json && (json.data || json.vectors)) ? (json.data || json.vectors) : [];
    return {
      dims: data.length ? (Array.isArray(data[0]) ? data[0].length : Array.isArray(data[0].embedding) ? data[0].embedding.length : 0) : 0,
      vectors: data.map((item) => (Array.isArray(item) ? item : Array.isArray(item.embedding) ? item.embedding : []))
    };
  }
  if (config.provider === 'bge-local') return bgeLocalEmbed(config, clean);
  if (config.provider === 'bge-node') return bgeNodeEmbed(config, clean);
  throw new Error('unsupported embedding provider');
}

async function knowledgeVectorSearch(entries, query, topK) {
  const config = await readVectorConfig();
  if (config.provider === 'none') return { ranked: [], status: 'disabled' };
  const vectors = await readKnowledgeVectors();
  if (!Object.keys(vectors.vectors || {}).length) return { ranked: [], status: 'no-vectors' };
  const embedded = await embedKnowledgeTexts(config, [query]);
  if (!embedded || !embedded.vectors || !embedded.vectors.length || !embedded.vectors[0].length) return { ranked: [], status: 'embed-error' };
  const q = embedded.vectors[0];
  const scored = [];
  for (const entry of entries) {
    const vec = vectors.vectors[entry.path];
    if (!vec || !vec.length) continue;
    scored.push({ id: entry.path, score: cosineSimilarity(q, vec) });
  }
  scored.sort((a, b) => b.score - a.score);
  return { ranked: scored.slice(0, topK), status: 'ok', dims: embedded.dims };
}

async function rebuildKnowledgeVectors() {
  const index = await scanKnowledgeVault();
  const config = await readVectorConfig();
  if (config.provider === 'none') return { rebuilt: false, reason: 'disabled' };
  const texts = index.entries.map((entry) => entry.title + '\n' + entry.summary);
  const embedded = await embedKnowledgeTexts(config, texts);
  const vectors = {};
  index.entries.forEach((entry, i) => {
    if (embedded.vectors[i] && embedded.vectors[i].length) vectors[entry.path] = embedded.vectors[i];
  });
  await writeKnowledgeVectors({ version: 1, updatedAt: new Date().toISOString(), dims: embedded.dims, vectors });
  return { rebuilt: true, count: index.entries.length, dims: embedded.dims };
}

async function updateKnowledgeVectorsFor(entries) {
  const config = await readVectorConfig();
  if (config.provider === 'none') return { updated: 0 };
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!list.length) return { updated: 0 };
  const vectors = await readKnowledgeVectors();
  const texts = list.map((entry) => entry.title + '\n' + entry.summary);
  const embedded = await embedKnowledgeTexts(config, texts);
  let updated = 0;
  list.forEach((entry, index) => {
    if (embedded && embedded.vectors[index] && embedded.vectors[index].length) {
      vectors.vectors[entry.path] = embedded.vectors[index];
      updated += 1;
    }
  });
  if (updated) {
    vectors.dims = embedded ? embedded.dims : vectors.dims;
    vectors.updatedAt = new Date().toISOString();
    await writeKnowledgeVectors(vectors);
  }
  return { updated, dims: embedded ? embedded.dims : 0 };
}

async function readKnowledgeProfiles() {
  if (knowledgeProfiles) return knowledgeProfiles;
  try {
    const info = await lstat(KNOWLEDGE_PROFILE_STORE);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('profile store must be a regular non-symbolic file');
    if (info.size > 1024 * 1024) throw new Error('profile store exceeds size limit');
    const parsed = JSON.parse(await readFile(KNOWLEDGE_PROFILE_STORE, 'utf8'));
    knowledgeProfiles = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error && error.code === 'ENOENT') knowledgeProfiles = {};
    else throw error;
  }
  return knowledgeProfiles;
}

async function writeKnowledgeProfiles(profiles) {
  await mkdir(DSH_ROOT, { recursive: true });
  const temp = KNOWLEDGE_PROFILE_STORE + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, JSON.stringify(profiles, null, 2) + '\n', 'utf8');
  await rename(temp, KNOWLEDGE_PROFILE_STORE);
  knowledgeProfiles = profiles;
  return profiles;
}

function mergeKnowledgeProfile(profile, project) {
  const stored = profile && typeof profile === 'object' ? profile : {};
  const base = JSON.parse(JSON.stringify(KNOWLEDGE_DEFAULT_PROFILE));
  return {
    mode: ['auto', 'bm25-graph', 'graph', 'vector', 'hybrid'].includes(stored.mode) ? stored.mode : 'auto',
    routes: { ...base.routes, ...(stored.routes || {}) },
    weights: { ...base.weights, ...(stored.weights || {}) },
    topK: clampInt(stored.topK, 1, KNOWLEDGE_MAX_TOPK, base.topK),
    tokenBudget: clampInt(stored.tokenBudget, 200, KNOWLEDGE_MAX_TOKEN_BUDGET, base.tokenBudget),
    rerank: ['none', 'local', 'llm', 'cross'].includes(stored.rerank) ? stored.rerank : 'none',
    folders: Array.isArray(stored.folders) ? stored.folders.filter((item) => KNOWLEDGE_FOLDER_IDS.includes(item)).slice(0, 5) : [...base.folders],
    projectType: cleanTaskText(stored.projectType || '', 80)
  };
}

async function knowledgeHydeQuery(query) {
  if (chatLlm === null) return '';
  try {
    const text = await streamLlmText(
      '你是检索改写助手。把用户的问题改写成一段适合检索的假设性完美答案（HyDE），只输出改写后的文本，不要解释。',
      '原问题：' + query + '\n\n改写：',
      { maxTokens: 300, temperature: 0.2 }
    );
    return cleanTaskText(text, 1000);
  } catch { return ''; }
}

async function knowledgeLlmRerank(query, candidates, topK) {
  if (!candidates.length || chatLlm === null) return candidates.slice(0, topK);
  try {
    const listText = candidates.map((item, index) => (index + 1) + '. [' + item.path + '] ' + item.title + ' — ' + String(item.summary || '').slice(0, 200)).join('\n');
    const text = await streamLlmText(
      '你是检索重排器。根据问题判断候选相关性，只输出 JSON：{"order":[最相关候选编号在前]}，不要解释。',
      '问题：' + query + '\n\n候选：\n' + listText + '\n\n输出：',
      { maxTokens: 500, temperature: 0.1 }
    );
    const parsed = parseJsonObject(text);
    const order = Array.isArray(parsed.order) ? parsed.order.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= candidates.length) : [];
    const byIndex = new Map(candidates.map((item, index) => [index + 1, item]));
    const ordered = order.map((n) => byIndex.get(n)).filter(Boolean);
    const rest = candidates.filter((item) => !ordered.includes(item));
    return [...ordered, ...rest].slice(0, topK);
  } catch { return candidates.slice(0, topK); }
}

async function knowledgeLocalRerank(query, candidates, topK) {
  const fallback = candidates.slice(0, topK);
  if (candidates.length < 2) return { results: fallback, status: 'skipped' };
  try {
    const config = await readVectorConfig();
    if (!['bge-local', 'bge-node'].includes(config.provider)) {
      return { results: fallback, status: 'disabled', error: 'local BGE provider is not enabled' };
    }
    const texts = [query, ...candidates.map((entry) => [entry.title, entry.summary, entry.snippet].filter(Boolean).join('\n').slice(0, 2000))];
    const embedded = await embedKnowledgeTexts(config, texts);
    const queryVector = embedded && embedded.vectors && embedded.vectors[0];
    if (!queryVector || !queryVector.length) return { results: fallback, status: 'empty', error: 'local reranker returned no query vector' };
    const scored = candidates.map((entry, index) => ({
      entry,
      index,
      score: cosineSimilarity(queryVector, embedded.vectors[index + 1])
    }));
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return { results: scored.slice(0, topK).map((item) => item.entry), status: 'ok' };
  } catch (error) {
    return { results: fallback, status: 'error', error: String((error && error.message) || error).slice(0, 500) };
  }
}

async function knowledgeCrossRerank(query, candidates, topK) {
  const fallback = candidates.slice(0, topK);
  if (candidates.length < 2) return { results: fallback, status: 'skipped' };
  try {
    const texts = candidates.map((entry) => [entry.title, entry.summary, entry.snippet].filter(Boolean).join('\n').slice(0, 2000));
    const output = await new Promise((resolvePromise, rejectPromise) => {
      const child = execFile(process.execPath, [KNOWLEDGE_RERANK_NODE_SCRIPT, '--model', KNOWLEDGE_RERANK_MODEL], {
        cwd: DSH_ROOT,
        timeout: 180000,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      }, (error, stdout, stderr) => {
        if (error) {
          rejectPromise(new Error('cross-encoder rerank failed: ' + String(stderr || error.message).slice(0, 500)));
          return;
        }
        try { resolvePromise(JSON.parse(stdout)); }
        catch (parseError) {
          rejectPromise(new Error('cross-encoder rerank invalid output: ' + String(stderr || '').slice(0, 300)));
        }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify({ query, candidates: texts.map((text) => ({ text })) }));
    });
    const order = Array.isArray(output.order) ? output.order.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < candidates.length) : [];
    const ranked = order.map((index) => candidates[index]).filter(Boolean);
    const rest = candidates.filter((entry) => !ranked.includes(entry));
    return { results: [...ranked, ...rest].slice(0, topK), status: order.length ? 'ok' : 'empty', scores: Array.isArray(output.scores) ? output.scores.slice(0, candidates.length) : [] };
  } catch (error) {
    return { results: fallback, status: 'error', error: String((error && error.message) || error).slice(0, 500) };
  }
}

async function knowledgeSnippet(entry, queryTokens, maxChars = 240) {
  try {
    const file = join(KNOWLEDGE_FOLDER_DIRS[entry.folder], entry.name);
    const text = await readFile(file, 'utf8');
    const body = String(text).replace(/^---[\s\S]*?---\r?\n/, '');
    const lines = body.split(/\r?\n/);
    const headings = [];
    let targetIndex = -1;
    let bestLen = Infinity;
    lines.forEach((line, index) => {
      const heading = /^#{1,4}\s+(.+)$/.exec(line);
      if (heading) headings.push({ index, title: heading[1].trim() });
      for (const token of queryTokens) {
        if (line.toLowerCase().includes(token) && line.length < bestLen) {
          bestLen = line.length;
          targetIndex = index;
        }
      }
    });
    let snippet = '';
    if (targetIndex >= 0) {
      const start = Math.max(0, targetIndex - 1);
      const end = Math.min(lines.length, targetIndex + 3);
      snippet = lines.slice(start, end).join(' ').replace(/\s+/g, ' ').slice(0, maxChars);
    }
    const heading = headings.filter((h) => targetIndex >= h.index).pop();
    return { heading: heading ? heading.title : '', snippet: snippet || String(entry.summary || '').slice(0, maxChars) };
  } catch { return { heading: '', snippet: String(entry.summary || '').slice(0, maxChars) }; }
}

function knowledgeClassifyQuery(query, queryTokens, entries) {
  const relationHits = /关联|关系|区别|差异|依赖|影响|联系|图谱|对比|类似|谁/.test(String(query || ''));
  const multiHopHits = /同时|分别|并且|以及|之间|先.*再|为什么.*如何|比较.*并|从.*到|影响.*原因/.test(String(query || ''));
  const termSet = new Set();
  const knownSet = new Set();
  for (const entry of entries) {
    for (const term of Object.keys(entry.terms || {})) termSet.add(term);
    knownSet.add(String(entry.title || '').toLowerCase());
    for (const tag of entry.tags || []) knownSet.add(String(tag).toLowerCase());
  }
  let covered = 0;
  for (const token of queryTokens) {
    if (termSet.has(token) || knownSet.has(token)) covered += 1;
  }
  const coverage = queryTokens.length ? covered / queryTokens.length : 0;
  const longQuery = queryTokens.length >= 6 || String(query || '').length >= 14;
  let mode = 'hybrid';
  let reason = '';
  let complexity = 'simple';
  if (multiHopHits && !relationHits && queryTokens.length >= 5) {
    mode = 'hybrid';
    complexity = 'complex';
    reason = '包含多跳关系或复合目标，进入迭代检索';
  } else if (relationHits) {
    mode = 'graph';
    complexity = 'complex';
    reason = '关系类提问，优先图谱';
  } else if (coverage >= 0.6 && queryTokens.length <= 10) {
    mode = 'bm25-graph';
    complexity = 'simple';
    reason = '精确术语覆盖 ' + Math.round(coverage * 100) + '%，走关键词+图谱';
  } else if (longQuery && coverage < 0.5) {
    mode = 'vector';
    complexity = 'ambiguous';
    reason = '语义模糊长问题（覆盖 ' + Math.round(coverage * 100) + '%），优先向量';
  } else {
    complexity = longQuery ? 'ambiguous' : 'simple';
    reason = '综合场景，混合多路召回';
  }
  return { mode, complexity, reason, coverage: Math.round(coverage * 1000) / 1000 };
}

async function precheckKnowledgeEntry({ title, content, source, excludePath }) {
  let index = knowledgeIndex;
  if (!index.entries || !index.entries.length) {
    index = await readKnowledgeIndex();
    if (!index.entries || !index.entries.length) index = await scanKnowledgeVault();
  } else if (await knowledgeIndexStale()) {
    index = await scanKnowledgeVault();
  }
  const parsed = parseFrontmatter(String(content || ''));
  const probe = String(title || '') + '\n' + parsed.summary + '\n' + parsed.body + '\n' + String(source || '');
  const keySet = new Set(tokenizeKnowledgeText(probe));
  const similar = [];
  for (const entry of index.entries || []) {
    if (excludePath && entry.path === excludePath) continue;
    const entryTerms = Object.keys(entry.terms || {});
    if (!entryTerms.length) continue;
    let inter = 0;
    for (const term of entryTerms) if (keySet.has(term)) inter += 1;
    const union = keySet.size + entryTerms.length - inter;
    if (union > 0 && inter / union > 0.45) {
      similar.push({ path: entry.path, title: entry.title, similarity: Math.round((inter / union) * 100) / 100 });
    }
  }
  similar.sort((a, b) => b.similarity - a.similarity);
  const byTitle = new Map((index.entries || []).map((entry) => [String(entry.title || '').toLowerCase(), entry]));
  const exactTitle = (() => {
    const hit = byTitle.get(String(title || '').toLowerCase()) || null;
    return hit && !(excludePath && hit.path === excludePath) ? hit : null;
  })();
  const warnings = [];
  if (exactTitle) warnings.push('与已有条目重名：' + exactTitle.path);
  if (!String(source || '').trim()) warnings.push('source 必填（来源），缺失会降低推导置信度');
  if (!String(parsed.summary || '').trim()) warnings.push('缺少 summary 摘要');
  if (String(parsed.body || '').trim().length < 50) warnings.push('正文过短（<50 字），建议补充结论与方法');
  const blocks = [];
  if (exactTitle) blocks.push('存在重名条目：' + exactTitle.path);
  if (similar.some((item) => item.similarity >= 0.8)) blocks.push('存在高相似条目（相似度 ≥0.8），需人工确认是否重复');
  if (!String(source || '').trim()) blocks.push('缺少 source（来源必填）');
  return {
    exactTitle: exactTitle ? { path: exactTitle.path, title: exactTitle.title } : null,
    duplicates: similar.filter((item) => item.similarity >= 0.8).slice(0, 8),
    similar: similar.slice(0, 8),
    warnings: warnings.slice(0, 10),
    blocks: blocks.slice(0, 8),
    ok: blocks.length === 0
  };
}

function knowledgeCoverageSignal(query, results, thresholds = KNOWLEDGE_AUTO_DEFAULT_CONFIG.thresholds) {
  const queryTokens = tokenizeKnowledgeText(query);
  const hits = Array.isArray(results) ? results : [];
  const thresholdInsufficient = Number.isFinite(Number(thresholds && thresholds.insufficient)) ? Number(thresholds.insufficient) : KNOWLEDGE_AUTO_DEFAULT_CONFIG.thresholds.insufficient;
  const thresholdGray = Number.isFinite(Number(thresholds && thresholds.gray)) ? Number(thresholds.gray) : KNOWLEDGE_AUTO_DEFAULT_CONFIG.thresholds.gray;
  if (!hits.length || !queryTokens.length) {
    return { score: 0, maxConfidence: 0, hitCount: 0, lexicalCoverage: 0, level: 'insufficient', action: 'web-primary' };
  }
  const covered = new Set();
  let maxConfidence = 0;
  for (const entry of hits) {
    maxConfidence = Math.max(maxConfidence, knowledgeEntryConfidenceScore(entry));
    const text = [entry.title, entry.summary, entry.snippet, ...(entry.tags || [])].join(' ').toLocaleLowerCase();
    queryTokens.forEach((token) => { if (text.includes(token)) covered.add(token); });
  }
  const lexicalCoverage = covered.size / queryTokens.length;
  const hitFactor = hits.length ? 1 : 0;
  const score = Math.max(0, Math.min(1, maxConfidence * 0.55 + lexicalCoverage * 0.3 + hitFactor * 0.15));
  const requiresFreshEvidence = /最新|今天|现行|实时|价格|政策|新闻|业界|近期|版本更新|刚发布/.test(String(query || ''));
  let level = score < thresholdInsufficient ? 'insufficient' : score < thresholdGray ? 'gray' : 'sufficient';
  if (requiresFreshEvidence && level === 'sufficient') level = 'gray';
  return {
    score: Math.round(score * 1000) / 1000,
    maxConfidence: Math.round(maxConfidence * 1000) / 1000,
    hitCount: hits.length,
    lexicalCoverage: Math.round(lexicalCoverage * 1000) / 1000,
    requiresFreshEvidence,
    level,
    action: level === 'sufficient' ? 'knowledge-only' : level === 'gray' ? 'parallel-kb-web' : 'web-primary'
  };
}

async function runKnowledgeSearchOnce(query, project, options = {}) {
  const q = cleanTaskText(query, KNOWLEDGE_MAX_QUERY_CHARS);
  if (!q) return { error: 'query required' };
  const prevEntries = (knowledgeIndex.entries || []).slice();
  const prevMap = new Map(prevEntries.map((entry) => [entry.path, entry]));
  let index = knowledgeIndex;
  let scanned = false;
  if (!index.entries || !index.entries.length) {
    index = await readKnowledgeIndex();
    if (!index.entries || !index.entries.length) { index = await scanKnowledgeVault(); scanned = true; }
  } else if (await knowledgeIndexStale()) {
    index = await scanKnowledgeVault();
    scanned = true;
  }
  if (scanned && prevEntries.length) {
    const changed = (index.entries || []).filter((entry) => {
      const old = prevMap.get(entry.path);
      return !old || old.hash !== entry.hash || old.status !== entry.status;
    });
    if (changed.length) {
      try {
        const vectorConfig = await readVectorConfig();
        if (vectorConfig.provider !== 'none') await updateKnowledgeVectorsFor(changed);
      } catch (e) { /* vector sync best effort */ }
    }
  }
  const profiles = await readKnowledgeProfiles();
  const profile = mergeKnowledgeProfile(profiles[project || ''], project);
  const folders = new Set(profile.folders);
  const entries = (index.entries || []).filter((entry) => folders.has(entry.folder) && entry.status === 'published');
  const topK = clampInt(options.topK || profile.topK, 1, KNOWLEDGE_MAX_TOPK, profile.topK);
  const tokenBudget = clampInt(options.tokenBudget || profile.tokenBudget, 200, KNOWLEDGE_MAX_TOKEN_BUDGET, profile.tokenBudget);
  const queryTokens = tokenizeKnowledgeText(q);
  const routing = knowledgeClassifyQuery(q, queryTokens, entries);
  const mode = options.mode || (profile.mode === 'auto' ? routing.mode : profile.mode);
  const want = (route) => profile.routes[route] !== false;
  const useBm25 = (mode === 'bm25-graph' || mode === 'hybrid') && want('bm25');
  const useGraph = (mode === 'bm25-graph' || mode === 'graph' || mode === 'hybrid') && want('graph');
  const useVector = (mode === 'vector' || mode === 'hybrid') && want('vector');
  const useHyde = profile.routes.hyde === true && (mode === 'hybrid' || mode === 'vector');
  const rankedLists = [];
  const weights = [];
  const routesUsed = [];
  if (useBm25) {
    rankedLists.push(knowledgeBm25(entries, queryTokens, Math.max(40, topK * 4)));
    weights.push(profile.weights.bm25 || 1);
    routesUsed.push('bm25');
  }
  const seeds = rankedLists.length ? rankedLists[0].map((item) => item.id) : [];
  if (useGraph) {
    rankedLists.push(knowledgeGraphSearch(entries, queryTokens, seeds, Math.max(40, topK * 4)));
    weights.push(profile.weights.graph || 0.7);
    routesUsed.push('graph');
  }
  if (useHyde) {
    const hydeText = await knowledgeHydeQuery(q);
    if (hydeText) {
      rankedLists.push(knowledgeBm25(entries, tokenizeKnowledgeText(hydeText), Math.max(40, topK * 4)));
      weights.push(0.6);
      routesUsed.push('hyde');
    }
  }
  let vector = { ranked: [], status: 'disabled' };
  if (useVector) {
    try {
      vector = await knowledgeVectorSearch(entries, q, Math.max(40, topK * 4));
      if (vector.ranked.length) {
        rankedLists.push(vector.ranked);
        weights.push(profile.weights.vector || 1);
        routesUsed.push('vector');
      }
    } catch (vectorError) {
      vector = { ranked: [], status: 'error', error: String((vectorError && vectorError.message) || vectorError) };
    }
  }
  if (!rankedLists.length) {
    const lexicalFallback = knowledgeBm25(entries, queryTokens, Math.max(40, topK * 4));
    rankedLists.push(lexicalFallback);
    weights.push(profile.weights.bm25 || 1);
    routesUsed.push('bm25-fallback');
    const fallbackSeeds = lexicalFallback.map((item) => item.id);
    rankedLists.push(knowledgeGraphSearch(entries, queryTokens, fallbackSeeds, Math.max(40, topK * 4)));
    weights.push(profile.weights.graph || 0.7);
    routesUsed.push('graph-fallback');
  }
  const fused = rankedLists.length ? knowledgeRrf(rankedLists, weights) : [];
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const scoreMap = new Map(fused.map((item) => [item.id, item.score]));
  const candidates = fused.slice(0, Math.max(topK * 3, 12)).map((item) => byPath.get(item.id)).filter(Boolean);
  let reranked = candidates;
  const rerankMode = ['none', 'local', 'llm', 'cross'].includes(options.rerank) ? options.rerank : profile.rerank;
  let rerankStatus = rerankMode === 'none' ? 'disabled' : 'skipped';
  let rerankError = '';
  if (rerankMode === 'local' && candidates.length > 1) {
    const local = await knowledgeLocalRerank(q, candidates, topK);
    reranked = local.results;
    rerankStatus = local.status;
    rerankError = local.error || '';
    routesUsed.push(local.status === 'ok' ? 'rerank-local' : 'rerank-local-fallback');
  } else if (rerankMode === 'llm' && chatLlm !== null && candidates.length > 1) {
    reranked = await knowledgeLlmRerank(q, candidates, topK);
    rerankStatus = 'ok';
    routesUsed.push('rerank-llm');
  } else if (rerankMode === 'cross' && candidates.length > 1) {
    const cross = await knowledgeCrossRerank(q, candidates, topK);
    reranked = cross.results;
    rerankStatus = cross.status;
    rerankError = cross.error || '';
    routesUsed.push(cross.status === 'ok' ? 'rerank-cross' : 'rerank-cross-fallback');
  } else {
    reranked = candidates.slice(0, topK);
  }
  const results = [];
  let estimatedTokens = 0;
  for (const entry of reranked) {
    if (results.length >= topK) break;
    const { heading, snippet } = await knowledgeSnippet(entry, queryTokens);
    const text = entry.title + '\n' + (heading ? '# ' + heading + '\n' : '') + snippet;
    const tokens = Math.max(1, Math.ceil(text.length / 2.5));
    if (estimatedTokens + tokens > tokenBudget && results.length >= 1) break;
    estimatedTokens += tokens;
    results.push({
      path: entry.path,
      folder: entry.folder,
      title: entry.title,
      tags: entry.tags,
      related: entry.related,
      confidence: entry.confidence,
      computedConfidence: entry.computedConfidence || entry.confidenceBasis && entry.confidenceBasis.label || entry.confidence,
      confidenceBasis: entry.confidenceBasis,
      status: entry.status,
      claimType: entry.claimType,
      staleness: entry.staleness,
      verifiedBy: entry.verifiedBy,
      verifiedAt: entry.verifiedAt,
      assumptions: entry.assumptions,
      retrievalScore: Math.round((scoreMap.get(entry.path) || 0) * 1000) / 1000,
      summary: entry.summary,
      heading,
      snippet,
      updatedAt: entry.updatedAt,
      project: entry.project,
      source: entry.source
    });
  }
  const coverage = knowledgeCoverageSignal(q, results, options.thresholds);
  const selfCheck = { caution: false, reasons: [] };
  if (vector.status === 'error') {
    selfCheck.caution = true;
    selfCheck.reasons.push('向量路异常：' + String(vector.error || '未知错误'));
  }
  if (!results.length) {
    selfCheck.caution = true;
    selfCheck.reasons.push('无召回结果，已自动记入评测候选池');
  } else if (results[0].computedConfidence === 'low') {
    selfCheck.caution = true;
    selfCheck.reasons.push('最高分结果推导置信度为低，建议人工核对');
  }
  if (results.length) recordKnowledgeUsage(results.map((item) => item.path)).catch(() => {});
  return {
    query: q,
    project: project || '',
    profile,
    routing,
    mode,
    topK,
    tokenBudget,
    routes: routesUsed,
    vectorStatus: vector.status || 'n/a',
    vectorError: vector.error || '',
    rerankMode,
    rerankStatus,
    rerankError,
    estimatedTokens,
    coverage,
    selfCheck,
    results
  };
}

async function runKnowledgeSearch(query, project, options = {}) {
  const startedAt = Date.now();
  const q = cleanTaskText(query, KNOWLEDGE_MAX_QUERY_CHARS);
  if (!q) return { error: 'query required' };
  const routingMode = ['auto', 'force-hybrid', 'force-iterative'].includes(options.routingMode) ? options.routingMode : 'auto';
  const maxIterations = clampInt(options.maxIterations, 1, 2, 2);
  const first = await runKnowledgeSearchOnce(q, project, {
    ...options,
    mode: routingMode === 'force-hybrid' ? 'hybrid' : options.mode,
    thresholds: options.thresholds
  });
  if (first.error) return first;
  const iterationReason = routingMode === 'force-iterative'
    ? 'forced'
    : first.routing && first.routing.complexity === 'complex'
      ? 'complex-query'
      : first.coverage && first.coverage.level === 'insufficient'
        ? 'insufficient-coverage'
        : '';
  const shouldIterate = routingMode === 'force-iterative' || (routingMode === 'auto' && !!iterationReason);
  if (!shouldIterate || maxIterations <= 1) {
    return { ...first, iterations: 1, retrievalTokens: first.estimatedTokens || 0, latencyMs: Date.now() - startedAt, firstCoverage: first.coverage, routing: { ...first.routing, strategy: shouldIterate ? 'iterative-disabled-by-limit' : 'single-pass', iterationReason } };
  }

  const allResults = [...(first.results || [])];
  const iterationQueries = [q];
  let totalTokens = first.estimatedTokens || 0;
  let last = first;
  for (let round = 1; round < maxIterations; round += 1) {
    const hints = allResults.slice(0, 3).map((entry) => entry.title).filter(Boolean).join(' ');
    const nextQuery = hints ? q + ' ' + hints : q;
    iterationQueries.push(nextQuery);
    last = await runKnowledgeSearchOnce(nextQuery, project, {
      ...options,
      mode: options.mode || 'hybrid',
      routingMode: 'force-hybrid',
      thresholds: options.thresholds
    });
    totalTokens += last.estimatedTokens || 0;
    for (const entry of last.results || []) {
      const existing = allResults.find((item) => item.path === entry.path);
      if (!existing || Number(entry.retrievalScore || 0) > Number(existing.retrievalScore || 0)) {
        if (existing) allResults[allResults.indexOf(existing)] = entry;
        else allResults.push(entry);
      }
    }
    const coverage = knowledgeCoverageSignal(q, allResults, options.thresholds);
    if (coverage.level === 'sufficient') break;
  }
  allResults.sort((a, b) => Number(b.retrievalScore || 0) - Number(a.retrievalScore || 0));
  const bounded = [];
  let boundedTokens = 0;
  for (const entry of allResults) {
    if (bounded.length >= first.topK) break;
    const tokens = Math.max(1, Math.ceil((String(entry.title || '') + String(entry.summary || '') + String(entry.snippet || '')).length / 2.5));
    if (bounded.length && boundedTokens + tokens > first.tokenBudget) break;
    bounded.push(entry);
    boundedTokens += tokens;
  }
  return {
    ...first,
    mode: 'iterative',
    routes: [...new Set([...(first.routes || []), ...(last.routes || []), 'iterative'])],
    iterations: iterationQueries.length,
    iterationQueries,
    estimatedTokens: boundedTokens,
    retrievalTokens: totalTokens,
    latencyMs: Date.now() - startedAt,
    firstCoverage: first.coverage,
    coverage: knowledgeCoverageSignal(q, bounded, options.thresholds),
    routing: { ...first.routing, strategy: 'iterative', iterationReason },
    selfCheck: last.selfCheck,
    results: bounded
  };
}

function cleanKnowledgeAutoConfig(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const base = JSON.parse(JSON.stringify(KNOWLEDGE_AUTO_DEFAULT_CONFIG));
  const thresholds = value.thresholds && typeof value.thresholds === 'object' ? value.thresholds : {};
  const insufficientThreshold = Math.max(0, Math.min(1, Number.isFinite(Number(thresholds.insufficient)) ? Number(thresholds.insufficient) : base.thresholds.insufficient));
  const grayThreshold = Math.max(insufficientThreshold, Math.min(1, Number.isFinite(Number(thresholds.gray)) ? Number(thresholds.gray) : base.thresholds.gray));
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : base.enabled,
    gate: ['rule', 'model', 'both'].includes(value.gate) ? value.gate : base.gate,
    routing: ['auto', 'force-hybrid', 'force-iterative'].includes(value.routing) ? value.routing : base.routing,
    maxIterations: clampInt(value.maxIterations, 1, 2, base.maxIterations),
    rerank: ['none', 'local', 'llm', 'cross'].includes(value.rerank) ? value.rerank : base.rerank,
    topK: clampInt(value.topK, 1, KNOWLEDGE_MAX_TOPK, base.topK),
    tokenBudget: clampInt(value.tokenBudget, 200, KNOWLEDGE_MAX_TOKEN_BUDGET, base.tokenBudget),
    minConfidence: KNOWLEDGE_CONFIDENCES.includes(value.minConfidence) ? value.minConfidence : base.minConfidence,
    maxRefs: clampInt(value.maxRefs, 1, 5, base.maxRefs),
    cacheTtlMs: Number.isFinite(Number(value.cacheTtlMs)) && Number(value.cacheTtlMs) >= 0 ? Math.min(Number(value.cacheTtlMs), 60 * 60 * 1000) : base.cacheTtlMs,
    webFallback: typeof value.webFallback === 'boolean' ? value.webFallback : base.webFallback,
    thresholds: {
      insufficient: insufficientThreshold,
      gray: grayThreshold
    },
    auditLevel: value.auditLevel === 'ref+groundedness' ? 'ref+groundedness' : base.auditLevel
  };
}

async function readKnowledgeAutoConfig() {
  try {
    const info = await lstat(KNOWLEDGE_AUTO_STORE);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('auto config store must be a regular file');
    if (info.size > 256 * 1024) throw new Error('auto config store too large');
    const parsed = JSON.parse(await readFile(KNOWLEDGE_AUTO_STORE, 'utf8'));
    return cleanKnowledgeAutoConfig(parsed);
  } catch {
    return cleanKnowledgeAutoConfig({});
  }
}

async function writeKnowledgeAutoConfig(config) {
  await mkdir(DSH_ROOT, { recursive: true });
  const temp = KNOWLEDGE_AUTO_STORE + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, JSON.stringify(cleanKnowledgeAutoConfig(config), null, 2) + '\n', 'utf8');
  await rename(temp, KNOWLEDGE_AUTO_STORE);
  return cleanKnowledgeAutoConfig(config);
}

function knowledgeEntryConfidenceScore(entry) {
  if (entry && Number.isFinite(Number(entry.confidenceBasis && entry.confidenceBasis.score))) {
    return Number(entry.confidenceBasis.score);
  }
  const label = (entry && (entry.computedConfidence || entry.confidence)) || 'medium';
  return KNOWLEDGE_CONFIDENCE_SCORE[label] || KNOWLEDGE_CONFIDENCE_SCORE.medium;
}

function knowledgeEntryConfidenceRank(entry) {
  const label = (entry && (entry.computedConfidence || entry.confidence)) || 'medium';
  return { high: 2, medium: 1, low: 0 }[label] ?? 1;
}

function knowledgeAutoGate(query) {
  const q = cleanTaskText(query, KNOWLEDGE_MAX_QUERY_CHARS);
  if (q.length < 4) return { should: false, hardSkip: true, reason: '输入过短，无需检索' };
  if (KNOWLEDGE_AUTO_SKIP.test(q)) return { should: false, hardSkip: true, reason: '寒暄/确认类消息，无需检索' };
  if (KNOWLEDGE_AUTO_TRIGGER.test(q)) return { should: true, hardSkip: false, reason: '知识型提问，触发检索' };
  if (q.length >= 20) return { should: true, hardSkip: false, reason: '长任务描述，可能受益于知识库' };
  return { should: false, hardSkip: false, reason: '无知识型意图，不消耗 token' };
}

async function knowledgeModelGate(query) {
  if (chatLlm === null) return null;
  try {
    const text = await streamLlmText(
      '你是知识库调用门控器。判断用户消息是否需要检索个人知识库。只输出 JSON：{"shouldRetrieve":true|false,"reason":"简短原因"}。寒暄、确认、纯创作和不依赖既有资料的请求返回 false。',
      '用户消息：\n' + cleanTaskText(query, KNOWLEDGE_MAX_QUERY_CHARS) + '\n\n输出：',
      { maxTokens: 80, temperature: 0 }
    );
    const parsed = parseJsonObject(text);
    if (typeof parsed.shouldRetrieve !== 'boolean') return null;
    return { should: parsed.shouldRetrieve, reason: cleanTaskText(parsed.reason, 120) || '模型门控判断' };
  } catch { return null; }
}

function knowledgeAutoBuildBlock(refs, meta, config) {
  const lines = [];
  lines.push('[知识库参考 · 自动检索]');
  if (meta) {
    const routeText = (meta.routes || []).join(' + ') || 'n/a';
    const coverage = meta.coverage;
    const coverageText = coverage ? ' · 覆盖 ' + coverage.level + '（' + coverage.score + '，' + coverage.action + '）' : '';
    lines.push('检索：' + (meta.mode || 'n/a') + '（' + routeText + '）· 向量 ' + (meta.vectorStatus || 'n/a') + ' · ' + (meta.iterations || 1) + ' 轮 · ' + (meta.latencyMs || 0) + 'ms' + coverageText + ' · ' + (refs.length ? '命中 ' + refs.length + ' 条 · 注入约 ' + (meta.estimatedTokens || 0) + ' tokens' : '未命中高置信度条目'));
  }
  if (refs.length) {
    for (const ref of refs) {
      const snippet = String(ref.snippet || ref.summary || '').replace(/\s+/g, ' ').slice(0, 160);
      lines.push('');
      lines.push('[' + ref.id + '] 《' + ref.title + '》（置信度 ' + (ref.confidence || 'medium') + '）');
      if (snippet) lines.push('摘要：' + snippet);
      lines.push('路径：' + ref.path);
    }
    lines.push('');
    lines.push('使用规则：');
    const coverageAction = meta && meta.coverage ? meta.coverage.action : '';
    if (config && config.webFallback && coverageAction === 'parallel-kb-web') {
      lines.push('- 覆盖处于灰区：并行调用 web_search 补充证据，再与知识库结果融合；冲突时并列说明。');
    } else if (config && config.webFallback && coverageAction === 'web-primary') {
      lines.push('- 覆盖不足：以 web_search 为主要证据源，知识库仅作旁证；无法核实的内容标注“未验证”。');
    } else {
      lines.push('- 覆盖充分：优先使用本次知识库证据；仅当问题明确要求最新信息时再联网。');
    }
    lines.push('- 引用规则：引用知识库内容时标注 [知识N《标题》· 置信度 X]（如 [知识1《工作台-看门狗机制》· 置信度中]）；引用联网内容时标注来源 URL；不得只给结论不给出处。');
    lines.push('- 可信度区分：知识库与联网信息冲突或都不充分时，说明差异；无法确认的内容一律标注“未验证”，不得编造。');
  } else if (config && config.webFallback) {
    lines.push('');
    lines.push('知识库未找到高置信度匹配。若问题涉及事实、经验或最新信息，请调用 web_search 联网核实并标注来源 URL；无法联网时标注“未验证”。');
  }
  return lines.join('\n');
}

const knowledgeAutoCache = new Map();
const knowledgeAutoLastBySession = new Map();
const knowledgeChatContext = new Map();
let knowledgeStatsCache = null;
let knowledgeStatsQueue = Promise.resolve();

async function readKnowledgeStats() {
  if (knowledgeStatsCache) return knowledgeStatsCache;
  try {
    const info = await lstat(KNOWLEDGE_STATS_STORE);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('knowledge stats store must be a regular file');
    if (info.size > MAX_KNOWLEDGE_STATS_BYTES) throw new Error('knowledge stats store too large');
    const parsed = JSON.parse(await readFile(KNOWLEDGE_STATS_STORE, 'utf8'));
    knowledgeStatsCache = {
      version: 1,
      autoRetrievals: Math.max(0, Number(parsed.autoRetrievals) || 0),
      cacheHits: Math.max(0, Number(parsed.cacheHits) || 0),
      cacheMisses: Math.max(0, Number(parsed.cacheMisses) || 0),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : ''
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') knowledgeStatsCache = { version: 1, autoRetrievals: 0, cacheHits: 0, cacheMisses: 0, updatedAt: '' };
    else throw error;
  }
  return knowledgeStatsCache;
}

async function writeKnowledgeStats(stats) {
  await mkdir(DSH_ROOT, { recursive: true });
  const temp = KNOWLEDGE_STATS_STORE + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, JSON.stringify(stats, null, 2) + '\n', 'utf8');
  await rename(temp, KNOWLEDGE_STATS_STORE);
  knowledgeStatsCache = stats;
  return stats;
}

async function bumpKnowledgeStats(delta = {}) {
  const operation = knowledgeStatsQueue.then(async () => {
    const stats = await readKnowledgeStats();
    stats.autoRetrievals += Math.max(0, Number(delta.autoRetrievals) || 0);
    stats.cacheHits += Math.max(0, Number(delta.cacheHits) || 0);
    stats.cacheMisses += Math.max(0, Number(delta.cacheMisses) || 0);
    stats.updatedAt = new Date().toISOString();
    await writeKnowledgeStats(stats);
    return stats;
  });
  knowledgeStatsQueue = operation.catch(() => {});
  return operation;
}

async function knowledgeRuntimeStats() {
  const stats = await readKnowledgeStats();
  let knowledgeCalls = 0;
  let webCalls = 0;
  try {
    const store = await readKnowledgeTraceStore();
    for (const trace of store.traces) {
      if (trace.tool === 'knowledge_search' || trace.tool === 'knowledge_read') knowledgeCalls += 1;
      else if (trace.tool === 'web_search' || trace.tool === 'web_fetch') webCalls += 1;
    }
  } catch { /* best-effort */ }
  return {
    autoRetrievals: stats.autoRetrievals,
    cacheHits: stats.cacheHits,
    cacheMisses: stats.cacheMisses,
    cacheHitRate: stats.autoRetrievals > 0 ? Math.round(stats.cacheHits / stats.autoRetrievals * 1000) / 1000 : null,
    realKnowledgeCalls: knowledgeCalls,
    realWebCalls: webCalls
  };
}

function rememberKnowledgeChatContext(sessionId, result) {
  const key = String(sessionId || '');
  if (!key) return;
  const now = Date.now();
  for (const [id, entry] of knowledgeChatContext) {
    if (now - entry.at > KNOWLEDGE_CHAT_CONTEXT_TTL_MS) knowledgeChatContext.delete(id);
  }
  if (result && result.inject && result.block) {
    knowledgeChatContext.set(key, { at: now, block: result.block, refs: (result.refs || []).length });
  } else {
    knowledgeChatContext.delete(key);
  }
}

function knowledgeChatContextSectionText(context) {
  const id = context && context.agent && context.agent.id ? String(context.agent.id) : '';
  if (!id) return '';
  const entry = knowledgeChatContext.get(id);
  if (!entry || Date.now() - entry.at > KNOWLEDGE_CHAT_CONTEXT_TTL_MS) return '';
  return entry.block;
}

function knowledgeAutoCacheKey(sessionId, query) {
  return String(sessionId || 'global') + '\u0000' + cleanTaskText(query, KNOWLEDGE_MAX_QUERY_CHARS).toLocaleLowerCase();
}

async function knowledgeAutoRetrieve(query, sessionId, project, options = {}) {
  const q = cleanTaskText(query, KNOWLEDGE_MAX_QUERY_CHARS);
  const config = cleanKnowledgeAutoConfig(options.config || await readKnowledgeAutoConfig());
  if (!config.enabled) return { inject: false, reason: 'disabled', gated: false, block: '', refs: [], meta: null };
  const now = Date.now();
  const cacheKey = knowledgeAutoCacheKey(sessionId, q);
  const cached = knowledgeAutoCache.get(cacheKey);
  if (cached && now - cached.at < config.cacheTtlMs) {
    await bumpKnowledgeStats({ autoRetrievals: 1, cacheHits: 1 }).catch(() => {});
    return { ...cached.result, reused: true, cachedAt: cached.at };
  }
  const last = knowledgeAutoLastBySession.get(String(sessionId || 'global'));
  if (q.length <= 14 && KNOWLEDGE_AUTO_FOLLOWUP.test(q) && last && now - last.at < config.cacheTtlMs) {
    const reuse = { ...last.result, reused: true, followupReuse: true, reason: '追问复用上次检索结果' };
    await bumpKnowledgeStats({ autoRetrievals: 1, cacheHits: 1 }).catch(() => {});
    return reuse;
  }
  const ruleGate = knowledgeAutoGate(q);
  if (ruleGate.hardSkip) {
    return { inject: false, reason: ruleGate.reason, gated: true, gate: 'rule', block: '', refs: [], meta: null };
  }
  let gate = ruleGate;
  if (config.gate === 'model' || config.gate === 'both') {
    const modelGate = await knowledgeModelGate(q);
    if (modelGate) gate = { ...modelGate, source: 'model' };
  }
  if (!gate.should) {
    return { inject: false, reason: gate.reason, gated: true, gate: gate.source || 'rule', block: '', refs: [], meta: null };
  }
  const search = await runKnowledgeSearch(q, project, {
    topK: Math.max(config.topK, 5),
    tokenBudget: config.tokenBudget,
    rerank: config.rerank,
    routingMode: config.routing,
    maxIterations: config.maxIterations,
    thresholds: config.thresholds
  });
  await bumpKnowledgeStats({ autoRetrievals: 1, cacheMisses: 1 }).catch(() => {});
  const minRank = { high: 2, medium: 1, low: 0 }[config.minConfidence] ?? 1;
  const refs = (search.results || []).filter((entry) => knowledgeEntryConfidenceRank(entry) >= minRank).slice(0, config.maxRefs).map((entry, index) => ({
    id: '知识' + (index + 1),
    title: entry.title,
    path: entry.path,
    confidence: entry.computedConfidence || entry.confidence || 'medium',
    snippet: entry.summary || entry.snippet || ''
  }));
  const meta = {
    mode: search.mode || '',
    routes: search.routes || [],
    vectorStatus: search.vectorStatus || 'n/a',
    estimatedTokens: (search.estimatedTokens || 0) + 120,
    retrievalTokens: search.retrievalTokens || search.estimatedTokens || 0,
    latencyMs: search.latencyMs || 0,
    query: q,
    coverage: search.coverage || null,
    iterations: search.iterations || 1,
    at: new Date().toISOString()
  };
  const block = knowledgeAutoBuildBlock(refs, meta, config);
  const shouldInject = refs.length > 0 || config.webFallback;
  const result = { inject: shouldInject, reason: refs.length ? 'knowledge-query' : 'knowledge-miss', gated: false, gate: gate.source || config.gate, block: shouldInject ? block : '', refs, meta };
  knowledgeAutoCache.set(cacheKey, { at: now, result });
  knowledgeAutoLastBySession.set(String(sessionId || 'global'), { at: now, result });
  if (knowledgeAutoCache.size > 200) {
    const firstKey = knowledgeAutoCache.keys().next().value;
    if (firstKey) knowledgeAutoCache.delete(firstKey);
  }
  return result;
}

function cleanKnowledgeRef(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    id: cleanTaskText(value.id, 40) || '知识1',
    title: cleanTaskText(value.title, 300),
    path: cleanTaskText(value.path, 500),
    confidence: KNOWLEDGE_CONFIDENCES.includes(value.confidence) ? value.confidence : 'medium',
    snippet: cleanTaskText(value.snippet, 1000)
  };
}

function auditKnowledgeCitations(answer, refs, level = 'ref-only') {
  const text = String(answer || '').trim();
  const references = Array.isArray(refs) ? refs.map(cleanKnowledgeRef).filter((entry) => entry.title) : [];
  const byId = new Map(references.map((entry) => [entry.id, entry]));
  const citations = [];
  const invalid = [];
  const citationPattern = /\[知识\s*(\d+)(?:《([^》]+)》)?[^\]]*\]/g;
  let match;
  while ((match = citationPattern.exec(text))) {
    const id = '知识' + match[1];
    const ref = byId.get(id);
    const citedTitle = cleanTaskText(match[2], 300);
    if (!ref || (citedTitle && citedTitle !== ref.title)) {
      invalid.push({ id, title: citedTitle, reason: ref ? '标题与本次注入条目不一致' : '引用编号不存在于本次注入上下文' });
    } else {
      citations.push({ id, title: ref.title, index: match.index });
    }
  }
  const sentences = text.split(/[。！？!?\n]+/).map((item) => item.trim()).filter(Boolean);
  const groundedness = level === 'ref+groundedness' && references.length > 0
    ? sentences.filter((sentence) => /是|为|应|可以|需要|建议|因此|导致|说明|支持|选择|采用|必须/.test(sentence) && !/\[知识\s*\d+[^\]]*\]/.test(sentence)).map((sentence) => ({ sentence, reason: '结论句未发现知识库引用' })).slice(0, 20)
    : [];
  citationPattern.lastIndex = 0;
  const missing = references.length > 0 && text.length > 0 && citations.length === 0;
  return {
    level,
    valid: !missing && invalid.length === 0 && groundedness.length === 0,
    citationCount: citations.length,
    citations,
    invalid,
    missing: missing ? ['回答没有包含有效的 [知识N] 引用'] : [],
    groundedness,
    abstainRequired: missing || invalid.length > 0 || groundedness.length > 0,
    checkedAt: new Date().toISOString()
  };
}

function splitAnswerSentences(text) {
  const parts = String(text || '').split(/([。！？!?\n]+)/);
  const raw = [];
  for (let index = 0; index < parts.length; index += 2) {
    const sentence = ((parts[index] || '') + (parts[index + 1] || '')).trim();
    if (sentence) raw.push(sentence);
  }
  const sentences = [];
  for (const sentence of raw) {
    if (/^\[知识\s*\d+[^\]]*\]$/.test(sentence) && sentences.length) {
      sentences[sentences.length - 1] += ' ' + sentence;
    } else {
      sentences.push(sentence);
    }
  }
  return sentences;
}

function knowledgeTextTokens(text) {
  const normalized = String(text || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  if (!normalized) return new Set();
  const chars = [...normalized];
  const tokens = new Set(chars);
  for (let index = 0; index < chars.length - 1; index += 1) tokens.add(chars[index] + chars[index + 1]);
  return tokens;
}

function knowledgeTokenOverlap(left, right) {
  const setA = knowledgeTextTokens(left);
  const setB = knowledgeTextTokens(right);
  if (!setA.size || !setB.size) return 0;
  let hit = 0;
  for (const token of setA) if (setB.has(token)) hit += 1;
  return (2 * hit) / (setA.size + setB.size);
}

function knowledgeTokenContainment(sentence, snippet) {
  const setA = knowledgeTextTokens(sentence);
  const setB = knowledgeTextTokens(snippet);
  if (!setA.size) return 0;
  let hit = 0;
  for (const token of setA) if (setB.has(token)) hit += 1;
  return hit / setA.size;
}

function knowledgeEvidenceScore(sentence, snippet, embeddingScore) {
  const overlap = knowledgeTokenOverlap(sentence, snippet);
  const containment = knowledgeTokenContainment(sentence, snippet);
  const ruleScore = Math.min(1, overlap * 0.7 + containment * 0.3);
  const score = typeof embeddingScore === 'number' && Number.isFinite(embeddingScore)
    ? Math.min(1, Math.max(ruleScore, embeddingScore))
    : ruleScore;
  return Math.round(score * 1000) / 1000;
}

function knowledgeClaimSentence(sentence) {
  const text = String(sentence || '').trim();
  if (text.length < KNOWLEDGE_GROUNDEDNESS_MIN_CLAIM_CHARS) return false;
  if (/[？?]$/.test(text) || /^[#>*\-\s\d.]+$/.test(text)) return false;
  if (/[:：]$/.test(text)) return false;
  if (/^(来源[:：]|参考资料[:：]|\[来源)/.test(text)) return false;
  return KNOWLEDGE_GROUNDEDNESS_CLAIM_RE.test(text) || /[\d０-９]+([.．%％点次个条项倍]|$)/.test(text);
}

function knowledgeCitationIdsIn(sentence) {
  const ids = [];
  const pattern = /\[知识\s*(\d+)[^\]]*\]/g;
  let match;
  while ((match = pattern.exec(sentence))) ids.push('知识' + match[1]);
  return ids;
}

async function knowledgeAdjudicateWeak(check) {
  if (chatLlm === null || !check || check.verdict !== 'weak') return check;
  const ref = check.suggestedRef;
  const evidence = ref ? ref.id + '《' + ref.title + '》 ' + String(ref.snippet || '') : '无';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const text = await streamLlmText(
        '你是引用证据判定器。判断结论句是否被给定知识条目内容直接支持。只输出 JSON：{"supported":true|false,"reason":"简短原因"}。只要条目内容能支撑该结论（含合理推断）就算 true；条目完全没有相关信息才算 false。',
        '结论句：' + check.sentence + '\n\n知识条目：\n' + evidence + '\n\n输出：',
        { maxTokens: 256, temperature: 0 }
      );
      const parsed = parseJsonObject(text);
      if (parsed && typeof parsed.supported === 'boolean') {
        if (parsed.supported) {
          return { ...check, verdict: 'grounded', reason: '', adjudicated: true, adjudicationReason: cleanTaskText(parsed.reason, 200) };
        }
        return { ...check, verdict: 'unsupported', reason: '证据判定器认为该结论不被引用条目支持', adjudicated: true, adjudicationReason: cleanTaskText(parsed.reason, 200) };
      }
      if (attempt === 0 && !String(text || '').trim()) continue;
      break;
    } catch (error) {
      if (attempt === 0) {
        diag('knowledge groundedness adjudication failed (retry): ' + String((error && error.message) || error));
        continue;
      }
      diag('knowledge groundedness adjudication failed: ' + String((error && error.message) || error));
    }
  }
  return check;
}

async function auditKnowledgeGroundedness(answer, refs, options = {}) {
  const references = Array.isArray(refs) ? refs.map(cleanKnowledgeRef).filter((entry) => entry.title) : [];
  const byId = new Map(references.map((entry) => [entry.id, entry]));
  const sentences = splitAnswerSentences(answer);
  const claims = sentences.filter(knowledgeClaimSentence);
  const config = await readVectorConfig();
  let vectors = null;
  let method = 'rule';
  if (claims.length && references.length && config && ['bge-local', 'bge-node', 'openai', 'custom'].includes(config.provider)) {
    try {
      const texts = [
        ...claims.map((sentence) => String(sentence).replace(/\[知识\s*\d+[^\]]*\]/g, '').slice(0, 4000)),
        ...references.map((entry) => [entry.title, entry.snippet].filter(Boolean).join('\n').slice(0, 4000))
      ];
      const embedded = await embedKnowledgeTexts(config, texts);
      if (embedded && Array.isArray(embedded.vectors) && embedded.vectors.length === texts.length) {
        vectors = embedded.vectors;
        method = 'hybrid';
      }
    } catch (error) {
      diag('knowledge groundedness embedding failed: ' + String((error && error.message) || error));
    }
  }
  const checks = [];
  for (let index = 0; index < claims.length; index += 1) {
    const sentence = claims[index];
    const citedIds = knowledgeCitationIdsIn(sentence);
    const cleaned = String(sentence).replace(/\[知识\s*\d+[^\]]*\]/g, '').trim();
    const citedRefs = citedIds.map((id) => byId.get(id)).filter(Boolean);
    let best = { score: 0, ref: null, embeddingScore: null };
    references.forEach((ref, refIndex) => {
      const embeddingScore = vectors ? cosineSimilarity(vectors[index], vectors[claims.length + refIndex]) : null;
      const score = knowledgeEvidenceScore(cleaned, ref.snippet || ref.title || '', embeddingScore);
      if (score > best.score) best = { score, ref, embeddingScore };
    });
    let verdict = 'unsupported';
    let reason = '结论句与引用的知识条目证据内容不匹配';
    if (best.score >= KNOWLEDGE_GROUNDEDNESS_THRESHOLD) {
      if (citedRefs.some((ref) => ref.id === best.ref.id)) {
        verdict = 'grounded';
        reason = '';
      } else if (citedRefs.length) {
        verdict = 'weak';
        reason = '结论句引用的条目与证据内容不匹配，疑似应为 ' + best.ref.id;
      } else {
        verdict = 'uncited';
        reason = '结论句未标注知识库引用（存在疑似可支撑条目）';
      }
    } else if (best.score >= KNOWLEDGE_GROUNDEDNESS_WEAK_THRESHOLD) {
      verdict = 'weak';
      reason = '结论句与证据内容的匹配度偏低（' + best.score + '），需要复核';
    } else if (!citedIds.length) {
      reason = '结论句未标注引用且未找到可支撑的知识条目';
    }
    let check = {
      sentence,
      cited: citedIds,
      verdict,
      score: best.score,
      reason,
      suggestedRef: best.ref ? { id: best.ref.id, title: best.ref.title, snippet: String(best.ref.snippet || '').slice(0, 200) } : null,
      embeddingScore: best.embeddingScore
    };
    if (/未验证|无法确认|暂无法|不确定/.test(sentence)) {
      check = { ...check, verdict: 'abstained', reason: '句子已标注未验证/无法确认（abstain）' };
    } else if (check.verdict === 'weak' && options.adjudicateWeak !== false) {
      check = await knowledgeAdjudicateWeak(check);
    }
    checks.push(check);
  }
  const eligible = checks.filter((check) => check.verdict !== 'abstained');
  const violations = eligible.filter((check) => check.verdict !== 'grounded');
  const rate = eligible.length ? Math.round((eligible.length - violations.length) / eligible.length * 1000) / 1000 : null;
  return { claims, checks, rate, violations, grounded: eligible.length - violations.length, abstained: checks.length - eligible.length, method, target: KNOWLEDGE_GROUNDEDNESS_TARGET };
}

function knowledgeInsertSentenceMarker(sentence, marker) {
  const match = /([。！？!?；;]*)$/.exec(sentence);
  const punct = match ? match[1] : '';
  const body = punct ? sentence.slice(0, -punct.length) : sentence;
  if (marker === '未验证') return body + '（未验证）' + punct;
  return body + ' ' + marker + punct;
}

function knowledgeReplaceFirstCitation(sentence, toId) {
  return /\[知识\s*\d+[^\]]*\]/.test(sentence) ? sentence.replace(/\[知识\s*\d+[^\]]*\]/, '[' + toId + ']') : sentence;
}

function knowledgeGroundednessFixRules(answer, refs, groundedness) {
  if (!groundedness || !Array.isArray(groundedness.checks) || !groundedness.checks.length) return answer;
  let text = String(answer || '').replace(/\s+/g, ' ');
  let changed = false;
  for (const check of groundedness.checks) {
    const sentence = String(check.sentence || '').replace(/\s+/g, ' ');
    if (check.verdict === 'grounded' || !sentence || !text.includes(sentence)) continue;
    let fixed = '';
    if (check.verdict === 'uncited' && check.suggestedRef && check.suggestedRef.id) {
      fixed = knowledgeInsertSentenceMarker(sentence, '[' + check.suggestedRef.id + ']');
    } else if (check.verdict === 'weak' && check.suggestedRef && check.suggestedRef.id && !(check.cited || []).includes(check.suggestedRef.id)) {
      const replaced = knowledgeReplaceFirstCitation(sentence, check.suggestedRef.id);
      fixed = replaced !== sentence ? replaced : knowledgeInsertSentenceMarker(sentence, '[' + check.suggestedRef.id + ']');
    } else if (check.verdict === 'unsupported' || check.verdict === 'weak') {
      fixed = knowledgeInsertSentenceMarker(sentence, '未验证');
    }
    if (!fixed || fixed === sentence) continue;
    text = text.replace(sentence, fixed);
    changed = true;
  }
  return changed ? text : answer;
}

async function knowledgeGroundednessFixLlm(answer, refs, groundedness) {
  if (chatLlm === null) return answer;
  try {
    const listText = (Array.isArray(refs) ? refs : []).map((entry, index) => (index + 1) + '. ' + entry.id + '《' + entry.title + '》 ' + String(entry.snippet || entry.summary || '').slice(0, 300)).join('\n');
    const issues = (groundedness.checks || []).filter((check) => check.verdict !== 'grounded').map((check) => '- ' + check.sentence + '（' + check.reason + '）').join('\n');
    const text = await streamLlmText(
      '你是知识库引用修正器。用户回答中部分结论句缺少引用或引用的知识条目无法支撑结论。请重写回答：\n' +
      '1. 保持原意、结构与语气，不要新增知识库之外的事实；\n' +
      '2. 每个结论句必须紧邻标注能支撑它的引用，格式 [知识N《标题》· 置信度X]，编号只能来自给定引用列表；\n' +
      '3. 若某结论没有任何给定引用能支撑，改成不超出知识范围的表述，或在该句末尾标注（未验证）；\n' +
      '4. 不要编造引用。\n' +
      '只输出修正后的完整回答，不要解释。',
      '给定引用：\n' + listText + '\n\n问题句子：\n' + issues + '\n\n原回答：\n' + String(answer || ''),
      { maxTokens: 4000, temperature: 0.2 }
    );
    const cleaned = String(text || '').trim();
    return cleaned.length >= 4 && cleaned !== String(answer || '').trim() ? cleaned : answer;
  } catch (error) {
    diag('knowledge groundedness llm fix failed: ' + String((error && error.message) || error));
    return answer;
  }
}

async function recordKnowledgeAuditTrace({ query, sessionId, answer, refs, audit }) {
  const at = audit && audit.checkedAt ? audit.checkedAt : new Date().toISOString();
  const trace = cleanKnowledgeTrace({
    id: randomUUID(),
    sessionId: cleanTaskText(sessionId, 160),
    callId: '',
    rootCallId: '',
    turn: 0,
    step: 0,
    tool: 'knowledge_audit',
    arguments: { query: cleanTaskText(query, 500) },
    startedAt: at,
    endedAt: at,
    startedMs: Date.now(),
    endedMs: Date.now(),
    success: audit.valid === true,
    result: {
      rate: audit.groundednessRate,
      target: audit.groundednessTarget,
      method: audit.groundednessMethod,
      claimCount: Array.isArray(audit.groundednessChecks) ? audit.groundednessChecks.length : 0,
      grounded: audit.groundednessSummary ? audit.groundednessSummary.grounded : 0,
      violations: audit.groundednessSummary ? audit.groundednessSummary.violations : 0,
      completeness: audit.completeness,
      fixed: audit.fix && audit.fix.applied === true,
      abstainRequired: audit.abstainRequired === true,
      missing: audit.missing,
      invalidCount: (audit.invalid || []).length,
      checks: (Array.isArray(audit.groundednessChecks) ? audit.groundednessChecks : []).slice(0, 30).map((check) => ({
        verdict: check.verdict,
        score: check.score,
        cited: check.cited,
        reason: check.reason ? String(check.reason).slice(0, 200) : '',
        sentence: String(check.sentence).slice(0, 200)
      }))
    }
  });
  await mutateKnowledgeTraceStore((store) => { store.traces.push(trace); });
  return trace;
}

async function auditKnowledgeCitationsDeep(answer, refs, options = {}) {
  const level = options.level || 'ref+groundedness';
  const text = String(answer || '').trim();
  const cleanRefs = Array.isArray(refs) ? refs.map(cleanKnowledgeRef).filter((entry) => entry.title) : [];
  const base = auditKnowledgeCitations(text, cleanRefs, level);
  if (level !== 'ref+groundedness') return base;
  const first = await auditKnowledgeGroundedness(text, cleanRefs, options);
  const fix = { attempted: false, applied: false, method: '', before: null, after: null };
  let finalText = text;
  let final = first;
  const target = options.targetRate ?? KNOWLEDGE_GROUNDEDNESS_TARGET;
  if (first.claims.length && first.rate !== null && first.rate < target && options.autoFix !== false) {
    fix.attempted = true;
    fix.before = { rate: first.rate, violations: first.violations.length };
    let fixedText = text;
    if (chatLlm !== null && options.llmFix !== false) {
      const llmFixed = await knowledgeGroundednessFixLlm(text, cleanRefs, first);
      if (llmFixed !== text) { fixedText = llmFixed; fix.method = 'llm'; }
    }
    const ruleFixed = knowledgeGroundednessFixRules(fixedText, cleanRefs, first);
    if (ruleFixed !== fixedText) { fixedText = ruleFixed; fix.method = fix.method ? fix.method + '+rule' : 'rule'; }
    if (fixedText !== text) {
      fix.applied = true;
      finalText = fixedText;
      final = await auditKnowledgeGroundedness(finalText, cleanRefs, options);
      fix.after = { rate: final.rate, violations: final.violations.length };
    }
  }
  const violations = final.violations || [];
  const completenessValue = options.completeness === null || options.completeness === undefined ? null : Number(options.completeness);
  const audit = {
    ...base,
    level,
    text: finalText,
    fixed: fix.applied === true,
    fix,
    groundednessChecks: final.checks || [],
    groundednessRate: final.rate,
    groundednessTarget: target,
    groundednessMethod: final.method,
    groundednessSummary: { claims: Math.max(0, final.claims.length - (final.abstained || 0)), abstained: final.abstained || 0, grounded: final.grounded, violations: violations.length, rate: final.rate, method: final.method },
    groundedness: violations.map((check) => ({ sentence: check.sentence, reason: check.reason })),
    completeness: completenessValue !== null && Number.isFinite(completenessValue) && completenessValue >= 0 && completenessValue <= 1 ? Math.round(completenessValue * 1000) / 1000 : null,
    valid: (base.missing || []).length === 0 && base.invalid.length === 0 && violations.length === 0,
    abstainRequired: (base.missing || []).length > 0 || base.invalid.length > 0 || violations.length > 0,
    checkedAt: new Date().toISOString()
  };
  try {
    await recordKnowledgeAuditTrace({ query: options.query || '', sessionId: options.sessionId || '', answer: finalText, refs: cleanRefs, audit });
  } catch (error) {
    diag('knowledge audit trace write failed: ' + String((error && error.message) || error));
  }
  return audit;
}

function safeKnowledgeName(title) {
  const base = cleanTaskText(title, 60).replace(/[\\/:*?"<>|\r\n]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return base || 'untitled';
}

function knowledgeFrontmatter(meta) {
  const lines = [
    '---',
    'title: ' + cleanTaskText(meta.title, 300),
    'type: ' + (KNOWLEDGE_TYPES.includes(meta.type) ? meta.type : 'note'),
    'tags: [' + (Array.isArray(meta.tags) ? meta.tags.join(', ') : '') + ']',
    'confidence: ' + (KNOWLEDGE_CONFIDENCES.includes(meta.confidence) ? meta.confidence : 'medium'),
    'status: ' + (KNOWLEDGE_STATUSES.includes(meta.status) ? meta.status : 'review'),
    'claimType: ' + (KNOWLEDGE_CLAIM_TYPES.includes(meta.claimType) ? meta.claimType : 'fact'),
    'staleness: ' + (KNOWLEDGE_STALENESS.includes(meta.staleness) ? meta.staleness : 'CHECK'),
    'source: ' + cleanTaskText(meta.source, 80),
    'project: ' + cleanTaskText(meta.project, 300)
  ];
  if (meta.type === 'experience' || (meta.context || meta.result || meta.reusable)) {
    if (meta.context) lines.push('context: ' + cleanTaskText(meta.context, 2000));
    if (meta.result) lines.push('result: ' + cleanTaskText(meta.result, 2000));
    if (meta.reusable) lines.push('reusable: ' + cleanTaskText(meta.reusable, 2000));
  }
  if (meta.verifiedBy) lines.push('verifiedBy: ' + cleanTaskText(meta.verifiedBy, 80));
  if (meta.verifiedAt) lines.push('verifiedAt: ' + String(meta.verifiedAt));
  if (Array.isArray(meta.assumptions) && meta.assumptions.length) {
    lines.push('assumptions:');
    meta.assumptions.slice(0, 10).forEach((item) => lines.push('  - ' + cleanTaskText(item, 300)));
  }
  lines.push('related: "' + (Array.isArray(meta.related) ? meta.related.map((item) => '[[' + cleanTaskText(item, 200) + ']]').join(' ') : '') + '"');
  lines.push('summary: ' + cleanTaskText(meta.summary, 2000));
  lines.push('created: ' + (meta.created || new Date().toISOString()));
  lines.push('---');
  return lines.join('\n');
}

async function distillKnowledge({ title, source, content, project }) {
  await ensureKnowledgeVault();
  const rawTitle = cleanTaskText(title, 120).replace(/[\r\n:]+/g, ' ');
  const rawSource = cleanTaskText(source, 80) || 'text';
  const rawProject = cleanTaskText(project, 300);
  let markdown = '';
  let fallback = false;
  if (chatLlm !== null) {
    try {
      const system = [
        '你是一个知识蒸馏器。先判断内容来源：若来自解决具体项目问题/技术选型/踩坑/复盘/项目决策 → type=experience；若只是概念问答/资料学习/通用知识 → type=note。只输出 JSON：',
        '{"type":"note|experience","title":"简短标题","tags":["标签"],"confidence":"high|medium|low","claimType":"fact|hypothesis","staleness":"STABLE|CHECK|VOLATILE","assumptions":["关键假设，没有则空数组"],"related":["建议关联的已有条目标题（没有则空数组）"],"summary":"一句话核心","context":"type=experience 时的情境（项目/技术栈/约束/目标），否则空字符串","result":"type=experience 时验证了什么/结果，否则空字符串","reusable":"type=experience 时可复用结论（什么条件下哪个方案更优），否则空字符串","body":"完整 Markdown 正文（含 ## 结论 / ## 方法 / ## 决策 / ## 待办 等小节，压缩至 800 字内）"}'
      ].join('\n');
      const prompt = ['来源：' + rawSource, '关联项目：' + rawProject, '原始内容：\n' + String(content || '').slice(0, 50000)].join('\n\n');
      const text = await streamLlmText(system, prompt, { maxTokens: 2500, temperature: 0.3 });
      const parsed = parseJsonObject(text);
      if (parsed && (parsed.title || parsed.body)) {
        const titleText = cleanTaskText(parsed.title || rawTitle || '未命名', 120).replace(/[\r\n:]+/g, ' ');
        const tags = Array.isArray(parsed.tags) ? parsed.tags.map((item) => cleanTaskText(item, 60)).filter(Boolean).slice(0, 10) : [];
        const meta = {
          title: titleText,
          type: KNOWLEDGE_TYPES.includes(parsed.type) ? parsed.type : 'note',
          context: cleanTaskText(parsed.context, 2000),
          result: cleanTaskText(parsed.result, 2000),
          reusable: cleanTaskText(parsed.reusable, 2000),
          tags,
          confidence: KNOWLEDGE_CONFIDENCES.includes(parsed.confidence) ? parsed.confidence : 'medium',
          status: 'review',
          claimType: KNOWLEDGE_CLAIM_TYPES.includes(parsed.claimType) ? parsed.claimType : 'fact',
          staleness: KNOWLEDGE_STALENESS.includes(parsed.staleness) ? parsed.staleness : 'CHECK',
          source: rawSource,
          project: rawProject,
          related: Array.isArray(parsed.related) ? parsed.related.map((item) => cleanTaskText(item, 200)).filter(Boolean).slice(0, 10) : [],
          summary: cleanTaskText(parsed.summary, 2000),
          assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.map((item) => cleanTaskText(item, 300)).filter(Boolean).slice(0, 10) : [],
          created: new Date().toISOString()
        };
        markdown = knowledgeFrontmatter(meta) + '\n\n' + String(parsed.body || '').trim();
      }
    } catch (error) { markdown = ''; }
  }
  if (!markdown) {
    fallback = true;
    const body = String(content || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').slice(0, 2000);
    markdown = knowledgeFrontmatter({
      title: rawTitle || '未命名',
      type: 'note',
      tags: [],
      confidence: 'low',
      status: 'review',
      claimType: 'fact',
      staleness: 'CHECK',
      source: rawSource,
      project: rawProject,
      related: [],
      summary: body.slice(0, 300),
      assumptions: [],
      created: new Date().toISOString()
    }) + '\n\n# ' + (rawTitle || '未命名') + '\n\n' + body;
  }
  const date = new Date().toISOString().slice(0, 10);
  const fileName = date + '_' + safeKnowledgeName(rawTitle || '');
  const file = join(KNOWLEDGE_INBOX, fileName + '.md');
  await writeFile(file, markdown, 'utf8');
  const precheck = await precheckKnowledgeEntry({ title: rawTitle, content: markdown, source: rawSource, excludePath: 'inbox/' + fileName + '.md' });
  const quality = await readKnowledgeQuality();
  const autoPublish = quality.reviewMode === 'auto' && quality.autoPublishLowRisk && precheck.ok && precheckOkConfidence(markdown);
  const index = await scanKnowledgeVault();
  let entry = index.entries.find((item) => item.path === 'inbox/' + fileName + '.md') || null;
  let finalPath = 'inbox/' + fileName + '.md';
  let autoPublished = false;
  if (autoPublish && entry) {
    const published = await publishKnowledgeEntry({ path: finalPath, moveToAtomic: true, verifiedBy: 'auto' });
    entry = published.entry;
    finalPath = published.path;
    autoPublished = true;
  }
  return { entry, fallback, path: finalPath, autoPublished, precheck };
}

async function captureAcceptedOrchestrationKnowledge(orchestration) {
  if (!orchestration || orchestration.phase !== 'accepted' || !String(orchestration.finalReport || '').trim()) return null;
  await ensureKnowledgeVault();
  const name = 'project-experience-' + String(orchestration.id || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 80);
  const target = knowledgeWritePath('inbox', name);
  if (!target) return null;
  try {
    const existing = await lstat(target.full);
    if (existing.isFile() && !existing.isSymbolicLink()) {
      const index = await readKnowledgeIndex();
      return { path: target.relPath, created: false, entry: (index.entries || []).find((item) => item.path === target.relPath) || null };
    }
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  const title = cleanTaskText('项目经验：' + (orchestration.title || orchestration.idea || '已验收任务'), 120).replace(/[\r\n:]+/g, ' ');
  const context = cleanTaskText(orchestration.idea, 2000);
  const result = cleanTaskText(orchestration.finalReport, 4000);
  const reusable = cleanTaskText(orchestration.plan && orchestration.plan.strategy, 2000) || result.slice(0, 1200);
  const acceptance = cleanTaskText(orchestration.acceptedNote, 1000) || '用户已通过验收';
  const markdown = knowledgeFrontmatter({
    title,
    type: 'experience',
    context,
    result,
    reusable,
    tags: ['项目经验', '已验收'],
    confidence: 'medium',
    status: 'review',
    claimType: 'fact',
    staleness: 'CHECK',
    source: '项目验收',
    project: cleanTaskText(orchestration.projectPath, 300),
    related: [],
    summary: result.slice(0, 300),
    assumptions: ['仅沉淀用户已验收的执行结果；发布前仍需通过知识质量门'],
    created: new Date().toISOString()
  }) + '\n\n' + [
    '# ' + title,
    '',
    '## 情境',
    context,
    '',
    '## 执行结果',
    result,
    '',
    '## 可复用结论',
    reusable,
    '',
    '## 验证',
    acceptance
  ].join('\n');
  await writeFile(target.full, markdown, 'utf8');
  const index = await scanKnowledgeVault();
  return { path: target.relPath, created: true, entry: (index.entries || []).find((item) => item.path === target.relPath) || null };
}

function precheckOkConfidence(markdown) {
  const parsed = parseFrontmatter(markdown);
  return parsed.confidence !== 'low';
}

async function publishKnowledgeEntry({ path, moveToAtomic, verifiedBy, reject }) {
  const target = knowledgeResolve(path);
  if (!target) throw new Error('invalid knowledge path');
  const content = await readFile(target.full, 'utf8');
  const parsed = parseFrontmatter(content);
  const nextStatus = reject ? 'draft' : 'published';
  const next = {
    ...parsed,
    status: nextStatus,
    verifiedBy: reject ? '' : cleanTaskText(verifiedBy, 80) || 'human',
    verifiedAt: reject ? '' : new Date().toISOString()
  };
  const markdown = knowledgeFrontmatter(next) + '\n' + parsed.body;
  const destFolder = reject ? target.folder : (moveToAtomic ? 'atomic' : target.folder);
  const dest = knowledgeWritePath(destFolder, target.file.replace(/\.md$/i, ''));
  if (!dest) throw new Error('invalid destination folder');
  if (dest.relPath === target.relPath) {
    await writeFile(target.full, markdown, 'utf8');
  } else {
    await writeFile(dest.full, markdown, 'utf8');
    await rm(target.full, { force: true });
  }
  const index = await scanKnowledgeVault();
  const entry = index.entries.find((item) => item.path === dest.relPath) || null;
  try {
    const config = await readVectorConfig();
    if (config.provider !== 'none' && entry) await updateKnowledgeVectorsFor([entry]);
  } catch (e) { /* vector update best effort */ }
  return { entry, path: dest.relPath, moved: dest.relPath !== target.relPath, reject: !!reject };
}

async function archiveKnowledgeEntry({ path, restore }) {
  const target = knowledgeResolve(path);
  if (!target) throw new Error('invalid knowledge path');
  const content = await readFile(target.full, 'utf8');
  const parsed = parseFrontmatter(content);
  const destFolder = restore ? 'atomic' : 'archive';
  const nextStatus = restore ? 'published' : 'deprecated';
  const markdown = knowledgeFrontmatter({ ...parsed, status: nextStatus }) + '\n' + parsed.body;
  const dest = knowledgeWritePath(destFolder, target.file.replace(/\.md$/i, ''));
  if (!dest) throw new Error('invalid destination folder');
  if (dest.relPath === target.relPath) {
    await writeFile(target.full, markdown, 'utf8');
  } else {
    await writeFile(dest.full, markdown, 'utf8');
    await rm(target.full, { force: true });
  }
  const index = await scanKnowledgeVault();
  const entry = index.entries.find((item) => item.path === dest.relPath) || null;
  return { entry, path: dest.relPath, archived: !restore, restored: !!restore };
}

async function captureKnowledgeRaw({ name, source, content }) {
  await ensureKnowledgeVault();
  const rawTitle = cleanTaskText(name, 120) || ('源材料-' + new Date().toISOString().slice(0, 10));
  const rawSource = cleanTaskText(source, 80) || 'raw';
  const body = String(content || '').slice(0, KNOWLEDGE_MAX_ENTRY_BYTES);
  const date = new Date().toISOString().slice(0, 10);
  const fileName = date + '_' + safeKnowledgeName(rawTitle);
  const markdown = knowledgeFrontmatter({
    title: rawTitle,
    type: 'note',
    tags: [],
    confidence: 'low',
    status: 'draft',
    claimType: 'hypothesis',
    staleness: 'CHECK',
    source: rawSource,
    project: '',
    related: [],
    summary: String(body).replace(/\s+/g, ' ').slice(0, 300),
    assumptions: [],
    created: new Date().toISOString()
  }) + '\n\n' + body;
  const file = join(KNOWLEDGE_RAW, fileName + '.md');
  await writeFile(file, markdown, 'utf8');
  const index = await scanKnowledgeVault();
  const entry = index.entries.find((item) => item.path === 'raw/' + fileName + '.md') || null;
  return { entry, path: 'raw/' + fileName + '.md' };
}

async function buildConsolidationDraft(entry) {
  const baseTitle = String(entry.title || '').replace(/^经验-|^项目经验-/, '');
  const fallbackTitle = ('知识-' + baseTitle).slice(0, 60);
  const fallback = {
    title: fallbackTitle,
    summary: String(entry.reusable || entry.summary || '').slice(0, 300),
    body: [
      '# ' + fallbackTitle,
      '',
      '## 结论',
      '',
      String(entry.reusable || entry.summary || ''),
      '',
      '## 适用条件',
      '',
      String(entry.context || ''),
      '',
      '## 验证',
      '',
      String(entry.result || '')
    ].join('\n'),
    reasons: ['AI 提炼自项目经验：' + entry.path]
  };
  if (chatLlm === null) return fallback;
  try {
    const text = await streamLlmText(
      '你是知识提炼器。把一条项目经验提炼成一条可复用的知识点（去掉项目特例，保留普适结论 + 适用条件），只输出 JSON：{"title":"简短标题","summary":"一句话核心","body":"Markdown 正文（含 ## 结论 / ## 适用条件 / ## 验证 / ## 待办 等小节）"}',
      '项目经验标题：' + entry.title + '\n摘要：' + entry.summary + '\n情境：' + entry.context + '\n验证结果：' + entry.result + '\n可复用结论：' + entry.reusable,
      { maxTokens: 1500, temperature: 0.3 }
    );
    const parsed = parseJsonObject(text);
    if (parsed && (parsed.title || parsed.body)) {
      return {
        title: cleanTaskText(parsed.title || fallback.title, 120).replace(/[\r\n:]+/g, ' '),
        summary: cleanTaskText(parsed.summary || fallback.summary, 2000),
        body: String(parsed.body || fallback.body).trim(),
        reasons: ['AI 提炼自项目经验：' + entry.path]
      };
    }
  } catch (e) { /* fallback */ }
  return fallback;
}

async function suggestKnowledgeConsolidations() {
  const index = await scanKnowledgeVault();
  const quality = await readKnowledgeQuality();
  quality.consolidations = Array.isArray(quality.consolidations) ? quality.consolidations : [];
  const experiences = (index.entries || []).filter((entry) => entry.type === 'experience' && entry.status === 'published' && entry.folder !== 'templates');
  const validFrom = new Set(experiences.map((entry) => entry.path));
  const beforePrune = quality.consolidations.length;
  quality.consolidations = quality.consolidations.filter((item) => item.status !== 'pending' || validFrom.has(item.from));
  if (quality.consolidations.length !== beforePrune) await writeKnowledgeQuality(quality);
  const existing = new Set(quality.consolidations.map((item) => item.from));
  const now = Date.now();
  const candidates = experiences.filter((entry) => {
    const usage = (quality.usage || {})[entry.path];
    const hits = usage ? Number(usage.hits) || 0 : 0;
    const ageDays = Math.max(0, (now - new Date(entry.updatedAt || entry.createdAt || now).getTime()) / 86400000);
    return hits >= 1 || ageDays <= 30;
  });
  let added = 0;
  for (const entry of candidates) {
    if (existing.has(entry.path)) continue;
    const draft = await buildConsolidationDraft(entry);
    quality.consolidations.push({
      id: randomUUID(),
      from: entry.path,
      fromTitle: entry.title,
      title: draft.title,
      summary: draft.summary,
      body: draft.body,
      reasons: draft.reasons,
      createdAt: new Date().toISOString(),
      status: 'pending'
    });
    existing.add(entry.path);
    added += 1;
    if (quality.consolidations.length >= 20) break;
  }
  if (added) await writeKnowledgeQuality(quality);
  return {
    suggestions: quality.consolidations.filter((item) => item.status === 'pending').slice(-20),
    added,
    total: quality.consolidations.filter((item) => item.status === 'applied').length
  };
}

async function applyKnowledgeConsolidation({ id }) {
  const quality = await readKnowledgeQuality();
  const item = (quality.consolidations || []).find((entry) => entry.id === id && entry.status === 'pending');
  if (!item) return { ok: false, reason: 'suggestion not found or already handled' };
  const precheck = await precheckKnowledgeEntry({ title: item.title, content: item.body, source: '项目经验提炼', excludePath: item.from });
  if (!precheck.ok && precheck.blocks.length) {
    return { ok: false, reason: 'precheck 未通过：' + precheck.blocks.join('；'), precheck };
  }
  await ensureKnowledgeVault();
  const fileName = safeKnowledgeName(item.title);
  const markdown = knowledgeFrontmatter({
    title: item.title,
    type: 'note',
    tags: ['知识点', '项目经验'],
    confidence: 'medium',
    status: 'published',
    claimType: 'fact',
    staleness: 'CHECK',
    source: '项目经验提炼',
    project: '',
    related: [item.fromTitle],
    summary: item.summary,
    assumptions: [],
    created: new Date().toISOString(),
    verifiedBy: 'human-consolidation',
    verifiedAt: new Date().toISOString()
  }) + '\n' + item.body;
  const file = join(KNOWLEDGE_ATOMIC, fileName + '.md');
  await writeFile(file, markdown, 'utf8');
  try {
    const source = knowledgeResolve(item.from);
    if (source) {
      const content = await readFile(source.full, 'utf8');
      const parsed = parseFrontmatter(content);
      const related = parsed.related.includes(item.title) ? parsed.related : [...parsed.related, item.title].slice(0, 30);
      const next = knowledgeFrontmatter({ ...parsed, related }) + '\n' + parsed.body;
      if (next !== content) await writeFile(source.full, next, 'utf8');
    }
  } catch (e) { /* backlink best effort */ }
  item.status = 'applied';
  item.appliedAt = new Date().toISOString();
  await writeKnowledgeQuality(quality);
  const index = await scanKnowledgeVault();
  const entry = index.entries.find((entryItem) => entryItem.path === 'atomic/' + fileName + '.md') || null;
  try {
    const vectorConfig = await readVectorConfig();
    if (vectorConfig.provider !== 'none') await updateKnowledgeVectorsFor([entry].filter(Boolean));
  } catch (e) { /* vector best effort */ }
  return { ok: true, entry, path: 'atomic/' + fileName + '.md', precheck };
}

async function ignoreKnowledgeConsolidation({ id }) {
  const quality = await readKnowledgeQuality();
  const item = (quality.consolidations || []).find((entry) => entry.id === id);
  if (!item) return { ok: false, reason: 'suggestion not found' };
  item.status = 'ignored';
  item.ignoredAt = new Date().toISOString();
  await writeKnowledgeQuality(quality);
  return { ok: true };
}

async function maintainKnowledgeVault() {
  const index = await scanKnowledgeVault();
  const entries = index.entries || [];
  const byTitle = new Map();
  entries.forEach((entry) => byTitle.set(entry.title.toLowerCase(), entry));
  const duplicates = [];
  const keyTerms = (entry) => new Set(Object.keys(entry.terms || {}).slice(0, 80));
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = keyTerms(entries[i]);
      const b = keyTerms(entries[j]);
      let inter = 0;
      for (const term of a) if (b.has(term)) inter += 1;
      const union = a.size + b.size - inter;
      if (union > 0 && inter / union > 0.55) {
        duplicates.push({ a: entries[i].path, b: entries[j].path, similarity: Math.round((inter / union) * 100) / 100 });
      }
    }
  }
  duplicates.sort((x, y) => y.similarity - x.similarity);
  const brokenLinks = [];
  for (const entry of entries) {
    for (const rel of entry.related) {
      if (!byTitle.has(rel.toLowerCase())) brokenLinks.push({ from: entry.path, link: rel });
    }
  }
  const referenced = new Set();
  entries.forEach((entry) => entry.related.forEach((rel) => {
    const target = byTitle.get(rel.toLowerCase());
    if (target) referenced.add(target.path);
  }));
  const orphans = entries.filter((entry) => !referenced.has(entry.path) && !entry.related.length).map((entry) => entry.path);
  const now = new Date();
  const stale = entries.filter((entry) => {
    const t = new Date(entry.updatedAt || entry.createdAt).getTime();
    return Number.isFinite(t) && now.getTime() - t > 180 * 24 * 3600 * 1000 && entry.confidence === 'high';
  }).map((entry) => {
    const t = new Date(entry.updatedAt || entry.createdAt).getTime();
    return { path: entry.path, days: Math.round((now.getTime() - t) / 86400000), suggestion: 'archive' };
  });
  const quality = await readKnowledgeQuality();
  const conflictMap = {};
  for (const dup of duplicates) {
    conflictMap[dup.a] = conflictMap[dup.a] || [];
    conflictMap[dup.a].push({ with: dup.b, similarity: dup.similarity });
    conflictMap[dup.b] = conflictMap[dup.b] || [];
    conflictMap[dup.b].push({ with: dup.a, similarity: dup.similarity });
  }
  const conflictsChanged = JSON.stringify(quality.conflicts || {}) !== JSON.stringify(conflictMap);
  if (conflictsChanged) {
    quality.conflicts = conflictMap;
    await writeKnowledgeQuality(quality);
  }
  let indexAfter = index;
  const archived = [];
  if (quality.forgetMode === 'auto' && quality.forgetAutoArchive && stale.length) {
    for (const item of stale.slice(0, 20)) {
      try {
        await archiveKnowledgeEntry({ path: item.path, restore: false });
        archived.push(item.path);
      } catch (e) { /* keep on failure */ }
    }
    indexAfter = await scanKnowledgeVault();
  }
  const tagIndex = new Map();
  entries.forEach((entry) => entry.tags.forEach((tag) => {
    if (!tagIndex.has(tag)) tagIndex.set(tag, []);
    tagIndex.get(tag).push(entry);
  }));
  const mocs = [
    '---',
    'title: 知识库地图',
    'tags: [MOC]',
    'confidence: high',
    'related: ""',
    'summary: 自动生成的索引地图。',
    '---',
    '',
    '# 知识库地图',
    '',
    '> 由工作台维护器自动生成，修改后下次维护会被覆盖。',
    '',
    '## 目录结构',
    '',
    '- 00-Raw：源材料层，默认不进检索',
    '- 01-Inbox：AI 写入区，待人工审核',
    '- 02-Atomic：人工审核后的核心资产',
    '- 03-MOCs：地图索引',
    '- 04-Projects：按项目沉淀',
    '- 05-Archive：遗忘归档层',
    '- 99-Templates：模板',
    '',
    '## 最近新增',
    ''
  ];
  entries.filter((entry) => ['atomic', 'projects', 'mocs'].includes(entry.folder)).slice(0, 12)
    .forEach((entry) => mocs.push('- [[' + entry.title + ']]（' + entry.folder + '）'));
  mocs.push('', '## 标签索引', '');
  for (const [tag, tagged] of [...tagIndex.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 40)) {
    mocs.push('- #' + tag + '：' + tagged.map((entry) => '[[' + entry.title + ']]').join('、'));
  }
  await writeFile(join(KNOWLEDGE_MOCS, 'Index.md'), mocs.join('\n') + '\n', 'utf8');
  indexAfter = await scanKnowledgeVault();
  let consolidationResult = { suggestions: [], added: 0, total: 0 };
  try { consolidationResult = await suggestKnowledgeConsolidations(); } catch (e) { consolidationResult = { suggestions: [], added: 0, total: 0, error: String((e && e.message) || e) }; }
  return {
    duplicates: duplicates.slice(0, 20),
    brokenLinks: brokenLinks.slice(0, 50),
    orphans: orphans.slice(0, 50),
    stale: stale.slice(0, 50),
    archived: archived.slice(0, 50),
    consolidations: consolidationResult,
    mocsUpdated: true,
    stats: indexAfter.stats
  };
}

function cleanEvalItem(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    id: cleanTaskText(value.id, 64) || randomUUID(),
    question: cleanTaskText(value.question, 500),
    expected: Array.isArray(value.expected) ? value.expected.map((item) => cleanTaskText(item, 300)).filter(Boolean).slice(0, 10) : [],
    answerHints: cleanTaskText(value.answerHints, 2000),
    expectedStrategy: ['single', 'iterative'].includes(value.expectedStrategy) ? value.expectedStrategy : '',
    expectedWeb: ['none', 'parallel', 'primary'].includes(value.expectedWeb) ? value.expectedWeb : '',
    note: cleanTaskText(value.note, 500),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString()
  };
}

async function readKnowledgeEval() {
  if (knowledgeEvalCache) return knowledgeEvalCache;
  try {
    const info = await lstat(KNOWLEDGE_EVAL_STORE);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('eval store must be a regular non-symbolic file');
    if (info.size > MAX_KNOWLEDGE_EVAL_BYTES) throw new Error('eval store exceeds size limit');
    const parsed = JSON.parse(await readFile(KNOWLEDGE_EVAL_STORE, 'utf8'));
    knowledgeEvalCache = {
      version: 1,
      items: Array.isArray(parsed.items) ? parsed.items.map(cleanEvalItem) : [],
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates.map(cleanEvalItem) : [],
      lastRun: parsed.lastRun && typeof parsed.lastRun === 'object' ? parsed.lastRun : null,
      history: Array.isArray(parsed.history) ? parsed.history.slice(-10) : []
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') knowledgeEvalCache = { version: 1, items: [], candidates: [], lastRun: null, history: [] };
    else throw error;
  }
  return knowledgeEvalCache;
}

async function writeKnowledgeEval(store) {
  await mkdir(DSH_ROOT, { recursive: true });
  const temp = KNOWLEDGE_EVAL_STORE + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, JSON.stringify(store, null, 2) + '\n', 'utf8');
  await rename(temp, KNOWLEDGE_EVAL_STORE);
  knowledgeEvalCache = store;
  return store;
}

function redactKnowledgeTraceString(value, maxLength = 1000) {
  let text = String(value ?? '').replace(/\0/g, '');
  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk|key)-[A-Za-z0-9_-]{12,}\b/gi, '$1-[REDACTED]');
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      for (const key of [...url.searchParams.keys()]) {
        if (KNOWLEDGE_TRACE_SECRET_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
      }
      text = url.toString();
    } catch { /* preserve the bounded original */ }
  }
  return text.slice(0, maxLength);
}

function boundedKnowledgeTraceValue(value, key = '', depth = 0) {
  if (KNOWLEDGE_TRACE_SECRET_KEY.test(key)) return '[REDACTED]';
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return redactKnowledgeTraceString(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (depth >= 3) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => boundedKnowledgeTraceValue(item, key, depth + 1));
  if (typeof value !== 'object') return redactKnowledgeTraceString(value, 200);
  const output = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 30)) {
    output[redactKnowledgeTraceString(childKey, 80)] = boundedKnowledgeTraceValue(childValue, childKey, depth + 1);
  }
  return output;
}

function knowledgeTraceWebSummary(value, content) {
  const urls = new Set();
  let sourceArrayCount = 0;
  let visited = 0;
  const visit = (item, key = '', depth = 0) => {
    if (item === null || item === undefined || depth > 5 || visited > 500) return;
    visited += 1;
    if (typeof item === 'string') {
      if (/^https?:\/\//i.test(item)) {
        try { urls.add(new URL(item).origin); } catch { /* ignore malformed URLs */ }
      }
      return;
    }
    if (Array.isArray(item)) {
      if (/results?|sources?|items?/i.test(key)) sourceArrayCount = Math.max(sourceArrayCount, item.length);
      for (const child of item.slice(0, 100)) visit(child, key, depth + 1);
      return;
    }
    if (typeof item === 'object') {
      for (const [childKey, childValue] of Object.entries(item)) visit(childValue, childKey, depth + 1);
    }
  };
  visit(value);
  const contentChars = (Array.isArray(content) ? content : []).reduce((sum, block) => {
    if (!block || typeof block !== 'object') return sum;
    return sum + (typeof block.text === 'string' ? block.text.length : 0);
  }, 0);
  return {
    sourceCount: Math.max(sourceArrayCount, urls.size),
    sourceDomains: [...urls].slice(0, 10),
    contentChars
  };
}

function summarizeKnowledgeTraceResult(tool, result, thrownError) {
  if (thrownError || !result || result.isError === true) {
    const failure = thrownError || result && result.error || {};
    return {
      success: false,
      error: redactKnowledgeTraceString(failure.message || thrownError || 'tool execution failed', 500),
      errorCode: redactKnowledgeTraceString(failure.info && failure.info.code || failure.code || '', 100)
    };
  }
  const value = result.value && typeof result.value === 'object' ? result.value : {};
  const summary = { success: true };
  if (tool === 'knowledge_search') {
    summary.coverage = redactKnowledgeTraceString(value.coverage || '', 40);
    summary.coverageScore = Number.isFinite(value.coverageScore) ? value.coverageScore : null;
    summary.action = redactKnowledgeTraceString(value.action || '', 40);
    summary.resultCount = Array.isArray(value.results) ? value.results.length : 0;
    summary.estimatedTokens = Math.max(0, Number(value.estimatedTokens) || 0);
    summary.retrievalTokens = Math.max(0, Number(value.retrievalTokens) || 0);
    summary.retrievalLatencyMs = Math.max(0, Number(value.latencyMs) || 0);
    summary.iterations = Math.max(0, Number(value.iterations) || 0);
  } else if (tool === 'knowledge_read') {
    summary.path = redactKnowledgeTraceString(value.path || '', 300);
    summary.title = redactKnowledgeTraceString(value.title || '', 300);
    summary.truncated = value.truncated === true;
    summary.estimatedTokens = Math.max(0, Number(value.estimatedTokens) || 0);
  } else {
    Object.assign(summary, knowledgeTraceWebSummary(value, result.content));
  }
  return summary;
}

function knowledgeTracePosition(exec) {
  const events = exec && exec.agent && exec.agent.session && exec.agent.session.events;
  const list = Array.isArray(events) ? events : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const event = list[index] || {};
    const data = event.data && typeof event.data === 'object' ? event.data : event;
    if (event.type === 'tool/call' && String(data.callId || '') === String(exec.callId || '')) {
      return { turn: Math.max(0, Number(data.turn) || 0), step: Math.max(0, Number(data.step) || 0) };
    }
  }
  return { turn: 0, step: 0 };
}

function cleanKnowledgeTrace(raw) {
  const trace = raw && typeof raw === 'object' ? raw : {};
  const startedMs = Math.max(0, Number(trace.startedMs) || 0);
  const endedMs = Math.max(startedMs, Number(trace.endedMs) || startedMs);
  return {
    id: cleanTaskText(trace.id, 80) || randomUUID(),
    sessionId: cleanTaskText(trace.sessionId, 160),
    callId: cleanTaskText(trace.callId, 200),
    rootCallId: cleanTaskText(trace.rootCallId, 200),
    turn: Math.max(0, Number(trace.turn) || 0),
    step: Math.max(0, Number(trace.step) || 0),
    tool: KNOWLEDGE_TRACE_TOOLS.has(trace.tool) ? trace.tool : '',
    arguments: boundedKnowledgeTraceValue(trace.arguments),
    startedAt: typeof trace.startedAt === 'string' ? trace.startedAt : new Date(startedMs).toISOString(),
    endedAt: typeof trace.endedAt === 'string' ? trace.endedAt : new Date(endedMs).toISOString(),
    startedMs,
    endedMs,
    durationMs: Math.max(0, endedMs - startedMs),
    success: trace.success === true,
    result: boundedKnowledgeTraceValue(trace.result)
  };
}

async function readKnowledgeTraceStore() {
  if (knowledgeTraceCache) return knowledgeTraceCache;
  try {
    const info = await lstat(KNOWLEDGE_TRACE_STORE);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('knowledge trace store must be a regular non-symbolic file');
    if (info.size > MAX_KNOWLEDGE_TRACE_BYTES) throw new Error('knowledge trace store exceeds size limit');
    const parsed = JSON.parse(await readFile(KNOWLEDGE_TRACE_STORE, 'utf8'));
    knowledgeTraceCache = {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      traces: Array.isArray(parsed.traces) ? parsed.traces.map(cleanKnowledgeTrace).filter((trace) => trace.tool).slice(-MAX_KNOWLEDGE_TRACES) : []
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') knowledgeTraceCache = { version: 1, updatedAt: '', traces: [] };
    else throw error;
  }
  return knowledgeTraceCache;
}

async function writeKnowledgeTraceStore(store) {
  await mkdir(DSH_ROOT, { recursive: true });
  const normalized = {
    version: 1,
    updatedAt: new Date().toISOString(),
    traces: (Array.isArray(store.traces) ? store.traces : []).map(cleanKnowledgeTrace).filter((trace) => trace.tool).slice(-MAX_KNOWLEDGE_TRACES)
  };
  let serialized = JSON.stringify(normalized, null, 2) + '\n';
  while (Buffer.byteLength(serialized, 'utf8') > MAX_KNOWLEDGE_TRACE_BYTES && normalized.traces.length > 1) {
    normalized.traces.splice(0, Math.max(1, Math.ceil(normalized.traces.length / 10)));
    serialized = JSON.stringify(normalized, null, 2) + '\n';
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_KNOWLEDGE_TRACE_BYTES) throw new Error('one knowledge trace exceeds size limit');
  const temp = KNOWLEDGE_TRACE_STORE + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, serialized, 'utf8');
  await rename(temp, KNOWLEDGE_TRACE_STORE);
  knowledgeTraceCache = normalized;
  return normalized;
}

function mutateKnowledgeTraceStore(mutator) {
  const operation = knowledgeTraceWriteQueue.then(async () => {
    const current = await readKnowledgeTraceStore();
    const next = { ...current, traces: [...current.traces] };
    await mutator(next);
    return writeKnowledgeTraceStore(next);
  });
  knowledgeTraceWriteQueue = operation.catch(() => {});
  return operation;
}

function summarizeKnowledgeTraces(traces) {
  const list = Array.isArray(traces) ? traces : [];
  const byTool = {};
  const sessions = new Set();
  for (const trace of list) {
    byTool[trace.tool] = (byTool[trace.tool] || 0) + 1;
    if (trace.sessionId) sessions.add(trace.sessionId);
  }
  const knowledge = list.filter((trace) => trace.tool === 'knowledge_search' || trace.tool === 'knowledge_read');
  const web = list.filter((trace) => trace.tool === 'web_search' || trace.tool === 'web_fetch');
  const overlapPairs = [];
  const batches = new Set();
  for (const kbTrace of knowledge) {
    for (const webTrace of web) {
      if (!kbTrace.sessionId || kbTrace.sessionId !== webTrace.sessionId) continue;
      if (kbTrace.turn !== webTrace.turn || kbTrace.step !== webTrace.step) continue;
      const overlapMs = Math.max(0, Math.min(kbTrace.endedMs, webTrace.endedMs) - Math.max(kbTrace.startedMs, webTrace.startedMs));
      if (overlapMs <= 0) continue;
      overlapPairs.push({
        knowledgeTraceId: kbTrace.id,
        webTraceId: webTrace.id,
        sessionId: kbTrace.sessionId,
        turn: kbTrace.turn,
        step: kbTrace.step,
        overlapMs
      });
      batches.add(kbTrace.sessionId + ':' + kbTrace.turn + ':' + kbTrace.step);
    }
  }
  return {
    total: list.length,
    successful: list.filter((trace) => trace.success).length,
    failed: list.filter((trace) => !trace.success).length,
    sessions: sessions.size,
    byTool,
    knowledgeCalls: knowledge.length,
    webCalls: web.length,
    overlapPairs: overlapPairs.slice(-100),
    parallelBatches: batches.size,
    hasParallelEvidence: overlapPairs.length > 0
  };
}

async function recordKnowledgeToolTrace(exec, result, startedMs, endedMs, thrownError) {
  if (!exec || !KNOWLEDGE_TRACE_TOOLS.has(exec.name)) return null;
  const position = knowledgeTracePosition(exec);
  const resultSummary = summarizeKnowledgeTraceResult(exec.name, result, thrownError);
  const trace = cleanKnowledgeTrace({
    id: randomUUID(),
    sessionId: exec.agent && exec.agent.id || '',
    callId: exec.callId || '',
    rootCallId: exec.rootCallId || exec.callId || '',
    turn: position.turn,
    step: position.step,
    tool: exec.name,
    arguments: exec.arguments,
    startedAt: new Date(startedMs).toISOString(),
    endedAt: new Date(endedMs).toISOString(),
    startedMs,
    endedMs,
    success: resultSummary.success,
    result: resultSummary
  });
  await mutateKnowledgeTraceStore((store) => { store.traces.push(trace); });
  return trace;
}

async function traceKnowledgeToolExecution(exec, next) {
  if (!exec || !KNOWLEDGE_TRACE_TOOLS.has(exec.name)) return next();
  const startedMs = Date.now();
  try {
    const result = await next();
    try { await recordKnowledgeToolTrace(exec, result, startedMs, Date.now(), null); }
    catch (error) { diag('knowledge trace write failed: ' + String((error && error.stack) || error)); }
    return result;
  } catch (error) {
    try { await recordKnowledgeToolTrace(exec, null, startedMs, Date.now(), error); }
    catch (traceError) { diag('knowledge trace write failed: ' + String((traceError && traceError.stack) || traceError)); }
    throw error;
  }
}

async function knowledgeOnlineAuditSummary() {
  try {
    const taskStore = await readTaskStore();
    const audits = (taskStore.orchestrations || []).map((item) => item.knowledgeCitationAudit).filter((audit) => audit && typeof audit === 'object');
    const grounded = audits.filter((audit) => audit.level === 'ref+groundedness');
    const rate = (list, predicate) => list.length ? Math.round(list.filter(predicate).length / list.length * 1000) / 1000 : null;
    const orchestrationChecks = grounded.flatMap((audit) => Array.isArray(audit.groundednessChecks) ? audit.groundednessChecks : []);
    let traceChecks = [];
    try {
      const traceStore = await readKnowledgeTraceStore();
      traceChecks = traceStore.traces.filter((trace) => trace.tool === 'knowledge_audit').flatMap((trace) => trace.result && Array.isArray(trace.result.checks) ? trace.result.checks : []);
    } catch { /* trace store is best-effort */ }
    const checks = traceChecks.length ? traceChecks : orchestrationChecks;
    const eligibleChecks = checks.filter((check) => check.verdict !== 'abstained');
    const sentenceRate = eligibleChecks.length ? Math.round(eligibleChecks.filter((check) => check.verdict === 'grounded').length / eligibleChecks.length * 1000) / 1000 : null;
    let completenessValues = [];
    try {
      const traceStore = await readKnowledgeTraceStore();
      completenessValues = traceStore.traces
        .filter((trace) => trace.tool === 'knowledge_audit')
        .map((trace) => Number(trace.result && trace.result.completeness))
        .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
    } catch { /* best-effort */ }
    const completeness = completenessValues.length ? Math.round(completenessValues.reduce((sum, value) => sum + value, 0) / completenessValues.length * 1000) / 1000 : null;
    return {
      citationSamples: audits.length,
      citationValidRate: rate(audits, (audit) => audit.valid === true),
      abstainRate: rate(audits, (audit) => audit.abstainRequired === true),
      groundednessSamples: eligibleChecks.length || grounded.length,
      groundedness: eligibleChecks.length ? sentenceRate : rate(grounded, (audit) => audit.valid === true && (!audit.groundedness || audit.groundedness.length === 0)),
      groundednessChecks: eligibleChecks.length,
      groundednessMethod: null,
      faithfulness: sentenceRate,
      completeness
    };
  } catch {
    return { citationSamples: 0, citationValidRate: null, abstainRate: null, groundednessSamples: 0, groundedness: null, groundednessChecks: 0, groundednessMethod: null, faithfulness: null, completeness: null };
  }
}

async function knowledgeTop1Relevance(query, entry) {
  try {
    const config = await readVectorConfig();
    if (!['bge-local', 'bge-node'].includes(config.provider) || !entry) return null;
    const embedded = await embedKnowledgeTexts(config, [
      query,
      [entry.title, entry.summary].filter(Boolean).join('\n').slice(0, 2000)
    ]);
    if (!embedded || !Array.isArray(embedded.vectors) || embedded.vectors.length < 2 || !embedded.vectors[0].length) return null;
    return Math.round(cosineSimilarity(embedded.vectors[0], embedded.vectors[1]) * 1000) / 1000;
  } catch { return null; }
}

async function runKnowledgeEvalSet(options = {}) {
  const store = await readKnowledgeEval();
  const items = store.items || [];
  const topK = clampInt(options.topK, 1, 10, 5);
  const rerank = ['none', 'local', 'llm', 'cross'].includes(options.rerank) ? options.rerank : '';
  const searchOptions = { topK: Math.max(topK, 10), tokenBudget: 4000 };
  if (rerank) searchOptions.rerank = rerank;
  const results = [];
  for (const item of items) {
    const start = Date.now();
    const search = await runKnowledgeSearch(item.question, '', searchOptions);
    const topResults = (search.results || []).slice(0, topK);
    const top1 = topResults[0] || null;
    const paths = new Set(topResults.map((result) => result.path));
    const titles = new Set(topResults.map((result) => result.title.toLowerCase()));
    const expected = item.expected || [];
    const hits = expected.filter((exp) => {
      const normalized = String(exp).toLowerCase();
      return paths.has(exp) || titles.has(normalized) || titles.has(normalized.replace(/\.md$/, ''));
    });
    const top1Hit = top1 ? expected.some((exp) => {
      const normalized = String(exp).toLowerCase();
      return top1.path === exp || top1.title.toLowerCase() === normalized || top1.title.toLowerCase() === normalized.replace(/\.md$/, '');
    }) : false;
    const top1Relevance = rerank && top1 ? await knowledgeTop1Relevance(item.question, top1) : null;
    results.push({
      id: item.id,
      question: item.question,
      expected: expected.length,
      hits: hits.length,
      hitPaths: hits,
      top1Hit,
      top1Path: top1 ? top1.path : '',
      top1Relevance,
      rerankMode: rerank || (search.rerankMode || 'default'),
      topK,
      latencyMs: Date.now() - start,
      tokens: search.estimatedTokens || 0,
      retrievalTokens: search.retrievalTokens || search.estimatedTokens || 0,
      coverage: search.coverage || null,
      firstCoverage: search.firstCoverage || search.coverage || null,
      mode: search.mode || '',
      routes: search.routes || [],
      iterations: search.iterations || 1,
      iterationReason: search.routing && search.routing.iterationReason || '',
      expectedStrategy: item.expectedStrategy || '',
      actualStrategy: Number(search.iterations || 1) > 1 ? 'iterative' : 'single',
      expectedWeb: item.expectedWeb || '',
      actualWeb: search.coverage && search.coverage.action === 'parallel-kb-web' ? 'parallel' : search.coverage && search.coverage.action === 'web-primary' ? 'primary' : 'none'
    });
  }
  const completed = results.length;
  const totalExpected = results.reduce((sum, result) => sum + result.expected, 0);
  const totalHits = results.reduce((sum, result) => sum + result.hits, 0);
  const recallAtK = completed && totalExpected ? Math.round((totalHits / totalExpected) * 1000) / 1000 : 0;
  const top1HitRate = completed ? Math.round(results.filter((result) => result.top1Hit).length / completed * 1000) / 1000 : 0;
  const relevanceScores = results.map((result) => result.top1Relevance).filter((value) => typeof value === 'number');
  const avgTop1Relevance = relevanceScores.length ? Math.round(relevanceScores.reduce((sum, value) => sum + value, 0) / relevanceScores.length * 1000) / 1000 : null;
  const routeSamples = results.filter((result) => result.expectedStrategy);
  const webRouteSamples = results.filter((result) => result.expectedWeb);
  const simpleRouteSamples = routeSamples.filter((result) => result.expectedStrategy === 'single');
  const routeAccuracy = routeSamples.length ? Math.round(routeSamples.filter((result) => result.actualStrategy === result.expectedStrategy).length / routeSamples.length * 1000) / 1000 : null;
  const webRouteAccuracy = webRouteSamples.length ? Math.round(webRouteSamples.filter((result) => result.actualWeb === result.expectedWeb).length / webRouteSamples.length * 1000) / 1000 : null;
  const simpleSinglePassRate = simpleRouteSamples.length ? Math.round(simpleRouteSamples.filter((result) => result.actualStrategy === 'single').length / simpleRouteSamples.length * 1000) / 1000 : null;
  const onlineAudit = await knowledgeOnlineAuditSummary();
  const runtime = await knowledgeRuntimeStats();
  const acceptanceChecks = [
    { id: 'dataset-size', label: '离线评测题数', actual: completed, target: 50, passed: completed >= 50 },
    { id: 'recall-at-k', label: 'recall@' + topK, actual: recallAtK, target: 0.9, passed: completed > 0 && recallAtK >= 0.9 },
    { id: 'groundedness-samples', label: '逐句审计样本', actual: onlineAudit.groundednessSamples, target: 20, passed: onlineAudit.groundednessSamples >= 20 },
    { id: 'groundedness', label: 'groundedness', actual: onlineAudit.groundedness, target: 0.85, passed: onlineAudit.groundedness !== null && onlineAudit.groundedness >= 0.85 }
  ];
  const report = {
    ranAt: new Date().toISOString(),
    topK,
    rerankMode: rerank || 'default',
    items: completed,
    recallAtK,
    top1HitRate,
    avgTop1Relevance,
    avgTokens: completed ? Math.round(results.reduce((sum, result) => sum + result.tokens, 0) / completed) : 0,
    avgRetrievalTokens: completed ? Math.round(results.reduce((sum, result) => sum + result.retrievalTokens, 0) / completed) : 0,
    avgLatencyMs: completed ? Math.round(results.reduce((sum, result) => sum + result.latencyMs, 0) / completed) : 0,
    avgCoverage: completed ? Math.round(results.reduce((sum, result) => sum + Number(result.coverage && result.coverage.score || 0), 0) / completed * 1000) / 1000 : 0,
    routeSamples: routeSamples.length,
    routeAccuracy,
    webRouteSamples: webRouteSamples.length,
    webRouteAccuracy,
    simpleSinglePassRate,
    coverageLevels: {
      sufficient: results.filter((result) => result.coverage && result.coverage.level === 'sufficient').length,
      gray: results.filter((result) => result.coverage && result.coverage.level === 'gray').length,
      insufficient: results.filter((result) => !result.coverage || result.coverage.level === 'insufficient').length
    },
    webFallbackRate: completed ? Math.round(results.filter((result) => result.coverage && result.coverage.action !== 'knowledge-only').length / completed * 1000) / 1000 : 0,
    iterativeRate: completed ? Math.round(results.filter((result) => Number(result.iterations || 1) > 1).length / completed * 1000) / 1000 : 0,
    onlineAudit,
    runtime,
    faithfulness: onlineAudit.faithfulness,
    completeness: onlineAudit.completeness,
    acceptance: { ready: acceptanceChecks.every((check) => check.passed), checks: acceptanceChecks },
    results
  };
  store.lastRun = report;
  store.history = store.history || [];
  store.history.push(report);
  if (store.history.length > 10) store.history = store.history.slice(-10);
  await writeKnowledgeEval(store);
  return report;
}

async function addKnowledgeEvalCandidate(question) {
  const text = cleanTaskText(question, 500);
  if (!text) return;
  const store = await readKnowledgeEval();
  store.candidates = store.candidates || [];
  const normalized = text.replace(/\s+/g, ' ').toLowerCase();
  if (store.candidates.some((item) => String(item.question || '').replace(/\s+/g, ' ').toLowerCase() === normalized)) return;
  store.candidates.push(cleanEvalItem({ question: text, note: '自动记录：检索无结果', expected: [] }));
  store.candidates = store.candidates.slice(-200);
  await writeKnowledgeEval(store);
}

async function knowledgeRecordMissCandidate(query, coverage, hasSelectedResults) {
  const level = coverage && coverage.level;
  const lexical = Number(coverage && coverage.lexicalCoverage) || 0;
  const isMiss = !hasSelectedResults || level === 'insufficient' || (level === 'gray' && lexical === 0);
  if (!isMiss) return;
  try { await addKnowledgeEvalCandidate(query); } catch (e) { /* best effort */ }
}

async function knowledgeCompletenessScore(question, answer, refs) {
  if (chatLlm === null) return null;
  const refsSummary = (Array.isArray(refs) ? refs : []).map((entry) => entry.id + '《' + entry.title + '》 ' + String(entry.snippet || '').replace(/\s+/g, ' ').slice(0, 120)).join('\n');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const text = await streamLlmText(
        '你是回答完整度评估器。以下是回答可依据的知识条目摘要（只用于判断问题是否可答，不要求回答覆盖所有条目）。判断回答是否完整覆盖"问题要求且条目能支撑的要点"。只输出一个 0.0 到 1.0 的小数作为完整度分数，不要输出任何解释、引号或 JSON。\n评分口径：\n- 问题要求且条目能支撑的要点全部覆盖，无法支撑的部分明确标注（未验证）→ 0.9 以上；\n- 遗漏一个可支撑的明显要点 → 0.6-0.8；\n- 只覆盖一半或更少可答要点 → 0.5 以下；\n- 条目确实没有相关信息、回答如实说明无法确认（未验证）→ 0.85 以上（诚实 abstain 不算遗漏）；\n- 回答与问题无关 → 0.1 以下。',
        '知识条目摘要：\n' + (refsSummary || '（无）') + '\n\n问题：' + String(question || '').slice(0, 1000) + '\n\n回答：\n' + String(answer || '').slice(0, 4000) + '\n\n输出：',
        { maxTokens: 256, temperature: 0 }
      );
      const match = /(\d+(?:\.\d+)?)/.exec(String(text || ''));
      const value = match ? Number(match[1]) : NaN;
      if (Number.isFinite(value) && value >= 0 && value <= 1) return Math.round(value * 1000) / 1000;
      if (attempt === 0 && !String(text || '').trim()) continue;
      diag('knowledge completeness score parse failed: ' + String(text || '').slice(0, 200));
      break;
    } catch (error) {
      if (attempt === 0) {
        diag('knowledge completeness score failed (retry): ' + String((error && error.message) || error));
        continue;
      }
      diag('knowledge completeness score failed: ' + String((error && error.message) || error));
    }
  }
  return null;
}

async function generateKnowledgeGroundednessSamples(options = {}) {
  const store = await readKnowledgeEval();
  const items = (store.items || []).slice(0, clampInt(options.count, 1, 50, 20));
  const topK = clampInt(options.topK, 1, 10, 5);
  const results = [];
  for (const item of items) {
    const search = await runKnowledgeSearch(item.question, '', { topK: Math.max(topK, 5), tokenBudget: 4000 });
    const refs = (search.results || []).slice(0, Math.max(topK, 3)).map((entry, index) => ({
      id: '知识' + (index + 1),
      title: entry.title,
      path: entry.path,
      confidence: entry.computedConfidence || entry.confidence || 'medium',
      snippet: entry.summary || entry.snippet || ''
    }));
    let answer = '';
    let block = '';
    if (refs.length && chatLlm !== null) {
      const meta = {
        query: item.question,
        mode: search.mode || '',
        routes: search.routes || [],
        vectorStatus: search.vectorStatus || 'n/a',
        estimatedTokens: search.estimatedTokens || 0,
        retrievalTokens: search.retrievalTokens || 0,
        latencyMs: search.latencyMs || 0,
        coverage: search.coverage || null,
        iterations: search.iterations || 1
      };
      block = knowledgeAutoBuildBlock(refs, meta, { maxRefs: refs.length, tokenBudget: 4000 });
      answer = await streamLlmText(
        '你是知识库问答助手。只依据给定知识条目回答用户问题：\n' +
        '1. 每个结论句必须紧邻标注支撑它的引用，格式 [知识N《标题》· 置信度X]；\n' +
        '2. 知识条目无法支撑的结论不要写，或明确标注（未验证）；\n' +
        '3. 不要编造引用与事实；\n' +
        '4. 完整回答问题的所有要点：若问题包含多个方面或步骤，逐点覆盖，不要只答一半；宁可列出全部要点也不要遗漏。',
        '知识条目：\n' + block + '\n\n问题：' + item.question + '\n\n回答：',
        { maxTokens: 2000, temperature: 0.2 }
      );
    }
    const audit = answer && answer.trim()
      ? await auditKnowledgeCitationsDeep(answer, refs, {
          level: 'ref+groundedness',
          query: item.question,
          autoFix: true,
          completeness: await knowledgeCompletenessScore(item.question, answer, refs)
        })
      : null;
    results.push({
      id: item.id,
      question: item.question,
      refs: refs.length,
      answerLength: answer.length,
      answerPreview: String(answer).slice(0, 300),
      completeness: audit ? audit.completeness : null,
      audit: audit ? {
        valid: audit.valid,
        rate: audit.groundednessRate,
        claims: audit.groundednessSummary,
        fixed: audit.fixed,
        fixMethod: audit.fix && audit.fix.method,
        method: audit.groundednessMethod
      } : null
    });
  }
  const audited = results.filter((result) => result.audit);
  const checks = audited.flatMap((result) => result.audit && result.audit.claims ? result.audit.claims.claims || [] : []);
  const sentenceRate = checks.length ? Math.round(checks.filter((check) => check.verdict === 'grounded').length / checks.length * 1000) / 1000 : null;
  const traces = await readKnowledgeTraceStore();
  return {
    generatedAt: new Date().toISOString(),
    target: KNOWLEDGE_GROUNDEDNESS_TARGET,
    generated: results.length,
    audited: audited.length,
    skippedNoRefs: results.filter((result) => !result.refs).length,
    skippedNoAnswer: results.filter((result) => result.refs && !result.answerLength).length,
    claimSamples: checks.length,
    groundednessRate: sentenceRate,
    auditTraces: traces.traces.filter((trace) => trace.tool === 'knowledge_audit').length,
    results
  };
}

async function recordKnowledgeFeedback(raw) {
  const question = cleanTaskText(raw && raw.question, 500);
  if (!question) throw new Error('question required');
  const rating = ['helpful', 'unhelpful', 'miss'].includes(raw && raw.rating)
    ? raw.rating
    : 'miss';
  const requestedPaths = Array.isArray(raw && raw.paths) ? raw.paths.slice(0, 5) : [];
  let index = await readKnowledgeIndex();
  if (await knowledgeIndexStale()) index = await scanKnowledgeVault();
  const knownPaths = new Set((index.entries || []).map((entry) => entry.path));
  const paths = [...new Set(requestedPaths.map((path) => {
    const target = knowledgeResolve(path);
    return target && knownPaths.has(target.relPath) ? target.relPath : '';
  }).filter(Boolean))];
  if (rating !== 'miss' && !paths.length) throw new Error('at least one valid knowledge path is required');

  let usage = {};
  if (rating !== 'miss') {
    const quality = await readKnowledgeQuality();
    quality.usage = quality.usage || {};
    const at = new Date().toISOString();
    for (const path of paths) {
      const current = quality.usage[path] || { hits: 0, lastHitAt: '' };
      quality.usage[path] = {
        ...current,
        helpful: Math.max(0, Number(current.helpful) || 0) + (rating === 'helpful' ? 1 : 0),
        unhelpful: Math.max(0, Number(current.unhelpful) || 0) + (rating === 'unhelpful' ? 1 : 0),
        lastFeedbackAt: at
      };
      usage[path] = quality.usage[path];
    }
    await writeKnowledgeQuality(quality);
  }

  const evalStore = await readKnowledgeEval();
  evalStore.candidates = evalStore.candidates || [];
  const existing = evalStore.candidates.find((item) => String(item.question || '').toLocaleLowerCase() === question.toLocaleLowerCase());
  const expected = rating === 'helpful' ? paths : [];
  const note = cleanTaskText(raw && raw.note, 500) || (rating === 'helpful' ? '用户反馈：召回有帮助' : rating === 'unhelpful' ? '用户反馈：召回不准确，需补全或降权' : '用户反馈：未命中');
  if (existing) {
    existing.note = note;
    if (expected.length) existing.expected = [...new Set([...(existing.expected || []), ...expected])].slice(0, 20);
  } else {
    evalStore.candidates.push(cleanEvalItem({ question, note, expected }));
  }
  evalStore.candidates = evalStore.candidates.slice(-200);
  await writeKnowledgeEval(evalStore);
  index = await scanKnowledgeVault();
  return { ok: true, rating, paths, usage, candidates: evalStore.candidates.length, entries: index.entries.length };
}

function knowledgeToolArgs(args, required, optional = []) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('tool arguments must be an object');
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(args).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError('unknown tool argument: ' + unknown[0]);
  for (const key of required) {
    if (typeof args[key] !== 'string' || !args[key].trim()) throw new TypeError(key + ' must be a non-empty string');
  }
  for (const key of optional) {
    if (args[key] !== undefined && typeof args[key] !== 'string') throw new TypeError(key + ' must be a string');
  }
  return args;
}

function throwIfKnowledgeToolAborted(exec) {
  if (!exec || !exec.signal || !exec.signal.aborted) return;
  const error = new Error('knowledge tool call aborted');
  error.name = 'AbortError';
  throw error;
}

async function readPublishedKnowledgeEntry(relPath, exec) {
  const target = knowledgeResolve(relPath);
  if (!target) throw new Error('invalid knowledge path');
  throwIfKnowledgeToolAborted(exec);
  const index = await readKnowledgeIndex();
  const entry = (index.entries || []).find((item) => item.path === target.relPath) || null;
  if (!entry || entry.status !== 'published') throw new Error('knowledge entry is not published');
  const info = await lstat(target.full);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('knowledge entry must be a regular file');
  if (info.size > KNOWLEDGE_MAX_ENTRY_BYTES) throw new Error('knowledge entry is too large');
  const raw = await readFile(target.full, 'utf8');
  throwIfKnowledgeToolAborted(exec);
  const parsed = parseFrontmatter(raw);
  // Legacy reviewed entries predate the status field. Their folder default and
  // indexed status remain authoritative unless the file explicitly opts out.
  if (parsed.status && parsed.status !== 'published') throw new Error('knowledge entry is not published');
  const truncated = raw.length > KNOWLEDGE_TOOL_READ_MAX_CHARS;
  const content = truncated ? raw.slice(0, KNOWLEDGE_TOOL_READ_MAX_CHARS) : raw;
  return {
    path: target.relPath,
    title: cleanTaskText(parsed.title, 300) || cleanTaskText(entry.title, 300) || basename(target.file, '.md'),
    confidence: KNOWLEDGE_CONFIDENCES.includes(entry.computedConfidence) ? entry.computedConfidence : KNOWLEDGE_CONFIDENCES.includes(entry.confidence) ? entry.confidence : 'medium',
    content,
    truncated,
    estimatedTokens: Math.max(1, Math.ceil(content.length / 2.5))
  };
}

function renderKnowledgeSearchTool(value) {
  const lines = [
    '知识库检索：覆盖 ' + value.coverage + '（' + value.coverageScore + '）· 动作 ' + value.action + ' · ' + value.iterations + ' 轮 · ' + value.latencyMs + 'ms'
  ];
  for (const result of value.results || []) {
    lines.push('', '[' + result.id + '《' + result.title + '》· 置信度' + result.confidence + ']', '路径：' + result.path);
    if (result.summary) lines.push('摘要：' + result.summary);
  }
  if (!value.results || !value.results.length) lines.push('', '未找到可引用的已发布知识条目。');
  if (value.action === 'parallel-kb-web') lines.push('', '覆盖处于灰区：并行使用 web_search 补充证据，并明确说明冲突。');
  if (value.action === 'web-primary') lines.push('', '覆盖不足：以 web_search 为主；知识库未支持的结论必须标记为未验证。');
  lines.push('', '引用知识库结论时使用上方完整标签，不要虚构编号、标题或路径。');
  return lines.join('\n');
}

function renderKnowledgeReadTool(value) {
  const lines = [
    '知识条目《' + value.title + '》· 置信度' + value.confidence,
    '路径：' + value.path,
    '',
    value.content
  ];
  if (value.truncated) lines.push('', '[内容已按 token 上限截断]');
  lines.push('', '引用时沿用 knowledge_search 为该路径返回的完整 [知识N《标题》· 置信度X] 标签。');
  return lines.join('\n');
}

function makeKnowledgeSearchTool() {
  return {
    name: 'knowledge_search',
    description: 'Search the user\'s published personal and project knowledge. Returns compact summaries, coverage routing, and citation labels; it never returns full note content.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'A focused question to search for in the knowledge base.' },
        project: { type: 'string', description: 'Optional project name used to select its retrieval profile.' }
      },
      required: ['query']
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string' },
          coverage: { type: 'string', enum: ['sufficient', 'gray', 'insufficient'] },
          coverageScore: { type: 'number' },
          action: { type: 'string', enum: ['knowledge-only', 'parallel-kb-web', 'web-primary'] },
          results: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' }, title: { type: 'string' }, path: { type: 'string' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, summary: { type: 'string' }
              },
              required: ['id', 'title', 'path', 'confidence', 'summary']
            }
          },
          estimatedTokens: { type: 'integer' }, retrievalTokens: { type: 'integer' },
          latencyMs: { type: 'integer' }, iterations: { type: 'integer' }
        },
        required: ['query', 'coverage', 'coverageScore', 'action', 'results', 'estimatedTokens', 'retrievalTokens', 'latencyMs', 'iterations']
      },
      render: (_args, value) => [{ type: 'text', text: renderKnowledgeSearchTool(value) }],
      presentationMeta: (_args, value) => ({ coverage: value.coverage, action: value.action, resultCount: value.results.length })
    },
    timeoutMs: 30000,
    isConcurrencySafe: () => true,
    async execute(rawArgs, exec) {
      const args = knowledgeToolArgs(rawArgs, ['query'], ['project']);
      const query = cleanTaskText(args.query, KNOWLEDGE_MAX_QUERY_CHARS);
      if (!query) throw new TypeError('query must be a non-empty string');
      throwIfKnowledgeToolAborted(exec);
      const config = await readKnowledgeAutoConfig();
      if (!config.enabled) throw new Error('knowledge retrieval is disabled');
      const search = await runKnowledgeSearch(query, cleanTaskText(args.project, 300), {
        topK: Math.max(config.topK, config.maxRefs),
        tokenBudget: config.tokenBudget,
        rerank: config.rerank,
        routingMode: config.routing,
        maxIterations: config.maxIterations,
        thresholds: config.thresholds
      });
      throwIfKnowledgeToolAborted(exec);
      if (search.error) throw new Error(search.error);
      const minRank = { high: 2, medium: 1, low: 0 }[config.minConfidence] ?? 1;
      const selected = (search.results || [])
        .filter((entry) => knowledgeEntryConfidenceRank(entry) >= minRank)
        .slice(0, config.maxRefs);
      const coverage = knowledgeCoverageSignal(query, selected, config.thresholds);
      const results = selected.map((entry, index) => ({
        id: '知识' + (index + 1),
        title: cleanTaskText(entry.title, 300),
        path: entry.path,
        confidence: KNOWLEDGE_CONFIDENCES.includes(entry.computedConfidence) ? entry.computedConfidence : KNOWLEDGE_CONFIDENCES.includes(entry.confidence) ? entry.confidence : 'medium',
        summary: cleanTaskText(entry.summary || entry.snippet, 600)
      }));
      await knowledgeRecordMissCandidate(query, coverage, results.length > 0);
      return {
        query,
        coverage: coverage.level,
        coverageScore: coverage.score,
        action: coverage.action,
        results,
        estimatedTokens: Math.max(0, Math.ceil(results.reduce((sum, item) => sum + item.title.length + item.path.length + item.summary.length + 40, 0) / 2.5)),
        retrievalTokens: Math.max(0, Math.round(search.retrievalTokens || search.estimatedTokens || 0)),
        latencyMs: Math.max(0, Math.round(search.latencyMs || 0)),
        iterations: clampInt(search.iterations, 1, 2, 1)
      };
    },
    presentCall: (args) => ({ card: 'generic', title: cleanTaskText(args && args.query, 120) || '搜索知识库', kind: 'search', rawInput: cleanTaskText(args && args.query, 1000) }),
    presentResult: () => ({ card: 'generic' })
  };
}

function makeKnowledgeReadTool() {
  return {
    name: 'knowledge_read',
    description: 'Read one published knowledge entry returned by knowledge_search when its summary is insufficient. Paths outside the knowledge index and unpublished entries are rejected.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { path: { type: 'string', description: 'Exact knowledge path returned by knowledge_search.' } },
      required: ['path']
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string' }, title: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          content: { type: 'string' }, truncated: { type: 'boolean' }, estimatedTokens: { type: 'integer' }
        },
        required: ['path', 'title', 'confidence', 'content', 'truncated', 'estimatedTokens']
      },
      render: (_args, value) => [{ type: 'text', text: renderKnowledgeReadTool(value) }],
      presentationMeta: (_args, value) => ({ path: value.path, title: value.title, truncated: value.truncated })
    },
    timeoutMs: 10000,
    isConcurrencySafe: () => true,
    async execute(rawArgs, exec) {
      const args = knowledgeToolArgs(rawArgs, ['path']);
      return readPublishedKnowledgeEntry(args.path, exec);
    },
    presentCall: (args) => ({ card: 'generic', title: cleanTaskText(args && args.path, 160) || '读取知识条目', kind: 'read', rawInput: cleanTaskText(args && args.path, 500) }),
    presentResult: () => ({ card: 'generic' })
  };
}

const KNOWLEDGE_TOOL_PROMPT = [
  'Use knowledge_search for questions about the user\'s personal, project, workflow, or workbench knowledge. Do not call it for greetings, acknowledgements, or requests that do not depend on existing knowledge.',
  'For freshness-sensitive questions that need both personal/project knowledge and current external facts, emit knowledge_search and web_search together in the same assistant tool-call batch so they execute concurrently.',
  'Follow the knowledge_search coverage action: knowledge-only means answer from the returned entries; parallel-kb-web means use web_search too (in the same batch when it was already predictable, otherwise in the next batch); web-primary means use web_search as the primary source and mark unsupported knowledge-base claims as unverified.',
  'Do not repeat knowledge_search with a near-duplicate query after it reports sufficient coverage. Use knowledge_read for a missing detail, or one focused follow-up search only when the returned entries are demonstrably off-topic.',
  'Call knowledge_read only when a search summary is insufficient, and only with an exact path returned by knowledge_search.',
  'Cite knowledge claims with the complete [知识N《标题》· 置信度X] label returned by knowledge_search. Never invent knowledge paths, titles, labels, or citations.',
  'web_search is the only available Web retrieval tool. Never call web_fetch.',
  'Every claim based on web_search must include a clickable [source title](URL) copied from that tool result. A bare source name, the word 来源, or a placeholder without its real URL is not a valid web citation.',
  'Before sending the final answer, verify that every Web-backed claim has a real http(s) URL in Markdown link syntax. If you cannot provide that URL, omit the claim or mark it unverified instead of presenting it as fact.'
].join('\n');

function knowledgeResolve(relPath) {
  const parts = String(relPath || '').split('/');
  if (parts.length !== 2) return null;
  const [folder, file] = parts;
  if (!KNOWLEDGE_FOLDER_IDS.includes(folder)) return null;
  if (!/^[\w\u4e00-\u9fa5-]{1,160}\.md$/i.test(file)) return null;
  const full = join(KNOWLEDGE_FOLDER_DIRS[folder], file);
  if (!inside(KNOWLEDGE_ROOT, full)) return null;
  return { folder, file, full, relPath: folder + '/' + file };
}

function knowledgeWritePath(folder, name) {
  if (!KNOWLEDGE_FOLDER_IDS.includes(folder)) return null;
  if (!/^[\w\u4e00-\u9fa5-]{1,160}$/.test(name)) return null;
  return { folder, file: name + '.md', full: join(KNOWLEDGE_FOLDER_DIRS[folder], name + '.md'), relPath: folder + '/' + name + '.md' };
}

function conversationStylePrompt(sessionId = '') {
  const override = sessionId ? (styleState.sessionStyles || {})[sessionId] : null;
  const settings = override && override.conversationStyle
    ? { conversationStyle: override.conversationStyle, customConversationStyle: override.customConversationStyle || '' }
    : styleState.settings;
  if (settings.conversationStyle === 'custom') {
    const custom = settings.customConversationStyle.trim();
    return custom === '' ? '' : 'Conversation style selected by the user:\n' + custom;
  }
  return CONVERSATION_PROMPTS[settings.conversationStyle] || '';
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
    locked: Boolean(raw.locked),
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
    orchestrationId: String(raw.orchestrationId || ''),
    completedAt: status === 'completed' ? (typeof raw.completedAt === 'string' && raw.completedAt !== '' ? raw.completedAt : now) : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
  };
}

function orchestrationTaskStatus(phase) {
  if (['planning', 'running', 'refining', 'review'].includes(phase)) return 'in_progress';
  if (phase === 'accepted') return 'completed';
  if (phase === 'failed' || phase === 'cancelled') return 'blocked';
  return 'pending';
}

function syncOrchestrationTask(store, orchestration) {
  if (!orchestration || !orchestration.taskId) return;
  const index = store.tasks.findIndex((task) => task.id === orchestration.taskId);
  if (index < 0) return;
  const derived = orchestrationTaskStatus(orchestration.phase);
  const task = store.tasks[index];
  const now = new Date().toISOString();
  const active = derived === 'in_progress' || derived === 'pending';
  if (task.locked && !active) return;
  store.tasks[index] = cleanTask({
    ...task,
    status: derived,
    locked: active ? false : task.locked,
    completedAt: derived === 'completed' ? (orchestration.acceptedAt || now) : '',
    blockedReason: orchestration.phase === 'failed' ? (orchestration.runtimeError || 'AI 协作执行失败') : (orchestration.phase === 'cancelled' ? 'AI 协作已取消' : (store.tasks[index] && store.tasks[index].blockedReason) || ''),
    updatedAt: now
  });
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
    agentRef: cleanTaskText(value.agentRef, 80),
    provider: cleanTaskText(value.provider, 160),
    model: cleanTaskText(value.model, 240),
    modelReason: cleanTaskText(value.modelReason, 1000),
    readOnly: value.readOnly !== false,
    usedProvider: cleanTaskText(value.usedProvider, 160),
    usedModel: cleanTaskText(value.usedModel, 240),
    dependsOn: Array.isArray(value.dependsOn) ? [...new Set(value.dependsOn.map((item) => cleanTaskText(item, 120)).filter(Boolean))].slice(0, 12) : [],
    status: ORCHESTRATION_AGENT_STATUSES.includes(value.status) ? value.status : 'planned',
    sessionId: String(value.sessionId || ''),
    output: cleanTaskText(value.output, 30000),
    error: cleanTaskText(value.error, 4000),
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : '',
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : '',
    attempts: Number.isSafeInteger(value.attempts) && value.attempts >= 1 ? value.attempts : 1
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

function cleanModelProbe(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const results = Array.isArray(value.results) ? value.results.map((entry) => ({
    provider: cleanTaskText(entry && entry.provider, 160),
    model: cleanTaskText(entry && (entry.model || entry.id), 240),
    name: cleanTaskText(entry && entry.name, 240),
    available: Boolean(entry && entry.available),
    cached: Boolean(entry && entry.cached),
    reason: cleanTaskText(entry && entry.reason, 1000),
    checkedAt: typeof (entry && entry.checkedAt) === 'string' ? entry.checkedAt : ''
  })).filter((entry) => entry.provider && entry.model).slice(0, 200) : [];
  const catalogCount = Math.max(results.length, Number.isSafeInteger(value.catalogCount) ? value.catalogCount : results.length);
  return {
    status: ['idle', 'probing', 'ready', 'fallback'].includes(value.status) ? value.status : (results.length ? 'ready' : 'idle'),
    checkedAt: typeof value.checkedAt === 'string' ? value.checkedAt : '',
    cacheMinutes: 10,
    availableCount: results.filter((entry) => entry.available).length,
    totalCount: results.length,
    catalogCount,
    skippedCount: Math.max(0, catalogCount - results.length),
    results
  };
}

function cleanSourceReference(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const kind = ['idea', 'file', 'knowledge'].includes(value.kind) ? value.kind : 'file';
  return {
    kind,
    title: cleanTaskText(value.title, 300),
    content: cleanTaskText(value.content, 6000)
  };
}

function cleanKnowledgeAutoMeta(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const coverage = value.coverage && typeof value.coverage === 'object' ? value.coverage : null;
  return {
    mode: cleanTaskText(value.mode, 80),
    routes: Array.isArray(value.routes) ? value.routes.map((item) => cleanTaskText(item, 80)).filter(Boolean).slice(0, 8) : [],
    vectorStatus: cleanTaskText(value.vectorStatus, 80),
    estimatedTokens: Number.isFinite(Number(value.estimatedTokens)) ? Math.max(0, Math.round(Number(value.estimatedTokens))) : 0,
    retrievalTokens: Number.isFinite(Number(value.retrievalTokens)) ? Math.max(0, Math.round(Number(value.retrievalTokens))) : 0,
    latencyMs: Number.isFinite(Number(value.latencyMs)) ? Math.max(0, Math.round(Number(value.latencyMs))) : 0,
    query: cleanTaskText(value.query, 1000),
    iterations: Number.isSafeInteger(Number(value.iterations)) ? Math.max(1, Math.min(2, Number(value.iterations))) : 1,
    coverage: coverage ? {
      score: Number.isFinite(Number(coverage.score)) ? Math.max(0, Math.min(1, Number(coverage.score))) : 0,
      maxConfidence: Number.isFinite(Number(coverage.maxConfidence)) ? Math.max(0, Math.min(1, Number(coverage.maxConfidence))) : 0,
      hitCount: Number.isSafeInteger(Number(coverage.hitCount)) ? Math.max(0, Number(coverage.hitCount)) : 0,
      lexicalCoverage: Number.isFinite(Number(coverage.lexicalCoverage)) ? Math.max(0, Math.min(1, Number(coverage.lexicalCoverage))) : 0,
      level: ['sufficient', 'gray', 'insufficient'].includes(coverage.level) ? coverage.level : 'insufficient',
      action: cleanTaskText(coverage.action, 40)
    } : null,
    at: typeof value.at === 'string' ? value.at : ''
  };
}

function knowledgeAutoPrompt(refs, meta) {
  if (!meta) return '';
  return knowledgeAutoBuildBlock(Array.isArray(refs) ? refs : [], meta, { webFallback: true });
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
    quick: Boolean(raw.quick),
    attachments: Array.isArray(raw.attachments) ? raw.attachments.map(cleanAttachment).filter((entry) => entry.id).slice(0, 12) : [],
    memory: Array.isArray(raw.memory) ? raw.memory.map(cleanMemorySnapshot).filter((entry) => entry.id).slice(0, 5) : [],
    sourceRefs: Array.isArray(raw.sourceRefs) ? raw.sourceRefs.map(cleanSourceReference).filter((entry) => entry.title).slice(0, 12) : [],
    knowledgeRefs: Array.isArray(raw.knowledgeRefs) ? raw.knowledgeRefs.map(cleanKnowledgeRef).filter((entry) => entry.title).slice(0, 5) : [],
    knowledgeMeta: raw.knowledgeMeta && typeof raw.knowledgeMeta === 'object' ? cleanKnowledgeAutoMeta(raw.knowledgeMeta) : null,
    knowledgeCitationAudit: raw.knowledgeCitationAudit && typeof raw.knowledgeCitationAudit === 'object' ? raw.knowledgeCitationAudit : null,
    modelProbe: cleanModelProbe(raw.modelProbe),
    modelPolicy: cleanTaskText(raw.modelPolicy, 40),
    projectPath: String(raw.projectPath || ''),
    sourceSessionId: String(raw.sourceSessionId || ''),
    taskId: String(raw.taskId || ''),
    phase,
    plan: currentPlan,
    mainAgent: raw.mainAgent && typeof raw.mainAgent === 'object' ? cleanOrchestrationAgent(raw.mainAgent, '主协调代理', '负责拆解、汇总与质量控制') : null,
    workers: Array.isArray(raw.workers) ? raw.workers.map((worker, index) => cleanOrchestrationAgent(worker, '子代理 ' + (index + 1), '执行代理')).slice(0, 6) : [],
    maxParallel: Number.isSafeInteger(raw.maxParallel) ? Math.max(1, Math.min(4, raw.maxParallel)) : 3,
    attempt: Number.isSafeInteger(raw.attempt) && raw.attempt >= 0 ? raw.attempt : 0,
    feedback: cleanTaskText(raw.feedback, 6000),
    planningNote: cleanTaskText(raw.planningNote, 200),
    thread: Array.isArray(raw.thread) ? raw.thread.map((entry) => ({ role: entry && entry.role === 'user' ? 'user' : 'main', text: cleanTaskText(entry && entry.text, 20000), at: typeof (entry && entry.at) === 'string' ? entry.at : '' })).filter((entry) => entry.text).slice(-60) : [],
    refineCount: Number.isSafeInteger(raw.refineCount) && raw.refineCount >= 0 ? raw.refineCount : 0,
    finalReport: cleanTaskText(raw.finalReport, 30000),
    runtimeError: cleanTaskText(raw.runtimeError, 6000),
    acceptedNote: cleanTaskText(raw.acceptedNote, 6000),
    planVersions,
    runs: Array.isArray(raw.runs) ? raw.runs.map((run, index) => cleanOrchestrationRun(run, index + 1)).slice(-30) : [],
    log: Array.isArray(raw.log) ? raw.log.map(cleanLogEntry).filter(Boolean).slice(-200) : [],
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
    const modelHealth = cleanModelHealth(parsed.modelHealth);
    return {
      version: 4,
      revision: Number.isSafeInteger(parsed.revision) && parsed.revision >= 0 ? parsed.revision : 0,
      tasks: parsed.tasks.map(cleanTask),
      templates: Array.isArray(parsed.templates) ? parsed.templates.map(cleanTemplate) : [],
      ideas: Array.isArray(parsed.ideas) ? parsed.ideas.map(cleanIdea) : [],
      orchestrations: Array.isArray(parsed.orchestrations) ? parsed.orchestrations.map(cleanOrchestration) : [],
      modelHealth
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { version: 4, revision: 0, tasks: [], templates: [], ideas: [], orchestrations: [], modelHealth: {} };
    throw error;
  }
}

function cleanModelHealth(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = {};
  for (const [key, entry] of Object.entries(raw).slice(-200)) {
    const item = entry && typeof entry === 'object' ? entry : {};
    const failures = Number.isSafeInteger(item.failures) && item.failures > 0 ? Math.min(item.failures, 100) : 0;
    const lastFailedAt = typeof item.lastFailedAt === 'string' ? item.lastFailedAt : '';
    if (failures > 0 && lastFailedAt) out[String(key).slice(0, 300)] = { failures, lastFailedAt };
  }
  return out;
}

function recordModelFailure(provider, model, detail) {
  const key = (String(provider || '') + '\u0000' + String(model || '')).slice(0, 300);
  if (!key || key === '\u0000') return Promise.resolve();
  const operation = taskMutationQueue.then(async () => {
    const store = await readTaskStore();
    const current = (store.modelHealth || {})[key] || { failures: 0, lastFailedAt: '' };
    store.modelHealth = cleanModelHealth({
      ...(store.modelHealth || {}),
      [key]: { failures: current.failures + 1, lastFailedAt: new Date().toISOString() }
    });
    store.revision += 1;
    await writeTaskStore(store);
    broadcastTaskEvent({ type: 'tasks', revision: store.revision, action: 'model_health' });
    return store;
  });
  taskMutationQueue = operation.catch(() => {});
  return operation.catch(() => {});
}

async function writeTaskStore(store) {
  store.version = 4;
  await mkdir(DSH_ROOT, { recursive: true });
  const temp = TASK_STORE + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, JSON.stringify(store, null, 2) + '\n', 'utf8');
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(temp, TASK_STORE);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  try { await rm(temp, { force: true }); } catch (e) { /* keep the temp for inspection */ }
  throw lastError;
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

async function attachKnowledgeAuto(idea, sourceSessionId, projectPath) {
  try {
    const auto = await knowledgeAutoRetrieve(idea || '', sourceSessionId, projectPath);
    if (auto && auto.inject) {
      return { knowledgeRefs: auto.refs || [], knowledgeMeta: auto.meta || null };
    }
  } catch (e) { /* auto KB retrieval is best-effort; never block task creation */ }
  return { knowledgeRefs: [], knowledgeMeta: null };
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
      locked: patch.locked === undefined ? current.locked : Boolean(patch.locked),
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
  } else if (action === 'template_create') {
    const template = cleanTemplate({
      id: randomUUID(),
      title: body.title,
      description: body.description,
      steps: (Array.isArray(body.steps) ? body.steps : []).map((title, index) => ({ title: String(title || '').trim(), priority: 'medium', owner: 'agent', notes: '', durationMinutes: 0, labels: [], order: index })),
      sourceSessionId: body.sourceSessionId,
      createdAt: now,
      updatedAt: now
    });
    store.templates.push(template);
  } else if (action === 'template_update') {
    const index = store.templates.findIndex((item) => item.id === body.templateId);
    if (index < 0) throw new Error('template not found');
    const current = store.templates[index];
    store.templates[index] = cleanTemplate({
      ...current,
      title: body.title !== undefined && body.title !== null ? body.title : current.title,
      description: body.description !== undefined ? body.description : current.description,
      steps: Array.isArray(body.steps) ? body.steps.map((title, stepIndex) => ({ title: String(title || '').trim(), priority: 'medium', owner: 'agent', notes: '', durationMinutes: 0, labels: [], order: stepIndex })) : current.steps,
      updatedAt: now
    });
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
    const autoKb = await attachKnowledgeAuto(idea.body, body.sourceSessionId || idea.sourceSessionId, idea.projectPath);
    const orchestration = cleanOrchestration({
      title: idea.title, idea: idea.body, projectPath: idea.projectPath,
      sourceSessionId: body.sourceSessionId || idea.sourceSessionId, phase: 'idea', createdAt: now, updatedAt: now,
      knowledgeRefs: autoKb.knowledgeRefs, knowledgeMeta: autoKb.knowledgeMeta
    });
    store.orchestrations.push(orchestration);
    store.ideas[index] = cleanIdea({ ...idea, status: 'promoted', linkedOrchestrationId: orchestration.id, updatedAt: now });
  } else if (action === 'idea_remove') {
    const before = store.ideas.length;
    store.ideas = store.ideas.filter((item) => item.id !== body.id);
    if (store.ideas.length === before) throw new Error('idea not found');
  } else if (action === 'orchestration_create') {
    const autoKb = await attachKnowledgeAuto(body.idea, body.sourceSessionId, body.projectPath);
    const orchestration = cleanOrchestration({
      title: body.title,
      idea: body.idea,
      projectPath: body.projectPath,
      sourceSessionId: body.sourceSessionId,
      quick: body.quick,
      attachments: await resolveAttachments(body.attachments),
      memory: await resolveMemorySnapshots(body.memoryTokens),
      sourceRefs: body.sourceRefs,
      modelProbe: body.modelProbe,
      phase: 'idea',
      createdAt: now,
      updatedAt: now,
      knowledgeRefs: autoKb.knowledgeRefs,
      knowledgeMeta: autoKb.knowledgeMeta
    });
    const taskId = randomUUID();
    store.tasks.push(cleanTask({
      id: taskId,
      title: orchestration.title,
      status: 'pending',
      priority: orchestration.quick ? 'low' : 'medium',
      owner: 'agent',
      labels: ['AI协作'],
      notes: (orchestration.quick ? '快速问答' : '多代理编排') + '（AI 协作任务）\n' + orchestration.idea.slice(0, 400),
      projectPath: orchestration.projectPath,
      sourceSessionId: orchestration.sourceSessionId,
      orchestrationId: orchestration.id
    }));
    store.orchestrations.push(cleanOrchestration({ ...orchestration, taskId }));
  } else if (action === 'orchestration_set_planning') {
    const index = store.orchestrations.findIndex((item) => item.id === body.id);
    if (index < 0) throw new Error('orchestration not found');
    const current = store.orchestrations[index];
    store.orchestrations[index] = cleanOrchestration({
      ...current,
      phase: 'planning',
      planningNote: cleanTaskText(body.planningNote, 200) || 'AI 正在生成方案…',
      modelProbe: body.modelProbe || current.modelProbe,
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
      modelPolicy: cleanTaskText(body.modelPolicy, 40) || 'balanced',
      planVersions: [...current.planVersions, { version: nextVersion, plan, feedback: cleanTaskText(body.feedback, 6000), createdAt: now }],
      feedback: cleanTaskText(body.feedback, 6000),
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
    const sourceSessionId = cleanTaskText(current.sourceSessionId || body.sourceSessionId, 160);
    if (!sourceSessionId) throw new Error('source session required for agent execution');
    if (current.phase === 'running') throw new Error('orchestration is already running');
    const enforceReadOnly = body.readOnlyOverride === 'enforce';
    store.orchestrations[index] = cleanOrchestration({
      ...current,
      sourceSessionId,
      phase: 'running',
      attempt: current.attempt + 1,
      mainAgent: { ...current.mainAgent, status: 'waiting', sessionId: '', output: '', error: '', usedProvider: '', usedModel: '', startedAt: '', completedAt: '' },
      workers: current.workers.map((worker) => ({ ...worker, readOnly: enforceReadOnly ? true : worker.readOnly, status: 'planned', sessionId: '', output: '', error: '', usedProvider: '', usedModel: '', startedAt: '', completedAt: '' })),
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
  } else if (action === 'orchestration_worker_retry') {
    const index = store.orchestrations.findIndex((item) => item.id === body.id);
    if (index < 0) throw new Error('orchestration not found');
    const current = store.orchestrations[index];
    if (current.phase !== 'failed' && current.phase !== 'cancelled') throw new Error('只有异常中止或已终止的协作任务可以重试单个子代理');
    if (!current.plan || current.workers.length === 0) throw new Error('没有可执行的方案，请重新生成方案');
    const workerId = String(body.workerId || '');
    const target = (current.workers || []).find((worker) => worker.id === workerId);
    if (!target) throw new Error('子代理不存在');
    if (target.status === 'completed') throw new Error('该子代理已成功完成，无需重试');
    const retriedWorkers = current.workers.map((worker) => worker.id === workerId ? {
      ...worker, status: 'planned', sessionId: '', output: '', error: '', startedAt: '', completedAt: '', attempts: 1
    } : worker);
    store.orchestrations[index] = cleanOrchestration({
      ...current,
      phase: 'running',
      attempt: current.attempt + 1,
      mainAgent: { ...current.mainAgent, status: 'waiting', sessionId: '', output: '', error: '', startedAt: '', completedAt: '' },
      workers: retriedWorkers,
      finalReport: '',
      runtimeError: '',
      startedAt: now,
      completedAt: '',
      updatedAt: now
    });
  } else if (action === 'orchestration_continue') {
    const index = store.orchestrations.findIndex((item) => item.id === body.id);
    if (index < 0) throw new Error('orchestration not found');
    const current = store.orchestrations[index];
    if (current.phase !== 'review' && current.phase !== 'accepted') throw new Error('只有等待验收或已验收的协作任务可以继续优化');
    const message = cleanTaskText(body.message, 12000);
    if (message === '') throw new Error('请写下要继续优化的内容');
    store.orchestrations[index] = cleanOrchestration({
      ...current,
      phase: 'refining',
      refineCount: current.refineCount + 1,
      thread: [...(current.thread || []), { role: 'user', text: message, at: now }],
      mainAgent: current.mainAgent ? { ...current.mainAgent, status: 'running', startedAt: now, error: '' } : current.mainAgent,
      runtimeError: '',
      updatedAt: now
    });
  } else if (action === 'orchestration_remove') {
    const before = store.orchestrations.length;
    const removed = store.orchestrations.find((item) => item.id === body.id);
    store.orchestrations = store.orchestrations.filter((item) => item.id !== body.id);
    if (store.orchestrations.length === before) throw new Error('orchestration not found');
    if (removed && Array.isArray(removed.attachments)) {
      removed.attachments.forEach((entry) => { if (entry && entry.id) removeAttachmentFile(entry.id).catch(() => {}); });
    }
    if (removed && removed.taskId) store.tasks = store.tasks.filter((task) => task.id !== removed.taskId);
  } else {
    throw new Error('unsupported task action');
  }
  if (action.startsWith('orchestration_')) {
    for (const orchestration of store.orchestrations) syncOrchestrationTask(store, orchestration);
  }
  store.revision += 1;
  await writeTaskStore(store);
  broadcastTaskEvent({ type: 'tasks', revision: store.revision, action });
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

function repairJsonObject(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  if (start < 0) return null;
  const closers = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') closers.push('}');
    else if (ch === '[') closers.push(']');
    else if (ch === '}' || ch === ']') closers.pop();
  }
  if (closers.length === 0) return null;
  return raw.slice(start).trimEnd() + closers.reverse().join('');
}

function parseJsonObject(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(raw); } catch (firstError) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(raw.slice(start, end + 1)); } catch (e) { /* fall through to repair */ }
    }
    const repaired = repairJsonObject(raw);
    if (repaired !== null) {
      try { return JSON.parse(repaired); } catch (e) { /* fall through to original error */ }
    }
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

async function probeOneOrchestrationModel(item, force) {
  const key = item.provider + '\u0000' + item.id;
  const cached = modelProbeCache.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) return { ...cached.result, cached: true };
  const checkedAt = new Date().toISOString();
  let result;
  try {
    const iterator = chatLlm.stream({
      provider: item.provider,
      model: item.id,
      system: 'Reply with exactly OK.',
      messages: [{ id: 'wb-model-probe-' + (++chatCounter), role: 'user', content: [{ type: 'text', text: 'OK' }], source: { kind: 'user' } }],
      temperature: 0,
      maxTokens: 4
    })[Symbol.asyncIterator]();
    let timer;
    try {
      const first = await Promise.race([
        iterator.next(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('探测超时')), MODEL_PROBE_TIMEOUT_MS); })
      ]);
      if (!first || first.done) throw new Error('模型未返回内容');
      result = { provider: item.provider, model: item.id, name: item.name || item.id, available: true, cached: false, reason: '极小请求验证通过', checkedAt };
    } finally {
      if (timer) clearTimeout(timer);
      try { void Promise.resolve(iterator.return()).catch(() => {}); } catch { /* best effort */ }
    }
  } catch (error) {
    result = { provider: item.provider, model: item.id, name: item.name || item.id, available: false, cached: false, reason: cleanTaskText(String((error && error.message) || error), 1000), checkedAt };
  }
  modelProbeCache.set(key, { expiresAt: Date.now() + MODEL_PROBE_CACHE_MS, result });
  return result;
}

function modelProbeCandidates(catalog) {
  const groups = new Map();
  for (const item of catalog) {
    if (!groups.has(item.provider)) groups.set(item.provider, []);
    groups.get(item.provider).push(item);
  }
  const selected = [];
  while (selected.length < MAX_MODEL_PROBE_COUNT && [...groups.values()].some((items) => items.length > 0)) {
    for (const items of groups.values()) {
      if (items.length > 0) selected.push(items.shift());
      if (selected.length >= MAX_MODEL_PROBE_COUNT) break;
    }
  }
  return selected;
}

async function probeOrchestrationModels(force = false, all = false) {
  const catalog = await listOrchestrationModels();
  if (chatLlm === null || catalog.length === 0) return { models: [], probe: cleanModelProbe({ status: 'fallback', checkedAt: new Date().toISOString(), catalogCount: catalog.length, results: [] }) };
  const candidates = all ? catalog : modelProbeCandidates(catalog);
  const results = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const index = cursor++;
      results[index] = await probeOneOrchestrationModel(candidates[index], force);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, worker));
  const availableKeys = new Set(results.filter((entry) => entry.available).map((entry) => entry.provider + '\u0000' + entry.model));
  const models = candidates.filter((entry) => availableKeys.has(entry.provider + '\u0000' + entry.id));
  return {
    models,
    probe: cleanModelProbe({ status: models.length ? 'ready' : 'fallback', checkedAt: new Date().toISOString(), catalogCount: catalog.length, results })
  };
}

function cleanProjectContext(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    projectPath: String(value.projectPath || ''),
    note: cleanTaskText(value.note, 4000),
    techStack: cleanTaskText(value.techStack, 2000),
    injectionPaths: Array.isArray(value.injectionPaths)
      ? [...new Set(value.injectionPaths.map((entry) => String(entry || '').trim().replace(/\\/g, '/')).filter(Boolean))].slice(0, 20)
      : [],
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString()
  };
}

async function readProjectContexts() {
  try {
    const info = await lstat(PROJECT_CONTEXT_STORE);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('project context store must be a regular non-symbolic file');
    if (info.size > MAX_PROJECT_CONTEXT_STORE_BYTES) throw new Error('project context store is too large');
    const parsed = JSON.parse(await readFile(PROJECT_CONTEXT_STORE, 'utf8'));
    const items = Array.isArray(parsed && parsed.items) ? parsed.items.map(cleanProjectContext).filter((entry) => entry.projectPath).slice(-MAX_PROJECT_CONTEXTS) : [];
    return { version: 1, items };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { version: 1, items: [] };
    throw error;
  }
}

async function writeProjectContexts(value) {
  await mkdir(dirname(PROJECT_CONTEXT_STORE), { recursive: true });
  const next = { version: 1, items: (value.items || []).map(cleanProjectContext).filter((entry) => entry.projectPath).slice(-MAX_PROJECT_CONTEXTS) };
  const serialized = JSON.stringify(next, null, 2) + '\n';
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PROJECT_CONTEXT_STORE_BYTES) throw new Error('project context store is too large');
  const temp = PROJECT_CONTEXT_STORE + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, serialized, 'utf8');
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(temp, PROJECT_CONTEXT_STORE);
      return next;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolvePromise) => setTimeout(resolvePromise, 25 * (attempt + 1)));
    }
  }
  try { await rm(temp, { force: true }); } catch (e) { /* keep temp for inspection */ }
  throw lastError;
}

async function projectContextConfig(projectPath) {
  if (!projectPath) return cleanProjectContext({ projectPath: '' });
  const store = await readProjectContexts();
  return store.items.find((entry) => taskProjectKey(entry.projectPath) === taskProjectKey(projectPath)) || cleanProjectContext({ projectPath });
}

async function validateProjectInjectionPaths(projectPath, paths) {
  const { canonical: root } = await authorizeWorkspacePath(projectPath, 'directory');
  const valid = [];
  for (const input of paths) {
    const target = resolve(root, input);
    const requestedRelative = relative(root, target).replace(/\\/g, '/');
    if (!requestedRelative || requestedRelative === '.' || requestedRelative.startsWith('../') || isAbsolute(requestedRelative)) throw new Error('注入目录必须是项目内的相对子目录');
    const { canonical } = await authorizeWorkspacePath(target, 'directory');
    const canonicalRelative = relative(root, canonical).replace(/\\/g, '/');
    if (!canonicalRelative || canonicalRelative === '.' || canonicalRelative.startsWith('../') || isAbsolute(canonicalRelative)) throw new Error('注入目录的真实路径必须位于当前项目内');
    valid.push(requestedRelative);
  }
  return [...new Set(valid)].slice(0, 20);
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

async function projectContextSummary(projectPath, sessionId = '') {
  if (!projectPath) return '';
  try {
    const { canonical } = await authorizeWorkspacePath(projectPath, 'directory');
    const config = await projectContextConfig(projectPath);
    const roots = config.injectionPaths.length ? config.injectionPaths : ['.'];
    const entries = [];
    for (const injectionPath of roots) {
      let target;
      try {
        target = (await authorizeWorkspacePath(injectionPath === '.' ? canonical : resolve(canonical, injectionPath), 'directory')).canonical;
        if (!inside(canonical, target)) continue;
      } catch (e) { continue; }
      const names = await readdir(target, { withFileTypes: true });
      entries.push(...names.slice(0, 60).map((entry) => (injectionPath === '.' ? '' : injectionPath + '/') + entry.name + (entry.isDirectory() ? '/' : '')));
      if (entries.length >= 80) break;
    }
    const manifestCandidates = ['package.json', 'requirements.txt', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'composer.json', 'README.md', 'readme.md'];
    const techHints = [];
    for (const candidate of manifestCandidates) {
      try {
        const { canonical: manifestPath, info } = await authorizeWorkspacePath(join(canonical, candidate), 'file');
        if (!inside(canonical, manifestPath)) continue;
        if (!info.isFile() || info.size > 64 * 1024) continue;
        const head = (await readFile(manifestPath, 'utf8')).slice(0, 800).replace(/\s+/g, ' ').trim();
        if (head) techHints.push(candidate + ': ' + head);
      } catch (e) { /* skip missing manifests */ }
      if (techHints.length >= 4) break;
    }
    const store = await readTaskStore();
    const history = store.orchestrations
      .filter((item) => taskProjectKey(item.projectPath) === taskProjectKey(projectPath))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, 3)
      .map((item) => '- ' + item.title + '（' + (item.phase || 'idea') + '）' + (item.finalReport ? '：' + item.finalReport.slice(0, 120) : ''))
      .join('\n');
    const ruleData = await discoverProjectRules(projectPath);
    const ruleSummary = ruleData.rules.map((entry) => entry.name + '：\n' + entry.content.slice(0, 600)).join('\n\n');
    const sessionContext = sessionId ? await readSessionContext(projectPath, sessionId) : { text: '' };
    return [
      config.note ? '项目备注：\n' + config.note : '',
      config.techStack ? '人工指定技术栈：\n' + config.techStack : '',
      config.injectionPaths.length ? '人工指定注入目录：' + config.injectionPaths.join('、') : '',
      '项目文件结构（前 ' + entries.length + ' 项）：\n' + entries.join(' '),
      techHints.length ? '技术栈线索：\n' + techHints.join('\n') : '',
      ruleSummary ? '项目规则：\n' + ruleSummary : '',
      sessionContext.text ? '当前会话专属内容：\n' + sessionContext.text.slice(0, 3000) : '',
      history ? '本项目近期协作记录：\n' + history : ''
    ].filter(Boolean).join('\n\n');
  } catch (e) {
    return '';
  }
}

function dshSessionSlug(projectPath) {
  const value = String(projectPath || '').trim();
  if (!value) return '';
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) out += ch;
    else if (code > 0x7f) {
      if (code > 0xffff) {
        const hi = 0xd800 + ((code - 0x10000) >> 10);
        const lo = 0xdc00 + ((code - 0x10000) & 0x3ff);
        out += '~' + hi.toString(16).toUpperCase() + '~' + '~' + lo.toString(16).toUpperCase() + '~';
      } else {
        out += '~' + code.toString(16).toUpperCase().padStart(4, '0') + '~';
      }
    } else {
      out += '-';
    }
  }
  return '--' + out + '--';
}

function sessionContextFile(projectPath, sessionId) {
  if (!sessionId) return '';
  const slug = dshSessionSlug(projectPath);
  if (!slug) return '';
  return join(SESSION_ROOT, slug, String(sessionId), SESSION_CONTEXT_FILE);
}

async function readSessionContext(projectPath, sessionId) {
  const file = sessionContextFile(projectPath, sessionId);
  if (!file) return { path: '', text: '', updatedAt: '' };
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('session context must be a regular file');
    if (info.size > SESSION_CONTEXT_MAX_BYTES) throw new Error('session context file is too large');
    return { path: file, text: await readFile(file, 'utf8'), updatedAt: info.mtime.toISOString() };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { path: file, text: '', updatedAt: '' };
    throw error;
  }
}

async function appendSessionContext(projectPath, sessionId, appendText) {
  const current = await readSessionContext(projectPath, sessionId);
  const append = cleanTaskText(appendText, 8000);
  if (!append) throw new Error('追加内容不能为空');
  const file = current.path || sessionContextFile(projectPath, sessionId);
  if (!file) throw new Error('session context path unavailable');
  const stamp = '\n\n--- ' + new Date().toISOString() + ' ---\n' + append + '\n';
  const next = current.text + stamp;
  if (Buffer.byteLength(next, 'utf8') > SESSION_CONTEXT_MAX_BYTES) throw new Error('会话专属内容超过 256 KB 上限');
  await mkdir(dirname(file), { recursive: true });
  const temp = file + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, next, 'utf8');
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(temp, file);
      return { path: file, text: next };
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolvePromise) => setTimeout(resolvePromise, 25 * (attempt + 1)));
    }
  }
  try { await rm(temp, { force: true }); } catch (e) { /* keep temp for inspection */ }
  throw lastError;
}

async function discoverProjectRules(projectPath) {
  if (!projectPath) return { rules: [] };
  const { canonical } = await authorizeWorkspacePath(projectPath, 'directory');
  const rules = [];
  for (const name of PROJECT_RULE_FILES) {
    const file = join(canonical, name);
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > PROJECT_RULE_MAX_BYTES) continue;
      rules.push({ path: file, name, size: info.size, content: (await readFile(file, 'utf8')).slice(0, 6000), updatedAt: info.mtime.toISOString() });
    } catch (e) { /* skip missing */ }
    if (rules.length >= 6) break;
  }
  try {
    const rulesDir = join(canonical, '.cursor', 'rules');
    const names = await readdir(rulesDir);
    for (const name of names.filter((entry) => entry.endsWith('.mdc')).slice(0, 6)) {
      const file = join(rulesDir, name);
      const info = await stat(file);
      if (!info.isFile() || info.size > PROJECT_RULE_MAX_BYTES) continue;
      rules.push({ path: file, name: '.cursor/rules/' + name, size: info.size, content: (await readFile(file, 'utf8')).slice(0, 6000), updatedAt: info.mtime.toISOString() });
    }
  } catch (e) { /* no cursor rules dir */ }
  return { rules };
}

async function appendProjectRule(projectPath, target, appendText, init) {
  const { canonical } = await authorizeWorkspacePath(projectPath, 'directory');
  let name = String(target || '').trim();
  const allowed = PROJECT_RULE_FILES.includes(name) || /^\.cursor\/rules\/.+\.mdc$/.test(name);
  if (!allowed) throw new Error('不支持写入该规则文件');
  const file = resolve(canonical, name);
  const rel = relative(canonical, file).replace(/\\/g, '/');
  if (!rel || rel.startsWith('../') || isAbsolute(rel)) throw new Error('规则文件必须在项目内');
  const append = cleanTaskText(appendText, 8000);
  let next;
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('规则文件必须为普通文件');
    if (info.size > PROJECT_RULE_MAX_BYTES) throw new Error('规则文件过大');
    if (init) throw new Error('规则文件已存在，不需要初始化');
    next = (await readFile(file, 'utf8')) + '\n\n--- 追加 ' + new Date().toISOString() + ' ---\n' + append + '\n';
  } catch (error) {
    if (!(init && error && error.code === 'ENOENT')) throw error;
    next = ['# 项目规则（' + name + '）', '', '> 由工作台初始化，AI 协作与多 AI 模式会自动读取本文件。', '', '## 项目目标', '', '## 技术栈与约束', '', '## 常用命令与约定', '', '--- 初始化 ' + new Date().toISOString() + ' ---', append, ''].join('\n');
  }
  if (Buffer.byteLength(next, 'utf8') > PROJECT_RULE_MAX_BYTES) throw new Error('规则文件超过 96 KB 上限');
  await mkdir(dirname(file), { recursive: true });
  const temp = file + '.tmp-' + process.pid + '-' + randomUUID();
  await writeFile(temp, next, 'utf8');
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(temp, file);
      return { path: file, name, size: Buffer.byteLength(next, 'utf8'), updatedAt: new Date().toISOString() };
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolvePromise) => setTimeout(resolvePromise, 25 * (attempt + 1)));
    }
  }
  try { await rm(temp, { force: true }); } catch (e) { /* keep temp */ }
  throw lastError;
}

async function refineProjectContext(projectPath) {
  const { canonical } = await authorizeWorkspacePath(projectPath, 'directory');
  const config = await projectContextConfig(projectPath);
  const rules = await discoverProjectRules(projectPath);
  const readme = rules.rules.find((entry) => entry.name.toLocaleLowerCase() === 'readme.md');
  const sources = [
    readme ? 'README：\n' + readme.content.slice(0, 2000) : '',
    rules.rules.filter((entry) => entry.name !== 'README.md' && entry.name !== 'readme.md').map((entry) => entry.name + '：\n' + entry.content.slice(0, 1200)).join('\n\n'),
    config.note ? '已有备注：\n' + config.note : ''
  ].filter(Boolean).join('\n\n');
  const system = '你是个人工作台的项目配置助手。根据项目素材提炼结构化项目备注，只输出 Markdown，不要编造。';
  const prompt = [
    '项目路径：' + canonical,
    '请提炼以下内容，输出紧凑的 Markdown（目标 / 技术栈与约束 / 常用约定 / 当前阶段），400 字以内：',
    sources || '（没有可用的项目素材，请给出建议的初始化模板）'
  ].join('\n\n');
  const refined = cleanTaskText(await streamLlmText(system, prompt, { maxTokens: 1200 }), 6000);
  return { refined, sources: sources.slice(0, 3000) };
}

async function generateOrchestrationPlan(record, feedback, models, policy) {
  const healthStore = await readTaskStore();
  const modelHealth = healthStore.modelHealth || {};
  const unhealthy = (provider, model) => {
    const entry = modelHealth[String(provider || '') + '\u0000' + String(model || '')];
    if (!entry || entry.failures < 2) return false;
    const age = Date.now() - Date.parse(entry.lastFailedAt || 0);
    return Number.isFinite(age) && age < 7 * 86400000;
  };
  const modelList = (Array.isArray(models) ? models : []).slice().sort((a, b) => (unhealthy(a.provider, a.id) ? 1 : 0) - (unhealthy(b.provider, b.id) ? 1 : 0));
  const pool = await readAgentsStore();
  const agents = pool.mode === 'pool' ? pool.agents : [];
  const projectContext = await projectContextSummary(record.projectPath, record.sourceSessionId);
  const modelChoices = modelList.map((item) => item.provider + ' :: ' + item.id + ' (' + item.name + ')').join('\n');
  const system = [
    '你是一个谨慎的多代理任务编排器。把用户的粗略想法转成可审查、可执行、可验收的方案。',
    '只输出一个 JSON 对象，不要 Markdown，不要解释。主代理负责最终汇总和质量控制；子代理负责边界清晰的工作包。',
    '优先 2-4 个子代理，最多 6 个。可并行的任务不要添加依赖；确有先后关系时，dependsOn 使用子代理 name。',
    '每个任务必须带明确验收标准，不得声称已经执行。',
    '每个子代理必须声明 readOnly：纯分析/检索/评估/调研类工作包填 true（默认）；需要写文件、执行命令、修改代码或修改配置的工作包填 false。只有 readOnly=false 的子代理才会在用户确认后获得写权限。',
    '如果提供了模型目录，只能从目录中为代理选择 provider/model；没有合适选项时两者留空以继承父代理。',
    record.quick ? '快速问答模式：这是简单问题，不要拆解任务。只生成 1 个名为「直接回答」的子代理（role 用「回答者」）和 1 个主代理，主代理 mission 写「直接回答用户问题并给出可执行的结论」。' : ''
  ].join('\n');
  const prompt = [
    '项目路径：' + (record.projectPath || '全局任务'),
    projectContext ? '项目上下文：\n' + projectContext : '',
    record.knowledgeMeta ? '知识库参考（自动检索，规划时优先参考并溯源）：\n' + knowledgeAutoPrompt(record.knowledgeRefs, record.knowledgeMeta) : '',
    '用户想法：\n' + record.idea,
    record.memory && record.memory.length ? '记忆快照（跨会话上下文，优先引用）：\n' + record.memory.map((entry) => '- [' + entry.title + '] ' + entry.summary + (entry.findings.length ? '\n  发现：' + entry.findings.slice(0, 3).join('；') : '')).join('\n') : '',
    record.attachments && record.attachments.length ? '已附加文件：\n' + record.attachments.map((entry) => '- ' + entry.name + '（' + entry.size + ' B，' + entry.mime + '）' + (entry.summary ? '\n  内容摘录：' + entry.summary.slice(0, 400) : '')).join('\n') : '',
    record.sourceRefs && record.sourceRefs.length ? '用户明确引用的来源（方案中依赖这些内容的判断必须可追溯）：\n' + record.sourceRefs.map((entry) => '- [来源: ' + entry.title + '] ' + entry.content.slice(0, 1200)).join('\n') : '',
    agents.length ? '候选专家参考（可按需创建更合适的角色；若使用候选，请在 workers/mainAgent 里带上 agentRef）：\n' + agents.map((agent) => '- ' + agent.id + '：' + agent.name + '（' + (agent.capabilities || []).join('/') + '）' + (agent.model ? '；模型 ' + agent.model : '')).join('\n') : '',
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
      workers: [{ name: '子代理名称', role: '专业角色', task: '完整工作包（包含必要上下文）', dependsOn: [], readOnly: true, acceptance: '该子任务的验收标准', provider: '', model: '', modelReason: '选择或继承理由' }],
      acceptanceCriteria: ['最终由用户验收的标准']
    }, null, 2)
  ].filter(Boolean).join('\n\n');
  const plan = cleanOrchestrationPlan(await (async () => {
    const first = await streamLlmText(system, prompt, { maxTokens: 8000 });
    try {
      return parseJsonObject(first);
    } catch (firstError) {
      const second = await streamLlmText(system, prompt + '\n\n上一次输出解析失败（可能是 JSON 被截断）。请只输出一个完整、闭合的 JSON 对象，不要 Markdown。', { maxTokens: 8000 });
      try {
        return parseJsonObject(second);
      } catch (secondError) {
        throw new Error('方案生成失败（已重试一次）：' + String((firstError && firstError.message) || firstError));
      }
    }
  })());
  const allowed = new Set(modelList.map((item) => item.provider + '\u0000' + item.id));
  const validateAgentModel = (agent, isMain) => {
    if (!agent) return agent;
    const manualTarget = policy === 'manual' || (policy === 'main-manual' && isMain);
    if (manualTarget) return { ...agent, provider: '', model: '', modelReason: policy === 'main-manual' ? '主代理模型等待手动选择，子代理自动分配' : '等待用户手动选择，当前继承主会话' };
    if (!agent.provider || !agent.model) return { ...agent, provider: '', model: '', modelReason: agent.modelReason || '继承主会话模型' };
    if (unhealthy(agent.provider, agent.model)) return { ...agent, provider: '', model: '', modelReason: 'AI 建议的模型近期执行失败较多，已安全回退为继承主会话' };
    if (!allowed.has(agent.provider + '\u0000' + agent.model)) return { ...agent, provider: '', model: '', modelReason: 'AI 建议的模型当前不可用，已安全回退为继承主会话' };
    return agent;
  };
  return cleanOrchestrationPlan({ ...plan, mainAgent: validateAgentModel(plan.mainAgent, true), workers: plan.workers.map((worker) => validateAgentModel(worker, false)) });
}

function queueOrchestrationPatch(id, update) {
  const operation = taskMutationQueue.then(async () => {
    const store = await readTaskStore();
    const index = store.orchestrations.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('orchestration not found');
    const current = store.orchestrations[index];
    store.orchestrations[index] = cleanOrchestration(update(current) || current);
    syncOrchestrationTask(store, store.orchestrations[index]);
    store.revision += 1;
    await writeTaskStore(store);
    broadcastTaskEvent({ type: 'orchestration', orchestrationId: id, revision: store.revision });
    return store.orchestrations[index];
  });
  taskMutationQueue = operation.catch(() => {});
  return operation;
}

async function appendOrchestrationLog(orchestrationId, level, text, agent) {
  const entry = { at: new Date().toISOString(), level: ['info', 'warn', 'error'].includes(level) ? level : 'info', text: String(text || '').slice(0, 2000), agent: String(agent || '').slice(0, 120) };
  await queueOrchestrationPatch(orchestrationId, (item) => ({ ...item, log: [...(item.log || []), entry].slice(-200), updatedAt: entry.at })).catch(() => {});
}

async function orchestrationSnapshot(id) {
  const store = await readTaskStore();
  return store.orchestrations.find((item) => item.id === id) || null;
}

async function workerPrompt(orchestration, worker) {
  const byId = new Map(orchestration.workers.map((item) => [item.id, item]));
  const dependencyContext = worker.dependsOn.map((id) => {
    const dependency = byId.get(id);
    if (!dependency) return '';
    return '### ' + dependency.name + '\n状态：' + dependency.status + '\n结果：\n' + (dependency.output || dependency.error || '无结果');
  }).filter(Boolean).join('\n\n');
  let poolPrompt = '';
  try {
    const pool = await readAgentsStore();
    const entry = (pool.agents || []).find((agent) => worker.agentRef ? agent.id === worker.agentRef : agent.name === worker.name);
    if (entry && entry.prompt) poolPrompt = '角色设定（来自候选专家池 ' + entry.id + '）：\n' + entry.prompt;
  } catch (e) { /* pool is optional */ }
  return [
    '你是“' + worker.name + '”，角色：' + worker.role + '。',
    poolPrompt,
    '这是工作台中已经由用户确认执行的一项多代理任务。只完成分配给你的工作包，不要擅自扩大范围。',
    '项目路径：' + (orchestration.projectPath || '全局任务'),
    orchestration.knowledgeMeta ? '知识库参考（自动检索，与任务相关时优先参考并溯源）：\n' + knowledgeAutoPrompt(orchestration.knowledgeRefs, orchestration.knowledgeMeta) : '',
    (orchestration.attachments || []).length ? '已附加文件（需要时读取内容）：\n' + (orchestration.attachments || []).map((entry) => '- ' + entry.name + '（' + entry.size + ' B）' + (entry.summary ? '\n  ' + entry.summary.slice(0, 1200) : '')).join('\n') : '',
    (orchestration.sourceRefs || []).length ? '用户明确引用的来源：\n' + orchestration.sourceRefs.map((entry) => '- [来源: ' + entry.title + '] ' + entry.content).join('\n') : '',
    '总目标：\n' + orchestration.idea,
    '你的任务：\n' + worker.mission,
    worker.acceptance ? '你的验收标准：\n' + worker.acceptance : '',
    worker.readOnly ? '只读模式：你是分析型子代理，禁止任何文件写入、代码修改、命令执行或状态变更；只允许读取、检索、分析与联网查询，最终产出报告。若任务确实需要写操作，在交接报告中明确说明，由主代理和用户决定。' : '',
    dependencyContext ? '依赖任务的结果：\n' + dependencyContext : '',
    (orchestration.sourceRefs || []).length ? '凡是依赖上述引用资料的事实、判断或建议，必须紧邻标注 [来源: 对应名称]；无法从来源确认时明确写“未验证”，不得补造。' : '',
    orchestration.knowledgeMeta ? '知识库引用规则：知识库是优先参考但不是唯一来源——知识库覆盖不全或需要更全面/更新的信息时，可结合自身知识或调用 web_search / web_fetch 联网补充；引用知识库内容时标注 [知识N《标题》· 置信度 X] 或 [来源: 标题]，引用联网内容时标注来源 URL；无法确认的内容标注“未验证”。' : '',
    '完成后给出结构清晰的交接报告：完成内容、证据/产物、验证结果、风险和建议。'
  ].filter(Boolean).join('\n\n');
}

function withTimeout(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

function orchestrationFailureDetail(result) {
  if (!result || typeof result !== 'object') return '子代理未返回结果';
  const parts = ['stopReason=' + String(result.stopReason || '')];
  if (result.error) parts.push('error=' + String(result.error));
  if (result.message) parts.push('message=' + String(result.message));
  if (result.failure) parts.push('failure=' + String(result.failure.message || result.failure));
  const reasonError = result.reason && result.reason.error;
  if (reasonError) parts.push('reason=' + String(reasonError.message || reasonError));
  if (Array.isArray(result.errors) && result.errors.length) parts.push('errors=' + result.errors.slice(0, 3).map((entry) => String(entry && (entry.message || entry))).join(' | '));
  return parts.join('；');
}

async function modelHealthSnapshot() {
  try { const store = await readTaskStore(); return store.modelHealth || {}; } catch (e) { return {}; }
}

function modelUnhealthy(health, provider, model) {
  const entry = health[String(provider || '') + '\u0000' + String(model || '')];
  if (!entry || entry.failures < 2) return false;
  const age = Date.now() - Date.parse(entry.lastFailedAt || 0);
  return Number.isFinite(age) && age < 7 * 86400000;
}

async function pickOrchestrationFailoverModel(worker, triedKeys) {
  if (!ORCHESTRATION_MODEL_FAILOVER_ENABLED) return null;
  if (!worker) return null;
  let catalog = [];
  try { catalog = await listOrchestrationModels(); } catch (e) { return null; }
  if (!catalog.length) return null;
  const health = await modelHealthSnapshot();
  const candidates = catalog.map((item) => ({ ...item, key: item.provider + '\u0000' + item.id }))
    .filter((item) => !triedKeys.has(item.key) && !modelUnhealthy(health, item.provider, item.id));
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const sameA = worker.provider ? (a.provider === worker.provider ? 0 : 1) : 0;
    const sameB = worker.provider ? (b.provider === worker.provider ? 0 : 1) : 0;
    if (sameA !== sameB) return sameA - sameB;
    return String(a.name || a.id).localeCompare(String(b.name || b.id));
  });
  return candidates[0];
}

async function runOrchestrationWorker(orchestrationId, workerId, parent, controller) {
  const maxSameRetries = ORCHESTRATION_WORKER_MAX_RETRIES;
  const maxFailovers = ORCHESTRATION_MODEL_FAILOVER_MAX;
  const triedKeys = new Set();
  let run = null;
  let attemptsDone = 0;
  let sameRetries = 0;
  let failovers = 0;
  let lastError = '';
  for (let attempt = 1; ; attempt++) {
    attemptsDone = attempt;
    if (controller.signal.aborted) break;
    const startedAt = new Date().toISOString();
    let finished = false;
    let worker = null;
    try {
      const current = await orchestrationSnapshot(orchestrationId);
      if (!current || current.phase !== 'running') return;
      worker = current.workers.find((item) => item.id === workerId);
      if (!worker) throw new Error('worker not found');
      let poolEntry = null;
      try {
        const pool = await readAgentsStore();
        poolEntry = (pool.agents || []).find((agent) => worker.agentRef ? agent.id === worker.agentRef : agent.name === worker.name) || null;
      } catch (e) { /* pool is optional */ }
      const effectiveProvider = worker.provider || (poolEntry && poolEntry.provider) || '';
      const effectiveModel = worker.model || (poolEntry && poolEntry.model) || '';
      if (effectiveProvider && effectiveModel) triedKeys.add(effectiveProvider + '\u0000' + effectiveModel);
      await queueOrchestrationPatch(orchestrationId, (item) => ({
        ...item,
        workers: item.workers.map((entry) => entry.id === workerId ? { ...entry, status: 'running', startedAt, error: '', attempts: attempt } : entry),
        updatedAt: startedAt
      }));
      await appendOrchestrationLog(orchestrationId, 'info', '子代理「' + worker.name + '」第 ' + attempt + ' 次执行开始' + (effectiveProvider && effectiveModel ? '（模型 ' + effectiveProvider + '/' + effectiveModel + '）' : ''), worker.id);
      const spawned = await orchestrationSubagents.start('spawn', {
        label: worker.name,
        prompt: [{ type: 'text', text: await workerPrompt(current, worker) }],
        parent,
        signal: controller.signal,
        persona: '你是' + worker.role + '。保持专业、独立验证，并以可交接的证据为准。',
        ...(effectiveProvider && effectiveModel ? { agentOptions: { provider: effectiveProvider, model: effectiveModel } } : {}),
        maxDepth: 2
      });
      run = spawned;
      const usedProvider = run.localAgent && run.localAgent.options ? String(run.localAgent.options.provider || effectiveProvider || '') : effectiveProvider;
      const usedModel = run.localAgent && run.localAgent.options ? String(run.localAgent.options.model || effectiveModel || '') : effectiveModel;
      await queueOrchestrationPatch(orchestrationId, (item) => ({
        ...item,
        workers: item.workers.map((entry) => entry.id === workerId ? { ...entry, sessionId: String(run.id), usedProvider, usedModel } : entry),
        updatedAt: new Date().toISOString()
      }));
      const result = await withTimeout(run.result, ORCHESTRATION_WORKER_TIMEOUT_MS, '子代理执行超时（' + (ORCHESTRATION_WORKER_TIMEOUT_MS / 1000).toFixed(1) + ' 秒）');
      const completedAt = new Date().toISOString();
      const output = contentBlocksText(result.output);
      const successful = result.stopReason === 'completed';
      const failureDetail = orchestrationFailureDetail(result);
      if (!successful && effectiveProvider && effectiveModel) void recordModelFailure(effectiveProvider, effectiveModel, failureDetail);
      await queueOrchestrationPatch(orchestrationId, (item) => item.phase === 'cancelled' ? item : ({
        ...item,
        workers: item.workers.map((entry) => entry.id === workerId ? { ...entry, status: successful ? 'completed' : 'failed', output, error: successful ? '' : failureDetail, completedAt, attempts: attempt } : entry),
        updatedAt: completedAt
      }));
      if (successful) {
        await appendOrchestrationLog(orchestrationId, 'info', '子代理「' + worker.name + '」完成', worker.id);
        return;
      }
      lastError = failureDetail;
      finished = true;
    } catch (error) {
      lastError = String((error && error.message) || error);
      if (controller.signal.aborted) break;
      finished = true;
    } finally {
      if (run) { await run.dispose().catch(() => {}); run = null; }
    }
    if (finished) {
      if (controller.signal.aborted) break;
      if (failovers < maxFailovers) {
        const latest = await orchestrationSnapshot(orchestrationId).catch(() => null);
        const latestWorker = latest ? (latest.workers || []).find((entry) => entry.id === workerId) : null;
        if (latestWorker && latestWorker.provider && latestWorker.model) triedKeys.add(latestWorker.provider + '\u0000' + latestWorker.model);
        const nextModel = await pickOrchestrationFailoverModel(latestWorker || worker, triedKeys);
        if (nextModel) {
          failovers++;
          triedKeys.add(nextModel.key);
          const origin = latestWorker && latestWorker.provider && latestWorker.model ? latestWorker.provider + '/' + latestWorker.model : '继承主会话';
          await appendOrchestrationLog(orchestrationId, 'warn', '子代理 ' + workerId + '：' + lastError + '；自动切换模型 ' + nextModel.provider + '/' + nextModel.id + '（原 ' + origin + '）重试', workerId);
          await queueOrchestrationPatch(orchestrationId, (item) => item.phase === 'cancelled' ? item : ({
            ...item,
            workers: item.workers.map((entry) => entry.id === workerId ? { ...entry, provider: nextModel.provider, model: nextModel.id, modelReason: '失败后自动切换（原 ' + origin + '）', status: 'running', error: lastError + '；准备切换模型重试', attempts: attempt + 1 } : entry),
            updatedAt: new Date().toISOString()
          })).catch(() => {});
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 800));
          continue;
        }
      }
      if (sameRetries < maxSameRetries) {
        sameRetries++;
        const nextNumber = sameRetries + failovers + 1;
        await appendOrchestrationLog(orchestrationId, 'warn', '子代理 ' + workerId + '：' + lastError + '；准备第 ' + nextNumber + ' 次重试（同模型）', workerId);
        await queueOrchestrationPatch(orchestrationId, (item) => item.phase === 'cancelled' ? item : ({
          ...item,
          workers: item.workers.map((entry) => entry.id === workerId ? { ...entry, status: 'running', error: lastError + '；准备重试（第 ' + nextNumber + ' 次）' } : entry),
          updatedAt: new Date().toISOString()
        })).catch(() => {});
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200 * nextNumber));
        continue;
      }
      await appendOrchestrationLog(orchestrationId, 'error', '子代理 ' + workerId + ' 最终失败：' + lastError, workerId);
      const completedAt = new Date().toISOString();
      await queueOrchestrationPatch(orchestrationId, (item) => item.phase === 'cancelled' ? item : ({
        ...item,
        workers: item.workers.map((entry) => entry.id === workerId ? { ...entry, status: 'failed', error: lastError, completedAt, attempts: attemptsDone } : entry),
        updatedAt: completedAt
      })).catch(() => {});
      return;
    }
  }
  await appendOrchestrationLog(orchestrationId, 'warn', '子代理 ' + workerId + ' 被终止：' + (lastError || '用户终止执行'), workerId);
  const completedAt = new Date().toISOString();
  await queueOrchestrationPatch(orchestrationId, (item) => item.phase === 'cancelled' ? item : ({
    ...item,
    workers: item.workers.map((entry) => entry.id === workerId ? { ...entry, status: controller.signal.aborted ? 'cancelled' : 'failed', error: lastError || '未知错误', completedAt, attempts: attemptsDone } : entry),
    updatedAt: completedAt
  })).catch(() => {});
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
    orchestration.knowledgeMeta ? '知识库参考（自动检索，汇总时优先参考并溯源）：\n' + knowledgeAutoPrompt(orchestration.knowledgeRefs, orchestration.knowledgeMeta) : '',
    (orchestration.sourceRefs || []).length ? '用户明确引用的来源：\n' + orchestration.sourceRefs.map((entry) => '- [来源: ' + entry.title + '] ' + entry.content).join('\n') : '',
    orchestration.plan && orchestration.plan.strategy ? '执行策略：\n' + orchestration.plan.strategy : '',
    '子代理交接：\n' + results,
    orchestration.plan && orchestration.plan.acceptanceCriteria.length ? '最终验收标准：\n- ' + orchestration.plan.acceptanceCriteria.join('\n- ') : '',
    ((orchestration.sourceRefs || []).length || orchestration.knowledgeMeta) ? '生成侧溯源门：依赖引用资料或知识库条目的结论必须紧邻标注 [来源: 对应名称] 或 [知识N《标题》· 置信度 X]；无法确认就标记“未验证”。提交前自行检查至少出现一条有效来源标注。' : '',
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
    await appendOrchestrationLog(orchestrationId, 'info', '开始执行：共 ' + orchestration.workers.length + ' 个子代理，本次运行 ' + pending.size + ' 个');
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
    const completedWorkers = orchestration.workers.filter((worker) => worker.status === 'completed').length;
    const failedWorkers = orchestration.workers.filter((worker) => worker.status === 'failed' || worker.status === 'cancelled').length;
    if (completedWorkers === 0 && failedWorkers > 0) {
      await appendOrchestrationLog(orchestrationId, 'error', '所有 ' + failedWorkers + ' 个子代理均失败，需要人工介入');
      const completedAt = new Date().toISOString();
      await queueOrchestrationPatch(orchestrationId, (item) => {
        if (item.phase === 'cancelled') return item;
        const next = { ...item, phase: 'failed', runtimeError: '所有 ' + failedWorkers + ' 个子代理均未成功，需要人工介入：请查看下方子代理错误详情，点击“继续执行”只重跑失败部分，或重新生成方案。', completedAt, updatedAt: completedAt };
        return { ...next, runs: runsWithSnapshot(next, 'failed', completedAt) };
      });
      return;
    }
    const mainStartedAt = new Date().toISOString();
    await queueOrchestrationPatch(orchestrationId, (item) => ({ ...item, mainAgent: { ...item.mainAgent, status: 'running', startedAt: mainStartedAt }, updatedAt: mainStartedAt }));
    await appendOrchestrationLog(orchestrationId, 'info', '主代理「' + orchestration.mainAgent.name + '」开始汇总', orchestration.mainAgent.id);
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
      const failureDetail = orchestrationFailureDetail(result);
      const workerFailures = orchestration.workers.filter((worker) => worker.status !== 'completed').length;
      const knowledgeAutoConfig = await readKnowledgeAutoConfig();
      let citationAudit = null;
      if (successful && orchestration.knowledgeMeta) {
        const lastUser = [...(orchestration.thread || [])].reverse().find((entry) => entry.role === 'user');
        citationAudit = await auditKnowledgeCitationsDeep(output, orchestration.knowledgeRefs, {
          level: knowledgeAutoConfig.auditLevel,
          query: orchestration.knowledgeMeta.query || (lastUser ? lastUser.text : ''),
          sessionId: orchestration.mainAgent ? orchestration.mainAgent.sessionId || '' : '',
          autoFix: true
        }).catch((error) => {
          diag('knowledge audit deep failed: ' + String((error && error.message) || error));
          return successful && orchestration.knowledgeMeta ? auditKnowledgeCitations(output, orchestration.knowledgeRefs, knowledgeAutoConfig.auditLevel) : null;
        });
      }
      await queueOrchestrationPatch(orchestrationId, (item) => {
        if (item.phase === 'cancelled') return item;
        const mainAgent = { ...item.mainAgent, status: successful ? 'completed' : 'failed', output, error: successful ? '' : ('主代理结束原因：' + failureDetail), completedAt };
        const traceMissing = successful && ((item.sourceRefs || []).length > 0 || item.knowledgeMeta) && !/\[来源:\s*[^\]]+\]/.test(output) && !/\[知识\d+[^\]]*\]/.test(output);
        const warnings = [];
        if (successful && workerFailures > 0) warnings.push(workerFailures + ' 个子代理未正常完成，请在验收时重点检查。');
        if (traceMissing) warnings.push('生成侧溯源门未通过：最终报告使用了引用资料或知识库条目，但没有找到 [来源: 名称] 或 [知识N] 标注，请要求主代理补充后再验收。');
        if (citationAudit && !citationAudit.valid) {
          const reasons = [...(citationAudit.missing || []), ...(citationAudit.invalid || []).map((entry) => entry.id + ' ' + entry.reason)];
          if (citationAudit.groundednessSummary && citationAudit.groundednessSummary.violations > 0) {
            reasons.push('逐句 groundedness 未达标（' + citationAudit.groundednessSummary.grounded + '/' + citationAudit.groundednessSummary.claims + '，目标 ≥ ' + (citationAudit.groundednessTarget ?? 0.85) + '），' + citationAudit.groundednessSummary.violations + ' 个结论句缺少证据支撑');
          }
          warnings.push('知识库引用审计未通过：' + reasons.join('；'));
        }
        const runtimeError = successful ? warnings.join('\n') : ('主代理结束原因：' + failureDetail);
        const next = { ...item, phase: successful ? 'review' : 'failed', mainAgent, finalReport: output, runtimeError, knowledgeCitationAudit: citationAudit, completedAt, updatedAt: completedAt };
        return { ...next, runs: runsWithSnapshot(next, successful ? 'review' : 'failed', completedAt) };
      });
      await appendOrchestrationLog(orchestrationId, successful ? 'info' : 'error', successful ? '主代理完成汇总，进入验收' : '主代理汇总失败：' + failureDetail, orchestration.mainAgent.id);
    } finally {
      if (mainRun) await mainRun.dispose().catch(() => {});
    }
  } catch (error) {
    const completedAt = new Date().toISOString();
    await appendOrchestrationLog(orchestrationId, controller.signal.aborted ? 'warn' : 'error', '编排终止：' + String((error && error.message) || error));
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

function continuationPrompt(orchestration, userMessage) {
  const results = (orchestration.workers || []).map((worker) => [
    '## ' + worker.name + '（' + worker.role + '）',
    '状态：' + worker.status,
    '结果：\n' + (worker.output || worker.error || '无结果')
  ].join('\n')).join('\n\n').slice(0, 50000);
  const history = (orchestration.thread || []).slice(-30).map((entry) => (entry.role === 'user' ? '用户：' : '主代理：') + entry.text).join('\n\n').slice(0, 30000);
  return [{
    type: 'text',
    text: [
      '你正在继续优化一项已经交付的任务。请基于已有成果继续工作，不要从头重做；可以按需调用子代理去修改、验证对应的部分，最后把更新后的完整结果交回。',
      '项目路径：' + (orchestration.projectPath || '全局任务'),
      '原始想法：\n' + orchestration.idea,
      orchestration.knowledgeMeta ? '知识库参考（自动检索，继续优化时同样优先参考并溯源）：\n' + knowledgeAutoPrompt(orchestration.knowledgeRefs, orchestration.knowledgeMeta) : '',
      orchestration.plan && orchestration.plan.strategy ? '执行策略：\n' + orchestration.plan.strategy : '',
      orchestration.plan && orchestration.plan.acceptanceCriteria.length ? '最终验收标准：\n- ' + orchestration.plan.acceptanceCriteria.join('\n- ') : '',
      '子代理交接（最近结果）：\n' + results,
      '上次最终报告：\n' + (orchestration.finalReport || '（无）'),
      history ? '之前的优化对话记录：\n' + history : '',
      '用户本次优化要求：\n' + (userMessage || '请整体再检查一遍并改进')
    ].filter(Boolean).join('\n\n')
  }];
}

async function continueOrchestration(orchestrationId) {
  if (orchestrationControllers.has(orchestrationId)) return;
  const controller = new AbortController();
  orchestrationControllers.set(orchestrationId, controller);
  try {
    let orchestration = await orchestrationSnapshot(orchestrationId);
    if (!orchestration || orchestration.phase !== 'refining') return;
    if (orchestrationSubagents === null || orchestrationAgents === null) throw new Error('DSH subagent runtime unavailable; restart the desktop host and try again');
    let parent = orchestrationAgents.get(orchestration.sourceSessionId);
    const requestedProject = taskProjectKey(orchestration.projectPath);
    const parentProject = parent && parent.session && parent.session.header ? taskProjectKey(parent.session.header.cwd || '') : '';
    if (requestedProject && parentProject !== requestedProject) {
      parent = orchestrationAgents.roots().find((agent) => agent.session && agent.session.header && taskProjectKey(agent.session.header.cwd || '') === requestedProject);
    }
    if (!parent) throw new Error('所选项目当前没有在线主会话；请先打开该项目中的任一会话，再重试继续优化');
    const lastUser = [...(orchestration.thread || [])].reverse().find((entry) => entry.role === 'user');
    const startedAt = new Date().toISOString();
    await queueOrchestrationPatch(orchestrationId, (item) => item.phase === 'cancelled' ? item : ({
      ...item,
      mainAgent: { ...item.mainAgent, status: 'running', startedAt, error: '' },
      updatedAt: startedAt
    }));
    await appendOrchestrationLog(orchestrationId, 'info', '主代理开始按用户指示优化（第 ' + (orchestration.refineCount + 1) + ' 轮）', orchestration.mainAgent && orchestration.mainAgent.id);
    const run = await orchestrationSubagents.start('spawn', {
      label: (orchestration.mainAgent && orchestration.mainAgent.name) + ' · 优化',
      prompt: continuationPrompt(orchestration, lastUser && lastUser.text),
      parent,
      signal: controller.signal,
      persona: '你是' + (orchestration.mainAgent && orchestration.mainAgent.role || '主协调代理') + '。继续负责本次任务的优化与质量把关，可以调用子代理修改对应部分，最后交回更新后的完整结果。',
      ...(orchestration.mainAgent && orchestration.mainAgent.provider && orchestration.mainAgent.model ? { agentOptions: { provider: orchestration.mainAgent.provider, model: orchestration.mainAgent.model } } : {}),
      maxDepth: 3
    });
    const result = await run.result;
    const completedAt = new Date().toISOString();
    const output = contentBlocksText(result.output);
    const successful = result.stopReason === 'completed';
    const failureDetail = orchestrationFailureDetail(result);
    await queueOrchestrationPatch(orchestrationId, (item) => {
      if (item.phase === 'cancelled') return item;
      return cleanOrchestration({
        ...item,
        phase: successful ? 'review' : 'failed',
        mainAgent: { ...item.mainAgent, status: successful ? 'completed' : 'failed', output, error: successful ? '' : ('主代理优化结束原因：' + failureDetail), completedAt },
        thread: [...(item.thread || []), { role: 'main', text: output, at: completedAt }],
        finalReport: output,
        runtimeError: successful ? '' : ('主代理优化结束原因：' + failureDetail),
        completedAt,
        updatedAt: completedAt
      });
    });
    await appendOrchestrationLog(orchestrationId, successful ? 'info' : 'error', successful ? '优化完成，回到验收' : '主代理优化失败：' + result.stopReason, orchestration.mainAgent && orchestration.mainAgent.id);
  } catch (error) {
    const completedAt = new Date().toISOString();
    await appendOrchestrationLog(orchestrationId, controller.signal.aborted ? 'warn' : 'error', '优化终止：' + String((error && error.message) || error));
    await queueOrchestrationPatch(orchestrationId, (item) => {
      if (item.phase === 'cancelled') return item;
      const status = controller.signal.aborted ? 'cancelled' : 'failed';
      return cleanOrchestration({
        ...item,
        phase: status,
        mainAgent: item.mainAgent && (item.mainAgent.status === 'running') ? { ...item.mainAgent, status: controller.signal.aborted ? 'cancelled' : 'failed', error: String((error && error.message) || error), completedAt } : item.mainAgent,
        runtimeError: String((error && error.message) || error),
        completedAt,
        updatedAt: completedAt
      });
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
      if (item.phase !== 'running' && item.phase !== 'planning' && item.phase !== 'refining') return item;
      changed = true;
      const next = cleanOrchestration({
        ...item,
        phase: 'failed',
        workers: item.workers.map((worker) => ['running', 'waiting', 'planned'].includes(worker.status) ? { ...worker, status: 'failed', error: '桌面端重启中断了本次执行', completedAt: now } : worker),
        mainAgent: item.mainAgent && ['running', 'waiting', 'planned'].includes(item.mainAgent.status) ? { ...item.mainAgent, status: 'failed', error: '桌面端重启中断了本次执行', completedAt: now } : item.mainAgent,
        runtimeError: item.phase === 'refining' ? '桌面端重启中断了本次优化；可以在交付页重新发送优化要求。' : '桌面端重启中断了本次执行；已完成步骤已保留，可以点击“继续执行”从未完成步骤接着跑。',
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
    // ---- durable workbench appearance + conversation-style preferences ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/style/read',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'GET') return bad(res, 'method', 'GET required');
        try { writeJson(res, 200, await readStyleStore()); } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/style/write',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        const operation = styleMutationQueue.then(async () => {
          const current = await readStyleStore();
          const next = cleanStyleStore({ ...body, sessionStyles: current.sessionStyles });
          next.revision = current.revision + 1;
          await writeStyleStore(next);
          styleState = next;
          return next;
        });
        styleMutationQueue = operation.catch(() => {});
        try { writeJson(res, 200, await operation); } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/style/session',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try {
          if (req.method === 'GET') {
            const sessionId = paramOf(req, 'sessionId') || '';
            const store = await readStyleStore();
            return writeJson(res, 200, (store.sessionStyles || {})[sessionId] || { conversationStyle: '', customConversationStyle: '' });
          }
          if (req.method !== 'POST') return bad(res, 'method', 'GET or POST required');
          let body;
          try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
          const sessionId = String(body.sessionId || '').slice(0, 160);
          if (!sessionId) throw new Error('sessionId required');
          const style = CONVERSATION_STYLES.has(body.conversationStyle) ? body.conversationStyle : '';
          const operation = styleMutationQueue.then(async () => {
            const current = await readStyleStore();
            const sessionStyles = { ...(current.sessionStyles || {}) };
            if (style) {
              sessionStyles[sessionId] = { conversationStyle: style, customConversationStyle: String(body.customConversationStyle || '').trim().slice(0, 1200) };
            } else {
              delete sessionStyles[sessionId];
            }
            const next = cleanStyleStore({ ...current, sessionStyles });
            next.revision = current.revision + 1;
            await writeStyleStore(next);
            styleState = next;
            return sessionStyles[sessionId] || { conversationStyle: '', customConversationStyle: '' };
          });
          styleMutationQueue = operation.catch(() => {});
          try { writeJson(res, 200, await operation); } catch (error) { fail(res, error); }
        } catch (error) { fail(res, error); }
      }
    },
    // ---- P2.6 model readiness + per-project context overrides ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/models/probe',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body = {};
        try { body = JSON.parse(await readBody(req) || '{}'); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        try { writeJson(res, 200, await probeOrchestrationModels(Boolean(body.force), Boolean(body.all))); } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/project-context',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        const requestedPath = req.method === 'GET' ? (paramOf(req, 'projectPath') || '') : '';
        try {
          if (req.method === 'GET') {
            if (requestedPath) await authorizeWorkspacePath(requestedPath, 'directory');
            return writeJson(res, 200, await projectContextConfig(requestedPath));
          }
          if (req.method !== 'POST') return bad(res, 'method', 'GET or POST required');
          let body;
          try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
          const projectPath = String(body.projectPath || '');
          if (!projectPath) throw new Error('projectPath required');
          const { canonical } = await authorizeWorkspacePath(projectPath, 'directory');
          const injectionPaths = await validateProjectInjectionPaths(canonical, Array.isArray(body.injectionPaths) ? body.injectionPaths : []);
          const operation = projectContextMutationQueue.then(async () => {
            const next = cleanProjectContext({ ...body, projectPath: canonical, injectionPaths, updatedAt: new Date().toISOString() });
            const store = await readProjectContexts();
            const index = store.items.findIndex((entry) => taskProjectKey(entry.projectPath) === taskProjectKey(canonical));
            if (index >= 0) store.items[index] = next; else store.items.push(next);
            await writeProjectContexts(store);
            return next;
          });
          projectContextMutationQueue = operation.catch(() => {});
          return writeJson(res, 200, await operation);
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/session-context',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try {
          if (req.method === 'GET') {
            const projectPath = paramOf(req, 'projectPath') || '';
            const sessionId = paramOf(req, 'sessionId') || '';
            if (projectPath) await authorizeWorkspacePath(projectPath, 'directory');
            return writeJson(res, 200, await readSessionContext(projectPath, sessionId));
          }
          if (req.method !== 'POST') return bad(res, 'method', 'GET or POST required');
          const body = JSON.parse(await readBody(req));
          const projectPath = String(body.projectPath || '');
          const sessionId = String(body.sessionId || '');
          if (!sessionId) throw new Error('sessionId required');
          if (projectPath) await authorizeWorkspacePath(projectPath, 'directory');
          return writeJson(res, 200, await appendSessionContext(projectPath, sessionId, body.append));
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/project-rules',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try {
          if (req.method === 'GET') {
            const projectPath = paramOf(req, 'projectPath') || '';
            return writeJson(res, 200, await discoverProjectRules(projectPath));
          }
          if (req.method !== 'POST') return bad(res, 'method', 'GET or POST required');
          const body = JSON.parse(await readBody(req));
          const projectPath = String(body.projectPath || '');
          if (!projectPath) throw new Error('projectPath required');
          return writeJson(res, 200, await appendProjectRule(projectPath, body.target, body.append, Boolean(body.init)));
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/project-context/refine',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        try {
          const body = JSON.parse(await readBody(req));
          const projectPath = String(body.projectPath || '');
          if (!projectPath) throw new Error('projectPath required');
          return writeJson(res, 200, await refineProjectContext(projectPath));
        } catch (error) { fail(res, error); }
      }
    },
    // ---- persistent workbench tasks (separate from per-turn agent todos) ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/events',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'GET') return bad(res, 'method', 'GET required');
        const sessionId = paramOf(req, 'sessionId') || '';
        if (sessionId) {
          if (!sseSessions.has(sessionId)) sseSessions.set(sessionId, new Set());
          sseSessions.get(sessionId).add(res);
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write('retry: 3000\n\n');
        sseClients.add(res);
        const cleanup = () => {
          sseClients.delete(res);
          if (sessionId) {
            const set = sseSessions.get(sessionId);
            if (set) { set.delete(res); if (set.size === 0) sseSessions.delete(sessionId); }
          }
        };
        req.on('close', cleanup);
        req.on('error', cleanup);
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/tasks/list',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'GET') return bad(res, 'method', 'GET required');
        const projectPath = paramOf(req, 'projectPath') || '';
        const sessionId = paramOf(req, 'sessionId') || '';
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
            modelCatalog,
            modelHealth: store.modelHealth || {},
            sessionClients: sessionId ? (sseSessions.get(sessionId) || new Set()).size : 0
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
            const feedback = cleanTaskText(body.feedback, 6000);
            const modelPolicy = cleanTaskText(body.modelPolicy, 40) || 'balanced';
            const probed = body.probeModels ? await probeOrchestrationModels(Boolean(body.forceProbe)) : { models: await listOrchestrationModels(), probe: record.modelProbe };
            const planRequest = { ...body, feedback, modelPolicy, modelProbe: probed.probe };
            await taskMutationQueue.then(() => mutateTasks({ ...planRequest, action: 'orchestration_set_planning', planningNote: feedback ? '正在按反馈重新编排…' : 'AI 正在生成第一份方案…' }));
            void (async () => {
              try {
                const plan = await generateOrchestrationPlan({ ...record, modelProbe: probed.probe }, feedback, probed.models, modelPolicy);
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
          let knowledgeCapture = null;
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
          if (body.action === 'orchestration_worker_retry') {
            void runOrchestration(body.id).catch((error) => diag('orchestration worker retry failed: ' + String((error && error.stack) || error)));
          }
          if (body.action === 'orchestration_continue') {
            void continueOrchestration(body.id).catch((error) => diag('orchestration continue failed: ' + String((error && error.stack) || error)));
          }
          if (body.action === 'orchestration_accept') {
            const accepted = store.orchestrations.find((item) => item.id === body.id) || null;
            try {
              knowledgeCapture = await captureAcceptedOrchestrationKnowledge(accepted);
            } catch (error) {
              diag('accepted orchestration knowledge capture failed: ' + String((error && error.stack) || error));
            }
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
            modelCatalog,
            knowledgeCapture
          });
        } catch (error) {
          bad(res, 'task-mutation-failed', String((error && error.message) || error));
        }
      }
    },
    // ---- fs: native folder picker (Electron main process only) ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/fs/pick-folder',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let dialog = null;
        try { dialog = hostRequire('electron').dialog; } catch (e) { dialog = null; }
        if (!dialog || typeof dialog.showOpenDialog !== 'function') return bad(res, 'native-dialog-unavailable', '当前环境不支持原生文件夹选择，请手动输入路径');
        try {
          const result = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择项目文件夹' });
          const picked = result && !result.canceled && Array.isArray(result.filePaths) ? result.filePaths[0] : '';
          if (typeof picked !== 'string' || picked === '') return writeJson(res, 200, { canceled: true, path: '' });
          writeJson(res, 200, { canceled: false, path: picked });
        } catch (error) { fail(res, error); }
      }
    },
    // ---- open: external protocol via Electron main process (obsidian:// etc.) ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/open/external',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        const uri = cleanTaskText(body.uri, 2000);
        if (!/^(obsidian|https?):\/\//i.test(uri)) return bad(res, 'bad-uri', 'only obsidian:// or http(s):// allowed');
        let shell = null;
        try { shell = hostRequire('electron').shell; } catch (e) { shell = null; }
        if (!shell || typeof shell.openExternal !== 'function') return bad(res, 'external-unavailable', '当前环境不支持打开外部应用，请复制路径后在 Obsidian 中手动打开');
        try {
          await shell.openExternal(uri);
          writeJson(res, 200, { ok: true });
        } catch (error) { fail(res, error); }
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
    },
    // ---- agents pool: durable config for the multi-AI collaboration pool ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/agents/list',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try { writeJson(res, 200, await readAgentsStore()); } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/agents/write',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        if (!Array.isArray(body.agents)) return bad(res, 'bad-agents', 'agents must be an array');
        const mode = body.mode === 'pool' ? 'pool' : 'free';
        try { writeJson(res, 200, await writeAgentsStore(body.agents, mode)); } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/agents/reset',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        try { writeJson(res, 200, await writeAgentsStore(AGENT_POOL_DEFAULTS, 'free')); } catch (error) { fail(res, error); }
      }
    },
    // ---- memory snapshots: cross-session context ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/memory/list',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try { writeJson(res, 200, await readMemoryStore()); } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/memory/generate',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        try {
          const store = await readTaskStore();
          const orchestration = store.orchestrations.find((item) => item.id === body.orchestrationId);
          if (!orchestration) return bad(res, 'not-found', 'orchestration not found');
          if (!['review', 'accepted', 'failed', 'cancelled'].includes(orchestration.phase)) return bad(res, 'not-ready', '只对已结束的任务生成记忆快照');
          const snapshot = await generateMemorySnapshot(orchestration);
          const memory = await readMemoryStore();
          memory.revision += 1;
          memory.snapshots = [...memory.snapshots, snapshot];
          await writeMemoryStore(memory);
          writeJson(res, 200, { snapshot, revision: memory.revision });
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/memory/remove',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        try {
          const memory = await readMemoryStore();
          const before = memory.snapshots.length;
          memory.snapshots = memory.snapshots.filter((entry) => entry.id !== body.id);
          if (memory.snapshots.length === before) return bad(res, 'not-found', 'snapshot not found');
          memory.revision += 1;
          await writeMemoryStore(memory);
          writeJson(res, 200, { revision: memory.revision });
        } catch (error) { fail(res, error); }
      }
    },
    // ---- workflows: template library + schedules + runs ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/workflows/list',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try {
          const templates = await ensureDefaultTemplates();
          const workflows = await readWorkflowStore();
          writeJson(res, 200, { templates, schedules: workflows.schedules, runs: workflows.runs });
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/workflows/schedule',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        try {
          const templates = await ensureDefaultTemplates();
          if (!templates.some((item) => item.id === body.templateId)) return bad(res, 'template-not-found', 'template not found');
          const workflows = await readWorkflowStore();
          workflows.revision += 1;
          if (body.id && workflows.schedules.some((item) => item.id === body.id)) {
            workflows.schedules = workflows.schedules.map((item) => item.id === body.id ? cleanWorkflowSchedule({ ...item, templateId: body.templateId, projectPath: body.projectPath, intervalMinutes: body.intervalMinutes, enabled: body.enabled !== false }) : item);
          } else {
            workflows.schedules.push(cleanWorkflowSchedule({ templateId: body.templateId, projectPath: body.projectPath, intervalMinutes: body.intervalMinutes, enabled: body.enabled !== false }));
          }
          await writeWorkflowStore(workflows);
          writeJson(res, 200, { schedules: workflows.schedules });
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/workflows/run',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        try {
          const run = await runWorkflow(body.templateId, String(body.projectPath || ''), body.sourceSessionId, 'manual');
          writeJson(res, 200, { run });
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/workflows/remove',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        try {
          const workflows = await readWorkflowStore();
          const before = workflows.schedules.length + workflows.runs.length;
          if (body.kind === 'schedule') workflows.schedules = workflows.schedules.filter((item) => item.id !== body.id);
          else if (body.kind === 'run') workflows.runs = workflows.runs.filter((item) => item.id !== body.id);
          else return bad(res, 'bad-kind', 'kind must be schedule or run');
          if (workflows.schedules.length + workflows.runs.length === before) return bad(res, 'not-found', 'record not found');
          workflows.revision += 1;
          await writeWorkflowStore(workflows);
          writeJson(res, 200, { schedules: workflows.schedules, runs: workflows.runs });
        } catch (error) { fail(res, error); }
      }
    },
    // ---- knowledge: Obsidian-compatible vault + retrieval engine (P5 v3.1) ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/list',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try {
          const vaultRoot = await ensureKnowledgeVault();
          let index = await readKnowledgeIndex();
          if (await knowledgeIndexStale()) index = await scanKnowledgeVault();
          const vectorConfig = maskVectorConfig(await readVectorConfig());
          const profiles = await readKnowledgeProfiles();
          writeJson(res, 200, {
            vaultRoot,
            updatedAt: index.updatedAt,
            stats: index.stats,
            entries: index.entries,
            profiles,
            vector: vectorConfig
          });
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/overview',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try {
          writeJson(res, 200, await knowledgeOverview());
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/sync',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        try {
          const index = await scanKnowledgeVault();
          writeJson(res, 200, { updatedAt: index.updatedAt, stats: index.stats, entries: index.entries });
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/write',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        const target = knowledgeWritePath(body.folder, cleanTaskText(body.name, 160));
        if (!target) return bad(res, 'bad-path', 'invalid folder or file name');
        const content = String(body.content || '');
        if (!content.trim()) return bad(res, 'empty', 'content required');
        if (Buffer.byteLength(content, 'utf8') > KNOWLEDGE_MAX_ENTRY_BYTES) return bad(res, 'too-large', 'content exceeds 512KB');
        try {
          await ensureKnowledgeVault();
          await writeFile(target.full, content, 'utf8');
          const index = await scanKnowledgeVault();
          const entry = index.entries.find((item) => item.path === target.relPath) || null;
          try {
            const vectorConfig = await readVectorConfig();
            if (vectorConfig.provider !== 'none' && entry) await updateKnowledgeVectorsFor([entry]);
          } catch (e) { /* vector sync best effort */ }
          let precheck = null;
          try {
            precheck = await precheckKnowledgeEntry({
              title: entry ? entry.title : name,
              content,
              source: entry ? entry.source : '',
              excludePath: target.relPath
            });
          } catch (e) { /* best effort */ }
          writeJson(res, 200, { entry, entries: index.entries, precheck });
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/raw',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        if (!String(body.content || '').trim()) return bad(res, 'empty', 'content required');
        try {
          const result = await captureKnowledgeRaw({ name: body.name, source: body.source, content: body.content });
          writeJson(res, 200, result);
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/precheck',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        try {
          const result = await precheckKnowledgeEntry({
            title: body.title,
            content: body.content,
            source: body.source,
            excludePath: body.excludePath
          });
          writeJson(res, 200, result);
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/publish',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        try {
          const result = await publishKnowledgeEntry({
            path: body.path,
            moveToAtomic: body.moveToAtomic !== false,
            verifiedBy: body.verifiedBy,
            reject: body.reject === true
          });
          writeJson(res, 200, result);
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/archive',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        try {
          const result = await archiveKnowledgeEntry({ path: body.path, restore: body.restore === true });
          writeJson(res, 200, result);
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/quality',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try {
          if (req.method === 'POST') {
            let body;
            try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
            const current = await readKnowledgeQuality();
            const next = {
              ...current,
              reviewMode: body.reviewMode === 'auto' ? 'auto' : 'manual',
              autoPublishLowRisk: body.autoPublishLowRisk !== false,
              forgetMode: body.forgetMode === 'auto' ? 'auto' : 'prompt',
              forgetAutoArchive: body.forgetAutoArchive === true
            };
            await writeKnowledgeQuality(next);
            writeJson(res, 200, next);
          } else {
            writeJson(res, 200, await readKnowledgeQuality());
          }
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/consolidations',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try {
          if (req.method === 'POST') {
            let body;
            try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
            if (body.action === 'apply') {
              writeJson(res, 200, await applyKnowledgeConsolidation({ id: body.id }));
            } else if (body.action === 'ignore') {
              writeJson(res, 200, await ignoreKnowledgeConsolidation({ id: body.id }));
            } else {
              return bad(res, 'bad-action', 'action must be apply or ignore');
            }
          } else {
            writeJson(res, 200, await suggestKnowledgeConsolidations());
          }
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/read',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try {
          const target = knowledgeResolve(paramOf(req, 'path'));
          if (!target) return bad(res, 'bad-path', 'invalid knowledge path');
          const content = await readFile(target.full, 'utf8');
          const index = await readKnowledgeIndex();
          const entry = index.entries.find((item) => item.path === target.relPath) || null;
          writeJson(res, 200, { path: target.relPath, content, entry });
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/remove',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        const target = knowledgeResolve(body.path);
        if (!target) return bad(res, 'bad-path', 'invalid knowledge path');
        try {
          await rm(target.full, { force: true });
          const index = await scanKnowledgeVault();
          writeJson(res, 200, { ok: true, removed: target.relPath, entries: index.entries });
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/search',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        try {
          const result = await runKnowledgeSearch(body.query, body.project, {
            topK: body.topK,
            tokenBudget: body.tokenBudget,
            routingMode: body.routingMode,
            maxIterations: body.maxIterations,
            thresholds: body.thresholds
          });
          if (result && !result.error) {
            await knowledgeRecordMissCandidate(body.query, result.coverage, (result.results || []).length > 0);
          }
          writeJson(res, 200, result);
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/auto',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        const query = cleanTaskText(body.query, KNOWLEDGE_MAX_QUERY_CHARS);
        if (!query) return bad(res, 'empty', 'query required');
        try {
          const result = await knowledgeAutoRetrieve(query, body.sessionId, body.project);
          rememberKnowledgeChatContext(body.sessionId, result);
          writeJson(res, 200, result);
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/auto/config',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try {
          if (req.method === 'POST') {
            let body;
            try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
            const current = await readKnowledgeAutoConfig();
            const next = cleanKnowledgeAutoConfig({ ...current, ...(body || {}) });
            await writeKnowledgeAutoConfig(next);
            writeJson(res, 200, { config: next });
          } else {
            writeJson(res, 200, { config: await readKnowledgeAutoConfig() });
          }
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/profile',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try {
          const profiles = await readKnowledgeProfiles();
          if (req.method === 'POST') {
            let body;
            try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
            const project = cleanTaskText(body.project, 300);
            const merged = mergeKnowledgeProfile(body.profile, project);
            profiles[project] = merged;
            await writeKnowledgeProfiles(profiles);
            writeJson(res, 200, { project, profile: merged });
          } else {
            const project = cleanTaskText(paramOf(req, 'project'), 300);
            writeJson(res, 200, { project, profile: mergeKnowledgeProfile(profiles[project], project) });
          }
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/distill',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        const content = String(body.content || '').slice(0, 60000);
        if (!content.trim()) return bad(res, 'empty', 'content required');
        try {
          const result = await distillKnowledge({ title: body.title, source: body.source, content, project: body.project });
          writeJson(res, 200, result);
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/maintain',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        try {
          writeJson(res, 200, await maintainKnowledgeVault());
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/feedback',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        const question = cleanTaskText(body.question, 500);
        if (!question) return bad(res, 'empty', 'question required');
        try {
          writeJson(res, 200, await recordKnowledgeFeedback({ ...body, question }));
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/traces',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try {
          if (req.method === 'POST') {
            let body;
            try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
            if (body.action !== 'clear') return bad(res, 'bad-action', 'action must be clear');
            const sessionId = cleanTaskText(body.sessionId, 160);
            const store = await mutateKnowledgeTraceStore((next) => {
              next.traces = sessionId ? next.traces.filter((trace) => trace.sessionId !== sessionId) : [];
            });
            return writeJson(res, 200, { ok: true, clearedSessionId: sessionId, summary: summarizeKnowledgeTraces(store.traces) });
          }
          if (req.method !== 'GET') return bad(res, 'method', 'GET or POST required');
          const sessionId = cleanTaskText(paramOf(req, 'sessionId'), 160);
          const tool = cleanTaskText(paramOf(req, 'tool'), 80);
          const limit = clampInt(paramOf(req, 'limit'), 1, 1000, 200);
          if (tool && !KNOWLEDGE_TRACE_TOOLS.has(tool)) return bad(res, 'bad-tool', 'unknown trace tool');
          const store = await readKnowledgeTraceStore();
          const filtered = store.traces.filter((trace) => (!sessionId || trace.sessionId === sessionId) && (!tool || trace.tool === tool));
          const traces = filtered.slice(-limit);
          writeJson(res, 200, { version: store.version, updatedAt: store.updatedAt, totalMatched: filtered.length, summary: summarizeKnowledgeTraces(traces), traces });
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/eval',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try {
          writeJson(res, 200, await readKnowledgeEval());
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/eval/add',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        const item = cleanEvalItem({ question: body.question, expected: body.expected, answerHints: body.answerHints, expectedStrategy: body.expectedStrategy, expectedWeb: body.expectedWeb });
        if (!item.question) return bad(res, 'empty', 'question required');
        try {
          const store = await readKnowledgeEval();
          store.items = store.items || [];
          store.items.push(item);
          store.items = store.items.slice(-300);
          await writeKnowledgeEval(store);
          writeJson(res, 200, { item, items: store.items });
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/eval/remove',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        try {
          const store = await readKnowledgeEval();
          store.items = (store.items || []).filter((item) => item.id !== body.id);
          await writeKnowledgeEval(store);
          writeJson(res, 200, { ok: true, items: store.items });
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/eval/update',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        try {
          const store = await readKnowledgeEval();
          const index = (store.items || []).findIndex((item) => item.id === body.id);
          if (index < 0) return bad(res, 'not-found', 'evaluation item not found');
          store.items[index] = cleanEvalItem({ ...store.items[index], ...body.patch, id: store.items[index].id, createdAt: store.items[index].createdAt });
          await writeKnowledgeEval(store);
          writeJson(res, 200, { item: store.items[index], items: store.items });
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/eval/candidate',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        try {
          const store = await readKnowledgeEval();
          const candidate = (store.candidates || []).find((item) => item.id === body.id);
          if (!candidate) return bad(res, 'not-found', 'evaluation candidate not found');
          if (body.action === 'promote') {
            const expected = Array.isArray(body.expected) ? body.expected : candidate.expected;
            if (!expected || !expected.length) return bad(res, 'expected-required', 'at least one expected path or title is required');
            const item = cleanEvalItem({ ...candidate, id: randomUUID(), expected, answerHints: body.answerHints || candidate.answerHints });
            store.items = [...(store.items || []), item].slice(-300);
          } else if (body.action !== 'ignore') {
            return bad(res, 'bad-action', 'action must be promote or ignore');
          }
          store.candidates = (store.candidates || []).filter((item) => item.id !== candidate.id);
          await writeKnowledgeEval(store);
          writeJson(res, 200, { ok: true, action: body.action, items: store.items, candidates: store.candidates });
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/eval/run',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        try {
          writeJson(res, 200, await runKnowledgeEvalSet({ topK: body.topK, rerank: body.rerank }));
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/audit',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        const answer = cleanTaskText(body.answer, 30000);
        if (!answer) return bad(res, 'empty', 'answer required');
        try {
          const config = await readKnowledgeAutoConfig();
          const level = body.level || config.auditLevel;
          const deep = body.deep === true || level === 'ref+groundedness';
          const audit = deep
            ? await auditKnowledgeCitationsDeep(answer, body.refs, {
                level,
                query: cleanTaskText(body.query, 500),
                sessionId: cleanTaskText(body.sessionId, 160),
                autoFix: body.autoFix !== false
              })
            : auditKnowledgeCitations(answer, body.refs, level);
          writeJson(res, 200, audit);
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/groundedness',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try {
          if (req.method !== 'GET') return bad(res, 'method', 'GET required');
          const taskStore = await readTaskStore();
          const audits = (taskStore.orchestrations || [])
            .map((item) => item.knowledgeCitationAudit)
            .filter((audit) => audit && typeof audit === 'object' && audit.level === 'ref+groundedness');
          const traceStore = await readKnowledgeTraceStore();
          const traceAudits = traceStore.traces.filter((trace) => trace.tool === 'knowledge_audit');
          const traceChecks = traceAudits.flatMap((trace) => trace.result && Array.isArray(trace.result.checks) ? trace.result.checks : []);
          const orchestrationChecks = audits.flatMap((audit) => Array.isArray(audit.groundednessChecks) ? audit.groundednessChecks : []);
          const checks = traceChecks.length ? traceChecks : orchestrationChecks;
          const rate = (list) => {
            const eligible = list.filter((check) => check.verdict !== 'abstained');
            return eligible.length ? Math.round(eligible.filter((check) => check.verdict === 'grounded').length / eligible.length * 1000) / 1000 : null;
          };
          const samples = [
            ...audits.slice(-100).map((audit) => ({
              source: 'orchestration',
              checkedAt: audit.checkedAt,
              rate: audit.groundednessRate,
              target: audit.groundednessTarget,
              claims: audit.groundednessSummary,
              fixed: audit.fixed,
              method: audit.groundednessMethod,
              checks: (Array.isArray(audit.groundednessChecks) ? audit.groundednessChecks : []).slice(0, 30).map((check) => ({ verdict: check.verdict, score: check.score, reason: check.reason }))
            })),
            ...traceAudits.slice(-100).map((trace) => ({
              source: 'trace',
              traceId: trace.id,
              checkedAt: trace.endedAt,
              rate: trace.result && trace.result.rate,
              target: trace.result && trace.result.target,
              claims: trace.result ? { claims: trace.result.claimCount, grounded: trace.result.grounded, violations: trace.result.violations, rate: trace.result.rate, method: trace.result.method } : null,
              fixed: trace.result && trace.result.fixed,
              method: trace.result && trace.result.method,
              checks: trace.result && Array.isArray(trace.result.checks) ? trace.result.checks : []
            }))
          ].slice(-200);
          writeJson(res, 200, {
            target: KNOWLEDGE_GROUNDEDNESS_TARGET,
            summary: {
              orchestrationSamples: audits.length,
              traceSamples: traceAudits.length,
              claimSamples: checks.filter((check) => check.verdict !== 'abstained').length,
              groundednessRate: rate(checks),
              method: traceAudits.length ? (traceAudits[0].result && traceAudits[0].result.method || null) : null,
              faithfulness: rate(checks),
              completeness: (() => {
                const values = traceAudits.map((trace) => Number(trace.result && trace.result.completeness)).filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
                return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 1000) / 1000 : null;
              })()
            },
            samples
          });
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/groundedness/generate',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        try {
          writeJson(res, 200, await generateKnowledgeGroundednessSamples({ count: body.count, topK: body.topK }));
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/vector',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        try {
          if (req.method === 'POST') {
            let body;
            try { body = JSON.parse(await readBody(req)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
            const config = cleanVectorConfig(body.config);
            const current = await readVectorConfig();
            if (!config.apiKey && current.apiKey) config.apiKey = current.apiKey;
            let status = { tested: false, reason: 'provider none' };
            if (config.provider !== 'none') {
              try {
                const embedded = await embedKnowledgeTexts(config, ['测试']);
                status = { tested: true, dims: embedded ? embedded.dims : 0 };
              } catch (embedError) {
                status = { tested: false, error: String((embedError && embedError.message) || embedError) };
              }
            }
            if (config.provider === 'none' || status.tested) {
              await writeVectorConfig(config);
              writeJson(res, 200, { saved: true, config: maskVectorConfig(config), status });
            } else {
              writeJson(res, 200, { saved: false, config: maskVectorConfig(current), status });
            }
          } else {
            const config = await readVectorConfig();
            const vectors = await readKnowledgeVectors();
            writeJson(res, 200, {
              config: maskVectorConfig(config),
              stored: {
                count: Object.keys(vectors.vectors || {}).length,
                dims: vectors.dims,
                updatedAt: vectors.updatedAt
              }
            });
          }
        } catch (error) { fail(res, error); }
      }
    },
    {
      kind: 'exact',
      path: '/api/dsh-workbench/knowledge/vector/rebuild',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        try {
          writeJson(res, 200, await rebuildKnowledgeVectors());
        } catch (error) { fail(res, error); }
      }
    },
    // ---- attachments: loopback-only upload for orchestration inputs ----
    {
      kind: 'exact',
      path: '/api/dsh-workbench/attachment/put',
      handler: async (req, res) => {
        if (!fence(req, res)) return;
        if (req.method !== 'POST') return bad(res, 'method', 'POST required');
        let body;
        try { body = JSON.parse(await readBody(req, MAX_ATTACHMENT_BYTES * 2 + 64 * 1024)); } catch { return bad(res, 'bad-json', 'invalid JSON body'); }
        const name = cleanTaskText(body.name, 240);
        const data = String(body.data || '');
        if (!name || !data) return bad(res, 'missing', 'name and base64 data required');
        const ext = String(name).toLocaleLowerCase().split('.').pop() || '';
        if (!ATTACHMENT_TYPES.has(ext)) return bad(res, 'type-not-allowed', 'attachment type not allowed: ' + ext);
        let buffer;
        try { buffer = Buffer.from(data, 'base64'); } catch (e) { return bad(res, 'bad-data', 'invalid base64 data'); }
        if (buffer.length === 0 || buffer.length > MAX_ATTACHMENT_BYTES) return bad(res, 'too-large', 'attachment must be ≤ ' + MAX_ATTACHMENT_BYTES + ' bytes');
        try {
          await mkdir(ATTACHMENT_ROOT, { recursive: true });
          const id = randomUUID();
          const filePath = join(ATTACHMENT_ROOT, id);
          await writeFile(filePath, buffer);
          writeJson(res, 200, cleanAttachment({ id, name, mime: ATTACHMENT_TYPES.get(ext), size: buffer.length, path: filePath }));
        } catch (error) { fail(res, error); }
      }
    }
  ];
}

function apply(ctx) {
  diag('apply called');
  void readStyleStore().catch((error) => diag('style store load failed: ' + String((error && error.stack) || error)));
  let disposers = [];
  let commandDisposers = [];
  const register = (webServer) => {
    try {
      const routes = makeRoutes();
      disposers.push(...routes.map((route) => webServer.register(route)));
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
  ctx.inject(['systemPrompt'], (scoped) => {
    scoped.effect(() => scoped.systemPrompt.section({
      name: 'dsh-workbench:conversation-style',
      order: 50,
      text: (context) => conversationStylePrompt((context && context.agent && context.agent.id) || '')
    }), 'dsh-workbench: conversation style');
    try {
      const kbDispose = scoped.systemPrompt.section({
        name: 'dsh-workbench:knowledge-context',
        order: 60,
        text: (context) => knowledgeChatContextSectionText(context)
      });
      disposers.push(kbDispose);
      diag('knowledge-context section registered');
    } catch (error) {
      diag('knowledge-context section register failed: ' + String((error && error.stack) || error));
    }
  });
  ctx.inject(['tools', 'systemPrompt'], (scoped) => {
    const toolDisposers = [];
    try {
      toolDisposers.push(scoped.tools.register(makeKnowledgeSearchTool()));
      toolDisposers.push(scoped.tools.register(makeKnowledgeReadTool()));
      toolDisposers.push(scoped.systemPrompt.section({ name: 'dsh-workbench:knowledge-tools', order: 108, text: KNOWLEDGE_TOOL_PROMPT }));
      disposers.push(...toolDisposers);
      diag('knowledge_search + knowledge_read tools registered');
    } catch (error) {
      for (const dispose of toolDisposers.reverse()) dispose();
      diag('knowledge tools register failed: ' + String((error && error.stack) || error));
    }
  });
  try {
    const traceDispose = ctx.on('tools/execute', traceKnowledgeToolExecution);
    if (typeof traceDispose === 'function') disposers.push(traceDispose);
    diag('knowledge/Web tool trace listener registered');
  } catch (error) {
    diag('knowledge/Web tool trace listener register failed: ' + String((error && error.stack) || error));
  }
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
  workflowTimer = setInterval(() => { void pollWorkflowSchedules(); }, WORKFLOW_SCHEDULE_POLL_MS);
  if (workflowTimer && typeof workflowTimer.unref === 'function') workflowTimer.unref();
  const knowledgeMaintain = () => { void maintainKnowledgeVault().catch(() => {}); };
  const knowledgeMaintainTimer = setInterval(knowledgeMaintain, 24 * 3600 * 1000);
  if (knowledgeMaintainTimer && typeof knowledgeMaintainTimer.unref === 'function') knowledgeMaintainTimer.unref();
  const knowledgeMaintainBoot = setTimeout(knowledgeMaintain, 15000);
  if (knowledgeMaintainBoot && typeof knowledgeMaintainBoot.unref === 'function') knowledgeMaintainBoot.unref();
  ctx.on('dispose', () => {
    if (workflowTimer !== null) clearInterval(workflowTimer);
    workflowTimer = null;
    clearInterval(knowledgeMaintainTimer);
    clearTimeout(knowledgeMaintainBoot);
    workflowInFlight.clear();
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
