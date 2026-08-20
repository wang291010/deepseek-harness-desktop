/** Plugins owned by this desktop distribution and sealed into packaged builds. */

/** Package names whose runtime files ship beside app.asar. */
export const BUNDLED_PLUGIN_PACKAGES = [
  '@wang291010/dsh-usage-stats',
  'dsh-plugin-hub',
  'dsh-workbench',
] as const

/**
 * Select installation-owned packages only for a packaged Electron runtime.
 * Development keeps profile-local file/link dependencies available for iteration.
 */
export function bundledPluginPackagesForRuntime(isPackaged: boolean): readonly string[] {
  return isPackaged ? BUNDLED_PLUGIN_PACKAGES : []
}
