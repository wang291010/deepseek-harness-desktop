import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  BUNDLED_PLUGIN_PACKAGES,
  bundledPluginPackagesForRuntime,
} from '../src/bundled-plugins.ts'
import {
  installationPackageBaseUrl,
  isInstallationOwnedPackageSpecifier,
  installProfilePackageResolver,
} from '../src/module-resolution.ts'

describe('distribution-owned plugin runtime', () => {
  it('enables the fixed plugin set only in packaged Electron builds', () => {
    expect(BUNDLED_PLUGIN_PACKAGES).toEqual([
      '@abcdefu_cja/dsh-usage-stats',
      'dsh-plugin-hub',
      'dsh-workbench',
    ])
    expect(bundledPluginPackagesForRuntime(true)).toBe(BUNDLED_PLUGIN_PACKAGES)
    expect(bundledPluginPackagesForRuntime(false)).toEqual([])
  })

  it('matches package roots and exports without accepting lookalike names', () => {
    expect(isInstallationOwnedPackageSpecifier(
      '@abcdefu_cja/dsh-usage-stats',
      BUNDLED_PLUGIN_PACKAGES,
    )).toBe(true)
    expect(isInstallationOwnedPackageSpecifier(
      '@abcdefu_cja/dsh-usage-stats/client',
      BUNDLED_PLUGIN_PACKAGES,
    )).toBe(true)
    expect(isInstallationOwnedPackageSpecifier('dsh-plugin-hub/client', BUNDLED_PLUGIN_PACKAGES)).toBe(true)
    expect(isInstallationOwnedPackageSpecifier('dsh-workbench-extra', BUNDLED_PLUGIN_PACKAGES)).toBe(false)
    expect(isInstallationOwnedPackageSpecifier('third-party-plugin', BUNDLED_PLUGIN_PACKAGES)).toBe(false)
  })

  it('anchors packaged plugin resolution in the physical app.asar.unpacked tree', () => {
    const modulePath = join(
      process.cwd(),
      'fixture',
      'resources',
      'app.asar',
      'lib',
      'module-resolution.js',
    )

    expect(fileURLToPath(installationPackageBaseUrl(pathToFileURL(modulePath).href))).toBe(join(
      process.cwd(),
      'fixture',
      'resources',
      'app.asar.unpacked',
      'package.json',
    ))
  })

  it('redirects createRequire resolution from any parent for installation-owned packages', () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'dsh-bundled-plugin-resolver-'))
    const profilePackageUrl = pathToFileURL(join(profileDir, 'package.json')).href
    const unrelatedRequesterUrl = pathToFileURL(join(profileDir, 'client-module-service', 'entry.js')).href
    writeFileSync(fileURLToPath(profilePackageUrl), '{"private":true}\n')
    const expected = createRequire(new URL('../package.json', import.meta.url)).resolve('yaml/package.json')
    const dispose = installProfilePackageResolver(profilePackageUrl, ['yaml'])

    try {
      expect(createRequire(unrelatedRequesterUrl).resolve('yaml/package.json')).toBe(expected)
    } finally {
      dispose()
      rmSync(profileDir, { recursive: true, force: true })
    }
  })
})
