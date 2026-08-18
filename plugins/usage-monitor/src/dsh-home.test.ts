import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { resolveCredentialsFile, resolveDshHome, resolveUsageFile } from './dsh-home.ts'

describe('DSH data root isolation', () => {
  it('uses DSH_HOME for usage data and credentials', () => {
    const root = resolve('test-data', 'independent-desktop-home')
    const env = { DSH_HOME: root }

    expect(resolveDshHome(env, resolve('unused-home'))).toBe(root)
    expect(resolveUsageFile(undefined, env, resolve('unused-home')))
      .toBe(join(root, 'dsh-usage-stats.json'))
    expect(resolveCredentialsFile(env, resolve('unused-home')))
      .toBe(join(root, '.credentials.yaml'))
  })

  it('falls back to the legacy CLI home when DSH_HOME is absent', () => {
    const fallbackHome = resolve('test-data', 'user-home')
    const root = join(fallbackHome, '.dsh')

    expect(resolveDshHome({}, fallbackHome)).toBe(root)
    expect(resolveUsageFile(undefined, {}, fallbackHome))
      .toBe(join(root, 'dsh-usage-stats.json'))
    expect(resolveCredentialsFile({}, fallbackHome))
      .toBe(join(root, '.credentials.yaml'))
  })

  it('rejects a custom usage path outside the active DSH_HOME', () => {
    const root = resolve('test-data', 'independent-desktop-home')
    const env = { DSH_HOME: root }

    expect(resolveUsageFile(resolve('test-data', 'old-home', 'dsh-usage-stats.json'), env))
      .toBe(join(root, 'dsh-usage-stats.json'))
  })
})
