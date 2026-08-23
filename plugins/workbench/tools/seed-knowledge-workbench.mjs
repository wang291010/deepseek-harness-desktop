#!/usr/bin/env node
/**
 * Seed the workbench knowledge vault with real workbench knowledge + an eval set.
 *
 * Usage: node tools/seed-knowledge-workbench.mjs --api http://127.0.0.1:PORT
 *
 * - Seeds curated 02-Atomic / 04-Projects entries distilled from the workbench
 *   build history (P1A/P2/P2.5/P3/P4/P5).
 * - Adds eval questions that map to those entries (recall@k harness).
 */

const args = process.argv.slice(2);
const apiBase = (() => {
  const index = args.indexOf('--api');
  return index >= 0 ? args[index + 1].replace(/\/+$/, '') : '';
})();
if (!apiBase) {
  console.error('usage: node tools/seed-knowledge-workbench.mjs --api http://127.0.0.1:PORT');
  process.exit(1);
}

async function api(path, method, body) {
  const response = await fetch(apiBase + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(path + ' -> ' + response.status + ' ' + text.slice(0, 300));
  return text ? JSON.parse(text) : {};
}

const now = new Date().toISOString();
const frontmatter = (title, type, tags, confidence, related, summary) => [
  '---',
  'title: ' + title,
  'type: ' + type,
  'tags: [' + tags.join(', ') + ']',
  'confidence: ' + confidence,
  'related: "' + (related || []).map((item) => '[[' + item + ']]').join(' ') + '"',
  'summary: ' + summary,
  'source: 工作台开发沉淀',
  'project: ',
  'created: ' + now,
  '---',
  ''
].join('\n');

const entries = [
  {
    folder: 'atomic', name: '工作台-任务面板优化',
    content: frontmatter('工作台-任务面板优化', 'note', ['工作台', '任务面板', 'P1A'], 'high', ['工作台-多AI协作'],
      '任务面板按用户反馈重构：Quick-Add 直接发任务、方案异步生成、执行进度可视化、中断可继续。') + [
      '# 工作台-任务面板优化',
      '',
      '## 结论',
      '',
      '任务面板以"线性列表 + 运行视图 + 快速创建"为核心，规划与执行全程有进度反馈。',
      '',
      '## 方法',
      '',
      '- 顶部 Quick-Add：输入任务回车即创建并进入方案阶段，不用先进想法库。',
      '- 方案异步生成：先落盘 planning 状态，后台生成，前端显示不确定进度条与已用时长。',
      '- 执行可视化：整体进度条 + 逐代理状态卡（含耗时/尝试次数）+ 阶段步骤条。',
      '- 中断继续：保留已完成子代理产出，只重跑未完成部分，主代理再汇总。',
      '',
      '## 决策',
      '',
      '规划异步化（D12）；进度刷新保持轮询（D13）；方案生成先落盘再后台执行。',
      '',
      '## 待办',
      '',
      '真机复测运行中项目切换（反馈 #5）。'
    ].join('\n')
  },
  {
    folder: 'atomic', name: '工作台-风格页',
    content: frontmatter('工作台-风格页', 'note', ['工作台', '风格', 'P2'], 'high', [],
      '风格页提供主题/强调色/壁纸/透明度/毛玻璃/字体/圆角/密度与预设，对话风格与专家分离。') + [
      '# 工作台-风格页',
      '',
      '## 结论',
      '',
      '视觉设置实时生效并持久化；对话风格是独立的一层，决定"怎么表达"，与专家人格分离。',
      '',
      '## 方法',
      '',
      '- 外观：主题（浅/深/跟随系统）、强调色、壁纸、界面不透明度、暗色遮罩、毛玻璃、字体大小、圆角、密度。',
      '- 预设：内置（专注/工作室/深夜）+ 自定义最多 20 个，可保存/删除；预设不复制壁纸。',
      '- 持久化：DSH_HOME/dsh-workbench-style.json，串行队列 + 原子替换，revision 递增。',
      '',
      '## 决策',
      '',
      '对话风格 MVP 为全局默认，可叠加任意专家；按会话保存留待后续。'
    ].join('\n')
  },
  {
    folder: 'atomic', name: '工作台-多AI协作',
    content: frontmatter('工作台-多AI协作', 'note', ['工作台', '多AI', 'P2.5'], 'high', ['工作台-看门狗机制', '工作台-记忆快照', '工作台-候选专家池'],
      '主会话驱动的多AI协作：普通/快速问答/多AI 模式，复杂任务自动拆解给子代理执行并汇总。') + [
      '# 工作台-多AI协作',
      '',
      '## 结论',
      '',
      '用户只和主代理对话，主代理拆解任务、编排子代理、汇总结果，右侧面板实时可视化。',
      '',
      '## 方法',
      '',
      '- 模式开关：普通 / 快速问答（单个回答代理）/ 多AI协作，切换不丢上下文。',
      '- 复杂度判断：启发式规则（阈值 0.6）+ 可选"自动判断复杂任务"。',
      '- 编排：方案 V1/V2、dependsOn 依赖、并行上限（≤4）、逐代理模型选择与白名单回退。',
      '- 输入增强：@ 引用想法/文件、拖拽上传（≤10MB 自动摘要）、快捷命令 /new /plan /memory。',
      '- 记忆快照：任务结束后生成，Token 可跨会话恢复。',
      '',
      '## 决策',
      '',
      '多AI 默认手动切换（D14）；复杂度用启发式 + LLM 双轨（D15）；旧任务中心保留为管理视图（D19）。'
    ].join('\n')
  },
  {
    folder: 'atomic', name: '工作台-看门狗机制',
    content: frontmatter('工作台-看门狗机制', 'note', ['多AI', '看门狗', '可靠性'], 'high', ['工作台-多AI协作'],
      '子代理超时自动重试，全部失败标记"执行异常/需人工介入"并跳过主代理，节省成本。') + [
      '# 工作台-看门狗机制',
      '',
      '## 结论',
      '',
      '单任务超时默认 300s（DSH_WORKBENCH_WORKER_TIMEOUT_MS 可调），自动重试 ≤2 次，全失败进入"执行异常"。',
      '',
      '## 方法',
      '',
      '- 超时 → 重试 ≤2 次（DSH_WORKBENCH_WORKER_MAX_RETRIES）→ 全部失败标记"需要人工介入"。',
      '- 进入执行异常后跳过主代理汇总，避免继续消耗 token。',
      '- 代理记录带 attempts 字段，界面显示"尝试 N 次"。',
      '',
      '## 决策',
      '',
      '原方案"换同类型代理"未实现，改为重试 + 人工介入。'
    ].join('\n')
  },
  {
    folder: 'atomic', name: '工作台-记忆快照',
    content: frontmatter('工作台-记忆快照', 'note', ['多AI', '记忆', '跨会话'], 'high', ['工作台-多AI协作'],
      '任务成果压缩为记忆快照（摘要/发现/决策/待办），复制 Token 可在后续任务加载恢复。') + [
      '# 工作台-记忆快照',
      '',
      '## 结论',
      '',
      '跨会话恢复上下文的关键机制：快照只存摘要类信息，不含对话原文与代码全文。',
      '',
      '## 方法',
      '',
      '- 生成：任务结束后由 LLM 压缩（失败回退启发式提取），持久化到 dsh-workbench-memory.json（上限 100 条）。',
      '- 使用：复制 Token → 新任务输入区加载（≤5 条），方案提示词注入记忆摘要。',
      '',
      '## 决策',
      '',
      '快照范围按 D16 推荐：仅摘要/关键发现/决策/待办，保护隐私与控制成本。'
    ].join('\n')
  },
  {
    folder: 'atomic', name: '工作台-候选专家池',
    content: frontmatter('工作台-候选专家池', 'note', ['多AI', '专家', '子代理'], 'high', ['工作台-多AI协作'],
      '子代理默认"自由生成"：主代理按任务自动创建最适配专家并自动分配模型；也可切换参考候选池。') + [
      '# 工作台-候选专家池',
      '',
      '## 结论',
      '',
      '子代理池不固定，由主代理按任务动态生成最适配的专家；候选池只是可选参考。',
      '',
      '## 方法',
      '',
      '- 自由生成（默认）：拆解时不参考固定名单，主代理自动创建专家并自动分模型。',
      '- 参考候选池：agents.json（角色/能力/模型/提示词）参与拆解匹配，agentRef 命中注入池提示词，'
      + '并以池模型作为未手动指定时的回退。',
      '- 决策 Tab 提供模式开关、JSON 编辑器、重新载入 / 恢复默认 / 保存设置。'
    ].join('\n')
  },
  {
    folder: 'atomic', name: '工作台-监控页',
    content: frontmatter('工作台-监控页', 'note', ['工作台', '监控', 'P3'], 'high', [],
      '监控页五板块：账户总览/用量统计/会话洞察/实时面板/告警，数据来自 dsh-usage-stats。') + [
      '# 工作台-监控页',
      '',
      '## 结论',
      '',
      '五板块全部实现并部署，10 秒刷新，告警触发页面横幅 + 导航红点。',
      '',
      '## 方法',
      '',
      '- 账户：余额、累计费用、预计可用天数、Token 总量、费用趋势。',
      '- 用量：Token 分项、命中率、主要模型、按模型/按天（7/30/90/365 天）。',
      '- 会话：消耗最高前 8；实时：当前会话用量 + 协作运行状态。',
      '- 告警：余额/日/区间阈值，本机 localStorage 持久化。'
    ].join('\n')
  },
  {
    folder: 'atomic', name: '工作台-工作流页',
    content: frontmatter('工作台-工作流页', 'note', ['工作台', '工作流', 'P4'], 'high', ['工作流-部署发布'],
      '工作流页：模板库 + 一键运行 + 定时调度，首批 4 个默认模板。') + [
      '# 工作台-工作流页',
      '',
      '## 结论',
      '',
      '模板一键运行生成分组任务，运行记录含状态/任务数/时间；支持定时调度。',
      '',
      '## 方法',
      '',
      '- 默认模板：日报/晨报汇总、会议纪要整理、调研写作流水线、表格数据清洗。',
      '- 调度：间隔分钟（1–10080）、启用/暂停、lastRunAt；Host 每 30 秒轮询（unref 不阻塞退出）。',
      '- 限制：仅在桌面端运行期间触发。'
    ].join('\n')
  },
  {
    folder: 'atomic', name: '知识库-v3-架构',
    content: frontmatter('知识库-v3-架构', 'note', ['知识库', '架构', 'P5'], 'high', ['技能-知识库检索', '知识库-维护器与自生长', '知识库-评测集'],
      '知识库三层架构：Obsidian 资产层 / BM25+图谱+可插拔向量引擎层 / 工作台+MCP 接入层。') + [
      '# 知识库-v3-架构',
      '',
      '## 结论',
      '',
      '本地自用、自生长、不污染上下文、最小 token 最大价值、防幻觉、多路可配置检索，未来可被其他 agent 接入。',
      '',
      '## 方法',
      '',
      '- 资产层：01-Inbox（AI 写入）→ 02-Atomic（人工审核）→ 03-MOCs → 04-Projects → 99-Templates，Obsidian 兼容。',
      '- 引擎层：中文分词 BM25 + 图谱 2 跳 + RRF 融合 + 可选 LLM 重排/HyDE + 证据块 token 预算 + 强制溯源。',
      '- 接入层：工作台知识库页 + MCP 预留（knowledge-query CLI、稳定检索接口）。',
      '- 自生长四件套：写入即结构化 → 审核流转 → 每周维护 → 反馈闭环。',
      '',
      '## 决策',
      '',
      '三层架构/检索画像/自生长/MCP/评测集先行/向量可插拔（D20–D22）均已确认。'
    ].join('\n')
  },
  {
    folder: 'atomic', name: '技能-知识库检索',
    type: 'skill',
    content: frontmatter('技能-知识库检索', 'skill', ['技能', '检索', '知识库'], 'high', ['知识库-v3-架构'],
      '多路召回 + RRF 融合 + 溯源输出：BM25 关键词路、图谱路（标签/双向链接 2 跳）、可选向量路与 HyDE。') + [
      '# 技能-知识库检索',
      '',
      '## 结论',
      '',
      '检索必须溯源（文件路径 + 置信度 + 检索分），并按 token 预算剪枝，避免污染上下文。',
      '',
      '## 方法',
      '',
      '- BM25：CJK bigram + 英文单词，k1=1.5、b=0.75；标签纳入索引词。',
      '- 图谱：related 双向链接 + 同标签邻居，2 跳扩展。',
      '- 融合：RRF（1/(60+rank) 加权），按检索画像配权重。',
      '- 预算：默认 Top5 / ≤1500 token，超预算剪枝；检索前自动检测 vault 变更重建索引。',
      '',
      '## 决策',
      '',
      '向量路默认关闭（none），接口可插拔（bge-local/openai/custom），是否启用由评测集决定。'
    ].join('\n')
  },
  {
    folder: 'atomic', name: '技能-蒸馏入库',
    type: 'skill',
    content: frontmatter('技能-蒸馏入库', 'skill', ['技能', '蒸馏', '知识库'], 'high', ['知识库-v3-架构'],
      '把对话/文档/笔记蒸馏为结构化 Markdown 条目，先入 01-Inbox，人工确认后移到 02-Atomic。') + [
      '# 技能-蒸馏入库',
      '',
      '## 结论',
      '',
      'AI 提炼结论/方法/决策/待办并自动生成 frontmatter（title/tags/related/confidence/summary/type）。',
      '',
      '## 方法',
      '',
      '- 输入：文本/会话/文档；LLM 不可用时回退兜底模板（置信度 low）。',
      '- 流程：蒸馏 → 01-Inbox 待审核 → 人工确认/编辑 → 移入 02-Atomic → 检索默认覆盖。',
      '- type 字段：note/skill/project/workflow，供资产总览分类。'
    ].join('\n')
  },
  {
    folder: 'atomic', name: '工作流-部署发布',
    type: 'workflow',
    content: frontmatter('工作流-部署发布', 'workflow', ['工作流', '部署', '发布'], 'high', ['工作台-工作流页'],
      '工作台插件部署 SOP：备份 → 复制两个文件到运行端 → 重启桌面端 → 定位新端口 → 回归。') + [
      '# 工作流-部署发布',
      '',
      '## 结论',
      '',
      'Client 改动刷新即生效；Host 改动必须重启桌面端，每次重启动态端口会变化。',
      '',
      '## 方法',
      '',
      '1. 备份运行副本到 backups\\<时间戳>。',
      '2. 复制 plugins/workbench/lib/{client.js,host/index.js} 到运行端 app.asar.unpacked\\node_modules\\dsh-workbench\\lib。',
      '3. 重启桌面端（带 --remote-debugging-port=9224 便于回归）。',
      '4. netstat 定位新端口，验证 API 往返。',
      '5. smoke + CDP GUI 回归通过后提交。',
      '',
      '## 待办',
      '',
      '打包大更新发给朋友前先攒足进度。'
    ].join('\n')
  },
  {
    folder: 'atomic', name: '工作台-原生文件夹选择',
    content: frontmatter('工作台-原生文件夹选择', 'note', ['工作台', '修复', '文件'], 'high', [],
      'Electron 32+ 移除 File.path，旧浏览按钮报错；改用 Host 原生对话框（dialog.showOpenDialog）。') + [
      '# 工作台-原生文件夹选择',
      '',
      '## 结论',
      '',
      '项目创建"浏览…"优先走 Host 原生对话框，不可用时回退 HTML 文件夹输入；取消不再弹二次。',
      '',
      '## 方法',
      '',
      '- Host 新增 POST /api/dsh-workbench/fs/pick-folder（Electron dialog.showOpenDialog 主进程实现）。',
      '- 客户端优先原生对话框，非桌面环境优雅降级（400 native-dialog-unavailable）。',
      '- 取消（canceled）与原生不可用区分处理。'
    ].join('\n')
  },
  {
    folder: 'projects', name: '项目-简历生成器',
    type: 'project',
    content: frontmatter('项目-简历生成器', 'project', ['项目', '简历'], 'medium', [],
      '当前进行中的项目：剩余功能补全与打印美化，任务已恢复并完成，处于等待验收。') + [
      '# 项目-简历生成器',
      '',
      '## 结论',
      '',
      '任务"简历生成器剩余功能补全与打印美化"（id 174c2a92…）已从执行异常恢复并完成，当前等待验收。',
      '',
      '## 待办',
      '',
      '- 真机验收打印效果。',
      '- 完成后可蒸馏本项目经验入库。'
    ].join('\n')
  },
  {
    folder: 'atomic', name: 'FastAPI-订单中台决策',
    content: frontmatter('FastAPI-订单中台决策', 'note', ['架构', 'fastapi', '订单'], 'high', [],
      '订单中台选 FastAPI：异步支持与类型校验适合高并发长流程。') + [
      '# FastAPI-订单中台决策',
      '',
      '## 结论',
      '',
      'FastAPI 提供异步支持与类型校验，适合订单中台的高并发与长流程。',
      '',
      '## 决策',
      '',
      '异步解耦与高性能是关键选型理由。'
    ].join('\n')
  },
  {
    folder: 'atomic', name: '技能-BGE本地向量',
    type: 'skill',
    content: frontmatter('技能-BGE本地向量', 'skill', ['技能', '向量', 'bge'], 'high', ['技能-知识库检索', '知识库-评测集'],
      '本地向量方案：BGE 小模型免费离线部署，需 Python + onnxruntime + tokenizers，首次自动下载约 100MB。') + [
      '# 技能-BGE本地向量',
      '',
      '## 结论',
      '',
      '向量路是可插拔的一路召回；本地 BGE（如 bge-small-zh-v1.5）免费离线，付费模型（OpenAI 等）填 key 即可切换。',
      '',
      '## 方法',
      '',
      '- 接口：provider none|bge-local|openai|custom，配置留空保持已保存 key。',
      '- 本地部署：pip install onnxruntime tokenizers numpy huggingface_hub；tools/knowledge_embed.py 做桥接。',
      '- 首次使用自动下载模型到 ~/.cache/knowledge-bge/<model>。',
      '',
      '## 决策',
      '',
      '是否启用由评测集实测决定（D21），不盲目安装。'
    ].join('\n')
  },
  {
    folder: 'atomic', name: '知识库-维护器与自生长',
    content: frontmatter('知识库-维护器与自生长', 'note', ['知识库', '自生长', '维护'], 'high', ['知识库-v3-架构', '知识库-评测集'],
      '每周维护：去重/断链/孤儿/过期报告 + MOC 自动更新；检索反馈闭环把"没找到"记入评测候选池。') + [
      '# 知识库-维护器与自生长',
      '',
      '## 结论',
      '',
      '知识库随使用自生长：写入即结构化 → 审核流转 → 每周维护压缩 → 反馈闭环修正。',
      '',
      '## 方法',
      '',
      '- 维护：token Jaccard 查重（>0.55 提示）、断链报告、孤儿条目、180 天未更新高置信度降级提示。',
      '- MOC：03-MOCs/Index.md 自动生成（最近新增 + 标签索引）。',
      '- 反馈：检索"没找到/不准"自动记入评测候选池，成为后续评测题。'
    ].join('\n')
  },
  {
    folder: 'atomic', name: '知识库-评测集',
    content: frontmatter('知识库-评测集', 'note', ['知识库', '评测', '调优'], 'high', ['知识库-维护器与自生长', '技能-知识库检索'],
      '评测集 = 标准考题（问题 + 期望召回 + 答案要点）；每次改引擎跑同一套题量化 recall@k/token/耗时。') + [
      '# 知识库-评测集',
      '',
      '## 结论',
      '',
      '没有考题就只能凭感觉调参；评测集让每次引擎改动可回归验证，只保留变好的改动。',
      '',
      '## 方法',
      '',
      '- 考题：问题 + 期望召回（路径或标题）+ 答案要点，建议 20–50 条覆盖真实使用场景。',
      '- 指标：recall@k、平均 token、平均耗时；历史存档可对比。',
      '- 向量路开关也用它验证（开向量前后分数对比）。',
      '',
      '## 待办',
      '',
      '持续从使用反馈（候选池）补充考题。'
    ].join('\n')
  }
];

const evalItems = [
  ['任务面板怎么快速创建协作任务', '工作台-任务面板优化'],
  ['方案生成是同步还是异步', '工作台-任务面板优化'],
  ['怎么设置工作台主题和壁纸', '工作台-风格页'],
  ['对话风格和专家人格是什么关系', '工作台-风格页'],
  ['多AI协作模式怎么切换', '工作台-多AI协作'],
  ['子代理超时了会怎样', '工作台-看门狗机制'],
  ['记忆快照 Token 怎么用', '工作台-记忆快照'],
  ['候选专家池和自由生成有什么区别', '工作台-候选专家池'],
  ['监控页有哪些板块', '工作台-监控页'],
  ['工作流模板在哪管理', '工作台-工作流页'],
  ['知识库三层架构是什么', '知识库-v3-架构'],
  ['知识库检索用了哪些方法', '技能-知识库检索'],
  ['检索结果为什么带路径和置信度', '技能-知识库检索'],
  ['蒸馏入库的流程是什么', '技能-蒸馏入库'],
  ['上线部署工作台要注意什么', '工作流-部署发布'],
  ['选文件夹功能怎么修的', '工作台-原生文件夹选择'],
  ['简历生成器项目现在什么状态', '项目-简历生成器'],
  ['订单中台为什么用 FastAPI', 'FastAPI-订单中台决策'],
  ['向量路有哪些选择', '技能-BGE本地向量'],
  ['BGE 本地部署需要什么', '技能-BGE本地向量'],
  ['怎么防止知识库污染上下文', '知识库-v3-架构'],
  ['每周维护做什么', '知识库-维护器与自生长'],
  ['检索没找到会怎样', '知识库-维护器与自生长'],
  ['评测集是什么', '知识库-评测集'],
  ['向量路什么时候开', '知识库-评测集']
];

evalItems.push(
  ['如何从任务面板发起一个多 AI 协作', '工作台-任务面板优化'],
  ['生成协作方案时界面会不会被阻塞', '工作台-任务面板优化'],
  ['在哪里调整强调色、背景图和界面风格', '工作台-风格页'],
  ['会话表达方式会覆盖专家角色设定吗', '工作台-风格页'],
  ['单 AI 会话怎样改成多 AI', '工作台-多AI协作'],
  ['执行代理卡住后看门狗如何重试', '工作台-看门狗机制'],
  ['跨会话继续任务时怎样引用记忆快照', '工作台-记忆快照'],
  ['编排时固定专家名单和自动选专家如何选择', '工作台-候选专家池'],
  ['账户、用量和告警信息去哪里看', '工作台-监控页'],
  ['定时工作流和模板库在哪里配置', '工作台-工作流页'],
  ['个人知识库的数据流和分层是怎样的', '知识库-v3-架构'],
  ['搜索笔记时 BM25、图谱和向量怎么配合', '技能-知识库检索'],
  ['知识召回结果如何进行溯源和可信度判断', '技能-知识库检索'],
  ['如何把一段会话提炼成待审核知识', '技能-蒸馏入库'],
  ['发布新版工作台前需要检查哪些事项', '工作流-部署发布'],
  ['原生目录选择为什么需要单独修复', '工作台-原生文件夹选择'],
  ['简历生成器目前完成到哪个阶段', '项目-简历生成器'],
  ['订单服务选择 FastAPI 的技术依据是什么', 'FastAPI-订单中台决策'],
  ['知识库向量检索支持哪些 provider', '技能-BGE本地向量'],
  ['离线运行 BGE 向量模型有哪些依赖', '技能-BGE本地向量'],
  ['怎样控制知识检索占用的上下文和 token', '知识库-v3-架构'],
  ['知识库维护器会自动处理哪些问题', '知识库-维护器与自生长'],
  ['没有召回结果的问题会被记录到哪里', '知识库-维护器与自生长'],
  ['为什么要维护固定的知识检索回归题', '知识库-评测集'],
  ['什么情况下值得启用向量检索或重排', '知识库-评测集']
);

if (evalItems.length !== 50) throw new Error('knowledge evaluation seed must contain exactly 50 items');

let seeded = 0;
for (const entry of entries) {
  const result = await api('/api/dsh-workbench/knowledge/write', 'POST', { folder: entry.folder, name: entry.name, content: entry.content });
  if (result.entry) seeded += 1;
  console.log('seeded ' + entry.folder + '/' + entry.name + '.md');
}

let added = 0;
for (const [question, expectedTitle] of evalItems) {
  const result = await api('/api/dsh-workbench/knowledge/eval/add', 'POST', {
    question,
    expected: [expectedTitle],
    answerHints: '',
    expectedStrategy: 'single',
    expectedWeb: 'none'
  });
  added += 1;
}

console.log('seeded ' + seeded + ' entries, added ' + added + ' eval items');
