# 工作台任务交接（2026-08-20 v7，P2.6 已部署并通过 GUI 验收）

> 本文只记录续作上下文，不替代当前用户请求。详细范围与决策见
> [未来完整计划](workbench-future-plan-2026-08-18.md) 的 P2.6 与 D23-D25。

## 一、仓库与工作区

- 仓库：`C:\YourWorkbench`，分支 `main`，开工前 HEAD `b2e95c5`，比 `origin/main` 超前 11 个提交。
- 当前未提交改动：
  - `plugins/workbench/lib/client.js`
  - `plugins/workbench/lib/host/index.js`
  - `plugins/workbench/tools/smoke-collab.mjs`
  - `plugins/workbench/tools/gui-p26-regression.mjs`
  - `desktop-source/dsh-plugin-desktop/docs/workbench-future-plan-2026-08-18.md`
  - 本文档
- 备份：部署前 `C:\YourWorkbench\backups\workbench-p26-pre-20260820-000115`；
  部署时 `C:\YourWorkbench\backups\workbench-p26-deploy-20260820`。
- 不修改 `deepseek-harness/` 子模块；开发源始终以 `plugins/workbench/lib` 为准。

## 二、本轮完成的 P2.6 源码

- Agent 页新增按会话记忆的“单 AI / 多 AI”；单 AI 保留原生会话输入，多 AI 使用工作台输入。
- 多 AI 自动执行：发送 → 实测模型 → 规划 → 启动编排 → 主代理汇总；默认按复杂度选择快速回答或
  完整编排，也可强制始终编排。
- 对话内折叠卡显示进度、主/子代理、所用/继承模型、探测摘要、报告与风险；精确跳转任务中心同一记录。
- 自动启动 ID 按会话持久化，规划中切换会话后不会停在 `planned`。
- @ 浮层支持想法库与当前项目顶层文件；复用附件上传和拖放。
- 项目上下文设置支持项目备注、技术栈覆盖和项目内相对注入目录。
- Host 新增 `models/probe` 和 `project-context`；模型缓存 10 分钟，最多实测 12 个且按 Provider 轮转；
  项目上下文存储串行、原子替换、重试、限额，并防符号链接越界。
- 引用以 `sourceRefs` 保存，提示词强制 `[来源: 名称]`；最终报告缺标注会产生验收风险。
- 体验修正：多 AI 发送后，用户消息与主代理最终报告以消息卡直接写入对话流（`wb-chat-flow`），观感与正常
  对话一致；底部浮层专注实时进度（阶段、当前子代理高亮、模型实测），报告区只提示已写入对话。消息按会话
  持久化到 localStorage（`wb.chatFlow.<sessionId>`），切换会话后仍可恢复。

## 三、验证状态

已通过：

- Client/Host `node --check`
- `git diff --check`（仅换行转换提示）
- ESLint（`lib/client.js`、`lib/host/index.js` 零报错）
- `smoke-collab.mjs`
- `smoke-knowledge.mjs`
- `smoke-memory.mjs`
- `smoke-orchestration.mjs`
- `smoke-style.mjs`
- `smoke-watchdog.mjs`
- `smoke-workflow.mjs`
- `smoke-client-load.mjs`（需将桌面源码 `node_modules` 设为 `NODE_PATH`）
- CDP GUI 回归：`tools/gui-p26-regression.mjs`（截图 `p26-agent-single/multi/refs/context/final.png`、
  `p26-task-center.png`）

运行端部署与 GUI 结果：

- 运行端 Client/Host 哈希与源码一致；桌面端以 `--remote-debugging-port=9224` 重启。
- 真实模型实测：目录 30 个、单次实测 12 个全部可用、跳过 18 个、10 分钟缓存生效。
- 真实快速问答：创建 → 模型实测 → 规划 → 自动启动 → 子代理回答 → 主代理汇总，最终报告 100% 完成；
  主代理 gpt-5.6-sol、子代理 deepseek-v4-flash；对话流出现用户消息与主代理最终报告消息卡，浮层仅保留
  进度/模型摘要。
- 任务中心精确高亮同一编排，详情含方案、模型清单与实际使用模型。

## 四、完成记录与建议后续

1. 本轮改动已提交；不要推送，除非用户明确要求。
2. 后续可继续验证窄窗口布局（桌面宽度下已目测正常）与“始终编排”复杂任务多代理执行。
3. 模型探测上限（12 个/次）与跳过说明已在真实目录（30 个）上验证，后续如需覆盖全部模型可提供“全部实测”按钮。

## 五、运行端路径

`C:\Users\wang2\AppData\Local\Programs\DeepSeek Harness Desktop\resources\app.asar.unpacked\node_modules\dsh-workbench\lib`

已部署；Host 改动必须重启，Client 改动刷新即可。
