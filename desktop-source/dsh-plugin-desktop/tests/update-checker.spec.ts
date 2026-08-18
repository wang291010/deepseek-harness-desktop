import { describe, expect, it, vi } from 'vitest'
import {
  MAX_VERSION_RESPONSE_BYTES,
  checkForStableUpdate,
  compareSemVerVersions,
  parseSemVer,
  type UpdateRequest,
} from '../src/update-checker.ts'
import { UPDATE_RELEASES_ENDPOINT } from '../src/update-source.ts'

const ASSET_URL = 'https://github.com/example/deepseek-harness-desktop/releases/download/v2.10.0/DeepSeek-Harness-Desktop-2.10.0-x64-Setup.exe'

function releaseResponse(tag: string, assets: unknown[] = [], init: ResponseInit = {}): Response {
  return Response.json({ tag_name: tag, assets }, init)
}

function windowsAssets(url = ASSET_URL): unknown[] {
  return [{
    name: 'DeepSeek-Harness-Desktop-2.10.0-x64-Setup.exe',
    browser_download_url: url,
  }]
}

describe('strict SemVer parsing', () => {
  it('accepts a three-part version, optional lowercase v, prerelease, and build metadata', () => {
    expect(parseSemVer('v2.10.3-alpha.1+mac.arm64')).toEqual({
      version: '2.10.3-alpha.1+mac.arm64',
      major: '2',
      minor: '10',
      patch: '3',
      prerelease: ['alpha', '1'],
      build: ['mac', 'arm64'],
    })
    expect(parseSemVer('0.0.0')).not.toBeNull()
  })

  it.each([
    '1',
    '1.2',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-01',
    '1.2.3-alpha..1',
    '1.2.3+',
    'V1.2.3',
    ' 1.2.3',
  ])('rejects invalid SemVer %s', version => {
    expect(parseSemVer(version)).toBeNull()
  })

  it('compares strict versions without numeric overflow', () => {
    expect(compareSemVerVersions('2.1.0', '2.0.9')).toBeGreaterThan(0)
    expect(compareSemVerVersions('2.0.0-rc.1', '2.0.0')).toBeLessThan(0)
    expect(compareSemVerVersions('2.0', '2.0.0')).toBeNull()
    expect(compareSemVerVersions(
      '10000000000000000.0.0',
      '9007199254740992.0.0',
    )).toBeGreaterThan(0)
  })
})

