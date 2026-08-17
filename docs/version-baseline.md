# Validated local version baseline

Date: 2026-08-18

This file records the versions currently validated together for the local
independent DSH Desktop distribution. Updating any item requires a backup and
compatibility test before it becomes the new baseline.

## Desktop runtime

- Desktop package: `dsh-plugin-desktop@2.0.0`
- DeepSeek Harness core: `@deepseek-ai/dsh@0.1.0-rc.6`
- Electron: `43.4.0`
- Desktop-bundled pnpm: `11.7.0`
- Desktop executable SHA-256:
  `30FC346D92400970F2B7D413AF7E452BB0FDC765C0B78729E21DF36730E0C5DA`

## Profile plugins

- `@abcdefu_cja/dsh-usage-stats@0.1.0`
- `dsh-plugin-hub@0.1.6`
- `dsh-workbench@0.0.1` from
  `C:/YourWorkbench/plugins/workbench`

## Workbench development tools

- Node.js: `24.19.0`
- pnpm: `11.19.0`
- ESLint: `10.8.1`
- globals: `17.11.0`

## Update policy

- Desktop background update checks are disabled in the desktop profile.
- Registry plugins use exact versions in the profile manifest and lockfile.
- The Workbench remains a local link and is changed only from this project.
- Upstream versions must not be accepted until their source and compatibility
  have been reviewed against this baseline.
