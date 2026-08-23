# 项目日志系统（Project Log）使用工作流

> 2026-08-23 在 YourWorkbench 首次跑通并沉淀。适用于任何 Codex 项目。

## 这是什么

一套"长期日志 + 自动记录 + 经验蒸馏"的项目记忆系统，解决会话没有上下文时 AI 无法理解项目历史的问题：

- 项目内记录（`.project-log/`）：改了什么、为什么、效果如何，跨会话可回溯。
- 自动维护：`AGENTS.md` 约定任务收尾必须补录，AI 完成工作后自动调用更新技能。
- 经验沉淀：阶段性把心得蒸馏进外部知识库（本工作台用 KB 格式，普通项目用通用 Markdown）。

## 三个技能

| 技能 | 作用 | 何时触发 |
|---|---|---|
| `$project-log-init` | 创建 `.project-log/` 四件套、写入 AGENTS.md 约定、配置蒸馏目标 | 新项目初始化、迁移历史基线 |
| `$project-log-update` | 把一次任务/改动/决策追加进 changelog/index/learnings/status | 任务收尾自动调用，或用户说"记录一下" |
| `$project-log-distill` | 读 config 蒸馏目标，把 learnings 写成知识条目 | 项目完成、阶段总结，或用户说"蒸馏/沉淀" |

## 文件分工

- `index.md` — 功能级总清单（按模块、时间倒序、带 C 编号跳转）
- `changelog.md` — 代码级明细（编号/时间/模块/文件/改动/原因/验证/回滚）
- `learnings.md` — 心得与决策（方案取舍、方法评价、触发词配方）← 蒸馏的输入源
- `status.md` — 当前进度、最近编号、待办
- `config.json` — 蒸馏目标（`workbench-kb` 用知识库格式；`generic` 用通用 Markdown；可多目标）

## 标准流程

1. **初始化**：`$project-log-init` → 生成模板 → 写入 AGENTS.md → 确认蒸馏目标 → 迁移历史基线（编号从 C0001 起）。
2. **日常记录**：每完成一个任务，AI 按 AGENTS.md 约定调用 `$project-log-update`；用户也可随时手动触发。
3. **蒸馏**：里程碑或项目完成时，`$project-log-distill` 读取 learnings，按各目标格式写入；工作台条目 `status: published` 才会被检索。
4. **回溯**：查 index 找模块和时间线 → 跳 changelog 看代码级细节 → 读 learnings 看当时的决策与评价。

## 已验证（2026-08-23 试点）

- 初始化：`.project-log/` 五文件 + AGENTS.md 约定就绪，基线 C0001-C0014 迁移完成。
- 自动记录：AGENTS.md 已写入强制约定，任务收尾会触发更新。
- 蒸馏：两条心得（会话超时排查、依赖补丁门禁）已按 KB 格式写入工作台 `02-Atomic`，`status: published`，索引 stale 检测会在下次访问时纳入。
- 跨项目复用：三个技能在 `~/.codex/skills`，任何 Codex 工作区均可调用。

## 注意事项

- changelog 编号连续，一件事共用一个编号；不要跳号。
- learnings 只记值得复用的内容；蒸馏后标注"（已蒸馏 日期）"避免重复。
- 蒸馏目标路径变更时直接改 `config.json`，无需动技能。
- 工作台知识库若换了位置，`config.json` 的 path 要同步更新。
