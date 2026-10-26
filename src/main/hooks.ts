import { app, type WebContents } from 'electron'
import { createServer } from 'http'
import { randomBytes } from 'crypto'
import { openSync, readSync, closeSync, fstatSync, writeFileSync } from 'fs'
import { MCP_SERVER } from './mcpServer'
import { handleMcp, type McpDeps } from './mcp'
import { join } from 'path'
import type { HookEvent } from '@shared/types'

/**
 * Claude Code hooks → sldev. Missions launch `claude --settings <file>` where the settings register
 * hooks that run a tiny relay script (with Electron as node). The relay POSTs the hook payload to
 * this loopback server, so the app knows when an agent is working, waiting, or needs permission,
 * without touching the user's own Claude settings.
 */

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Notification', 'Stop', 'SessionEnd'] as const

const RELAY = `const http = require('http')
const event = process.argv[2]
let input = ''
const done = () => process.exit(0)
setTimeout(done, 4000)
process.stdin.on('data', (d) => (input += d))
process.stdin.on('end', () => {
  const { SLDEV_HOOK_PORT: port, SLDEV_HOOK_TOKEN: token, SLDEV_MISSION_ID: mission } = process.env
  if (!port || !mission) return done()
  const body = JSON.stringify({ mission, event, input })
  const req = http.request({ host: '127.0.0.1', port, path: '/hook', method: 'POST', timeout: 2000,
    headers: { 'content-type': 'application/json', 'x-sldev-token': token, 'content-length': Buffer.byteLength(body) } },
    (res) => { res.resume(); res.on('end', done) })
  req.on('error', done)
  req.on('timeout', () => { req.destroy(); done() })
  req.end(body)
})
`

export interface HookInfo {
  port: number
  token: string
  settingsPath: string
  /** how agents start the sldev MCP server: `<command> <script> --mission <id>` with ELECTRON_RUN_AS_NODE=1 */
  mcp: { command: string; script: string }
}

let info: HookInfo | null = null

export async function startHookServer(target: () => WebContents | null, mcp: Omit<McpDeps, 'send'>): Promise<HookInfo> {
  const token = randomBytes(16).toString('hex')
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/mcp' && req.headers['x-sldev-token'] === token) return void serveMcp(req, res)
    if (req.method !== 'POST' || req.url !== '/hook' || req.headers['x-sldev-token'] !== token) {
      res.writeHead(403).end()
      return
    }
    let body = ''
    req.on('data', (d) => {
      body += d
      if (body.length > 2_000_000) req.destroy()
    })
    req.on('end', () => {
      res.writeHead(204).end()
      try {
        const { mission, event, input } = JSON.parse(body)
        const evt = summarize(String(mission), String(event), safeJson(input))
        const wc = target()
        if (evt && wc && !wc.isDestroyed()) wc.send('mission:hook', evt)
      } catch {
        // malformed relay payload
      }
    })
  })
  const serveMcp = (req: import('http').IncomingMessage, res: import('http').ServerResponse): void => {
    let body = ''
    req.on('data', (d) => {
      body += d
      if (body.length > 1_000_000) req.destroy()
    })
    req.on('end', () => {
      const send = (e: Parameters<McpDeps['send']>[0]): void => {
        const wc = target()
        if (wc && !wc.isDestroyed()) wc.send('mission:mcp', e)
      }
      Promise.resolve()
        .then(() => handleMcp(JSON.parse(body), { ...mcp, send }))
        .catch(() => ({ error: 'Bad request' }))
        .then((r) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r)))
    })
  }

  const port = await new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
  )
  server.unref()

  const dir = app.getPath('userData')
  const relay = join(dir, 'hook-relay.cjs').replace(/\\/g, '/')
  writeFileSync(relay, RELAY)
  const exec = process.execPath.replace(/\\/g, '/')
  const hooks: Record<string, unknown> = {}
  for (const e of EVENTS) {
    const command = `ELECTRON_RUN_AS_NODE=1 "${exec}" "${relay}" ${e}`
    hooks[e] = [{ ...(e === 'PreToolUse' ? { matcher: '*' } : {}), hooks: [{ type: 'command', command, timeout: 10 }] }]
  }
  const settingsPath = join(dir, 'claude-hooks.json')
  writeFileSync(settingsPath, JSON.stringify({ hooks }, null, 2))
  const script = join(dir, 'sldev-mcp.cjs').replace(/\\/g, '/')
  writeFileSync(script, MCP_SERVER)
  // the server reads where to call from here, so the token never appears in a command line
  writeFileSync(join(dir, 'mcp-endpoint.json'), JSON.stringify({ port, token }), { mode: 0o600 })
  info = { port, token, settingsPath, mcp: { command: exec, script } }
  return info
}

export function hookInfo(): HookInfo | null {
  return info
}

function safeJson(s: unknown): Record<string, unknown> {
  try {
    return typeof s === 'string' ? JSON.parse(s) : {}
  } catch {
    return {}
  }
}

const clip = (s: unknown, n = 240): string | undefined => (typeof s === 'string' && s ? (s.length > n ? s.slice(0, n - 1) + '…' : s) : undefined)

function summarize(mission: string, event: string, p: Record<string, unknown>): HookEvent | null {
  const base = { mission, sessionId: typeof p.session_id === 'string' ? p.session_id : undefined, transcriptPath: typeof p.transcript_path === 'string' ? p.transcript_path : undefined }
  switch (event) {
    case 'SessionStart':
      return { ...base, type: 'session-start' }
    case 'UserPromptSubmit':
      return { ...base, type: 'prompt', text: clip(p.prompt) }
    case 'PreToolUse':
      return { ...base, type: 'tool', text: toolSummary(String(p.tool_name ?? 'tool'), (p.tool_input ?? {}) as Record<string, unknown>) }
    case 'Notification':
      return { ...base, type: 'notification', text: clip(p.message) ?? 'Claude needs your attention' }
    case 'Stop':
      return { ...base, type: 'stop', text: lastAssistantText(p.transcript_path) }
    case 'SessionEnd':
      return { ...base, type: 'session-end', text: clip(p.reason) }
  }
  return null
}

function toolSummary(tool: string, input: Record<string, unknown>): string {
  const pick = (k: string): string | undefined => (typeof input[k] === 'string' ? (input[k] as string) : undefined)
  const file = pick('file_path') ?? pick('notebook_path') ?? pick('path')
  // Claude's Bash and Task calls carry a one-line description, which reads better than the raw command
  const detail = file ? file.split(/[\\/]/).slice(-2).join('/') : pick('description') ?? pick('command') ?? pick('pattern') ?? pick('url') ?? pick('query')
  return clip(detail ? `${tool}: ${detail}` : tool, 160)!
}

/** Read the tail of the session transcript (JSONL) and return the last assistant text block. */
function lastAssistantText(path: unknown): string | undefined {
  if (typeof path !== 'string' || !path) return undefined
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const len = Math.min(size, 256 * 1024)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n').reverse()
    for (const line of lines) {
      if (!line.includes('"assistant"')) continue
      try {
        const msg = JSON.parse(line)
        const content = msg?.message?.content
        if (msg.type !== 'assistant' || !Array.isArray(content)) continue
        const text = content.filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n').trim()
        if (text) return clip(text, 600)
      } catch {
        // partial first line of the tail
      }
    }
  } catch {
    // transcript unreadable
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
  return undefined
}
