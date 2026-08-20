# Validated local version baseline

Date: 2026-08-18

This file records the versions currently validated together for the local
independent DSH Desktop distribution. Updating any item requires a backup and
compatibility test before it becomes the new baseline.

## Desktop runtime

- Desktop package: `dsh-plugin-desktop@2.0.1`
- DeepSeek Harness core: `@deepseek-ai/dsh@0.1.0-rc.6`
- Electron: `43.4.0`
- Desktop-bundled pnpm: `11.7.0`
- Setup installer SHA-256 (2.0.1):
  `E1B5A41B208EF44701C5D4CC5665139484EAB0F77A402740D8189606E1BB134B`
- Installed executable SHA-256 (2.0.1):
  `36B27A38…`（与 2.0.1 构建产物一致，2026-08-18 自动更新闭环验证）

## Profile plugins

- `@abcdefu_cja/dsh-usage-stats@0.1.0-yourworkbench.2`（本地维护 fork）
- `dsh-plugin-hub@0.1.6-yourworkbench.2`（本地维护 fork）
- `dsh-workbench@0.0.2-yourworkbench.1`（原创；开发源 `C:/YourWorkbench/plugins/workbench`；
  发布时经 extraResources 内置，运行时不再依赖该路径）

## Workbench development tools

- Node.js: `24.19.0`
- pnpm: `11.19.0`
- ESLint: `10.8.1`
- globals: `17.11.0`

## Update policy

- Desktop background update checks are enabled (check on startup + every 6 h,
  plus tray "Check for Updates").
- Update source: GitHub Releases `wang291010/deepseek-harness-desktop`;
  asset pattern `DeepSeek-Harness-Desktop-*-x64-Setup.exe`.
- Registry plugins use exact versions in the profile manifest and lockfile.
- The Workbench dev source is changed only from this project and rebuilt into
  the desktop package for releases.
- Desktop shell, Plugin Hub, and usage stats are locally maintained forks:
  their code lives in this repository and their updates are published through
  this repository's Releases; they never pull from their upstream repositories
  (see `docs/ownership-boundary.md`).
- The only upstream update track is the DeepSeek Harness core, which is pinned
  and must be reviewed and backed up before any upgrade.
- Upstream versions must not be accepted until their source and compatibility
  have been reviewed against this baseline.
