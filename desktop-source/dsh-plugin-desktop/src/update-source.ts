/**
 * GitHub Releases update source for DSH Desktop.
 *
 * The desktop update checker reads this repository's latest release, selects
 * the Windows x64 NSIS installer asset, and hands its download URL to the
 * installer downloader. Set the two constants below to YOUR GitHub account
 * and repository before shipping builds that should self-update from your
 * own Releases page.
 */

/** GitHub user or organization owning the release repository. */
export const UPDATE_REPOSITORY_OWNER = 'your-github-username'

/** GitHub repository publishing DSH Desktop releases. */
export const UPDATE_REPOSITORY_NAME = 'deepseek-harness-desktop'

/** Latest-stable release metadata endpoint on the GitHub REST API. */
export const UPDATE_RELEASES_ENDPOINT =
  `https://api.github.com/repos/${UPDATE_REPOSITORY_OWNER}/${UPDATE_REPOSITORY_NAME}/releases/latest`

/** Exact asset shape produced by the NSIS Windows x64 build. */
export const UPDATE_WINDOWS_INSTALLER_PATTERN = /^DeepSeek-Harness-Desktop-.*-x64-Setup\.exe$/iu
