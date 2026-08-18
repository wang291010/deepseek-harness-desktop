# 工作台交接文档（2026-08-18）

> 本文件是新会话的第一入口。新会话先读本文件，再按需展开
> [计划总结](workbench-build-plan-summary-2026-08-18.md) 与
> [未来完整计划](workbench-future-plan-2026-08-18.md)。

## 一、这是什么

把 DeepSeek Harness 桌面端（B 端）改造成个人 AI 工作台。全部工作以插件化方式
落在 `dsh-workbench`（Client + Host）上，桌面发行链路独立、可自动更新。

## 二、仓库结构（单一 git 仓库，根目录 C:\YourWorkbench）

- `desktop-source/dsh-plugin-desktop/`：桌面壳源码（Electron 引导、打包、发布测试），
  当前版本 2.0.1。
- `plugins/workbench/`：个人工作台插件开发源（`lib/client.js` + `lib/host/index.js`）。
- `plugins/plugin-hub/`、`plugins/usage-monitor/`：另两款自研插件。
- `docs/`：架构、安全、迁移、版本基线等文档。
- `scripts/`、`profiles/`、`backups/`、`diagnostics/`：构建脚本、profile 模板、
  本地备份与诊断（备份/诊断不入库）。

注意：Codex 工作区通常开在 `desktop-source/dsh-plugin-desktop`，对 `plugins/`、
`docs/`、`.git` 的写入需要提权。

## 三、已完成（截至 2026-08-18，HEAD dbf1fe5）

### 工作台插件功能

- P0 插件基建完成：Client + Host、desktop profile、`/todo` 命令、回滚脚本、
  错误边界与安全模式。
- P1 外壳主体完成：6 页导航、Agent 三栏、会话/项目面板、右侧工具栏、
  默认收起布局（左栏图标栏、右栏默认关闭、可展开）、临时想法入会话栏。
- P2 专家页已实现（健身专家、AI 产品架构师），待完整回归。
- P2+ 已开发：任务看板、文件视图、想法库、三栏 AI 协作、方案版本 V1/V2、
  逐代理模型选择（V4 Flash / V4 Pro）、执行轮次与验收反馈。

### 桌面发行

- 独立品牌 DeepSeek Harness Desktop、`DSH_HOME` 数据隔离。
- 三插件内置进安装包，运行时不再依赖 `C:\YourWorkbench\plugins`。
- NSIS Setup 打包、安装/卸载 smoke（2.0.0）、自动更新闭环（v2.0.1 已验证）。
- GitHub `wang291010/deepseek-harness-desktop`：v2.0.0、v2.0.1 两个 Release；
  发布前做过 278 文件敏感内容审计，无真实凭据。
- 本机已装 2.0.1 并启用自动更新（更新源为该 GitHub 仓库）。

## 四、当前实际状态（已核验）

- git `main` 干净，HEAD `dbf1fe5`。
- 桌面包版本 2.0.1；`dist/` 有 2.0.0/2.0.1 两个 Setup 安装包。
- 2.0.1 Setup SHA256：`E1B5A41B208EF44701C5D4CC5665139484EAB0F77A402740D8189606E1BB134B`。
- 本机应用正在运行（监听 127.0.0.1:55080），注册表版本 2.0.1。

## 五、未完成与下一步

按 [未来完整计划](workbench-future-plan-2026-08-18.md) 执行：

1. P1A 任务面板重构与体验升级（最高优先，用户反馈驱动，含 9 步清单）。
2. P1B 文件视图 / 外壳 / 专家页回归。
3. P2 风格页 → P3 监控页 → P4 工作流页 → P5 知识库与蒸馏 → P6 打磨文档。
4. P7 发布链路完善（数字签名等证书、覆盖安装怪癖、基线文档同步、发布 SOP）。

决策清单（D1–D13）见未来计划第 3 节；其中用户已确认：AI 协作可直接发任务、
新建项目可选文件夹、规划与执行要有进度可视化。

## 六、关键约束（持续遵守）

- A 端（日常）与 B 端（桌面）不能同时打开同一会话；B 端故障不影响 A 端。
- 修改前先备份；profile JSON 无 BOM；发布前敏感审计。
- Client 改动刷新即生效；Host 路由/命令与专家 preset 改动需重启 B 端。
- 文件接口仅本机回环；旧 DSH 数据（`~/.dsh`）不迁移不删除，除非用户决定。
- 插件开发源是 `C:\YourWorkbench\plugins\workbench`；打包时通过 extraResources
  内置，验证需同步到安装目录或重新打包。
