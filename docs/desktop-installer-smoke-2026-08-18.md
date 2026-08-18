# Desktop installer smoke — 2026-08-18

## Environment

- Host: Windows 11 (10.0.26100), x64
- Node.js: v24.19.0, Yarn 4.18.0 via Corepack
- Product: DeepSeek Harness Desktop 2.0.0 (unsigned local build)

## Verified artifacts

- `desktop-source/dsh-plugin-desktop/dist/DeepSeek-Harness-Desktop-2.0.0-x64-Setup.exe`
  - SHA-256: `CDB0873C6FBF37F538A96470C7C7D156EE9D222D21366BEABEA4416A9D90335A`
  - Size: 148,259,158 bytes
- Unpacked `DeepSeek Harness Desktop.exe` SHA-256:
  `ECF1F3E857BE7315E4A16A58FF6998840F04A73D6C3482F9BE839FAE7C9D8691`
- `resources/app.asar` SHA-256:
  `E079C9EE4EEE36D724AB5354CE8F38C7DACBC2AFF947BCFB0F6DBDAC8E1AD313`

The installer and the unpacked application both pass the Windows PE gate
(`scripts/verify-win-installer.ts`). The Windows release gate
(`check:win-package`) passed: 105 tests passed, 1 skipped; runtime closure
reports 197 first-party nodes.

## Isolation fix found during the smoke test

The first installed build leaked workbench host state into the legacy DSH home:

- `plugins/workbench/lib/host/index.js` hardcoded `DSH_ROOT = ~/.dsh`, so the
  workbench diagnostic log, task store, and agent presets ignored the desktop
  `DSH_HOME` (Electron `userData\harness-home`).
- On launch the installed app appended to `~/.dsh\dsh-workbench-host.log`
  (observed 2026-08-18 17:53:44) and would have written the task store there on
  the first task mutation.

Fix: `DSH_ROOT` now resolves `DSH_HOME` first and falls back to `~/.dsh`, the
same pattern already used by `plugins/usage-monitor`. Rebuilt and re-verified:

- After the fixed launch, `~/.dsh` last-write time stayed unchanged and
  `~/.dsh\dsh-workbench-host.log` received no new entries.
- The workbench diagnostic log is now created at
  `userData\harness-home\dsh-workbench-host.log`.
- The legacy and isolated task stores contain identical content
  (SHA-256 `AE212675B5099F28E794ECDE9CE1266C4FC1755577B3DE68ACD8EC992FD70AC8`),
  so the task center shows the same data.

## Install / uninstall results

- Fresh per-user install to the default directory: passed.
- Launch: passed (four processes, correct window title).
- In-place upgrade over an existing install: the NSIS installer showed
  "application cannot be closed" even though no application process was
  running. Worked around by uninstalling first, then installing fresh. This is
  recorded as a known installer quirk to investigate.
- Uninstall via Settings: passed. The install directory and the application
  uninstall registry entry were removed; the user data directory
  (`%APPDATA%\DeepSeek Harness Desktop`) was preserved; the legacy DSH install
  and `~/.dsh` were untouched.
- The uninstaller left one packaged sourcemap file
  (`@opentelemetry/resources/.../getMachineId-unsupported.js.map`) plus its
  empty parent tree under `resources\app.asar.unpacked`. It contained no user
  data and was removed manually. The file timestamp shows it was extracted by
  the interrupted in-place upgrade, so it was not in the first install's
  uninstaller manifest. A clean install/uninstall cycle is re-verified before
  the next release.

## Known release items

- Installer and executable are unsigned by design (`signExecutable=false`);
  Authenticode signing remains a separate release gate.
- Window close now quits the application (instead of hiding to the tray), so a
  running application is never left behind for the installer's process check.
  The in-place upgrade path is re-verified in the next release smoke.
- The installer/exe file properties still show the package description
  inherited from `package.json` `description`; updated to the DeepSeek Harness
  Desktop wording. Cosmetic branding cleanup, no functional impact.

## Addendum: 2.0.1 auto-update loop (2026-08-18)

The v2.0.1 end-to-end update loop was verified after this smoke:

- Release v2.0.1 was published to
  `wang291010/deepseek-harness-desktop` with asset
  `DeepSeek-Harness-Desktop-2.0.1-x64-Setup.exe`
  (SHA-256 `E1B5A41B208EF44701C5D4CC5665139484EAB0F77A402740D8189606E1BB134B`).
- The installed 2.0.0 app detected v2.0.1, downloaded, silently installed over
  the old tree, and restarted itself; registry `DisplayVersion` = 2.0.1 and the
  installed executable hash matches the 2.0.1 build.
- The in-place upgrade quirk ("application cannot be closed") was not hit on
  this path; the installer handled takeover of the running app. It remains a
  release-gate item to re-verify with a clean no-process upgrade.
