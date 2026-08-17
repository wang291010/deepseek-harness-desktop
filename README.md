# YourWorkbench

YourWorkbench is a local independent desktop distribution built on top of
DeepSeek Harness and the community DSH Desktop shell.

The immediate goal is to turn the current customized environment into a
stable, recoverable, and security-reviewed personal client. This repository is
local-only for now; initializing Git does not publish or upload the project.

## Project layout

- `desktop-source/`: desktop shell source when it is migrated later.
- `plugins/workbench/`: the active personal Workbench plugin.
- `plugins/plugin-hub/`: the future locally maintained Plugin Hub fork.
- `plugins/usage-monitor/`: the future locally maintained usage plugin fork.
- `profiles/`: sanitized profile templates only; never store real credentials.
- `scripts/`: local build, validation, backup, and recovery tools.
- `docs/`: architecture, security, migration, and version notes.
- `backups/`: private local snapshots excluded from Git.

## Current validated baseline

See `docs/version-baseline.md` for the exact versions currently validated
together.
