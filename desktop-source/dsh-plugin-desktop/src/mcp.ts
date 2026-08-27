/** Durable MCP server settings shared by the Desktop Host, profile composer, and Settings UI. */

import z from '@deepseek-ai/schemastery'

/** Namespace strings are branded by the settings service at runtime; the literal is accepted by its API. */
export const MCP_SETTINGS_NAMESPACE = 'dsh-mcp'
export const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'

const MCP_SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

export interface McpServerSettings {
  serverName: string
  transport: 'stdio' | 'streamable-http'
  enabled: boolean
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  url: string
  headers: Record<string, string>
  toolCallTimeoutMs: number
  failOnStartupError: boolean
  reconnect: McpReconnectSettings
}

export interface McpReconnectSettings {
  enabled: boolean
  initialDelayMs: number
  maxDelayMs: number
  maxAttempts: number
}

export interface McpSettings {
  servers: McpServerSettings[]
}

export const McpServerSettingsSchema: z<McpServerSettings> = z.object({
  serverName: z.string().pattern(MCP_SERVER_NAME),
  transport: z.union(['stdio', 'streamable-http'] as const).default('stdio'),
  enabled: z.boolean().default(true),
  command: z.string().default(''),
  args: z.array(z.string()).default([]),
  env: z.dict(z.string()).default({}),
  cwd: z.string().default(''),
  url: z.string().default(''),
  headers: z.dict(z.string()).default({}),
  toolCallTimeoutMs: z.number().step(1).min(100).max(600_000).default(60_000),
  failOnStartupError: z.boolean().default(false),
  reconnect: z.object({
    enabled: z.boolean().default(true),
    initialDelayMs: z.number().step(1).min(50).max(60_000).default(500),
    maxDelayMs: z.number().step(1).min(100).max(600_000).default(30_000),
    maxAttempts: z.number().step(1).min(1).max(100).default(10),
  }).default({
    enabled: true,
    initialDelayMs: 500,
    maxDelayMs: 30_000,
    maxAttempts: 10,
  }),
})

export const McpSettingsSchema: z<McpSettings> = z.object({
  servers: z.array(McpServerSettingsSchema).default([]),
})

export function validateMcpSettings(value: McpSettings): void {
  const names = new Set<string>()
  for (const server of value.servers) {
    if (names.has(server.serverName)) throw new Error(`dsh-mcp: duplicate serverName ${server.serverName}`)
    names.add(server.serverName)
    if (server.transport === 'stdio' && server.enabled && server.command.trim().length === 0) {
      throw new Error(`dsh-mcp: stdio server ${server.serverName} requires command`)
    }
    if (server.transport === 'streamable-http' && server.enabled) {
      try {
        const url = new URL(server.url)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol')
      } catch { throw new Error(`dsh-mcp: HTTP server ${server.serverName} requires a valid http(s) URL`) }
    }
    if (server.reconnect.maxDelayMs < server.reconnect.initialDelayMs) {
      throw new Error(`dsh-mcp: reconnect maxDelayMs must be >= initialDelayMs for ${server.serverName}`)
    }
  }
}

/** Convert durable settings into Loader rows for the official MCP bridge. */
export function mcpRowsFromSettings(settings: McpSettings): Array<{ id: string; name: string; config: Record<string, unknown> }> {
  return settings.servers.filter(server => server.enabled).map(server => ({
    id: `mcp-client-${server.serverName}`,
    name: MCP_CLIENT_PACKAGE,
    config: {
      serverName: server.serverName,
      transport: server.transport,
      ...(server.transport === 'stdio'
        ? { command: server.command, args: server.args, env: server.env, ...(server.cwd ? { cwd: server.cwd } : {}) }
        : { url: server.url, headers: server.headers }),
      toolCallTimeoutMs: server.toolCallTimeoutMs,
      failOnStartupError: server.failOnStartupError,
      reconnect: server.reconnect,
    },
  }))
}
