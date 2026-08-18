import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

/**
 * Resolve the active DSH data root.
 *
 * Desktop distributions set DSH_HOME before the plugin runtime loads. The
 * legacy ~/.dsh fallback is retained for standalone DSH CLI installations.
 */
export function resolveDshHome(
  env: NodeJS.ProcessEnv = process.env,
  fallbackHome: string = homedir(),
): string {
  const configured = env.DSH_HOME?.trim()
  return configured ? resolve(configured) : resolve(fallbackHome, '.dsh')
}

export function resolveCredentialsFile(
  env: NodeJS.ProcessEnv = process.env,
  fallbackHome: string = homedir(),
): string {
  return join(resolveDshHome(env, fallbackHome), '.credentials.yaml')
}

export function resolveUsageFile(
  value: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  fallbackHome: string = homedir(),
): string {
  const dshRoot = resolveDshHome(env, fallbackHome)
  const legacy = resolve(dshRoot, 'dsh-usage-stats.json')
  const managed = resolve(dshRoot, 'usage-stats')
  if (value === undefined || value.trim() === '') return legacy

  const requested = resolve(value)
  const normalize = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path
  const target = normalize(requested)
  const allowedRoot = normalize(managed)
  if (target === normalize(legacy) || target === allowedRoot || target.startsWith(allowedRoot + sep)) {
    return requested
  }
  return legacy
}
