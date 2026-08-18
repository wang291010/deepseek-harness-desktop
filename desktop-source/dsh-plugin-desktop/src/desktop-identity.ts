/** Stable product identity and private data-root policy for this distribution. */

import { isAbsolute, join, resolve } from 'node:path'

export const PRODUCT_NAME = 'DeepSeek Harness Desktop'
export const WINDOWS_APP_ID = 'com.yourworkbench.deepseek-harness-desktop'
export const DSH_HOME_ENV = 'DSH_HOME'
export const PRIVATE_DSH_HOME_DIRECTORY = 'harness-home'

/** Resolve the private Harness home below this application's Electron data. */
export function desktopDshHome(userDataPath: string): string {
  if (!isAbsolute(userDataPath)) {
    throw new Error('dsh-plugin-desktop: Electron userData path must be absolute')
  }
  return join(resolve(userDataPath), PRIVATE_DSH_HOME_DIRECTORY)
}

/** Force this distribution to use its private Harness home for all descendants. */
export function installDesktopDshHome(
  userDataPath: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const home = desktopDshHome(userDataPath)
  for (const name of Object.keys(environment)) {
    if (name.toUpperCase() === DSH_HOME_ENV && name !== DSH_HOME_ENV) {
      delete environment[name]
    }
  }
  environment[DSH_HOME_ENV] = home
  return home
}
