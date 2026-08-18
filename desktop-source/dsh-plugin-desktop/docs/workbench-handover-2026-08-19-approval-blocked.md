# 工作台交接文档（2026-08-19，审批阻塞）

> 状态：已完成（2026-08-19 会话恢复后按序执行完毕）。补丁已落地外层工作区并提交
> （`b8eb587`），桌面端已部署、GUI 回归通过。本文档保留原始阻塞记录，后续以
> [交接清单](workbench-handover-checklist-2026-08-19.md) 与
> [未来完整计划](workbench-future-plan-2026-08-18.md) 为准。

## 交接目的

继续完成 P2 风格页，并在补丁落地后完成桌面端部署和 GUI 回归。

## 当前仓库与源码位置

- 当前 Codex 工作区：`C:\YourWorkbench\desktop-source\dsh-plugin-desktop`
- 外层 Git 根目录：`C:\YourWorkbench`
- 工作台开发源：`C:\YourWorkbench\plugins\workbench\lib\client.js`
- 工作台 Host 源：`C:\YourWorkbench\plugins\workbench\lib\host\index.js`
- 运行副本：`%LOCALAPPDATA%\Programs\DeepSeek Harness Desktop\resources\app.asar.unpacked\node_modules\dsh-workbench\lib`
- 上游子模块：`deepseek-harness/`，禁止修改

## P2 补丁状态

原始记录：补丁尚未应用到外层源码。已准备好的补丁：

`C:\YourWorkbench\desktop-source\dsh-plugin-desktop\.patch-staging\workbench-p2-final.patch`

SHA-256：`AB9F8C36D586CCC6E8F63F58C6F0CE7BDAA79D022269A9022FAF017C84C9CE8A`

恢复后的实际进展（2026-08-19）：

- 核对发现外层工作区已包含补丁内容：`plugins/workbench/lib/{client.js,host/index.js}`、
  `README.md`、`package.json` 与两个 smoke 工具与 `.patch-staging\workbench-p2` 校验副本
  逐字节一致（仅行尾符差异），无需再 `git apply`。
- 外层源码验证通过：`smoke-orchestration`、`smoke-style`、`smoke-client-load`
  （后者需 `NODE_PATH` 指向 desktop-source 的 node_modules）、`node --check` ×2、
  `tsc --noEmit` ×4、eslint ×2（lib 两个文件，0 问题）。
- 桌面源码全量 Vitest：`249 passed / 23 failed / 1 skipped`，失败项与 staging 基线一致
  （Windows 下 POSIX/mac 路径与权限位、旧版本断言等环境差异，与 P2 无关）。
- 已提交：`b8eb587 feat(workbench): P2 style page with visual and conversation style settings`。

补丁包含：

- 风格页主题、强调色、壁纸、透明度、暗色遮罩、毛玻璃、字体大小、圆角和密度
- 实时预览、内置预设、自定义预设
- 全局对话风格设置
- Host 风格读写接口和原子持久化
- 风格相关 smoke 测试与 README/package 脚本更新

## 已完成验证

在 `.patch-staging\workbench-p2` 副本上已通过：

```powershell
node .patch-staging\workbench-p2\tools\smoke-orchestration.mjs
node .patch-staging\workbench-p2\tools\smoke-style.mjs
node .patch-staging\workbench-p2\tools\smoke-client-load.mjs
node --check .patch-staging\workbench-p2\lib\client.js
node --check .patch-staging\workbench-p2\lib\host\index.js
node node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
node node_modules\typescript\bin\tsc -p tsconfig.client.json --noEmit
node node_modules\typescript\bin\tsc -p tsconfig.tests.json --noEmit
node node_modules\typescript\bin\tsc -p tsconfig.tests.client.json --noEmit
```

结果：编排、风格、Client 加载 smoke 通过；四组 TypeScript 检查通过。

桌面源码全量 Vitest：`249 passed / 23 failed / 1 skipped`。失败项是当前 Windows 环境下的 POSIX/macOS 路径与权限测试、旧版本断言等，与 P2 补丁无关。

## 运行端核验

- 当前运行端曾监听 `127.0.0.1:50944`
- `/api/dsh-workbench/tasks/list` 返回 200，P1A 任务接口正常
- `/api/dsh-workbench/style/read` 返回 404，证明 P2 尚未部署

部署后（2026-08-19）：

- 运行副本两个文件已备份至 `C:\YourWorkbench\backups\workbench-runtime-before-style-p2-20260819`
  并替换为源码版本（SHA-256 与源码一致），桌面端已重启。
- `/api/dsh-workbench/style/read` 现返回 200；`style/write` 写入→读回→还原往返验证通过
  （revision 递增、原子持久化）。
- GUI 回归（CDP 驱动真实桌面端）通过：风格页渲染、外观（主题/强调色/圆角/字体/密度）、
  壁纸上传与移除、对话风格（简洁/自定义）、预设（内置应用/自定义保存/删除）、恢复默认；
  截图见 `C:\Users\wang2\.codex\visualizations\2026\08\18\01a0172b-e0c6-7000-85b1-6caaee4593de\style-*.png`。

## 当前阻塞

原始阻塞：应用补丁需要写入外层仓库 `C:\YourWorkbench`。当时会话的可写根仅包含
`C:\YourWorkbench\desktop-source\dsh-plugin-desktop`，因此该操作需要 Codex 提升权限审批。

当时审批服务连续返回：

```text
503 Service Unavailable
Automatic approval review failed
Service temporarily unavailable
```

这不是用户授权拒绝，也不是补丁校验失败。恢复后（本会话）以 `C:\YourWorkbench` 为可写根
正常完成全部部署与验证，未使用间接命令绕过审批，也未修改上游子模块。

## 恢复后的执行顺序

在审批服务恢复，或以 `C:\YourWorkbench` 作为新工作区根目录后：

- ✅ 补丁应用：外层工作区已含补丁内容（与 staging 副本一致），`git apply` 无需执行。
- ✅ 冒烟与语法检查：`smoke-orchestration`、`smoke-style`、`smoke-client-load`（NODE_PATH
  指向 desktop-source node_modules）、`node --check` 全部通过。

然后：

1. ✅ 备份运行副本（`backups\workbench-runtime-before-style-p2-20260819`）并复制两个插件文件到运行目录。
2. ✅ 重启 DeepSeek Harness Desktop（GUI 回归期间带 `--remote-debugging-port=9224`）。
3. ✅ 重新定位动态端口（本轮 `127.0.0.1:58915`）。
4. ✅ 验证风格读写接口、风格页加载、主题/滑块/壁纸/预设/对话风格（CDP 驱动，全部通过）。
5. ✅ 更新 `workbench-handover-checklist-2026-08-19.md` 和未来计划状态（随 docs 提交）。
6. ✅ 检查 `git diff`、运行发布前测试（smoke + eslint + tsc + 全量 Vitest），提交外层仓库变更
   （`b8eb587` 代码 + docs 提交）。

## 安全约束

- 不修改 `deepseek-harness/`。
- 不迁移或删除旧 DSH 数据。
- A/B 客户端不同时打开同一会话。
- 文件接口保持回环限制和工作区路径限制。
- Client 改动刷新生效；Host 改动需要重启桌面端。
