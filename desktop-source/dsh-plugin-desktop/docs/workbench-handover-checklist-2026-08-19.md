# 工作台交接清单（2026-08-19）

> 新会话入口文档。新窗口先读本清单，再按需展开
> [交接文档](workbench-handover-2026-08-18.md)、
> [计划总结](workbench-build-plan-summary-2026-08-18.md) 与
> [未来完整计划](workbench-future-plan-2026-08-18.md)。

## 一、当前状态（已核验）

- 仓库根 `C:\YourWorkbench`，分支 `main`，HEAD 已包含 P2 风格页提交 `b8eb587`
  （主代理续聊 `918d32c` 在其前），工作区干净。
- 桌面端 DeepSeek Harness Desktop 2.0.1 正在运行；P2 风格页已部署并回归通过，本轮 API
  端口 `127.0.0.1:58915`（每次重启会变），GUI 回归期间带 `--remote-debugging-port=9224`。
- 任务库内"简历生成器剩余功能补全与打印美化"（id `174c2a92-…`）已从"执行异常"恢复并完成，当前为"等待验收"。
- 代码位置：
  - 开发源 `C:\YourWorkbench\plugins\workbench\lib\{client.js,host\index.js}`
  - 运行副本 `%LOCALAPPDATA%\Programs\DeepSeek Harness Desktop\resources\app.asar.unpacked\node_modules\dsh-workbench\lib`
  - 部署前备份 `C:\YourWorkbench\backups\workbench-runtime-before-panel-rework-20260818\lib`

## 二、已完成（含最近几轮）

### 任务面板（P1A，用户反馈驱动）

- 错误与网络层：统一 fetch 容错（空响应/超时/解析错误）；所有错误提示可一键复制；错误遮罩不再挡点击；busy 全路径复位。
- AI 协作页 Quick-Add：顶部直接发任务，Enter 创建并进入方案阶段。
- 想法库转交修复：跳转自动修正项目范围并按 id 选中；空态区分原因。
- 方案异步生成：先落盘 `planning` 再后台生成，规划中显示进度条 + 已用时；崩溃恢复逻辑已生效。
- 执行进度可视化：整体进度条、逐代理状态卡（含耗时）、阶段步骤条。
- 反馈语义修正：反馈只用于生成新方案版本，不再注入子代理 prompt。
- 反馈草稿与已提交反馈分离。
- 项目创建支持选文件夹（"浏览…"）。
- 会话列：置顶（★）、面板拖拽调宽（264–420px）、项目切换记忆、双端同会话风险提示。
- 中断任务"继续执行"：保留已完成代理产出，只重跑未完成代理，主代理再汇总。
- 想法库即时同步：保存想法立即刷新全局徽标与想法库；打开任务中心强制刷新。
- Windows 写入健壮性：任务库临时文件 rename 加自动重试（修复偶发 EPERM）。

### 主代理续聊（本轮新增，918d32c）

- 任务进入"等待验收"或"已验收"后，右侧出现"继续与主代理对话"输入框。
- 发送后任务进入"主代理优化中"，主代理携带完整上下文（原始想法 + 方案 + 子代理结果 + 上次报告 + 全部对话记录）继续工作，并可再次调用子代理修改对应部分。
- 每轮对话记录保存在任务 `thread` 里（交付页展示"你/主代理"对话），完成后回到"等待验收"。
- 失败/中断可复制原因；重启中断优化会提示在交付页重新发送优化要求。

### P2 风格页（本轮交付，b8eb587）

- 外观：主题（浅色/深色/跟随系统）、强调色（6 预设 + 自定义取色）、壁纸（本地图片缩放转
  WebP data URL，Host 校验类型与大小，不加载远程图片）、界面不透明度、暗色遮罩、毛玻璃、
  字体大小、圆角、界面密度（紧凑/标准/宽松），全部实时预览。
- 对话风格：默认/简洁/详尽/引导/自定义，与专家人格分离，经独立 `systemPrompt` 段全局生效。
- 预设：内置（专注/工作室/深夜）可直接应用，自定义预设最多 20 个，可保存/删除；
  预设不复制壁纸，应用预设保留当前壁纸。
