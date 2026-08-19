import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopNotification,
  DesktopRuntime,
  DesktopTrayItem,
} from '../src/runtime.ts'
import type { UpdateCheckResult } from '../src/update-checker.ts'
import { apply, Config, inject, type Config as UpdateConfig } from '../src/updates.ts'

const testConfig: UpdateConfig = {
  enabled: true,
  initialDelayMs: 10,
  intervalMs: 1000,
  requestTimeoutMs: 1000,
}

const ASSET_URL = 'https://github.com/example/deepseek-harness-desktop/releases/download/v2.1.0/DeepSeek-Harness-Desktop-2.1.0-x64-Setup.exe'

function releaseResponse(version: string): Response {
  const tag = version.startsWith('v') ? version : `v${version}`
  return Response.json({
    tag_name: tag,
    assets: [{
      name: `DeepSeek-Harness-Desktop-${version}-x64-Setup.exe`,
      browser_download_url: ASSET_URL,
    }],
  })
}

interface Harness {
  readonly statePath: string
  readonly checkTray: DesktopTrayItem
  readonly toggleTray: DesktopTrayItem
  readonly notifications: DesktopNotification[]
  readonly warnings: unknown[][]
  readonly confirmDownload: ReturnType<typeof vi.fn>
  readonly showManualCheckResult: ReturnType<typeof vi.fn>
  readonly downloadAndOpen: ReturnType<typeof vi.fn>
  readonly refresh: ReturnType<typeof vi.fn>
  readonly registrationDispose: ReturnType<typeof vi.fn>
  dispose(): Promise<void>
}

