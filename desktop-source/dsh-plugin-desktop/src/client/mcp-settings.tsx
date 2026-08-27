import React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { McpServerSettings } from '../mcp.ts'

const MCP_SETTINGS_NAMESPACE = 'dsh-mcp'

type McpScope = SettingsScope<{ servers: McpServerSettings[] }>
type InputChange = React.ChangeEvent<HTMLInputElement>
type SelectChange = React.ChangeEvent<HTMLSelectElement>
type TextareaChange = React.ChangeEvent<HTMLTextAreaElement>

const buttonStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  padding: '7px 12px',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
}

const inputStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 34,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 7,
  padding: '6px 9px',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
}

function blankServer(): McpServerSettings {
  return {
    serverName: '', transport: 'stdio', enabled: true, command: '', args: [], env: {}, cwd: '',
    url: '', headers: {}, toolCallTimeoutMs: 60_000, failOnStartupError: false,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
  }
}

function mapText(value: Record<string, string>): string {
  return Object.entries(value).map(([key, item]) => `${key}=${item}`).join('\n')
}

function textMap(value: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of value.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    if (key) result[key] = line.slice(index + 1)
  }
  return result
}

function numberValue(raw: string, fallback: number): number {
  if (raw.trim().length === 0) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

function cloneServers(value: unknown): McpServerSettings[] {
  return Array.isArray(value) ? value.map(item => ({
    ...blankServer(), ...(item as Partial<McpServerSettings>),
    env: { ...((item as McpServerSettings)?.env ?? {}) },
    headers: { ...((item as McpServerSettings)?.headers ?? {}) },
    args: [...((item as McpServerSettings)?.args ?? [])],
    reconnect: { ...blankServer().reconnect, ...((item as McpServerSettings)?.reconnect ?? {}) },
  })) : []
}

function Field(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return jsx('label', { style: { display: 'grid', gap: 5, minWidth: 0 }, children: [
    jsx('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 }, children: props.label }),
    props.children,
  ] })
}

function McpSettingsSection({ scope }: { scope: McpScope }): React.JSX.Element {
  const snapshot = React.useSyncExternalStore(
    listener => scope.subscribe(listener),
    () => scope.getSnapshot(),
    () => scope.getSnapshot(),
  )
  const [draft, setDraft] = React.useState<McpServerSettings[]>(() => cloneServers(snapshot.value?.servers))
  const [dirty, setDirty] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState('')
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (!dirty) setDraft(cloneServers(snapshot.value?.servers))
  }, [snapshot.revision, snapshot.status, dirty, snapshot.value])

  const change = (index: number, patch: Partial<McpServerSettings>) => {
    setDraft(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
    setDirty(true)
    setNotice('')
  }
  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await scope.set('servers', draft)
      setDirty(false)
      setNotice('已保存，工作台将重启以加载 MCP 服务。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }
  const unavailable = snapshot.status === 'unavailable' || !snapshot.writable
  return jsxs('section', { style: { maxWidth: 780, display: 'grid', gap: 14, color: 'var(--dsw-alias-label-primary)' }, children: [
    jsxs('header', { style: { display: 'grid', gap: 4 }, children: [
      jsx('h2', { style: { margin: 0, fontSize: 17, fontWeight: 600 }, children: 'MCP 服务' }),
      jsx('p', { style: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 13 }, children: '连接外部 MCP 服务并将其工具提供给模型。' }),
    ] }),
    draft.length === 0 && jsx('div', { style: { border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: 9, padding: 20, color: 'var(--dsw-alias-label-tertiary)', textAlign: 'center' }, children: '尚未配置 MCP 服务' }),
    ...draft.map((server, index) => jsxs('article', { style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 9, padding: 14, display: 'grid', gap: 12 }, children: [
      jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 10 }, children: [
        jsx('input', { type: 'checkbox', checked: server.enabled, disabled: unavailable, onChange: (event: InputChange) => change(index, { enabled: event.target.checked }) }),
        jsx('input', { style: { ...inputStyle, flex: 1, minWidth: 0 }, value: server.serverName, disabled: unavailable, placeholder: 'server-name', onChange: (event: InputChange) => change(index, { serverName: event.target.value }) }),
        jsx('button', { type: 'button', style: { ...buttonStyle, color: 'var(--dsw-alias-state-error-primary)' }, disabled: unavailable, onClick: () => { setDraft(current => current.filter((_, itemIndex) => itemIndex !== index)); setDirty(true) }, 'aria-label': '删除服务', title: '删除服务', children: '删除' }),
      ] }),
      jsxs('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(140px, 180px) minmax(0, 1fr)', gap: 10 }, children: [
        jsx(Field, { label: '传输', children: jsx('select', { style: inputStyle, value: server.transport, disabled: unavailable, onChange: (event: SelectChange) => change(index, { transport: event.target.value as McpServerSettings['transport'] }), children: [jsx('option', { value: 'stdio', children: 'stdio' }), jsx('option', { value: 'streamable-http', children: 'Streamable HTTP' })] }) }),
        server.transport === 'stdio'
          ? jsx(Field, { label: '命令', children: jsx('input', { style: inputStyle, value: server.command, disabled: unavailable, placeholder: 'npx', onChange: (event: InputChange) => change(index, { command: event.target.value }) }) })
          : jsx(Field, { label: '服务 URL', children: jsx('input', { style: inputStyle, value: server.url, disabled: unavailable, placeholder: 'https://example.com/mcp', onChange: (event: InputChange) => change(index, { url: event.target.value }) }) }),
      ] }),
      server.transport === 'stdio'
        ? jsxs('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }, children: [
            jsx(Field, { label: '参数（每行一个）', children: jsx('textarea', { style: { ...inputStyle, minHeight: 68, resize: 'vertical' }, value: server.args.join('\n'), disabled: unavailable, onChange: (event: TextareaChange) => change(index, { args: event.target.value.split(/\r?\n/).map((item: string) => item.trim()).filter(Boolean) }) }) }),
            jsx(Field, { label: '环境变量（KEY=VALUE）', children: jsx('textarea', { style: { ...inputStyle, minHeight: 68, resize: 'vertical' }, value: mapText(server.env), disabled: unavailable, onChange: (event: TextareaChange) => change(index, { env: textMap(event.target.value) }) }) }),
          ] })
        : jsx(Field, { label: '请求头（Header=Value）', children: jsx('textarea', { style: { ...inputStyle, minHeight: 68, resize: 'vertical' }, value: mapText(server.headers), disabled: unavailable, onChange: (event: TextareaChange) => change(index, { headers: textMap(event.target.value) }) }) }),
      jsxs('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 160px', gap: 10 }, children: [
        jsx(Field, { label: '工作目录（可选）', children: jsx('input', { style: inputStyle, value: server.cwd, disabled: unavailable || server.transport !== 'stdio', onChange: (event: InputChange) => change(index, { cwd: event.target.value }) }) }),
        jsx(Field, { label: '调用超时（毫秒）', children: jsx('input', { style: inputStyle, type: 'number', min: 100, max: 600000, value: server.toolCallTimeoutMs, disabled: unavailable, onChange: (event: InputChange) => change(index, { toolCallTimeoutMs: numberValue(event.target.value, 60000) }) }) }),
      ] }),
      jsxs('div', { style: { display: 'grid', gap: 8 }, children: [
        jsx('label', { style: { display: 'flex', alignItems: 'center', gap: 7, color: 'var(--dsw-alias-label-secondary)', fontSize: 12 }, children: [
          jsx('input', { type: 'checkbox', checked: server.reconnect.enabled, disabled: unavailable, onChange: (event: InputChange) => change(index, { reconnect: { ...server.reconnect, enabled: event.target.checked } }) }),
          '断线自动重连',
        ] }),
        server.reconnect.enabled && jsxs('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }, children: [
          jsx(Field, { label: '首次重连延迟（毫秒）', children: jsx('input', { style: inputStyle, type: 'number', min: 50, max: 60000, value: server.reconnect.initialDelayMs, disabled: unavailable, onChange: (event: InputChange) => change(index, { reconnect: { ...server.reconnect, initialDelayMs: numberValue(event.target.value, 500) } }) }) }),
          jsx(Field, { label: '最大重连延迟（毫秒）', children: jsx('input', { style: inputStyle, type: 'number', min: 100, max: 600000, value: server.reconnect.maxDelayMs, disabled: unavailable, onChange: (event: InputChange) => change(index, { reconnect: { ...server.reconnect, maxDelayMs: numberValue(event.target.value, 30000) } }) }) }),
          jsx(Field, {
            label: '连续失败次数上限',
            children: jsx('input', {
              style: inputStyle,
              type: 'number',
              min: 1,
              max: 100,
              value: server.reconnect.maxAttempts,
              disabled: unavailable,
              onChange: (event: InputChange) => change(index, {
                reconnect: { ...server.reconnect, maxAttempts: numberValue(event.target.value, 10) },
              }),
            }),
          }),
        ] }),
      ] }),
    ] }, index)),
    jsxs('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, children: [
      jsx('button', { type: 'button', style: buttonStyle, disabled: unavailable, onClick: () => { setDraft(current => [...current, blankServer()]); setDirty(true) }, children: '添加 MCP 服务' }),
      jsx('button', { type: 'button', style: { ...buttonStyle, background: 'var(--dsw-alias-brand-primary)', color: 'white', borderColor: 'transparent' }, disabled: unavailable || busy || !dirty, onClick: save, children: busy ? '保存中…' : '保存并重启' }),
      notice && jsx('span', { style: { color: 'var(--dsw-alias-state-success-primary)', fontSize: 12 }, children: notice }),
      error && jsx('span', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12 }, children: error }),
      unavailable && jsx('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }, children: '当前配置不可写' }),
    ] }),
  ] })
}

export function registerMcpSettingsSection(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind({ namespace: MCP_SETTINGS_NAMESPACE }) as McpScope
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp',
    order: 16,
    label: () => 'MCP',
  }, () => jsx(McpSettingsSection, { scope }))), 'dsh-plugin-desktop: MCP settings section')
}
