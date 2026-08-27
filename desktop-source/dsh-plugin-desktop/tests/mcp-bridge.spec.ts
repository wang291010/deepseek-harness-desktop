import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apply as applyMcpClient } from '@deepseek-ai/dsh-mcp-client'

const serverSource = String.raw`
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  for (;;) {
    const newline = buffer.indexOf('\n')
    if (newline < 0) break
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    const request = JSON.parse(line)
    if (request.method === 'initialize') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'test-mcp', version: '1.0.0' },
        },
      }) + '\n')
    } else if (request.method === 'tools/list') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: [{
            name: 'echo',
            description: 'Echo input for integration testing',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          }],
        },
      }) + '\n')
    } else if (request.method === 'tools/call') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{ type: 'text', text: String(request.params?.arguments?.text ?? '') }],
        },
      }) + '\n')
    }
  }
})
`

function fakeContext() {
  const registered = new Map<string, { name: string; execute: (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown> }>()
  const effects: Array<void | (() => void | Promise<void>)> = []
  const logs: string[] = []
  const ctx = {
    root: {},
    tools: {
      register(definition: { name: string; execute: (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown> }) {
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      },
    },
    logger: {
      warn(message: string) { logs.push(`warn:${message}`) },
      info(message: string) { logs.push(`info:${message}`) },
      error(message: string) { logs.push(`error:${message}`) },
    },
    effect(factory: () => void | (() => void | Promise<void>), _label?: string) {
      const disposer = factory()
      effects.push(disposer)
      return disposer
    },
  }
  return { ctx, registered, effects, logs }
}

describe('official MCP bridge integration', () => {
  it('discovers, registers, calls, and disposes a real stdio MCP server', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-bridge-'))
    const server = join(dir, 'server.mjs')
    writeFileSync(server, serverSource, 'utf8')
    expect(existsSync(server)).toBe(true)

    const harness = fakeContext()
    try {
      await applyMcpClient(harness.ctx as never, {
        transport: 'stdio',
        serverName: 'integration',
        command: process.execPath,
        args: [server],
        env: {},
        cwd: dir,
        toolCallTimeoutMs: 5_000,
        failOnStartupError: true,
        reconnect: { enabled: false },
      })

      const tool = harness.registered.get('mcp__integration__echo')
      expect(tool).toBeDefined()
      const result = await tool?.execute(
        { text: 'hello' },
        { signal: new AbortController().signal },
      )
      expect(result).toEqual({ content: [{ type: 'text', text: 'hello' }] })
    } finally {
      for (const dispose of harness.effects.reverse()) {
        if (typeof dispose === 'function') await dispose()
      }
      rmSync(dir, { recursive: true, force: true })
    }
    expect(harness.registered.size).toBe(0)
  })

  it('discovers and calls a local Streamable HTTP MCP server', async () => {
    const requests: string[] = []
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? 'UNKNOWN'} ${request.url ?? ''}`)
      if (request.method === 'GET') {
        response.writeHead(405).end()
        return
      }
      if (request.method === 'DELETE') {
        response.writeHead(204).end()
        return
      }
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          id?: string | number
          method?: string
          params?: { arguments?: { text?: string } }
        }
        const result = message.method === 'initialize'
          ? {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'http-test-mcp', version: '1.0.0' },
            }
          : message.method === 'tools/list'
            ? {
                tools: [{
                  name: 'echo',
                  description: 'Echo input over HTTP',
                  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
                }],
              }
            : {
                content: [{ type: 'text', text: String(message.params?.arguments?.text ?? '') }],
              }
        response.writeHead(200, {
          'content-type': 'application/json',
          'mcp-session-id': 'http-integration',
          'mcp-protocol-version': '2025-06-18',
        }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('HTTP test server did not bind')

    const harness = fakeContext()
    try {
      await applyMcpClient(harness.ctx as never, {
        transport: 'streamable-http',
        serverName: 'http-integration',
        url: `http://127.0.0.1:${address.port}/mcp`,
        headers: { 'x-test-header': 'present' },
        toolCallTimeoutMs: 5_000,
        failOnStartupError: true,
        reconnect: { enabled: false },
      })
      const tool = harness.registered.get('mcp__http-integration__echo')
      expect(tool).toBeDefined()
      await expect(tool?.execute(
        { text: 'hello-http' },
        { signal: new AbortController().signal },
      )).resolves.toEqual({ content: [{ type: 'text', text: 'hello-http' }] })
      expect(requests.some(item => item.startsWith('POST /mcp'))).toBe(true)
    } finally {
      for (const dispose of harness.effects.reverse()) {
        if (typeof dispose === 'function') await dispose()
      }
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
    expect(harness.registered.size).toBe(0)
  })
})
