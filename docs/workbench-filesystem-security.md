# Workbench filesystem security

Validated on 2026-08-18 against DSH Desktop 2.0.0 and DSH core 0.1.0-rc.6.

## Risk addressed

The Workbench host previously accepted arbitrary absolute paths for directory
listing, text-file reading and writing, and Git graph execution. Loopback and
same-origin checks reduced exposure but did not establish which local paths the
plugin was allowed to access.

## Security boundary

The host now waits for DSH's durable `workspaceRegistry` service before it
registers its HTTP routes. Filesystem and Git requests must satisfy all of the
following conditions:

- the requested path is absolute and contains no NUL byte;
- the path exists and can be resolved by the operating system;
- the resolved path is inside a workspace registered by DSH;
- directory operations target directories and file operations target regular
  files;
- file reads and writes are limited to 512 KiB;
- JSON request bodies are limited to 768 KiB;
- writes only update existing regular files;
- paths are canonicalized before the boundary check, preventing symlink and
  Windows Junction escapes.

Preset routes remain separately confined to `~/.dsh/.agent-presets`.

## Runtime verification

- Host log confirmed `webServer + llm + workspaceRegistry injected`.
- All 9 Workbench routes registered successfully.
- DSH Desktop listened only on `127.0.0.1`.
- Both registered workspace roots returned HTTP 200 for directory listing.
- `C:\Windows` returned HTTP 403 for list, read, write, and Git requests.
- A registered 588-byte file returned HTTP 200 for read and same-content write.
- SHA-256 before/after content verification matched exactly:
  `7D52212982C469A8AD92FBA7DA2C5B132DEE7172651B157CDD5C77E22422BCE1`.
- JavaScript syntax, ESLint, and Git whitespace checks passed.

## Recovery

The pre-change host file is stored at:

`C:\YourWorkbench\backups\before-workbench-fs-security-2026-08-18\index.js`
