import { chmodSync, existsSync, mkdirSync, promises as fsp, readFileSync, unlinkSync } from 'fs'
import { createConnection, createServer, type Server, type Socket } from 'net'
import { join } from 'path'
import { agentCommand, allAgents, findAgent, installedBin, setInstalledBins, sldevMcp, stageMode, type AgentDef } from '@shared/agents'
import { branchName, cleanBranchName } from '@shared/branch'
import { contextPointer } from '@shared/context'
import { failoverBrief, nextAgent, TAIL_ROWS } from '@shared/failover'
import { patchMission, pushStatus } from '@shared/missionHistory'
import { BUILTIN_KINDS, type MissionKind } from '@shared/missionKinds'
import { missionPrompt, secondOpinionBrief } from '@shared/missionPrompt'
import { withMemory } from '@shared/memory'
import type { PassOutcome } from '@shared/repeat'
import { wasInterrupted } from '@shared/status'
import type { AppSettings, CustomAgent, Mission } from '@shared/types'
import { PtyManager, type PtySink } from '../../src/main/pty'
import { startHookServer, stopHookServer, type HookInfo } from '../../src/main/hooks'
import { findOnPath } from '../../src/main/launch'
import { addWorktree, diffStat, gitBranch, head, isRepo, run } from '../../src/main/git'
import { listKinds } from '../../src/main/missionKinds'
import { memoryInfo } from '../../src/main/memory'
import { closeContext, initContext, search } from '../../src/main/context'
import { lineReader, WAIT_STATES, type Command, type DaemonEvent, type NewPaneArgs, type PaneInfo, type Request, type Requests, type Response } from './protocol'
import { createTerm, screenText, termScreen, type Term } from './screen'
import { Tracker } from './tracker'
import { Loops, type PassStart } from './loops'
import { desktopNotify } from './notify'
import { cliDir, socketPath } from './paths'
import { VERSION } from './version'

/**
 * `sldev serve`: owns the agent ptys, a headless screen per pane, the hook and MCP loopback server and the
 * socket the commands and the TUI talk to. Panes outlive the clients, so detaching never stops an agent.
 */

interface Pane {
  info: PaneInfo
  agent: AgentDef
  term: Term
  /** the raw output, capped: a TUI that attaches replays it into its own screen */
  history: string
  tracker: Tracker
}

interface Waiter {
  pane?: string
  states: string[]
  resolve: (p: PaneInfo | null) => void
}

/** Everything a pane is started from; new, review and failover all end here. */
interface PaneSpec {
  agent: AgentDef
  prompt: string
  brief?: string
  title: string
  root: string
  cwd: string
  worktree?: Mission['worktree']
  options: Mission['options']
  kind?: Mission['kind']
  parent?: Mission['parent']
  repeat?: Mission['repeat']
  failover?: string[]
  cols: number
  rows: number
}

const HISTORY_MAX = 512 * 1024
const MAX_INLINE_PROMPT = 12_000
const CONTEXT_HITS = 6

export interface DaemonOptions {
  dataDir: string
  /** the program agents run the hook relay and MCP script with */
  node?: string
  /** desktop notifications (off in tests) */
  notify?: (title: string, body: string) => void
}

export interface Daemon {
  socket: string
  close: () => Promise<void>
}