- 持久化：`DSH_HOME/dsh-workbench-style.json`，串行队列 + 同目录原子替换；
  Host 路由 `GET /style/read`、`POST /style/write`（校验、revision 递增）。
- 验证：`smoke-style` / `smoke-client-load` 新增；eslint、`node --check`、tsc ×4 通过；
  全量 Vitest 249 通过（23 失败为既有 Windows 环境差异）。
- 运行端：已备份并部署两个文件（备份 `backups\workbench-runtime-before-style-p2-20260819`），
  重启后 API 往返验证通过；CDP GUI 回归（渲染、外观、壁纸、对话、预设、恢复默认）全部通过，
  截图见 `C:\Users\wang2\.codex\visualizations\2026\08\18\01a0172b-e0c6-7000-85b1-6caaee4593de\style-*.png`。

### P2.5-A 多AI协作工作台（MVP，本轮交付）

- 看门狗：子代理超时（默认 300s）→ 自动重试 ≤2 次 → 全部失败进入"执行异常"并提示需人工
  介入（跳过主代理）；代理卡显示尝试次数；`DSH_WORKBENCH_WORKER_TIMEOUT_MS` /
  `DSH_WORKBENCH_WORKER_MAX_RETRIES` 可调。
- 快速问答模式：与多AI协作并列的模式开关（localStorage 持久化），创建编排带 `quick` 标记，
  规划提示词生成单个直接回答代理；复杂度启发式徽标（阈值 0.6）+ 可选"自动判断复杂任务"。
- 右侧面板升级：概览（进行中/已完成/等待队列/进度/运行时）、代理状态（含尝试次数与空态）、
  决策（原内容）三 Tab。
- 验证：新增 `smoke-watchdog.mjs`；smoke ×4、eslint、`node --check`、tsc ×4 通过；
  CDP GUI 回归全部通过（模式开关/徽标/自动判断/快速问答创建/三 Tab/空态），
  截图 `collab-compose.png`、`collab-panel.png`；测试数据已清理。

### P2.5-B 体验优化（本轮交付）

- 执行日志：编排新增 `log` 时间线（info/warn/error），右侧面板"日志"Tab（级别过滤 + 搜索）。
- 附件：回环上传接口 + 扩展名白名单 + ≤10MB + 文本自动摘要；拖拽上传 + 附件片；随任务持久化
  并注入方案/子代理提示词；删除编排自动清理附件。
- 快捷命令 `/new`、`/plan`、`/memory`（提示）；@ 引用想法库与项目文件。
- 候选专家（可选）：默认"自由生成"（不参考固定名单，主代理按任务自动创建专家并分模型）；
  可切"参考候选池"——`agents/list|write|reset` + JSON 编辑器 + 模式开关/恢复默认，
  `agentRef` 命中时注入池提示词并以池模型作回退。
- 依赖可视化：方案 Tab"执行顺序"条（拓扑分组）。
- 验证：新增 `smoke-collab.mjs`；smoke ×5、eslint、`node --check` 通过；CDP GUI 回归通过，
  截图 `collab-attach.png`、`collab-order.png`；测试数据与附件已清理。

### 自动更新托盘开关（另一会话完成，8dbf932）

- `desktop-updates` 插件新增持久化设置 `dsh-desktop-updates.enabled`（默认沿用合成补丁策略），
  托盘 "Automatic Updates: On/Off" 开关：关闭即停后台检查与弹窗（保留手动检查更新），
  开启即调度下一次后台检查；偏好持久化、跨重启保留。
- 验证：`updates.spec.ts` 21/22 通过（1 个既有 Windows 权限位断言差异）、tsc ×4 通过，已推送。
- 运行端部署（2026-08-19）：新构建 lib 已备份（`backups\desktop-plugin-lib-before-updates-toggle-20260819-110438`）
  并复制到运行端 `resources\app.asar.unpacked\lib`（updates.js / profile.js 哈希与源码一致），
  重启后启动无插件错误、工作台接口正常；托盘 "Automatic Updates" 开关已随插件加载。

