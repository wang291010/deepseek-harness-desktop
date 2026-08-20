# Local plugin runtime notes

Verified on 2026-08-18 with DSH Desktop 2.0.0.

> 三个插件均为本仓库维护的发行（两个 fork + 一个原创），归属与更新上游见
> `docs/ownership-boundary.md`。

## Installed local distributions

- `@abcdefu_cja/dsh-usage-stats`: `0.1.0-yourworkbench.2`
- `dsh-plugin-hub`: `0.1.6-yourworkbench.2`
- `dsh-workbench`: `0.0.2-yourworkbench.1`

## Required installation mode

Plugins that import host-provided `@deepseek-ai/*` packages must be installed in the
desktop profile with the pnpm `file:` protocol, not a `link:` junction.

The desktop module resolver supplies host dependencies to packages whose real path is
inside the profile. A `link:` junction resolves to `C:\YourWorkbench\plugins\...` and
causes `ERR_MODULE_NOT_FOUND` during a cold start. A `file:` installation keeps the
editable source in `C:\YourWorkbench` while placing the runtime copy inside the profile.

Current required declarations:

```json
{
  "@abcdefu_cja/dsh-usage-stats": "file:C:/YourWorkbench/plugins/usage-monitor",
  "dsh-plugin-hub": "file:C:/YourWorkbench/plugins/plugin-hub"
}
```

Always reinstall local plugin changes with lifecycle scripts disabled. Do not change
these two dependencies back to `link:` unless the desktop module resolver is updated to
support external real paths.

## Verified behavior

- DSH Desktop cold start succeeds.
- Conversation and project lists load.
- Plugin Hub store loads.
- Usage statistics settings and historical data load.
- Workbench project selector loads.

## Recovery material

- Original usage plugin package:
  `C:\YourWorkbench\backups\usage-stats-original-0.1.0-2026-08-18`
- Original installed usage plugin directory:
  `C:\Users\wang2\.dsh\profiles\desktop\node_modules\@abcdefu_cja\dsh-usage-stats.original-0.1.0`
- Desktop program baseline:
  `D:\ui-harness-gpt\backups\baseline-2026-08-18\desktop-program`
