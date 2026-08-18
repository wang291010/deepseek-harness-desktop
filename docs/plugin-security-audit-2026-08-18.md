# Plugin security audit — 2026-08-18

Scope: DSH Desktop 2.0.0, desktop profile, directly loaded third-party plugins,
personal agent presets, and security-sensitive built-in components.

## Direct third-party plugins

### Usage monitor

Version: `0.1.0-yourworkbench.1`

- Balance requests are restricted to the fixed DeepSeek and OpenCode endpoints.
- Only the matching fixed API-key variable may be read for each endpoint.
- Redirects are rejected.
- API responses do not expose the API-key environment-variable name.
- Usage storage is restricted to the managed DSH usage path or the legacy file.
- Installed as a profile-local `file:` copy so host dependencies resolve safely.

### Plugin Hub

Version: `0.1.6-yourworkbench.2`

- Installs use the desktop pnpm runtime without a shell.
- Lifecycle scripts are disabled.
- Packages are scanned in quarantine before installation.
- Package names and references are validated.
- GitHub publishing credentials use an ephemeral Git header and are not stored
  in remote URLs or command arguments.
- npm and combined publishing are disabled.
- Installed as a profile-local `file:` copy.

### Workbench

Version: `0.0.2-yourworkbench.1`

- Filesystem and Git routes are restricted to canonical registered workspaces.
- Symlink and junction escapes are rejected.
- Git uses `execFile` with fixed arguments and no command shell.
- Preset paths are authorized through their canonical parent directory.
- Preset files must be ordinary, non-symbolic files and are limited to 512 KiB.
- The task store must be an ordinary, non-symbolic file and is limited to 8 MiB.
- HTTP routes require loopback access and reject cross-site browser requests.
- Orchestration uses the official DSH subagent service rather than launching an
  independent system command runner.

## Personal agent presets

Audited presets:

- `ai-product-architect`
- `fitness-expert`

Both use only bundled `@deepseek-ai/*` modules and `cordis:group`. No external
URLs, third-party packages, absolute package paths, `file:`/`link:` imports,
`danger-full-access`, or `approval: never` settings were found. Optional Codex
and Claude Code delegation entries are disabled.

## Built-in security-sensitive components

- Effective default permission mode: `workspace-write`.
- Effective approval policy: `ask`.
- Windows PowerShell sandbox is active; the Bash tool is disabled on Windows.
- No environment override for permissions, telemetry, tools mode, or trusted
  hosts was found.
- Session telemetry is installed but remains in its default `DISABLED` mode.
- Full-text session indexing is disabled by default.
- The live desktop server listens only on `127.0.0.1`; no LAN or public listener
  was observed.
- Automatic desktop updates are disabled by the desktop profile patch. Upstream
  installers therefore cannot replace the validated runtime without a deliberate
  manual change.

## Credential file ACL

`C:\Users\wang2\.dsh\.credentials.yaml` previously inherited read access for
`CodexSandboxUsers`. Its ACL is now protected and grants full control only to:

- the owning user;
- `SYSTEM`;
- `Administrators`.

The previous ACL is stored in the ignored local backups directory for recovery.

## Runtime verification

- Desktop cold start succeeds.
- Conversation and project lists load.
- Task Center and expert presets load.
- Plugin Hub store loads.
- Usage statistics settings and historical data load.
