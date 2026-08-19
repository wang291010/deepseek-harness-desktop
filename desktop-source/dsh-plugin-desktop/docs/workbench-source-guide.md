# 工作台源码导读（2026-08-20）

> 供维护者快速定位。开发源以 `plugins/workbench/lib` 为准；运行端部署副本在桌面安装目录
> `resources/app.asar.unpacked/node_modules/dsh-workbench/lib`。

## 1. 入口与文件

| 文件 | 职责 |
|---|---|
| `lib/client.js` | 客户端 bundle：外壳、六页、任务中心、AI 协作、多 AI 对话、项目配置 |
| `lib/host/index.js` | Host 插件：存储、编排引擎、知识库、工作流、SSE、全部 HTTP 路由 |
| `tools/smoke-*.mjs` | Host 冒烟测试（独立临时目录，不碰真实数据） |
| `tools/gui-*.mjs` | CDP 真实桌面 GUI 回归 |
| `tools/run-knowledge-eval.mjs` | 知识库评测（补题 `--add` / 跑分） |

## 2. client.js 分区索引

- `45` externals（web shell 提供）
- `142` services stash（apply 注入的服务）
- `776` 全局错误表面（事件错误 → 红色遮罩 + 复制/安全模式）
- `815` 会话面板（项目/会话/临时想法 + ChatModeSwitch 单多 AI）
- `1465` `useWorkbenchTasks`（任务数据 hook + SSE 订阅）
- `2044` 任务中心（聚焦/想法库/任务/AI 协作/复盘 + 看板/列表/时间线/模板）
- `2640` `ProjectConfigPanel`（项目配置栏：会话专属/项目规则/备注精炼）
- `2790` `WbToolbar`（右侧工具栏：详细信息/项目配置/Git/文件/蒸馏）
- `3109` Agent 工作区（会话列 + 对话 + 工具栏）
- `3680` 知识库页（总览/检索/蒸馏/维护/评测/向量设置）
- `4401` 专家页（卡片：调用/编辑/复制/删除）
- `4571` 错误边界 + `4645` 根包装（安全模式）

### 多 AI 对话相关（`MultiAiConversationShell`）

- 对话流消息（`wb-chat-flow`）、子代理浮层（`wb-chat-agents`，自动展开/折叠）、
  模型实测面板（`wb-chat-model-pop`，全部实测）、@ 引用、附件拖放、SSE 静默刷新。
- 模式与策略按会话存 localStorage（`wb.chatMode.*` / `wb.chatStrategy.*`）。

## 3. host/index.js 分区索引

- 顶部常量：存储路径、上限、`DSH_WORKBENCH_WORKER_TIMEOUT_MS` 等环境变量。
- `style`：外观 + 对话风格（全局 + 会话级 `sessionStyles`）。
- `agents`：候选专家池。
- `memory`：跨会话记忆快照。
- `workflow`：模板/调度/运行。
- `knowledge`：vault 扫描、质量门、BM25/图谱/向量检索、蒸馏、维护、评测集。
- `tasks`：任务库（`mutateTasks`）+ 编排（方案生成、`runOrchestrationWorker`、
  watchdog 重试、主代理汇总、`syncOrchestrationTask` 看板同步）。
- `sseClients` / `broadcastTaskEvent`：任务变更 SSE 推送。
- `project-context` / `project-rules` / `session-context`：项目配置与规则、会话专属内容。
- `models/probe`：模型实测（抽样 12 个 / `all` 全量）。
- 路由注册：`makeRoutes()` 中按区块注释排列（style → P2.6 模型/项目 → tasks → fs → preset →
  git → chat → agents → memory → workflows → knowledge → attachments）。

## 4. 存储文件（应用数据目录 `DSH_HOME`）

| 文件 | 内容 |
|---|---|
| `dsh-workbench-tasks.json` | 任务/想法/编排/模板（含编排任务卡同步） |
| `dsh-workbench-style.json` | 外观设置 + 对话风格（含会话级） |
| `dsh-workbench-memory.json` | 记忆快照 |
| `dsh-workbench-agents.json` | 候选专家池 |
| `dsh-workbench-workflows.json` | 模板/调度/运行 |
| `dsh-workbench-project-contexts.json` | 项目备注/技术栈/注入目录 |
| `dsh-workbench-knowledge-*.json` | 知识索引/向量/质量/评测 |
| `sessions/<项目>/<会话>/dsh-workbench-session.md` | 会话专属内容（不写项目） |

## 5. 环境变量

- `DSH_HOME`：应用数据根目录（桌面端为 harness-home）。
- `DSH_WORKBENCH_WORKER_TIMEOUT_MS`：子代理超时（默认 15 分钟）。
- `DSH_WORKBENCH_WORKER_MAX_RETRIES`：子代理重试次数（默认 2）。

## 6. 测试命令

```powershell
# Host 冒烟（独立临时目录）
node tools/smoke-collab.mjs        # 编排/附件/溯源/规则/会话内容/安全边界
node tools/smoke-style.mjs         # 风格 + 会话级对话风格
node tools/smoke-memory.mjs
node tools/smoke-orchestration.mjs
node tools/smoke-watchdog.mjs
node tools/smoke-workflow.mjs
node tools/smoke-knowledge.mjs

# 客户端装载（需桌面源码 node_modules 在 NODE_PATH）
$env:NODE_PATH='C:\YourWorkbench\desktop-source\dsh-plugin-desktop\node_modules'
node tools/smoke-client-load.mjs

# 真实桌面 GUI（桌面端需以 --remote-debugging-port=9224 启动）
node tools/gui-p1-regression.mjs   # P1A/P1B 结构性回归
node tools/gui-p26-regression.mjs  # P2.6 多 AI 对话/模型/看板/项目配置
node tools/gui-p27-regression.mjs  # 窄窗口 + 始终编排
node tools/gui-knowledge-regression.mjs

# 知识库评测（补题 / 跑分）
node tools/run-knowledge-eval.mjs --add "问题" --expected "条目标题"
node tools/run-knowledge-eval.mjs --api http://127.0.0.1:PORT
```

## 7. 约定

- 所有文件接口必须经 `authorizeWorkspacePath`；新路由必须调用 `fence(req, res)`。
- 存储写入使用进程内串行队列 + 同目录临时文件原子替换（Windows rename 重试）。
- Client 改动刷新即生效；Host 路由/编排改动需重启桌面端。
- 新增 Host 冒烟测试后才算交付；GUI 行为用 CDP 回归脚本固化。
