# Desktop source provenance

## Imported baseline

- Upstream repository: `https://github.com/anywhere-labs/deepseek-harness-desktop`
- Upstream release: `v2.0.0`
- Upstream release commit: `ee1235e1dd1675bbd6c52cfbe3f27b27bcfcfa81`
- Imported on: `2026-08-18`
- Downloaded archive: `deepseek-harness-desktop-v2.0.0.zip`
- Archive SHA-256: `24C100E1FB01AB99D21A119F591E308F4DA8B6CE16CE105981318ECCA240D1AB`
- License: MIT; retain the upstream `LICENSE` file and copyright notice.

The imported desktop source lives in `desktop-source/`. It is the starting
baseline for this independent distribution and is not a claim of original
authorship over the upstream code.

## Pinned DeepSeek Harness source

The upstream desktop release records the official core source separately:

- Repository: `https://github.com/deepseek-ai/deepseek-harness.git`
- Required source commit: `47f943859bef60e4160492346772ded9b24f765a`
- Recorded source version: `0.1.0-rc.5`
- Runtime npm package family: `0.1.0-rc.6`

The GitHub release archive does not contain Git submodule contents. Therefore
`desktop-source/deepseek-harness/` intentionally remains empty until the exact
required commit is obtained and verified. The unrelated local checkout at
`D:\ui-harness-gpt\vendor\deepseek-harness` is at commit
`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` and must not be substituted for the
pinned source.

## Ownership rule

Independent-distribution changes belong under `desktop-source/dsh-plugin-desktop/`
or in clearly named project-owned packages. Changes to the pinned official core
must be handled separately and documented as core patches or an explicit core
version update.

## Ownership and update boundary

These components are locally maintained by this distribution:

- Desktop shell `dsh-plugin-desktop`: a fork of the upstream release above; its
  self-update source is the project-owned repository
  `wang291010/deepseek-harness-desktop` (see `src/update-source.ts`).
- Plugin Hub and usage stats: forks maintained under `plugins/` in this
  repository; their package `repository` fields point here until standalone
  repositories are created.

The pinned Harness core remains the only upstream update track. Full ownership
definitions live in `docs/ownership-boundary.md`.
