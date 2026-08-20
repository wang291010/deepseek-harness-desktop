# 所有权边界与更新上游

> 本文件是 YourWorkbench 发行版对"哪些代码属于我、哪些来自上游、更新从哪里来"的正式定义。
> 归档、发布、安全审查、版本升级时以此为准。

## 一句话结论

本仓库维护的是**你自己的独立发行版**：桌面外壳、插件商店、用量监控均为"基于他人开源代码修改的
本地维护组件"（fork），工作台插件是你的原创；DeepSeek Harness 核心是唯一被钉死的上游依赖。
整套发行版的更新通道只有你自己的 GitHub Releases，不会自动拉取任何上游更新。

## 组件归属表

| 组件 | 代码位置 | 上游来源 | 上游版本/提交 | 许可证 | 归属状态 |
| --- | --- | --- | --- | --- | --- |
| Harness 核心 | `desktop-source/deepseek-harness/`（submodule，待钉 commit） | `deepseek-ai/deepseek-harness` | commit `47f943859bef60e4160492346772ded9b24f765a`（0.1.0-rc.5），运行包 0.1.0-rc.6 | MIT | 上游，只读钉死 |
| 桌面外壳 `dsh-plugin-desktop` | `desktop-source/dsh-plugin-desktop/` | `anywhere-labs/deepseek-harness-desktop` | v2.0.0，commit `ee1235e1dd1675bbd6c52cfbe3f27b27bcfcfa81` | MIT | 你的 fork（本地维护） |
| 插件商店 `dsh-plugin-hub` | `plugins/plugin-hub/` | `yunhuantian/dsh-plugin-hub` | 0.1.6 | MIT | 你的 fork（本地维护） |
| 用量监控 `@wang291010/dsh-usage-stats` | `plugins/usage-monitor/` | `@abcdefu_cja/dsh-usage-stats` | 0.1.0 | BSD-3-Clause | 你的 fork（本地维护） |
| 工作台 `dsh-workbench` | `plugins/workbench/` | 无（原创） | — | MIT | 你的原创 |

## 更新上游规则

- 桌面应用自更新只从 `wang291010/deepseek-harness-desktop` 的 GitHub Releases/latest 拉取
  （见 `desktop-source/dsh-plugin-desktop/src/update-source.ts`）。
- 三个 fork 组件（桌面外壳、插件商店、用量监控）**不再从上游仓库获取更新**：代码维护在本仓库，
  后续修改由你完成，发布以本仓库 Releases 为准。
- 上游仓库仅作来源标注（provenance / LICENSE 保留），不是更新来源。
- 唯一可能涉及"获取别人的更新"的是 **Harness 核心**：升级必须手动审查兼容性、先备份、
  再更新基线（见 `docs/version-baseline.md`），绝不自动合入。
- 若未来把插件商店 / 用量监控拆分到独立仓库或发布到 npm，包内 `repository` 字段须改为你的
  仓库地址；未拆分前统一以本仓库（`wang291010/deepseek-harness-desktop`）为唯一事实来源。

## 许可与署名义务

- fork 组件保留上游 LICENSE（MIT / BSD-3-Clause）与版权声明，不得删除。
- 本发行版整体可依 MIT 分发，但须在文档中保留"基于 DeepSeek Harness / 社区 DSH Desktop 构建"的署名。
- 品牌与标识（YourWorkbench、Windows App ID `com.yourworkbench.*`）为你的独立资产。
