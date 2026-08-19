# 发布 SOP（2026-08-20 固化）

> 面向维护者。版本节奏（D10）：功能回归完成后发 2.1.0；期间 bug 修复发 2.0.x。

## 0. 前置门禁（未全过不得发布）

- 工作台 Host 冒烟 8 项全过：`smoke-collab / style / memory / orchestration / watchdog /
  workflow / knowledge / client-load`。
- ESLint（client/host）零报错；`node --check` 通过；`git diff --check` 通过。
- 知识库评测 recall@5 = 1.0（当前 50 题）。
- GUI 回归：`gui-p1 / gui-p26 / gui-p27 / gui-knowledge` 通过。
- `git status` 干净；计划/交接文档已更新。

## 1. 版本号同步

- `desktop-source/package.json` 与 `dsh-plugin-desktop/package.json` 的 version 必须一致
  （构建门禁强制）。
- README 版本引用同步；`docs/version-baseline.md` 更新版本/哈希。

## 2. 构建

```powershell
# 完整门禁 + NSIS 安装器（Windows x64 本机）
corepack.cmd yarn dist:win

# 或仅目录冒烟产物
yarn package:dir
```

- 构建包含：版本同步门禁、tsc ×4、运行时闭包校验、PE 校验、安装器校验。
- 产出：`dist/DeepSeek-Harness-Desktop-<version>-x64-Setup.exe` + `dist/win-unpacked/`。
- 记录安装包 SHA-256 到 `version-baseline.md`。

## 3. 签名（等证书）

- 无证书：保持未签名发布；记录 SmartScreen / Unknown publisher 为已知提示。
- 有证书：设置 `CSC_LINK` / `WIN_CSC_LINK` + 密码；签名后校验安装器/卸载器/主程序签名。

## 4. 发布

1. `gh release create v<version> <Setup.exe> --repo wang291010/deepseek-harness-desktop`
   （附 release notes：本次变更、哈希、已知限制）。
2. Redis 设置 `deepseek-harness-desktop:release:version` = 新版本号。
3. 桌面端验证自动更新：等提示或托盘手动 Check for Updates → Download → Restart and Install。

## 5. 发布后验证清单

- 覆盖安装：2.0.2 起目标为免卸载覆盖安装；若遇 NSIS “application cannot be closed”，
  按 R2 处理并回归。
- 卸载残留：检查 `@opentelemetry/resources` 等 sourcemap 是否残留，清理或确认为无害。
- 数据保留：升级后工作台任务/风格/知识/记忆均保留（数据在 `harness-home`）。
- 回滚预案：回退 Redis 版本键 + 手动安装上一版安装包；工作台可 `tools/disable-workbench.ps1`
  临时禁用恢复原生 UI。

## 6. 跨平台 / 便携版（暂缓）

- macOS/Linux 暂不声明支持（D9）；便携版暂不做（D8）；旧 DSH 数据不自动迁移（D6）。
- 如启用 macOS：`release-mac.ts` + 公证流程已实现，仍需真实 macOS 机器验证。
