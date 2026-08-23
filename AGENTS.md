# DeepSeek Harness Desktop 工作台项目

## 项目日志维护（强制）

本项目的完整修改历史记录在 `.project-log/`（index/changelog/learnings/status）。
每当完成一个任务、修复一个 bug、或做了一次值得记录的改动/决策，收尾前必须：
1. 调用 project-log-update 技能，把改动追加到 changelog.md，并在 index.md 对应模块更新条目。
2. 在 learnings.md 记录值得复用的经验与方法评价。
3. 更新 status.md 的进度与最近记录编号。
未完成日志补录前，不得宣布任务完成。

经验蒸馏目标（工作台知识库）已配置在 `.project-log/config.json`；阶段性完成后调用 project-log-distill 技能沉淀知识。
