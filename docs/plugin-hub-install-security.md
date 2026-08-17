# Plugin Hub install security

Validated on 2026-08-18 against DSH Desktop 2.0.0, DSH core 0.1.0-rc.6,
and upstream `dsh-plugin-hub` 0.1.6.

## Distribution identity

The local security fork is versioned as `0.1.6-yourworkbench.1`. The upstream
MIT license and repository attribution are retained. The desktop profile loads
the fork through:

`link:C:/YourWorkbench/plugins/plugin-hub`

The profile `node_modules/dsh-plugin-hub` path is a Junction to that directory.

## Risks addressed

The upstream install flow ran `pnpm add` in the active profile before quality
and conflict checks. On Windows it constructed a command string and invoked a
`.cmd` shim with `shell: true`. A rejected package could therefore execute an
npm lifecycle script before the later rollback removed it. The Git fallback
also stripped the requested ref before cloning, so reviewed and installed code
could differ.

## Hardened install flow

- DSH Desktop's managed `desktopPnpm` service is mandatory; no shell fallback
  exists.
- Package-manager arguments remain an argv array.
- Every add and remove operation uses `--ignore-scripts`.
- Package names and install specifications are validated before registry or
  profile mutation.
- Only npm package versions/tags and HTTPS GitHub repository specifications are
  accepted.
- Candidates are downloaded into an operating-system temporary quarantine
  directory before the active profile is modified.
- The quarantined manifest name must match the requested package.
- Any npm lifecycle script blocks one-click installation.
- Source and shipped build output are scanned; dependencies and VCS data are
  excluded.
- Any scanner warning or critical finding blocks one-click installation until
  a future explicit, auditable approval UI exists.
- The quality gate runs in quarantine.
- The ref-stripping Git clone fallback was removed.
- Quarantine directories are removed in a `finally` block.

## Dependency controls

- pnpm is pinned to 11.19.0.
- `yaml` is pinned to 2.9.0.
- `zod` is pinned to 4.4.3.
- automatic peer installation and lifecycle scripts are disabled by project
  configuration.
- the development checkout uses DSH Desktop's own
  `@deepseek-ai/dsh-typert-protocol@0.1.0-rc.6` instance to avoid a duplicate
  Cordis/Typert service graph.

## Verification

- All modified JavaScript files passed `node --check`.
- The complete Host entry imported successfully from the linked project.
- A mock managed runner confirmed add/remove both receive
  `--ignore-scripts` as separate argv entries.
- Unsafe package-name cases were rejected by the validator.
- The lockfile records `autoInstallPeers: false`.
- DSH Desktop started successfully and listened only on `127.0.0.1`.
- The plugin-store database opened and the Plugin Hub UI loaded successfully.

## Recovery

Original upstream copy:

`C:\YourWorkbench\backups\plugin-hub-original-0.1.6-2026-08-18`

Former live profile directory before the Junction switch:

`C:\YourWorkbench\backups\plugin-hub-profile-live-before-link-2026-08-18`

## Remaining separate finding

The optional publishing module still contains a Windows `shell: true` command
runner. It is not used by browsing or installing plugins and is scheduled for
the next isolated hardening change. Do not use the Publish action until that
change is complete.
