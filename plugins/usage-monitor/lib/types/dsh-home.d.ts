/**
 * Resolve the active DSH data root.
 *
 * Desktop distributions set DSH_HOME before the plugin runtime loads. The
 * legacy ~/.dsh fallback is retained for standalone DSH CLI installations.
 */
export declare function resolveDshHome(env?: NodeJS.ProcessEnv, fallbackHome?: string): string;
export declare function resolveCredentialsFile(env?: NodeJS.ProcessEnv, fallbackHome?: string): string;
export declare function resolveUsageFile(value: string | undefined, env?: NodeJS.ProcessEnv, fallbackHome?: string): string;
