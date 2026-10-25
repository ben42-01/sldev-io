import { spawn } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { McpEvent, Mission } from '@shared/types'
import { handleMcp } from '../src/main/mcp'
import { MCP_SERVER, MCP_TOOLS } from '../src/main/mcpServer'
import { agentCommand, findAgent, sldevMcp } from '@renderer/lib/agents'

const server = sldevMcp({ command: '/opt/sldev/sldev-io', script: '/data/sldev-mcp.cjs' }, 'm-1')

describe('attaching the MCP server', () => {
  it('Claude Code gets an inline --mcp-config', () => {
    const cmd = agentCommand(findAgent('claude'), {}, 'go', undefined, { mcp: server })
    expect(cmd).toBe(
      `claude --mcp-config '{"mcpServers":{"sldev":{"type":"stdio","command":"/opt/sldev/sldev-io","args":["/data/sldev-mcp.cjs","--mission","m-1"],"env":{"ELECTRON_RUN_AS_NODE":"1"}}}}' go`
    )
  })
  it('Codex gets a -c inline table before the exec subcommand', () => {
    expect(agentCommand(findAgent('codex'), { print: true }, 'go', undefined, { mcp: server })).toBe(
      `codex -c 'mcp_servers.sldev={command="/opt/sldev/sldev-io",args=["/data/sldev-mcp.cjs","--mission","m-1"],env={ELECTRON_RUN_AS_NODE="1"}}' exec go`
    )
  })
  it('agents without a per-run flag are left alone', () => {
    expect(agentCommand(findAgent('gemini'), {}, 'go', undefined, { mcp: server })).toBe('gemini -i go')
  })
})

/** Runs the real server script over stdio against a stand-in for the app's loopback server. */
async function session(lines: object[]): Promise<{ replies: Record<string, unknown>[]; calls: Record<string, unknown>[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'sldev-mcp-'))
  const calls: Record<string, unknown>[] = []
  const http = createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      calls.push({ token: req.headers['x-sldev-token'], url: req.url, ...JSON.parse(body) })
      res.end(JSON.stringify({ text: 'Status updated.' }))
    })
  })
  const port = await new Promise<number>((r) => http.listen(0, '127.0.0.1', () => r((http.address() as { port: number }).port)))
  writeFileSync(join(dir, 'sldev-mcp.cjs'), MCP_SERVER)
  writeFileSync(join(dir, 'mcp-endpoint.json'), JSON.stringify({ port, token: 'secret' }))
  const child = spawn(process.execPath, [join(dir, 'sldev-mcp.cjs'), '--mission', 'm-1'], { cwd: dir })
  const replies: Record<string, unknown>[] = []
  let out = ''
  child.stdout.on('data', (d) => {
    out += d
    let i
    while ((i = out.indexOf('\n')) >= 0) {
      replies.push(JSON.parse(out.slice(0, i)))
      out = out.slice(i + 1)
    }
  })
  for (const l of lines) child.stdin.write(JSON.stringify(l) + '\n')
  const want = lines.filter((l) => 'id' in l).length
  for (let t = 0; t < 100 && replies.length < want; t++) await new Promise((r) => setTimeout(r, 30))
  child.kill()
  http.close()
  return { replies, calls }
}

describe('the MCP server', () => {
  it('speaks MCP over stdio and forwards tool calls with the token from its endpoint file', async () => {
    const { replies, calls } = await session([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'sldev_status', arguments: { state: 'needs_input', message: 'Which database?' } } },
      { jsonrpc: '2.0', id: 4, method: 'nope' }
    ])
    const byId = (id: number) => replies.find((r) => r.id === id)!
    expect(byId(1)).toMatchObject({ id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'sldev' } } })
    expect((byId(2).result as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name))
    expect(byId(3)).toMatchObject({ id: 3, result: { content: [{ type: 'text', text: 'Status updated.' }], isError: false } })
    expect(byId(4)).toMatchObject({ id: 4, error: { code: -32601 } })
    expect(calls).toEqual([{ token: 'secret', url: '/mcp', mission: 'm-1', tool: 'sldev_status', args: { state: 'needs_input', message: 'Which database?' }, cwd: expect.any(String) }])
  })
})

describe('tool calls', () => {
  const m = (id: string, root: string, extra: Partial<Mission> = {}): Mission => ({ id, title: `T ${id}`, prompt: 'p', root, cwd: root, options: { agent: 'codex' }, status: 'working', createdAt: 0, updatedAt: 0, ...extra })
  const deps = (events: McpEvent[]) => ({ missions: () => [m('a', '/p'), m('b', '/p', { status: 'waiting' }), m('c', '/other')], send: (e: McpEvent) => events.push(e) })

  it('status goes to the window', async () => {
    const events: McpEvent[] = []
    expect(await handleMcp({ mission: 'a', tool: 'sldev_status', args: { state: 'done', message: 'Added tests' }, cwd: '/p' }, deps(events))).toEqual({ text: 'Status updated.' })
    expect(events).toEqual([{ mission: 'a', type: 'status', state: 'done', text: 'Added tests' }])
  })
  it('rejects a bad state and unknown sessions', async () => {
    expect((await handleMcp({ mission: 'a', tool: 'sldev_status', args: { state: 'sleeping' }, cwd: '/p' }, deps([]))).error).toContain('working, needs_input or done')
    expect((await handleMcp({ mission: 'zz', tool: 'sldev_rules', args: {}, cwd: '/p' }, deps([]))).error).toContain('not started by sldev-io')
  })
  it('lists the other missions of the same project only', async () => {
    const r = await handleMcp({ mission: 'a', tool: 'sldev_missions', args: {}, cwd: '/p' }, deps([]))
    expect(r.text).toBe('b · codex · waiting · in place · T b')
  })
  it('never reads another project\'s mission', async () => {
    expect((await handleMcp({ mission: 'a', tool: 'sldev_mission_diff', args: { id: 'c' }, cwd: '/p' }, deps([]))).error).toContain('No mission with that id')
  })
})
