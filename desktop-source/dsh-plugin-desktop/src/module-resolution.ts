/** Profile-relative package resolution for Electron's restricted Node runtime. */

import { createRequire, registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { unpackedAsarPath } from './packaged-runtime-path.ts'

const LOADER_ENTRY_URL = import.meta.resolve('@deepseek-ai/cordis-plugin-loader')
const DESKTOP_ENTRY_URL = new URL('../lib/index.js', import.meta.url).href
const DESKTOP_PACKAGE_NAME = 'dsh-plugin-desktop'

/** Resolve the physical package root used by installation-owned dependencies. */
export function installationPackageBaseUrl(moduleUrl: string = import.meta.url): string {
  const logicalPackagePath = fileURLToPath(new URL('../package.json', moduleUrl))
  return pathToFileURL(unpackedAsarPath(logicalPackagePath)).href
}

const INSTALLATION_PACKAGE_BASE_URL = installationPackageBaseUrl()
const INSTALLATION_REQUIRE = createRequire(INSTALLATION_PACKAGE_BASE_URL)

/** Return whether a Loader request needs Node package resolution. */
function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !URL.canParse(specifier)
}

/** Return whether a Loader specifier belongs to an installation-owned package. */
export function isInstallationOwnedPackageSpecifier(
  specifier: string,
  packageNames: readonly string[],
): boolean {
  return packageNames.some(packageName => (
    specifier === packageName || specifier.startsWith(`${packageName}/`)
  ))
}

/**
 * Resolve Cordis Loader bare imports from the selected persistent profile.
 * @param profileBaseUrl - file URL inside the profile that owns plugin dependencies.
 * @param installationOwnedPackages - packages sealed into the application tree.
 * @returns an idempotent hook disposer.
 */
export function installProfilePackageResolver(
  profileBaseUrl: string,
  installationOwnedPackages: readonly string[] = [],
): () => void {
  let resolvingInstallationOwned = false
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (resolvingInstallationOwned) return nextResolve(specifier, context)
      const fromLoader = context.parentURL === LOADER_ENTRY_URL
      if (fromLoader && specifier === DESKTOP_PACKAGE_NAME) {
        return { shortCircuit: true, url: DESKTOP_ENTRY_URL }
      }
      if (
        isBareSpecifier(specifier)
        && isInstallationOwnedPackageSpecifier(specifier, installationOwnedPackages)
      ) {
        resolvingInstallationOwned = true
        try {
          return {
            shortCircuit: true,
            url: pathToFileURL(INSTALLATION_REQUIRE.resolve(specifier)).href,
          }
        } finally {
          resolvingInstallationOwned = false
        }
      }
      if (!fromLoader || !isBareSpecifier(specifier)) {
        return nextResolve(specifier, context)
      }
      return nextResolve(specifier, { ...context, parentURL: profileBaseUrl })
    },
  })
  let active = true
  return () => {
    if (!active) return
    active = false
    hooks.deregister()
  }
}
