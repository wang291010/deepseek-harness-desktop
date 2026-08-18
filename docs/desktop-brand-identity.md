# Desktop brand identity

## Chosen identity

- Display name: `DeepSeek Harness Desktop`
- Window title: `DeepSeek Harness Desktop`
- Windows application ID: `com.yourworkbench.deepseek-harness-desktop`
- Windows shortcut name: `DeepSeek Harness Desktop`
- Installer pattern: `DeepSeek-Harness-Desktop-${version}-${arch}-Setup.exe`

The display name was chosen for this independent distribution. The internal
Windows application ID deliberately uses the project-owned `yourworkbench`
namespace instead of the upstream `ai.deepseek.dsh.desktop` identity. This
prevents Windows from treating the two distributions as the same application.

## Update boundary

The upstream `dsh-plugin-desktop/updates` plugin is disabled in the bundled
profile by default. This distribution must not download or install upstream
DSH Desktop releases under its own application identity. Updates can be enabled
later only after a project-owned release endpoint, artifact verification policy,
and signing process exist.

## Data isolation status

Calling `app.setName('DeepSeek Harness Desktop')` before Electron becomes ready
gives this application its own Electron user-data directory instead of the
upstream `DSH Desktop` directory. Profile-selection state, runtime shims, and
download state therefore have a separate desktop location.

The DeepSeek Harness home directory is a different layer. It still resolves
through the upstream `DSH_HOME` rules and may currently point to the same `.dsh`
directory used by the existing client. Full account, conversation, profile, and
plugin-data isolation is a later migration step and is not claimed by this
identity change.