async function createHarness(options: {
  readonly packaged?: boolean
  readonly canDownload?: boolean
  readonly config?: UpdateConfig
  readonly request?: DesktopRuntime['updates']['request']
  readonly confirmDownload?: (version: string) => Promise<boolean>
  readonly showManualCheckResult?: (result: UpdateCheckResult | null) => Promise<void>
  readonly downloadAndOpen?: (result: UpdateCheckResult, signal: AbortSignal) => Promise<void>
  readonly notify?: (notification: DesktopNotification) => void
  readonly state?: string
} = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-updates-'))
  const statePath = join(root, 'private', 'state.json')
  if (options.state !== undefined) {
    await mkdir(join(root, 'private'), { recursive: true })
    await writeFile(statePath, options.state, { mode: 0o600 })
  }
  const notifications: DesktopNotification[] = []
  const warnings: unknown[][] = []
  const refresh = vi.fn()
  const registrationDispose = vi.fn()
  const confirmDownload = vi.fn(options.confirmDownload ?? (async () => false))
  const showManualCheckResult = vi.fn(options.showManualCheckResult ?? (async () => {}))
  const downloadAndOpen = vi.fn(options.downloadAndOpen ?? (async () => {}))
  const trayItems: DesktopTrayItem[] = []
  let disposer: (() => void | Promise<void>) | undefined
  const runtime = {
    updates: {
      isPackaged: options.packaged ?? true,
      currentVersion: '2.0.0',
      statePath,
      canDownload: options.canDownload ?? true,
      request: options.request ?? (async () => releaseResponse('2.0.0')),
      confirmDownload,
      showManualCheckResult,
      downloadAndOpen,
      notify: options.notify ?? ((notification: DesktopNotification) => { notifications.push(notification) }),
    },
    registerTrayItem: (item: DesktopTrayItem) => {
      trayItems.push(item)
      return { refresh, dispose: registrationDispose }
    },
  } as unknown as DesktopRuntime
  const settings = {
    register: (_ns: string, _schema: unknown, options?: { base?: Record<string, unknown> }) => {
      const resolved: Record<string, unknown> = { ...(options?.base ?? {}) }
      let userSection: Record<string, unknown> | undefined
      return {
        get: () => resolved,
        update: async (patch: Record<string, unknown>) => {
          userSection = { ...(userSection ?? {}), ...patch }
          for (const [key, value] of Object.entries(userSection)) resolved[key] = value
        },
        replace: async (section: Record<string, unknown>) => {
          userSection = section
          for (const key of Object.keys(resolved)) delete resolved[key]
          for (const [key, value] of Object.entries(section)) resolved[key] = value
        },
        watch: () => () => {},
      }
    },
  }
  const ctx = {
    desktopRuntime: runtime,
    settings,
    logger: { warn: (...args: unknown[]) => { warnings.push(args) } },
    effect: (register: () => (() => void | Promise<void>)) => {
      disposer = register()
      return disposer
    },
  } as unknown as Context

  apply(ctx, options.config ?? testConfig)
  const checkTray = trayItems.find(item => item.order === 10)
  const toggleTray = trayItems.find(item => item.order === 11)
  if (checkTray === undefined || toggleTray === undefined) {
    throw new Error('Update tray items were not registered.')
  }
  return {
    statePath,
    checkTray,
    toggleTray,
    notifications,
    warnings,
    confirmDownload,
    showManualCheckResult,
    downloadAndOpen,
    refresh,
    registrationDispose,
    dispose: async () => { await disposer?.() },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('desktop update Host plugin', () => {
  it('exposes the packaged 60-second and six-hour background policy', () => {
    expect(inject).toEqual(['desktopRuntime', 'settings'])
    expect(Config({} as UpdateConfig)).toEqual({
      enabled: true,
      initialDelayMs: 60_000,
      intervalMs: 21_600_000,
      requestTimeoutMs: 15_000,
    })
    expect(() => Config({ intervalMs: 0 } as UpdateConfig)).toThrow()
    expect(() => Config({ requestTimeoutMs: 0 } as UpdateConfig)).toThrow()
  })

  it.each([
    { packaged: false, enabled: true },
    { packaged: true, enabled: false },
  ])('reports a manual up-to-date result while automatic polling is disabled: %#', async ({ packaged, enabled }) => {
    vi.useFakeTimers()
    const request = vi.fn(async () => releaseResponse('2.0.0'))
    const harness = await createHarness({
      packaged,
      request,
      config: { ...testConfig, enabled },
    })

    await vi.advanceTimersByTimeAsync(testConfig.intervalMs)
    expect(request).not.toHaveBeenCalled()
    expect(harness.checkTray.label()).toBe('Check for Updates…')
    await harness.checkTray.invoke()
    expect(request).toHaveBeenCalledOnce()
    expect(harness.showManualCheckResult).toHaveBeenCalledWith({
      status: 'up-to-date',
      currentVersion: '2.0.0',
      latestVersion: '2.0.0',
      downloadUrl: ASSET_URL,
    })
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
  })

  it('prompts once for a background update and persists only state v2 prompt history', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => releaseResponse('2.1.0'))
    const harness = await createHarness({ request })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(harness.confirmDownload).toHaveBeenCalledWith('2.1.0') })
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.checkTray.label()).toBe('DeepSeek Harness Desktop 2.1.0 Available')
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(harness.statePath, 'utf8'))).toEqual({
        version: 2,
        lastPromptedVersion: '2.1.0',
      })
    })
    expect((await stat(harness.statePath)).mode & 0o777).toBe(0o600)

    await vi.advanceTimersByTimeAsync(testConfig.intervalMs)
    await vi.waitFor(() => { expect(request).toHaveBeenCalledTimes(2) })
    expect(harness.confirmDownload).toHaveBeenCalledOnce()
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
  })

  it('downloads and opens only after confirmation', async () => {
    vi.useFakeTimers()
    let resolveDownload!: () => void
    const download = new Promise<void>(resolve => { resolveDownload = resolve })
    const harness = await createHarness({
      request: async () => releaseResponse('2.1.0'),
      confirmDownload: async () => true,
      downloadAndOpen: async () => download,
    })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    const [result, signal] = harness.downloadAndOpen.mock.calls[0] as [UpdateCheckResult, AbortSignal]
    expect(result).toMatchObject({ latestVersion: '2.1.0', downloadUrl: ASSET_URL })
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
    expect(harness.checkTray.label()).toBe('Downloading DeepSeek Harness Desktop 2.1.0…')
    expect(harness.notifications).toEqual([])

    resolveDownload()
    await vi.waitFor(() => { expect(harness.checkTray.label()).toBe('DeepSeek Harness Desktop 2.1.0 Available') })
    expect(harness.notifications).toEqual([])
    expect(harness.checkTray.label()).toBe('DeepSeek Harness Desktop 2.1.0 Available')
  })

  it('treats a manual available-version selection as a fresh confirmation', async () => {
    const confirmDownload = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const harness = await createHarness({
      packaged: false,
      request: async () => releaseResponse('2.1.0'),
      confirmDownload,
    })

    await harness.checkTray.invoke()
    expect(confirmDownload).toHaveBeenCalledOnce()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.checkTray.label()).toBe('DeepSeek Harness Desktop 2.1.0 Available')

    await harness.checkTray.invoke()
    expect(confirmDownload).toHaveBeenCalledTimes(2)
    expect(harness.downloadAndOpen).toHaveBeenCalledOnce()
    expect(harness.showManualCheckResult).not.toHaveBeenCalled()
  })

  it('rechecks the version after confirmation and skips a rotated download', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(releaseResponse('2.1.0'))
      .mockResolvedValueOnce(releaseResponse('2.2.0'))
    const harness = await createHarness({
      packaged: false,
      request,
      confirmDownload: async () => true,
    })

    await harness.checkTray.invoke()

    expect(request).toHaveBeenCalledTimes(2)
    expect(harness.confirmDownload).toHaveBeenCalledWith('2.1.0')
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.showManualCheckResult).not.toHaveBeenCalled()
    expect(harness.checkTray.label()).toBe('DeepSeek Harness Desktop 2.2.0 Available')
  })

  it.each([
    ['up-to-date', async () => releaseResponse('2.0.0')],
    ['failed', async () => new Response('unavailable', { status: 503 })],
  ] as const)('keeps an automatic %s result silent', async (_case, request) => {
    vi.useFakeTimers()
    const requestSpy = vi.fn(request)
    const harness = await createHarness({ request: requestSpy })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(requestSpy).toHaveBeenCalledOnce() })

    expect(harness.showManualCheckResult).not.toHaveBeenCalled()
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
  })

  it.each([
    ['same version', async () => releaseResponse('2.0.0'), {
      status: 'up-to-date', currentVersion: '2.0.0', latestVersion: '2.0.0',
      downloadUrl: ASSET_URL,
    }],
    ['older version', async () => releaseResponse('1.9.9'), {
      status: 'up-to-date', currentVersion: '2.0.0', latestVersion: '1.9.9',
      downloadUrl: ASSET_URL,
    }],
    ['invalid version', async () => Response.json({ tag_name: 'v2.01.0', assets: [] }), null],
    ['service unavailable', async () => new Response('unavailable', { status: 503 }), null],
    ['network failure', async () => { throw new TypeError('offline') }, null],
  ] as const)('reports a manual %s result without prompting or downloading', async (_case, request, expected) => {
    const harness = await createHarness({ packaged: false, request })

    await harness.checkTray.invoke()

    expect(harness.showManualCheckResult).toHaveBeenCalledWith(expected)
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
    expect(harness.checkTray.label()).toBe('Check for Updates…')
  })

  it('silently resets legacy state and does not use it as an available version cache', async () => {
    vi.useFakeTimers()
    const harness = await createHarness({
      request: async () => releaseResponse('2.1.0'),
      state: JSON.stringify({
        version: 1,
        checkedVersion: '2.0.0',
        etag: '"legacy"',
        lastNotifiedVersion: '2.1.0',
        availableRelease: {
          tagName: 'v2.1.0',
          version: '2.1.0',
          htmlUrl: 'https://example.test/legacy',
        },
      }),
    })

    expect(harness.checkTray.label()).toBe('Check for Updates…')
    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(harness.confirmDownload).toHaveBeenCalledWith('2.1.0') })
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(harness.statePath, 'utf8'))).toEqual({
        version: 2,
        lastPromptedVersion: '2.1.0',
      })
    })
    expect(harness.warnings).toEqual([])
  })

  it('does not prompt on a platform without a fixed download entry', async () => {
    const harness = await createHarness({
      packaged: false,
      canDownload: false,
      request: async () => releaseResponse('2.1.0'),
    })

    await harness.checkTray.invoke()

    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.showManualCheckResult).toHaveBeenCalledWith({
      status: 'update-available',
      currentVersion: '2.0.0',
      latestVersion: '2.1.0',
      downloadUrl: ASSET_URL,
    })
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.notifications).toEqual([])
    expect(harness.checkTray.label()).toBe('Check for Updates…')
  })

  it('shares one pending download and silently restores availability after failure', async () => {
    let rejectDownload!: (cause: Error) => void
    const download = new Promise<void>((_resolve, reject) => { rejectDownload = reject })
    const harness = await createHarness({
      packaged: false,
      request: async () => releaseResponse('2.1.0'),
      confirmDownload: async () => true,
      downloadAndOpen: async () => download,
    })

    const first = harness.checkTray.invoke()
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    const second = harness.checkTray.invoke()
    expect(harness.downloadAndOpen).toHaveBeenCalledOnce()
    rejectDownload(new Error('offline'))
    await Promise.all([first, second])

    expect(harness.downloadAndOpen).toHaveBeenCalledOnce()
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
    expect(harness.checkTray.label()).toBe('DeepSeek Harness Desktop 2.1.0 Available')
  })

  it('aborts checks and downloads and removes the tray item on effect disposal', async () => {
    let checkSignal: AbortSignal | undefined
    const checking = await createHarness({
      packaged: false,
      request: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        checkSignal = init.signal as AbortSignal
        checkSignal.addEventListener('abort', () => {
          reject(new DOMException('disposed', 'AbortError'))
        }, { once: true })
      }),
    })
    const pendingCheck = checking.checkTray.invoke()
    await vi.waitFor(() => { expect(checkSignal).toBeDefined() })
    await checking.dispose()
    await pendingCheck
    expect(checkSignal?.aborted).toBe(true)
    expect(checking.registrationDispose).toHaveBeenCalledTimes(2)
    expect(checking.notifications).toEqual([])

    let downloadSignal: AbortSignal | undefined
    const downloading = await createHarness({
      packaged: false,
      request: async () => releaseResponse('2.1.0'),
      confirmDownload: async () => true,
      downloadAndOpen: async (_result, signal) => new Promise<void>((_resolve, reject) => {
        downloadSignal = signal
        signal.addEventListener('abort', () => {
          reject(new DOMException('disposed', 'AbortError'))
        }, { once: true })
      }),
    })
    const pendingDownload = downloading.checkTray.invoke()
    await vi.waitFor(() => { expect(downloadSignal).toBeDefined() })
    await downloading.dispose()
    await pendingDownload
    expect(downloadSignal?.aborted).toBe(true)
    expect(downloading.registrationDispose).toHaveBeenCalledTimes(2)
    expect(downloading.notifications).toEqual([])
    expect(downloading.warnings).toEqual([])
  })

  it('does not wait for an open manual result dialog during disposal', async () => {
    let closeDialog!: () => void
    const dialog = new Promise<void>(resolve => { closeDialog = resolve })
    const harness = await createHarness({
      packaged: false,
      showManualCheckResult: async () => dialog,
    })
    const pending = harness.checkTray.invoke()
    await vi.waitFor(() => { expect(harness.showManualCheckResult).toHaveBeenCalledOnce() })

    await harness.dispose()
    expect(harness.registrationDispose).toHaveBeenCalledTimes(2)

    closeDialog()
    await pending
  })

  it('reports a timed-out shared manual request and restores the idle tray label', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const request = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init.signal as AbortSignal
      signals.push(signal)
      signal.addEventListener('abort', () => {
        reject(new DOMException('cancelled', 'AbortError'))
      }, { once: true })
    }))
    const harness = await createHarness({ packaged: false, request })

    const first = harness.checkTray.invoke()
    const second = harness.checkTray.invoke()
    await vi.waitFor(() => { expect(request).toHaveBeenCalledOnce() })
    expect(harness.checkTray.label()).toBe('Checking for Updates…')
    await vi.advanceTimersByTimeAsync(testConfig.requestTimeoutMs)
    await Promise.all([first, second])

    expect(signals[0]?.aborted).toBe(true)
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.showManualCheckResult).toHaveBeenCalledWith(null)
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
    expect(harness.checkTray.label()).toBe('Check for Updates…')
  })

  it('toggles automatic background checks from the tray while keeping the manual check', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => releaseResponse('2.1.0'))
    const harness = await createHarness({ request })

    expect(harness.toggleTray.label()).toBe('Automatic Updates: On')
    await harness.toggleTray.invoke()
    expect(harness.toggleTray.label()).toBe('Automatic Updates: Off')
    expect(harness.checkTray.label()).toBe('Check for Updates…')

    await vi.advanceTimersByTimeAsync(testConfig.intervalMs)
    expect(request).not.toHaveBeenCalled()

    await harness.checkTray.invoke()
    expect(request).toHaveBeenCalledOnce()
  })

  it('enables background polling from the tray when the patch policy disabled it', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => releaseResponse('2.0.0'))
    const harness = await createHarness({
      request,
      config: { ...testConfig, enabled: false },
    })

    expect(harness.toggleTray.label()).toBe('Automatic Updates: Off')
    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    expect(request).not.toHaveBeenCalled()

    await harness.toggleTray.invoke()
    expect(harness.toggleTray.label()).toBe('Automatic Updates: On')
    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(request).toHaveBeenCalled() })
  })
})