### P2.5-C 记忆快照（本轮交付）

- Host：`dsh-workbench-memory.json` 持久化；`memory/list|generate|remove` 接口；任务携带
  `memoryTokens`（≤5），方案提示词注入记忆摘要。
- 客户端：右侧面板"记忆"Tab（生成/复制 Token/加载到输入/删除）+ 输入区记忆片 + 任务详情展示。
- 按 D16 推荐默认：快照仅存摘要/关键发现/决策/待办，不含对话原文与代码全文。
- 验证：新增 `smoke-memory.mjs`；smoke ×6、eslint、`node --check` 通过；CDP GUI 回归通过
  （含真实生成"简历生成器"快照并加载到新任务），截图 `collab-memory.png`；测试任务已清理。
- 项目上下文自动注入：方案提示词携带项目文件结构/技术栈线索/近期协作（仅注册工作区路径，
  越界自动跳过）；成本护栏：概览 Tab 显示并行上限与预计 LLM 调用、大任务提示。
- **P2.5 全部完成并部署**（备份 `backups\workbench-p2.5c-context-20260819-113636`）。

### 项目文件夹选择修复（原生对话框）

- 根因：Electron 32+ 移除了 `File.path`，运行端页面也没有 `window.webUtils`；旧"浏览…"在这类
  环境报"无法从当前环境读取文件夹绝对路径"（朋友实测触发）。
- 修复：Host 新增 `POST /api/dsh-workbench/fs/pick-folder`（Electron `dialog.showOpenDialog`
  主进程实现）；客户端"浏览…"优先走原生对话框，不可用时回退 HTML 文件夹输入；非桌面环境优雅
  降级（`400 native-dialog-unavailable`）。
- 验证：`smoke-collab` 新增降级断言；smoke ×6、eslint、`node --check` 通过；运行端已部署并重启
  （备份 `backups\workbench-fs-pick-folder-20260819-112558`），路由注册确认、接口正常。
- 取消修复：用户取消原生对话框时不再回退弹出 HTML 选择框（区分 `canceled` 与原生不可用；
  备份 `backups\workbench-fs-pick-cancel-20260819-112947`）。

### P3 监控页（本轮交付）

- 五板块：账户（余额/累计费用/预计可用/Token 总量/费用趋势）、用量（Token 分项/命中率/模型/
  按天，7/30/90/365 天区间）、会话（消耗最高前 8）、实时（当前会话用量 + 协作运行状态，10s 刷新）、
  告警（余额/日/区间阈值 → 页面横幅 + 导航红点，本机 localStorage）。
- 数据源：`dsh-usage-stats` 同源接口 + 会话 store；CDP GUI 回归通过（真实数据：余额 6.21 CNY、
  近 30 天费用 27.32 CNY、预计可用约 0.7 天、Token 2.06 亿），截图 `monitor-account.png`、
  `monitor-alerts.png`；未设置阈值时无横幅/红点。

### P4 工作流页（本轮交付）

- 模板库：默认 4 模板（日报/晨报、会议纪要、调研写作、表格清洗），新建/编辑/删除；
- 一键运行：生成分组任务到当前项目，运行记录含状态/任务数/时间；定时调度（间隔分钟、
  启用/暂停，仅应用运行期间触发）；运行记录可删。
- 验证：`smoke-workflow.mjs` 通过；CDP GUI 回归通过（三 Tab、新建模板、运行、调度、运行记录），
  截图 `workflows-page.png`；测试数据已清理。

### P5 知识库与蒸馏（本轮交付，v3.1，2026-08-19）

- 方案：三层架构（Obsidian Vault 资产层 / BM25+图谱+可插拔向量 引擎层 / 工作台+MCP 接入层），
  自生长四件套 + 评测集先行；向量路默认关闭、接口留好（none/bge-local/openai/custom）。
