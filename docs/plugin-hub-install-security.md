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

## Publishing hardening

The security fork was advanced to `0.1.6-yourworkbench.2` after a separate
review of the optional publishing module.

The upstream implementation used `shell: true` for npm publishing, placed the
npm token in a command-line argument, and embedded the GitHub token in the Git
remote URL. The latter persisted the credential in the local plugin's
`.git/config` despite a comment claiming the token was not logged.

The hardened behavior is:

- the npm shell runner, `.cmd` invocation and task-kill fallback are removed;
- one-click npm publishing and the combined GitHub/npm action are disabled
  until DSH exposes a dedicated credential-aware publishing capability;
- GitHub remotes always use credential-free HTTPS URLs;
- Git authentication is provided to the child process through ephemeral Git
  environment configuration, not argv or `.git/config`;
- the only remaining process spawn is fixed `git` with an argv array and
  `shell: false`;
- any security warning or critical finding blocks publication;
- package names, token lengths, descriptions and GitHub topics are bounded and
  validated;
- publishing audit entries contain result messages, not credential values.

Offline verification confirmed that the Git authentication header was visible
inside the test child process and absent immediately afterward. The npm publish
entry returned the disabled-policy result before any progress callback, network
request or process launch. DSH Desktop and the Plugin Hub UI then loaded
successfully with the hardened module.
