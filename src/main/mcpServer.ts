/**
 * The sldev MCP server: a stdio JSON-RPC process an agent starts (run with Electron as node). Each
 * tool call is forwarded to the app's loopback hook server. The port and token come from
 * mcp-endpoint.json next to the script, so no secret is ever on a command line.
 */

export const MCP_TOOLS = [
  {
    name: 'sldev_status',
    description:
      "Tell sldev-io what you're doing so the user sees it on the mission board. Call it with needs_input when you need the user (a question, a permission, a decision), with working when you continue, and with done when the task is finished.",
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['working', 'needs_input', 'done'] },
        message: { type: 'string', description: 'One line for the user: what you are doing, what you need, or what you did' }
      },
      required: ['state']
    }
  },
  {
    name: 'sldev_output',
    description: "Save this step's result (a spec, a review, a summary) as Markdown. In a factory run the next steps read it.",
    inputSchema: { type: 'object', properties: { markdown: { type: 'string' } }, required: ['markdown'] }
  },
  {
    name: 'sldev_done',
    description: 'Finish this step. Use it when sldev-io runs you as an interactive factory step and you have completed the task.',
    inputSchema: { type: 'object', properties: { summary: { type: 'string', description: 'What you did, in a few lines' } } }
  },
  {
    name: 'sldev_missions',
    description: 'List the other agent missions in this project: title, agent, status and branch.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'sldev_mission_diff',
    description: "Get another mission's changes as a unified diff, for example to review it. Use an id from sldev_missions.",
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'sldev_remember',
    description:
      "Add one line to the project's memory (.sldev/memory.md), which future agents in this project are pointed at. Record what would have saved you time: a gotcha, a command that works, a convention, where something lives. Not a summary of your task.",
    inputSchema: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'One line, under 500 characters' },
        paths: { type: 'array', items: { type: 'string' }, description: 'The files or folders the note is about (relative to the project). Later agents working on them are pointed at the note, and it is flagged when they change.' }
      },
      required: ['note']
    }
  },
  {
    name: 'sldev_recall',
    description:
      "Look up what earlier agents and the team know about this project: learnings, reference docs (.sldev/context), pinned files and skills. Ask by topic (query) or by file (path), for example before you change a file or when you are stuck. With a path you also get the other files those notes link to.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A topic or question, e.g. "how are tests run" or "auth tokens"' },
        path: { type: 'string', description: 'A file or folder relative to the project, e.g. src/server/auth.ts' }
      }
    }
  },
  {
    name: 'sldev_board',
    description:
      "The project's work board in sldev-io: cards with their number, column (backlog, ready, progress, review, done), priority, labels and title. Check it before filing a card, so you don't add one that is already there.",
    inputSchema: { type: 'object', properties: { column: { type: 'string', enum: ['backlog', 'ready', 'progress', 'review', 'done'], description: 'Only this column' } } }
  },
  {
    name: 'sldev_board_add',
    description:
      'File follow-up work you found but should not do now (a bug, a missing test, a refactor) as a card on the work board. It goes to Backlog, where a person decides whether an agent picks it up. One card per piece of work.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What needs doing, under 100 characters' },
        details: { type: 'string', description: 'Why, where (files) and what done looks like' },
        labels: { type: 'array', items: { type: 'string' }, description: 'e.g. bug, tests, refactor' },
        priority: { type: 'string', enum: ['high', 'normal', 'low'] }
      },
      required: ['title']
    }
  },
  {
    name: 'sldev_rules',
    description: "The project's agent rules (.sldev/rules.md, or AGENTS.md when there is none).",
    inputSchema: { type: 'object', properties: {} }
  }
]

export const MCP_SERVER = `const http = require('http')
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const TOOLS = ${JSON.stringify(MCP_TOOLS)}
const at = process.argv.indexOf('--mission')
const mission = at > 0 ? process.argv[at + 1] : ''
let endpoint = null
try { endpoint = JSON.parse(fs.readFileSync(path.join(__dirname, 'mcp-endpoint.json'), 'utf8')) } catch {}

function call(tool, args) {
  return new Promise((resolve) => {
    if (!endpoint) return resolve({ error: 'sldev-io is not running' })
    const body = JSON.stringify({ mission, tool, args, cwd: process.cwd() })
    const req = http.request({ host: '127.0.0.1', port: endpoint.port, path: '/mcp', method: 'POST', timeout: 20000,
      headers: { 'content-type': 'application/json', 'x-sldev-token': endpoint.token, 'content-length': Buffer.byteLength(body) } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve({ error: 'sldev-io sent an unreadable reply' }) } }) })
    req.on('error', (e) => resolve({ error: 'sldev-io is not reachable: ' + e.message }))
    req.on('timeout', () => { req.destroy(); resolve({ error: 'sldev-io did not answer in time' }) })
    req.end(body)
  })
}

const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  const { id, method, params } = msg
  if (method === 'initialize')
    return send({ jsonrpc: '2.0', id, result: { protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'sldev', version: '1.0.0' } } })
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
  if (method === 'tools/call') {
    const r = await call(params && params.name, (params && params.arguments) || {})
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: r.error || r.text || 'ok' }], isError: !!r.error } })
  }
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} })
  if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } })
})
`