- Host：`knowledge/list|sync|write|read|remove|search|profile|distill|maintain|feedback|eval|vector`
  全套路由；索引 v2（增量 hash + 中文 bigram BM25 + 图谱 2 跳 + RRF + token 预算 + 溯源）；
  维护器（去重/断链/MOC 更新）；评测集 recall@k 跑分；frontmatter 解析修复。
- 客户端：知识库页六 Tab（增长仪表盘/浏览/检索/蒸馏/维护/评测/向量设置）+ 预览编辑 + 一键 Obsidian
  + 复制路径 + 反馈闭环。
- 工具：`knowledge_embed.py`（BGE 本地桥）、`knowledge-query.mjs`（MCP 风格 CLI）、
  `run-knowledge-eval.mjs`（评测 CLI）、`gui-knowledge-regression.mjs`（CDP 回归）。
- 验证：8 个 smoke 全过、eslint 0、tsc ×4；CDP GUI 回归通过（仪表盘/检索溯源/真实 AI 蒸馏），
  截图 knowledge-dash.png / knowledge-search.png / knowledge-distill.png。
- 部署：备份 `backups\workbench-p5-knowledge-deploy-20260819-154456`，运行端已替换并重启
  （本轮 API 端口 62713，带 --remote-debugging-port=9224）。

## 三、未完成与下一步

1. P1B 剩余 GUI 回归（需用户实测）：文件视图（盘符面包屑/保存/大文件/越界提示）、外壳（置顶/拖拽/重命名归档/默认收起）、专家页（调用/编辑/复制/删除/重启保留）、任务中心存量（看板/`/todo`/想法流转）。
2. P2.5 多AI协作工作台、P3 监控页、P4 工作流页、P5 知识库与蒸馏已完成（见上）；
   下一步 **P2.6 对话窗口多AI模式**（计划已写入 future-plan，含 D23–D25）→ P6 打磨文档。
   决策点 D14–D19 见 [未来计划](workbench-future-plan-2026-08-18.md)。
3. P7 发布链路：数字签名（等证书）、覆盖安装怪癖、`version-baseline.md` 持续同步、发布 SOP。

## 四、待用户决策（D1–D13 摘要）

- D1 模型重写 vs 手动任务覆盖策略；D2 文件视图目录范围；D3 工作流首批模板；
- D4/D5 知识库形态与检索注入；D6 旧 DSH 数据迁移；D7 数字签名；
- D8 便携版；D9 mac/Linux 支持；D10 版本节奏（建议回归完成后发 2.1.0）；
- D11 选文件夹用 HTML 方案；D12 方案异步生成；D13 进度刷新保持轮询。

## 五、开发与验证工作流

```powershell
# 静态检查（node_modules 在沙箱外时需提权）
node --check C:\YourWorkbench\plugins\workbench\lib\client.js
node --check C:\YourWorkbench\plugins\workbench\lib\host\index.js
node C:\YourWorkbench\plugins\workbench\node_modules\eslint\bin\eslint.js C:\YourWorkbench\plugins\workbench\lib\client.js C:\YourWorkbench\plugins\workbench\lib\host\index.js

# 冒烟测试（异步规划 + 中断继续 + 主代理续聊全链路）
node C:\YourWorkbench\plugins\workbench\tools\smoke-orchestration.mjs

# 部署到运行端（需提权）：复制两个文件到 app.asar.unpacked 对应目录后重启应用
# 提交（git 根在 C:\YourWorkbench，沙箱外）：git add + git commit 需提权
```

客户端改动刷新/重启即生效；Host 改动必须重启桌面端。每次重启端口会变化，用
`netstat -ano` 按进程定位，或从页面 `/api/dsh-workbench/tasks/list` 验证。

## 六、持续遵守的约束

- A 端与 B 端不同时打开同一会话；B 端故障不影响 A 端；修改前先备份。
- profile JSON 无 BOM；发布前敏感审计；文件接口仅本机回环并限制在注册工作区内。
- 旧 DSH 数据（`~/.dsh`）不迁移不删除，除非用户决定。
- 计划变更先更新 [workbench-future-plan-2026-08-18.md](workbench-future-plan-2026-08-18.md) 并经确认。
