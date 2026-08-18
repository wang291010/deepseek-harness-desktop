# Desktop build baseline — 2026-08-18

## Environment

- Source baseline: DSH Desktop `v2.0.0`
- Operating system: Windows
- Node.js: `v24.19.0`
- Yarn: `4.18.0`
- Dependency install: `corepack yarn install --immutable --inline-builds`

The install resolved the immutable lockfile and added 843 packages. Install
scripts are disabled by default; only dependencies explicitly marked as built
by the upstream workspace configuration ran their required build steps.

## Results

- `corepack yarn build`: passed
- `corepack yarn typecheck`: passed
- `corepack yarn workspace dsh-plugin-desktop check:win-package`: passed
  - Windows release test files: 8 passed
  - Windows release tests: 101 passed, 1 skipped, 0 failed
  - Runtime closure: 197 reachable first-party nodes, closed graph

The Windows-specific check covers the installer configuration, packaged
runtime, update check and download behavior, PowerShell sandbox, and window
options without installing or launching the resulting desktop application.

## Cross-platform suite observation

The unfiltered `corepack yarn test` run reported 234 passed, 1 skipped, and 21
failed tests out of 256. The failures are concentrated in tests that simulate
macOS or Linux while running on Windows. They include host path separator
expectations, Unix permission bits, symbolic-link privileges, and test cases
whose platform branch is not isolated from the Windows host.

These failures do not block the currently targeted Windows distribution because
the upstream Windows release check passes. They remain a recorded portability
debt and must be resolved before claiming macOS or Linux support.

## Baseline conclusion

The imported source is buildable and passes its upstream Windows release gate.
Branding and distribution changes should preserve this gate as the minimum
regression check.