describe('GitHub Releases Desktop version check', () => {
  it('uses only the latest-release endpoint and reports a newer stable version', async () => {
    const controller = new AbortController()
    const calls: Array<{ url: string, init: RequestInit }> = []
    const request: UpdateRequest = async (url, init) => {
      calls.push({ url, init })
      return releaseResponse('v2.10.0', windowsAssets())
    }

    await expect(checkForStableUpdate({
      currentVersion: '2.9.9',
      signal: controller.signal,
      request,
    })).resolves.toEqual({
      status: 'update-available',
      currentVersion: '2.9.9',
      latestVersion: '2.10.0',
      downloadUrl: ASSET_URL,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(UPDATE_RELEASES_ENDPOINT)
    expect(calls[0]?.init).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get('accept')).toBe('application/vnd.github+json')
    expect(headers.get('x-github-api-version')).toBe('2022-11-28')
    expect(headers.has('if-none-match')).toBe(false)
  })

  it.each([
    ['2.0.0', '2.0.0'],
    ['2.0.1', '2.0.0'],
    ['2.0.0+installed', '2.0.0+release'],
  ])('reports no update for installed %s and service %s', async (currentVersion, latestVersion) => {
    await expect(checkForStableUpdate({
      currentVersion,
      request: async () => releaseResponse(`v${latestVersion}`, windowsAssets()),
    })).resolves.toEqual({
      status: 'up-to-date',
      currentVersion,
      latestVersion,
      downloadUrl: ASSET_URL,
    })
  })

  it('compares service versions without overflowing JavaScript numbers', async () => {
    await expect(checkForStableUpdate({
      currentVersion: '9007199254740992.0.0',
      request: async () => releaseResponse('v10000000000000000.0.0', windowsAssets()),
    })).resolves.toMatchObject({ status: 'update-available' })
  })

  it.each([
    ['prerelease tag', releaseResponse('v2.1.0-rc.1', windowsAssets())],
    ['invalid SemVer tag', releaseResponse('v2.01.0', windowsAssets())],
    ['missing tag', Response.json({ assets: windowsAssets() })],
    ['non-string tag', Response.json({ tag_name: 2, assets: windowsAssets() })],
    ['array response', Response.json(['2.1.0'])],
    ['missing windows asset', releaseResponse('v2.1.0', [])],
    ['asset without download URL', releaseResponse('v2.1.0', [{ name: 'DeepSeek-Harness-Desktop-2.1.0-x64-Setup.exe' }])],
    ['non-https asset URL', releaseResponse('v2.1.0', [{
      name: 'DeepSeek-Harness-Desktop-2.1.0-x64-Setup.exe',
      browser_download_url: 'http://github.com/example/releases/download/v2.1.0/x64-Setup.exe',
    }])],
    ['portable-only asset', releaseResponse('v2.1.0', [{
      name: 'DeepSeek-Harness-Desktop-2.1.0-x64-Portable.exe',
      browser_download_url: 'https://github.com/example/releases/download/v2.1.0/Portable.exe',
    }])],
  ])('silently ignores a service response with %s', async (_case, response) => {
    await expect(checkForStableUpdate({
      currentVersion: '2.0.0',
      request: async () => response,
    })).resolves.toBeNull()
  })

  it('selects the Windows x64 Setup asset among unrelated release assets', async () => {
    const request: UpdateRequest = async () => releaseResponse('v2.1.0', [
      { name: 'DeepSeek-Harness-Desktop-2.1.0-x64-Setup.exe.blockmap', browser_download_url: 'https://github.com/example/blockmap' },
      { name: 'latest.yml', browser_download_url: 'https://github.com/example/latest.yml' },
      { name: 'DeepSeek-Harness-Desktop-2.1.0-x64-Setup.exe', browser_download_url: 'https://github.com/example/releases/download/v2.1.0/DeepSeek-Harness-Desktop-2.1.0-x64-Setup.exe' },
    ])

    await expect(checkForStableUpdate({
      currentVersion: '2.0.0',
      request,
    })).resolves.toEqual({
      status: 'update-available',
      currentVersion: '2.0.0',
      latestVersion: '2.1.0',
      downloadUrl: 'https://github.com/example/releases/download/v2.1.0/DeepSeek-Harness-Desktop-2.1.0-x64-Setup.exe',
    })
  })

  it('silently ignores malformed JSON and non-200 statuses', async () => {
    await expect(checkForStableUpdate({
      currentVersion: '2.0.0',
      request: async () => new Response('{'),
    })).resolves.toBeNull()
    await expect(checkForStableUpdate({
      currentVersion: '2.0.0',
      request: async () => new Response('unavailable', { status: 503 }),
    })).resolves.toBeNull()
    await expect(checkForStableUpdate({
      currentVersion: '2.0.0',
      request: async () => new Response(null, { status: 304 }),
    })).resolves.toBeNull()
  })

  it('silently ignores network failure and caller cancellation', async () => {
    await expect(checkForStableUpdate({
      currentVersion: '2.0.0',
      request: async () => { throw new TypeError('offline') },
    })).resolves.toBeNull()

    const controller = new AbortController()
    controller.abort()
    await expect(checkForStableUpdate({
      currentVersion: '2.0.0',
      signal: controller.signal,
      request: async () => { throw new DOMException('cancelled', 'AbortError') },
    })).resolves.toBeNull()
  })

  it('silently ignores declared and streamed oversized responses', async () => {
    await expect(checkForStableUpdate({
      currentVersion: '2.0.0',
      request: async () => new Response('{}', {
        headers: { 'content-length': String(MAX_VERSION_RESPONSE_BYTES + 1) },
      }),
    })).resolves.toBeNull()
    await expect(checkForStableUpdate({
      currentVersion: '2.0.0',
      request: async () => new Response('x'.repeat(MAX_VERSION_RESPONSE_BYTES + 1)),
    })).resolves.toBeNull()
  })

  it.each(['2.0', 'v2.0.0', '2.0.0-rc.1'])('skips invalid installed version %s before requesting', async currentVersion => {
    const request = vi.fn(async () => releaseResponse('v2.1.0', windowsAssets()))

    await expect(checkForStableUpdate({ currentVersion, request })).resolves.toBeNull()
    expect(request).not.toHaveBeenCalled()
  })
})
