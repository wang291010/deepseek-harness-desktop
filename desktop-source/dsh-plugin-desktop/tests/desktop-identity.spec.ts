import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  desktopDshHome,
  installDesktopDshHome,
  PRODUCT_NAME,
  WINDOWS_APP_ID,
} from '../src/desktop-identity.ts'

describe('independent desktop identity', () => {
  it('keeps a stable product and Windows identity', () => {
    expect(PRODUCT_NAME).toBe('DeepSeek Harness Desktop')
    expect(WINDOWS_APP_ID).toBe('com.yourworkbench.deepseek-harness-desktop')
  })

  it('places the Harness home below an absolute Electron user-data path', () => {
    const userDataPath = resolve('private-desktop-user-data')

    expect(desktopDshHome(userDataPath)).toBe(join(userDataPath, 'harness-home'))
    expect(() => desktopDshHome('relative-user-data')).toThrow('must be absolute')
  })

  it('replaces inherited DSH home aliases with the private directory', () => {
    const userDataPath = resolve('private-desktop-user-data')
    const environment: NodeJS.ProcessEnv = {
      DSH_HOME: 'C:\\Users\\example\\.dsh',
      dsh_home: 'D:\\shared-dsh',
      SAFE_VALUE: 'kept',
    }

    const home = installDesktopDshHome(userDataPath, environment)

    expect(home).toBe(join(userDataPath, 'harness-home'))
    expect(environment).toEqual({ DSH_HOME: home, SAFE_VALUE: 'kept' })
  })
})
