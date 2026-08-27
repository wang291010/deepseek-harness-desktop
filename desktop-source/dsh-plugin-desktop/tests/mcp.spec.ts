import { describe, expect, it } from 'vitest'
import { McpSettingsSchema, mcpRowsFromSettings, validateMcpSettings } from '../src/mcp.ts'

function parseSettings(value: unknown) {
  return McpSettingsSchema(value as never)
}

describe('MCP settings', () => {
  it('normalizes a stdio server into the official bridge row', () => {
    const settings = parseSettings({
      servers: [{ serverName: 'filesystem', transport: 'stdio', command: 'npx', args: ['-y', 'server'], env: {}, cwd: '', url: '', headers: {}, enabled: true, reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 } }],
    })
    validateMcpSettings(settings)
    expect(mcpRowsFromSettings(settings)).toEqual([expect.objectContaining({
      id: 'mcp-client-filesystem',
      name: '@deepseek-ai/dsh-mcp-client',
      config: expect.objectContaining({ transport: 'stdio', command: 'npx', args: ['-y', 'server'], reconnect: expect.objectContaining({ maxAttempts: 10 }) }),
    })])
  })

  it('applies reconnect defaults and enforces the official attempt budget', () => {
    const settings = parseSettings({ servers: [{ serverName: 'defaults', transport: 'stdio', command: 'node' }] })
    expect(settings.servers[0]?.reconnect).toEqual({
      enabled: true,
      initialDelayMs: 500,
      maxDelayMs: 30000,
      maxAttempts: 10,
    })
    expect(() => parseSettings({ servers: [{ serverName: 'invalid', transport: 'stdio', command: 'node', reconnect: { maxAttempts: 0 } }] })).toThrow()
  })

  it('rejects duplicate names and missing transport endpoints', () => {
    const duplicate = parseSettings({ servers: [
      { serverName: 'same', transport: 'stdio', command: 'node' },
      { serverName: 'same', transport: 'stdio', command: 'node' },
    ] })
    expect(() => validateMcpSettings(duplicate)).toThrow('duplicate serverName')
    const missingUrl = parseSettings({ servers: [{ serverName: 'remote', transport: 'streamable-http', url: '' }] })
    expect(() => validateMcpSettings(missingUrl)).toThrow('valid http(s) URL')
    const unsupportedProtocol = parseSettings({ servers: [{ serverName: 'remote', transport: 'streamable-http', url: 'file:///tmp/mcp' }] })
    expect(() => validateMcpSettings(unsupportedProtocol)).toThrow('valid http(s) URL')
  })

  it('rejects an inverted reconnect delay range', () => {
    const settings = parseSettings({ servers: [{ serverName: 'unstable', transport: 'stdio', command: 'node', reconnect: { initialDelayMs: 5000, maxDelayMs: 1000 } }] })
    expect(() => validateMcpSettings(settings)).toThrow('maxDelayMs')
  })

  it('does not compose disabled servers', () => {
    const settings = parseSettings({ servers: [{ serverName: 'off', transport: 'stdio', command: 'node', enabled: false }] })
    expect(mcpRowsFromSettings(settings)).toEqual([])
  })
})