export async function startDaemon(o: DaemonOptions): Promise<Daemon> {
  const dir = cliDir(o.dataDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const socket = socketPath(dir)
  await claimSocket(socket)

  const settings = readSettings(o.dataDir)
  const custom: CustomAgent[] = settings.customAgents ?? []
  const agents = allAgents(custom)
  setInstalledBins(agents.flatMap((a) => [a.bin, ...(a.aliases ?? [])]).filter((b) => b && findOnPath(b, process.env)))
  initContext(o.dataDir)

  const panes = new Map<string, Pane>()
  const clients = new Set<Socket>()
  const focused = new Map<Socket, string | null>()
  let waiters: Waiter[] = []
  let nextId = 1
  const notify = o.notify ?? desktopNotify

  const broadcast = (e: DaemonEvent): void => {
    const line = JSON.stringify(e) + '\n'
    for (const c of clients) if (!c.destroyed) c.write(line)
  }

  const ptys = new PtyManager()
  const sink: PtySink = {
    data: (id, data) => {
      const p = panes.get(id)
      if (!p) return ptys.ack(id, data.length)
      p.history = (p.history + data).slice(-HISTORY_MAX)
      p.term.write(data, () => ptys.ack(id, data.length))
      broadcast({ event: 'output', pane: id, data })
      p.tracker.output()
    },
    exit: (id, code) => {
      const p = panes.get(id)
      if (!p) return
      update(p, { pid: undefined, exitCode: code })
      p.tracker.exit(code)
    },
    closed: () => false
  }

  /** panes whose pass of a repeat the user accepted (sldev accept) */
  const accepted = new Set<string>()

  function update(p: Pane, patch: Partial<PaneInfo>): void {
    const before = p.info.status
    p.info = patchMission(p.info, patch, Date.now()) as PaneInfo
    broadcast({ event: 'pane', pane: p.info })
    if (p.info.status !== before && (p.info.status === 'waiting' || p.info.status === 'ended')) void refreshStats(p)
    // a pass of a repeat is over when its pane is: the agent exited (print mode), or you accepted it
    if (p.info.repeat && isLive(before) && !isLive(p.info.status)) loops.ended(p.info.id, passOutcome(p.info), p.info.report?.trim() || p.info.lastMessage?.trim())
    const done: Waiter[] = []
    for (const w of waiters) if ((!w.pane || w.pane === p.info.id) && w.states.includes(p.info.status)) done.push(w)
    if (done.length) {
      waiters = waiters.filter((w) => !done.includes(w))
      for (const w of done) w.resolve(p.info)
    }
  }

  async function refreshStats(p: Pane): Promise<void> {
    const base = p.info.worktree?.base ?? p.info.baseCommit
    if (!base) return
    const stats = await diffStat(p.info.cwd, base).catch(() => undefined)
    if (stats && panes.has(p.info.id)) update(p, { stats })
  }

  function passOutcome(info: PaneInfo): PassOutcome {
    if (accepted.delete(info.id)) return 'done'
    if (info.limited) return 'limited'
    if (info.repeat?.accept || wasInterrupted(info.exitCode)) return 'stopped'
    return info.status === 'failed' ? 'failed' : 'done'
  }

  const loops = new Loops({
    // every pass prints and exits unless the loop waits for sldev accept
    start: (args, pass) => newPane({ ...args, brief: pass.brief, title: pass.title, print: !pass.repeat.accept }, pass),
    notify: (title, body) => {
      broadcast({ event: 'notify', pane: '', title, body })
      notify(title, body)
    },
    changed: (loop) => broadcast({ event: 'loop', loop })
  })

  const hook: HookInfo = await startHookServer({
    dir,
    node: o.node ?? process.execPath,
    onHook: (e) => panes.get(e.mission)?.tracker.hook(e),
    mcp: { missions: () => [...panes.values()].map((p) => p.info), send: (e) => panes.get(e.mission)?.tracker.mcp(e) }
  })

  function spawnPane(s: PaneSpec): PaneInfo {
    const id = String(nextId++)
    const now = Date.now()
    const info: PaneInfo = {
      id,
      title: s.title,
      prompt: s.prompt,
      brief: s.brief,
      root: s.root,
      cwd: s.cwd,
      worktree: s.worktree,
      options: { ...s.options, agent: s.agent.id },
      kind: s.kind,
      parent: s.parent,
      repeat: s.repeat,
      status: 'starting',
      createdAt: now,
      updatedAt: now,
      history: pushStatus(undefined, 'starting', now),
      agentName: s.agent.name,
      failover: s.failover?.length ? s.failover : undefined
    }
    const term = createTerm(s.cols, s.rows, { bell: () => pane.tracker.attention(), notify: (text) => pane.tracker.attention(text) })
    const pane: Pane = {
      info,
      agent: s.agent,
      term,
      history: '',
      tracker: new Tracker({
        agent: s.agent,
        get: () => pane.info,
        update: (patch) => update(pane, patch),
        notify: (title, body) => {
          broadcast({ event: 'notify', pane: id, title, body })
          if (![...focused.values()].includes(id)) notify(title, body)
        },
        limited: (line) => void failover(pane, line),
        screen: termScreen(term)
      })
    }
    panes.set(id, pane)
    const prompt = launchPrompt(id, s.prompt)
    const argv = agentCommand(s.agent, s.options, prompt, s.title, { settingsPath: hook.settingsPath, mcp: s.agent.mcpArgs ? sldevMcp(hook.mcp, id) : undefined })
    const env = { SLDEV_MISSION_ID: id, SLDEV_HOOK_PORT: String(hook.port), SLDEV_HOOK_TOKEN: hook.token }
    try {
      const { pid } = ptys.create(sink, id, { cwd: s.cwd, command: argv, cols: s.cols, rows: s.rows, env })
      pane.info = { ...pane.info, pid }
    } catch (err) {
      panes.delete(id)
      pane.tracker.dispose()
      throw new Error(`Could not start ${s.agent.name}: ${(err as Error).message}`)
    }
    broadcast({ event: 'pane', pane: pane.info })
    return pane.info
  }

  function launchPrompt(id: string, prompt: string): string {
    if (prompt.length <= MAX_INLINE_PROMPT) return prompt
    // a brief too long for a command line is handed over as a file the agent reads
    const briefs = join(dir, 'briefs')
    mkdirSync(briefs, { recursive: true, mode: 0o700 })
    const file = join(briefs, `${process.pid}-${id}.md`)
    void fsp.writeFile(file, prompt)
    return `Your task is in ${file} (it was too long to pass on the command line). Read the whole file first, then do what it says.`
  }

  function agentFor(id: string | undefined): AgentDef {
    const a = findAgent(id, custom)
    if (id && a.id !== id) throw new Error(`Unknown agent "${id}". Known: ${agents.map((x) => x.id).join(', ')}`)
    if (!installedBin(a)) throw new Error(`${a.name} isn't installed${a.install ? ` (${a.install})` : ''}`)
    return a
  }

  /** A repeat: the loop starts its first pass (and the rest) through newPane, with the pass's brief and folder. */
  async function newLoop(a: NewPaneArgs): Promise<PaneInfo> {
    const plan = a.repeat!
    if (!a.brief.trim()) throw new Error('A repeat needs a brief')
    agentFor(a.agent)
    const name = a.title?.trim() || a.brief.trim().split('\n')[0].slice(0, 50)
    return loops.create({ name, brief: a.brief, plan, args: { ...a, repeat: undefined } })
  }

  async function newPane(a: NewPaneArgs, pass?: PassStart): Promise<PaneInfo> {
    if (a.repeat && !pass) return newLoop(a)
    const agent = agentFor(a.agent)
    if (!a.brief.trim() && a.kind) throw new Error('A mission kind needs a brief')
    const repo = await isRepo(a.cwd)
    const root = repo ? (await run('git', ['rev-parse', '--show-toplevel'], a.cwd)).stdout.trim() || a.cwd : a.cwd
    const kinds: MissionKind[] = [...BUILTIN_KINDS, ...(await listKinds(root, o.dataDir))]
    const kind = a.kind ? kinds.find((k) => k.id === a.kind || k.name.toLowerCase() === a.kind!.toLowerCase()) : undefined
    if (a.kind && !kind) throw new Error(`Unknown mission kind "${a.kind}". Known: ${kinds.map((k) => k.id).join(', ')}`)
    const title = a.title?.trim() || a.brief.trim().split('\n')[0].slice(0, 60) || `${agent.name} session`
    // without a kind the brief goes exactly as written, like Freeform in the app
    let prompt = a.brief
    if (kind && kind.id !== 'freeform') {
      prompt = missionPrompt({ title, brief: a.brief }, kind)
      prompt = withMemory(prompt, await contextLines(root, agent, a.brief))
    }
    let cwd = pass?.cwd ?? a.cwd
    let worktree: Mission['worktree'] = pass?.cwd ? pass.worktree : undefined
    const wantsTree = !pass?.cwd && (typeof a.worktree === 'string' || (a.worktree === undefined && (kind?.worktree ?? false)))
    if (wantsTree && repo) {
      const base = (await gitBranch(root)) || 'HEAD'
      worktree = await addWorktree(root, a.worktree ? cleanBranchName(a.worktree) : branchName(a.brief || title), base)
      cwd = worktree.path
    } else if (wantsTree && typeof a.worktree === 'string') throw new Error(`${a.cwd} is not a git repository, so it can't have a worktree`)
    const order = a.failover ?? (settings.failoverAuto ? settings.failoverOrder : undefined)
    const info = spawnPane({
      agent,
      prompt,
      brief: a.brief,
      title,
      root,
      cwd,
      worktree,
      kind: kind && { id: kind.id, name: kind.name, readOnly: kind.readOnly },
      // print mode has nobody to approve a tool call: the unattended mode, as for the app's factory stages
      options: { model: a.model, effort: a.effort, print: a.print || undefined, permissionMode: a.mode ?? (kind?.readOnly ? agent.readOnlyMode : a.print ? stageMode(agent, settings.factoryModes) : undefined) },
      repeat: pass?.repeat,
      // a pass that hits the limit ends its loop; handing it to another agent would run outside the loop
      failover: pass ? undefined : order?.filter((x) => x !== agent.id),
      cols: a.cols ?? 120,
      rows: a.rows ?? 40
    })
    if (!worktree && repo && !pass?.cwd) {
      const base = await head(cwd)
      const p = panes.get(info.id)
      if (p && base) update(p, { baseCommit: base })
    }
    return panes.get(info.id)?.info ?? info
  }

  async function contextLines(root: string, agent: AgentDef, brief: string): Promise<string> {
    const [mem, hits] = await Promise.all([memoryInfo(root).catch(() => null), brief.trim() ? search(root, brief, CONTEXT_HITS).catch(() => []) : Promise.resolve([])])
    if (!mem) return ''
    return contextPointer(hits, root, { memoryPath: mem.path, memoryExists: mem.exists, tools: !!agent.mcpArgs })
  }

  /** The same work continues on the next agent in the pane's failover list, in the same folder. */
  async function failover(p: Pane, line: string): Promise<void> {
    const order = p.info.failover ?? []
    const to = nextAgent(order, p.agent.id, (id) => !!installedBin(findAgent(id, custom)) && findAgent(id, custom).id === id)
    if (!to) {
      notify(`${p.info.title}: ${p.agent.name} hit its usage limit`, line)
      return
    }
    const agent = findAgent(to, custom)
    const next = spawnPane({
      agent,
      prompt: failoverBrief(p.info, p.agent.name, termScreen(p.term).tail(TAIL_ROWS), p.agent.usageLimit),
      brief: p.info.brief,
      title: p.info.title,
      root: p.info.root,
      cwd: p.info.cwd,
      worktree: p.info.worktree,
      kind: p.info.kind,
      options: { permissionMode: p.info.kind?.readOnly ? agent.readOnlyMode : undefined },
      parent: { id: p.info.id, kind: 'failover' },
      failover: order.filter((x) => x !== to),
      cols: p.term.cols,
      rows: p.term.rows
    })
    update(p, { continuedBy: next.id, notification: `${p.agent.name} hit its usage limit; continued on ${agent.name} in pane ${next.id}` })
    notify(`${p.info.title}: continued on ${agent.name}`, `${p.agent.name} hit its usage limit`)
  }

  function review(paneId: string, agentId: string): PaneInfo {
    const p = paneFor(paneId)
    const agent = agentFor(agentId)
    const base = p.info.worktree?.base ?? p.info.baseCommit ?? 'HEAD'
    return spawnPane({
      agent,
      prompt: secondOpinionBrief(p.info, p.agent.name, base),
      title: `Review: ${p.info.title}`.slice(0, 80),
      root: p.info.root,
      cwd: p.info.cwd,
      options: { permissionMode: agent.readOnlyMode },
      kind: { id: 'review', name: 'Review', readOnly: true },
      parent: { id: p.info.id, kind: 'second-opinion' },
      cols: p.term.cols,
      rows: p.term.rows
    })
  }

  function paneFor(id: string): Pane {
    const p = panes.get(id) ?? [...panes.values()].find((x) => x.info.title === id)
    if (!p) throw new Error(`No pane "${id}". See sldev ls.`)
    return p
  }

  function wait(a: Requests['wait'][0]): Promise<PaneInfo | null> {
    const states = WAIT_STATES[a.for]
    if (!states) throw new Error('wait for ready, needs-you, done or idle')
    const id = a.pane ? paneFor(a.pane).info.id : undefined
    const now = id ? [panes.get(id)!] : [...panes.values()]
    const hit = now.find((p) => states.includes(p.info.status))
    if (hit) return Promise.resolve(hit.info)
    if (!id && !panes.size) throw new Error('No panes to wait for')
    return new Promise((resolve) => {
      const w: Waiter = { pane: id, states, resolve }
      waiters.push(w)
      if (a.timeout && a.timeout > 0)
        setTimeout(() => {
          if (!waiters.includes(w)) return
          waiters = waiters.filter((x) => x !== w)
          resolve(null)
        }, a.timeout * 1000)
    })
  }

  const handlers: { [C in Command]: (args: Requests[C][0], client: Socket) => Requests[C][1] | Promise<Requests[C][1]> } = {
    ping: () => ({ version: VERSION, pid: process.pid }),
    ls: () => [...panes.values()].map((p) => p.info),
    new: (a) => newPane(a),
    send: (a) => {
      const p = paneFor(a.pane)
      if (p.info.pid === undefined) throw new Error(`Pane ${p.info.id} has exited`)
      p.tracker.input()
      ptys.write(p.info.id, a.text)
      // the Enter goes on its own: a TUI may take a pasted newline as part of the text
      if (a.enter !== false) setTimeout(() => ptys.write(p.info.id, '\r'), 50)
      if (a.enter !== false && (p.info.status === 'waiting' || p.info.status === 'needs-input')) update(p, { status: 'working', notification: undefined, activityAt: Date.now() })
      return null
    },
    read: (a) => ({ text: screenText(paneFor(a.pane).term, Math.max(1, Math.min(a.lines ?? 60, 5000))) }),
    wait: (a) => wait(a),
    kill: (a) => {
      const p = paneFor(a.pane)
      ptys.kill(p.info.id)
      p.tracker.dispose()
      panes.delete(p.info.id)
      broadcast({ event: 'closed', pane: p.info.id })
      if (p.info.repeat && isLive(p.info.status)) loops.ended(p.info.id, 'stopped')
      return null
    },
    review: (a) => review(a.pane, a.agent),
    accept: (a) => {
      const p = paneFor(a.pane)
      if (!p.info.repeat?.accept) throw new Error(`Pane ${p.info.id} isn't a pass that waits for you (sldev new --repeat … --accept)`)
      if (!isLive(p.info.status)) throw new Error(`Pane ${p.info.id} is already over`)
      accepted.add(p.info.id)
      // a killed pty reports no exit: the pane ends here, and with it the pass
      ptys.kill(p.info.id)
      p.tracker.dispose()
      update(p, { pid: undefined, status: 'ended' })
      return null
    },
    loops: () => loops.list(),
    'loop-stop': (a) => loops.stop(a.loop),
    attach: (_a, c) => {
      clients.add(c)
      focused.set(c, null)
      return [...panes.values()].map((p) => p.info)
    },
    input: (a) => {
      const p = paneFor(a.pane)
      p.tracker.input()
      ptys.write(p.info.id, a.data)
      return null
    },
    resize: (a) => {
      const p = paneFor(a.pane)
      const cols = Math.max(20, Math.min(500, Math.floor(a.cols)))
      const rows = Math.max(5, Math.min(300, Math.floor(a.rows)))
      if (cols === p.term.cols && rows === p.term.rows) return null
      p.term.resize(cols, rows)
      ptys.resize(p.info.id, cols, rows)
      return null
    },
    focus: (a, c) => {
      focused.set(c, a.pane)
      return null
    },
    screen: (a) => ({ data: paneFor(a.pane).history }),
    stop: () => {
      setTimeout(() => void close().then(() => process.exit(0)), 20)
      return null
    }
  }

  const server: Server = createServer((c) => {
    c.on(
      'data',
      lineReader((m) => {
        const r = m as Request
        if (typeof r?.id !== 'number' || typeof r.cmd !== 'string' || !(r.cmd in handlers)) return
        const reply = (res: Response): void => void (!c.destroyed && c.write(JSON.stringify(res) + '\n'))
        Promise.resolve()
          .then(() => (handlers[r.cmd] as (a: unknown, c: Socket) => unknown)(r.args ?? {}, c))
          .then(
            (result) => reply({ id: r.id, ok: true, result: result ?? null }),
            (err: Error) => reply({ id: r.id, ok: false, error: err?.message ?? String(err) })
          )
      })
    )
    const drop = (): void => {
      clients.delete(c)
      focused.delete(c)
    }
    c.on('close', drop)
    c.on('error', drop)
  })
  // the socket is created owner-only (umask), not chmodded after: no moment where others could connect
  const mask = process.platform === 'win32' ? undefined : process.umask(0o077)
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socket, () => resolve())
    })
  } finally {
    if (mask !== undefined) process.umask(mask)
  }
  if (process.platform !== 'win32') chmodSync(socket, 0o600)

  let closed = false
  async function close(): Promise<void> {
    if (closed) return
    closed = true
    for (const p of panes.values()) p.tracker.dispose()
    loops.dispose()
    ptys.killAll()
    panes.clear()
    for (const w of waiters) w.resolve(null)
    waiters = []
    for (const c of clients) c.destroy()
    stopHookServer()
    closeContext()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (process.platform !== 'win32' && existsSync(socket)) unlinkSync(socket)
  }

  return { socket, close }
}

const isLive = (s: Mission['status']): boolean => s === 'starting' || s === 'working' || s === 'waiting' || s === 'needs-input'

function readSettings(dataDir: string): Partial<AppSettings> {
  try {
    return JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')) as Partial<AppSettings>
  } catch {
    return {}
  }
}

/**
 * A live daemon means this one doesn't start; a socket file left by one that died is removed. Windows named
 * pipes leave no file behind, so there it's only the "already running" check.
 */
async function claimSocket(socket: string): Promise<void> {
  const win = process.platform === 'win32'
  if (!win && !existsSync(socket)) return
  const alive = await new Promise<boolean>((resolve) => {
    const c = createConnection(socket)
    c.once('connect', () => (c.destroy(), resolve(true)))
    c.once('error', () => resolve(false))
  })
  if (alive) throw new Error(`sldev is already running (${socket})`)
  if (!win) unlinkSync(socket)
}
