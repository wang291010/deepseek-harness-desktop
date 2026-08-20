# DeepSeek Harness Desktop · 个人 AI 工作台（完整版）

> 基于 DeepSeek Harness 与社区 DSH Desktop 外壳构建的本地独立桌面发行版。
> Windows x64 安装包，自带自动更新（GitHub Releases）。本仓库同时托管桌面外壳源码与
> 工作台插件源码；这是目前功能最完整的发行形态，包含大量原生/社区版没有的能力。

## 特性：完整版独有功能

### 六页一体化工作台

- **Agent 工作区**：原生对话 + 会话管理 + 临时想法速记，左侧栏一键切换单 AI / 多 AI。
- **知识库**：Obsidian 兼容 Markdown Vault + 多路检索 + 蒸馏 + 维护 + 评测。
- **专家**：预设人格与工具组合，调用/编辑/复制/删除。
- **风格**：主题/强调色/壁纸/毛玻璃/密度 + 对话风格（全局与按会话）。
- **监控**：账户/用量/会话/实时/告警五板块。
- **工作流**：模板库 + 一键运行 + 定时调度。

### 任务中心 + AI 协作（个人工作台的核心）

- 五视图：聚焦 / 想法库 / 任务 / AI 协作 / 复盘；看板 / 列表 / 时间线 / 模板。
- Quick-Add 快速创建、想法库转协作、方案版本（V2/V3…）、逐代理状态卡、执行日志、
  中断继续执行、主代理续聊、记忆快照（跨会话 Token）。
- 看门狗：子代理超时自动重试、失败原因结构化、模型健康度跟踪（近期失败模型自动降权）。
- 执行进度 SSE 实时推送（不再只靠轮询）。
- 协作任务自动进入看板与复盘，状态双向同步。

### 对话窗口多 AI

- 单 AI / 多 AI 按会话记忆切换；多 AI 自动走“模型实测 → 规划 → 启动 → 主代理汇总”。
- 模型实测面板：可用模型清单 + “全部实测”（免 Python 的 BGE 向量由 Node 桥提供）。
- 用户消息与主代理最终报告进入对话流；子代理浮层实时观测、自动展开/折叠。
- @ 引用想法库与项目文件、附件拖放、`[来源: 名称]` 溯源门。
- 规划 JSON 截断自修复 + 失败自动重试。

### 项目配置（其它发行版没有）

- 会话专属内容：存于应用数据目录，绝不污染项目，自动注入规划提示词。
- 项目规则：自动发现并读写 AGENTS.md / CLAUDE.md / README，一键初始化。
- 项目备注：AI 自动精炼（读 README 与规则生成结构化备注）。

### 知识库（本地优先、可自生长）

- 01-Inbox → 02-Atomic → 03-MOCs → 04-Projects → 05-Archive 分层。
- 多路检索：BM25 + 知识图谱 + 本地 BGE 向量（免 Python，Node/WASM 推理）+ LLM 重排。
- 六步质量门、置信度推导与依据展示、项目经验（experience）半自动提炼。
- 评测集 50 题，recall@5 = 1.0；空检索自动进候选池。

### 工程与安全

- 文件接口仅本机回环、限制在注册工作区内，越界一律 403。
- 存储串行队列 + 原子替换（Windows rename 重试）；错误提示可复制、安全模式可恢复。
- 8 项 Host smoke + CDP 真实桌面 GUI 回归 + 知识库评测，每次改动全量验证。
- 完整文档：用户手册 / 故障排查 / 源码导读 / 发布 SOP / 版本基线。

## 开发流程（来自提交历史的真实过程）

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 文档与基线对齐 | ✅ |
| P1A | 任务面板重构与体验升级（错误硬化/Quick-Add/异步规划/进度可视化/中断继续） | ✅ |
| P1B | 文件视图 / 外壳 / 专家页回归 | ✅（GUI 回归通过） |
| P2 | 风格页（外观 + 对话风格） | ✅ |
| P2.5 | 多 AI 协作工作台（看门狗 / 附件日志 / 记忆快照 / 项目上下文注入） | ✅ |
| P2.6 | 对话窗口多 AI（单多切换 / 模型实测 / 对话流 / @ 引用 / 溯源门） | ✅ |
| P2.7 | 对话与项目配置体验（协作任务进看板复盘 / 项目配置栏 / 会话级风格 / 任务锁定） | ✅ |
| P3 | 监控页 | ✅ |
| P4 | 工作流页 | ✅ |
| P5 | 知识库与蒸馏（v3.1 → v4 质量门 → v6 项目经验） | ✅ |
| P6 | 打磨与文档（安全复查 / 响应式 / 用户手册 / 故障排查 / 源码导读） | ✅ |
| P7 | 发布链路（GitHub Releases 自动更新 / 覆盖安装实测 / SOP / 基线） | ✅ |

## 安装与更新

- 下载最新安装包：本仓库 GitHub Releases（自动更新即从 Releases/latest 发现新版本）。
- 覆盖安装无需卸载；历史数据位于用户数据目录，升级保留。
- 托盘可关闭自动更新（保留手动检查）；Host 改动需重启应用，Client 改动刷新页面即可。

## 仓库结构

```
desktop-source/           桌面外壳源码（Electron + DSH 插件化）
plugins/workbench/       工作台插件（client bundle + host 编排/知识库/工作流）
plugins/plugin-hub/      本地插件集线器（fork 维护中）
plugins/usage-monitor/   用量监控插件（fork 维护中）
docs/                    用户手册 / 故障排查 / 发布 SOP / 版本基线 / 源码导读
profiles/                脱敏 profile 模板（不含真实凭据）
```

## 开发

```powershell
# 工作台静态检查 + 冒烟
cd plugins/workbench
node --check lib/client.js lib/host/index.js
node tools/smoke-collab.mjs        # 编排/附件/溯源/规则/安全边界
node tools/smoke-knowledge.mjs     # 知识库
node tools/run-knowledge-eval.mjs  # 评测跑分

# 桌面端完整构建（生成安装包）
cd desktop-source
corepack yarn dist:win
```

详细流程见 `docs/workbench-source-guide.md`；发布见 `docs/release-sop.md`。

## 说明

- 安装包为未签名构建（等证书）；Windows 可能提示 Unknown publisher。
- 旧版 DSH 数据不自动迁移；凭据文件不进入仓库。
- 许可证：MIT（本仓库）；DeepSeek Harness 与 DSH Desktop 为上游项目，保留各自许可证。
- 组件归属与更新上游见 [docs/ownership-boundary.md](docs/ownership-boundary.md)：桌面外壳 / 插件商店 /
  用量监控为基于上游开源的本地 fork，工作台为原创；唯一的上游更新轨道是钉死的 Harness 核心。
