import { randomBytes } from 'crypto'
import { chmodSync, existsSync, mkdirSync, promises as fsp, readFileSync, unlinkSync } from 'fs'
import { createConnection, createServer, type Server, type Socket } from 'net'
import { basename, join, resolve } from 'path'
import { agentCommand, allAgents, findAgent, installedBin, setInstalledBins, sldevMcp, stageMode, type AgentDef } from '@shared/agents'
import { branchName, cleanBranchName } from '@shared/branch'
import { contextPointer } from '@shared/context'
import { failoverBrief, nextAgent, TAIL_ROWS } from '@shared/failover'
import { patchMission, pushStatus } from '@shared/missionHistory'
import type { MissionKind } from '@shared/missionKinds'
import { missionPrompt, secondOpinionBrief } from '@shared/missionPrompt'
import { withMemory } from '@shared/memory'
import type { PassOutcome } from '@shared/repeat'
import { wasInterrupted } from '@shared/status'
import type { CustomAgent, Mission } from '@shared/types'
import { defaultShell, PtyManager, type PtySink } from '../../src/main/pty'
import { startHookServer, stopHookServer, type HookInfo } from '../../src/main/hooks'
import { findOnPath } from '../../src/main/launch'
import { addWorktree, diffStat, gitBranch, head, isRepo, run } from '../../src/main/git'
import { memoryInfo } from '../../src/main/memory'
import { closeContext, initContext, search } from '../../src/main/context'
import { lineReader, MAX_SPAWN, WAIT_STATES, type Command, type DaemonEvent, type NewPaneArgs, type PaneInfo, type PaneOrigin, type Request, type Requests, type Response, type TabState } from './protocol'
import { createTerm, screenText, snapshot, termScreen, type Term } from './screen'
import { Tracker } from './tracker'
import { Loops, type PassStart } from './loops'
import { desktopNotify } from './notify'
import { readConfig } from './config'
import { cliKinds, cliRoot } from './briefs'
import { socketPath } from './paths'
import { isLive, readSessions, restorePlan, sessionWriter } from './sessions'
import { VERSION } from './version'

/**
 * `sldev serve`: owns the agent ptys, a headless screen per pane, the hook and MCP loopback server and the
 * socket the commands and the TUI talk to. Panes outlive the clients, so detaching never stops an agent.
 */

interface Pane {
  info: PaneInfo
  /** null for a plain shell tab */
  agent: AgentDef | null
  term: Term
  /** an agent's status; a shell has none */
  tracker?: Tracker
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
  criteria?: string
  title: string
  root: string
  cwd: string
  worktree?: Mission['worktree']
  options: Mission['options']
  kind?: Mission['kind']
  parent?: Mission['parent']
  repeat?: Mission['repeat']
  failover?: string[]
  allowSpawn?: number
  spawned?: number
  spawnedBy?: string
  cols: number
  rows: number
}

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
  /** given to every agent pane as SLDEV_CLI_DAEMON: a request naming it comes from one of this daemon's panes */
  instance: string
  close: () => Promise<void>
}

export async function startDaemon(o: DaemonOptions): Promise<Daemon> {
  const dir = o.dataDir
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const socket = socketPath(dir)
  await claimSocket(socket)

  const settings = readConfig(o.dataDir)
  const custom: CustomAgent[] = settings.customAgents ?? []
  const agents = allAgents(custom)
  setInstalledBins(agents.flatMap((a) => [a.bin, ...(a.aliases ?? [])]).filter((b) => b && findOnPath(b, process.env)))
  initContext(o.dataDir)

  const panes = new Map<string, Pane>()
  const clients = new Set<Socket>()
  const focused = new Map<Socket, string | null>()
  let waiters: Waiter[] = []
  let nextId = 1
  /** the TUI's tabs: their order, the one in front and the split, so attaching again finds them as they were */
  const tabs: TabState = { order: [], active: null, split: false }
  const notify = o.notify ?? desktopNotify
  const instance = randomBytes(16).toString('hex')

  const saved = sessionWriter(dir, () => ({ version: 1, nextId, tabs: { ...tabs, order: [...tabs.order] }, panes: [...panes.values()].map((p) => p.info) }))

  const broadcast = (e: DaemonEvent): void => {
    const line = JSON.stringify(e) + '\n'
    for (const c of clients) if (!c.destroyed) c.write(line)
    // a pane, its status or its tab changed: the file follows (output alone changes nothing that's saved)
    if (e.event !== 'output') saved.schedule()
  }

  const ptys = new PtyManager()
  const sink: PtySink = {
    data: (id, data) => {
      const p = panes.get(id)
      if (!p) return ptys.ack(id, data.length)
      p.term.write(data, () => ptys.ack(id, data.length))
      broadcast({ event: 'output', pane: id, data })
      p.tracker?.output()
    },
    exit: (id, code) => {
      const p = panes.get(id)
      if (!p) return
      if (!p.tracker) {
        // a shell that exits (`exit`, Ctrl-d) closes its tab, like a terminal's
        update(p, { pid: undefined, exitCode: code, status: 'ended' })
        return removePane(p)
      }
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
    for (const w of waiters) if ((w.pane ? w.pane === p.info.id : !p.info.shell) && w.states.includes(p.info.status)) done.push(w)
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
    onHook: (e) => panes.get(e.mission)?.tracker?.hook(e),
    // shell tabs aren't missions: agents don't see them through the sldev tools
    mcp: { missions: () => agentPanes().map((p) => p.info), send: (e) => panes.get(e.mission)?.tracker?.mcp(e) }
  })

  const agentPanes = (): Pane[] => [...panes.values()].filter((p) => !p.info.shell)

  /** a pane joins the tab bar at the end */
  function addTab(id: string): void {
    tabs.order.push(id)
    tabs.active ??= id
  }

  function removePane(p: Pane): void {
    ptys.kill(p.info.id)
    p.tracker?.dispose()
    panes.delete(p.info.id)
    const at = tabs.order.indexOf(p.info.id)
    tabs.order = tabs.order.filter((x) => x !== p.info.id)
    if (tabs.active === p.info.id) tabs.active = tabs.order[Math.min(Math.max(0, at), tabs.order.length - 1)] ?? null
    broadcast({ event: 'closed', pane: p.info.id })
  }

  /** A plain shell in its own tab: the user's $SHELL (Windows: PowerShell), through the same pty code as the agents. */
  async function newShell(a: NewPaneArgs, restored?: PaneInfo): Promise<PaneInfo> {
    const id = restored?.id ?? String(nextId++)
    const now = Date.now()
    const repo = await isRepo(a.cwd)
    const top = repo ? (await run('git', ['rev-parse', '--show-toplevel'], a.cwd)).stdout.trim() : ''
    const name = basename(defaultShell().shell).replace(/\.exe$/i, '')
    const info: PaneInfo = {
      id,
      title: a.title?.trim() || name,
      prompt: '',
      root: top ? resolve(top) : a.cwd,
      cwd: a.cwd,
      options: { agent: 'shell' },
      // a live shell counts as waiting for you: sldev clean leaves its folder alone, and wait doesn't hang on it
      status: 'waiting',
      createdAt: now,
      updatedAt: now,
      agentName: name,
      shell: true,
      ...(restored && { createdAt: restored.createdAt })
    }
    const pane: Pane = { info, agent: null, term: createTerm(a.cols ?? 120, a.rows ?? 40) }
    panes.set(id, pane)
    try {
      const { pid } = ptys.create(sink, id, { cwd: a.cwd, cols: a.cols ?? 120, rows: a.rows ?? 40 })
      pane.info = { ...pane.info, pid }
    } catch (err) {
      panes.delete(id)
      throw new Error(`Could not start a shell: ${(err as Error).message}`)
    }
    if (!restored) addTab(id)
    broadcast({ event: 'pane', pane: pane.info })
    return pane.info
  }

  /** `restored`: a pane from before the daemon restarted, which comes back with its id and resumes its agent's session */
  function spawnPane(s: PaneSpec, restored?: { info: PaneInfo; resume: string | true }): PaneInfo {
    const id = restored?.info.id ?? String(nextId++)
    const now = Date.now()
    const fresh: PaneInfo = {
      id,
      title: s.title,
      prompt: s.prompt,
      brief: s.brief,
      criteria: s.criteria,
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
      failover: s.failover?.length ? s.failover : undefined,
      allowSpawn: s.allowSpawn,
      spawned: s.spawned,
      spawnedBy: s.spawnedBy
    }
    const info: PaneInfo = restored
      ? {
          ...restored.info,
          pid: undefined,
          exitCode: undefined,
          status: 'starting',
          notification: 'Resumed after sldev restarted',
          updatedAt: now,
          history: pushStatus(restored.info.history, 'starting', now)
        }
      : fresh
    const term = createTerm(s.cols, s.rows, { bell: () => pane.tracker?.attention(), notify: (text) => pane.tracker?.attention(text) })
    const pane: Pane = {
      info,
      agent: s.agent,
      term,
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
    const mcp = s.agent.mcpArgs ? sldevMcp(hook.mcp, id) : undefined
    // a resumed session already has its prompt: it's never sent twice
    const argv = restored
      ? agentCommand(s.agent, s.options, undefined, s.title, { settingsPath: hook.settingsPath, resume: restored.resume, mcp })
      : agentCommand(s.agent, s.options, launchPrompt(id, s.prompt), s.title, { settingsPath: hook.settingsPath, mcp })
    const env = { SLDEV_MISSION_ID: id, SLDEV_CLI_DAEMON: instance, SLDEV_HOOK_PORT: String(hook.port), SLDEV_HOOK_TOKEN: hook.token, ...(s.spawnedBy ? noPushEnv(process.env) : {}) }
    try {
      const { pid } = ptys.create(sink, id, { cwd: s.cwd, command: argv, cols: s.cols, rows: s.rows, env })
      pane.info = { ...pane.info, pid }
    } catch (err) {
      panes.delete(id)
      pane.tracker?.dispose()
      throw new Error(`Could not start ${s.agent.name}: ${(err as Error).message}`)
    }
    if (!restored) addTab(id)
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

  /**
   * `parent`: the pane whose agent asked (sldev new from inside it, already allowed by spawnChild). Its child
   * always gets a worktree and print mode, has no failover and can't start agents of its own.
   */
  async function newPane(a: NewPaneArgs, pass?: PassStart, parent?: Pane): Promise<PaneInfo> {
    if (a.shell) return newShell(a)
    if (a.repeat && !pass) return newLoop(a)
    const allowSpawn = parent ? undefined : spawnLimit(a.allowSpawn)
    const agent = agentFor(a.agent)
    if (!a.brief.trim() && a.kind) throw new Error('A mission kind needs a brief')
    const repo = await isRepo(a.cwd)
    // git prints C:/forward/slashes on Windows: resolve() gives the platform's own form
    const top = repo ? (await run('git', ['rev-parse', '--show-toplevel'], a.cwd)).stdout.trim() : ''
    const root = top ? resolve(top) : a.cwd
    // the CLI's project kinds are in .sldev-cli/kinds of the main checkout, also for a pane started in a worktree
    const kinds: MissionKind[] = await cliKinds(await cliRoot(a.cwd), o.dataDir)
    const kind = a.kind ? kinds.find((k) => k.id === a.kind || k.name.toLowerCase() === a.kind!.toLowerCase()) : undefined
    if (a.kind && !kind) throw new Error(`Unknown mission kind "${a.kind}". Known: ${kinds.map((k) => k.id).join(', ')}`)
    if (a.criteria?.trim() && (!kind || kind.id === 'freeform')) throw new Error('Acceptance criteria go into a mission kind\'s prompt: add --kind (not freeform, which sends the brief exactly as written)')
    const title = a.title?.trim() || a.brief.trim().split('\n')[0].slice(0, 60) || `${agent.name} session`
    // without a kind the brief goes exactly as written, like Freeform in the app
    let prompt = a.brief
    if (kind && kind.id !== 'freeform') {
      prompt = missionPrompt({ title, brief: a.brief, criteria: a.criteria?.trim() || undefined }, kind)
      prompt = withMemory(prompt, await contextLines(root, agent, a.brief))
    }
    let cwd = pass?.cwd ?? a.cwd
    let worktree: Mission['worktree'] = pass?.cwd ? pass.worktree : undefined
    const wantsTree = !pass?.cwd && (!!parent || typeof a.worktree === 'string' || (a.worktree === undefined && (kind?.worktree ?? false)))
    if (parent && !repo) throw new Error(`${a.cwd} is not a git repository: an agent started from inside a pane needs a worktree of its own`)
    if (wantsTree && repo) {
      const base = (await gitBranch(root)) || 'HEAD'
      worktree = await addWorktree(root, a.worktree ? cleanBranchName(a.worktree) : branchName(a.brief || title), base)
      cwd = worktree.path
    } else if (wantsTree && typeof a.worktree === 'string') throw new Error(`${a.cwd} is not a git repository, so it can't have a worktree`)
    const order = parent ? undefined : a.failover ?? (settings.failoverAuto ? settings.failoverOrder : undefined)
    const print = a.print || !!parent
    const info = spawnPane({
      agent,
      prompt,
      brief: a.brief,
      criteria: a.criteria?.trim() || undefined,
      title,
      root,
      cwd,
      worktree,
      kind: kind && { id: kind.id, name: kind.name, readOnly: kind.readOnly },
      // print mode has nobody to approve a tool call: the unattended mode, as for the app's factory stages
      options: { model: a.model, effort: a.effort, print: print || undefined, permissionMode: a.mode ?? (kind?.readOnly ? agent.readOnlyMode : print ? stageMode(agent, settings.unattendedModes) : undefined) },
      repeat: pass?.repeat,
      // a pass that hits the limit ends its loop; handing it to another agent would run outside the loop
      failover: pass ? undefined : order?.filter((x) => x !== agent.id),
      allowSpawn,
      spawnedBy: parent?.info.id,
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
    if (!p.agent) return
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
      // the same work goes on: so does what's left of its budget for starting agents, and its children stay its own
      allowSpawn: p.info.allowSpawn,
      spawned: p.info.spawned,
      cols: p.term.cols,
      rows: p.term.rows
    })
    update(p, { continuedBy: next.id, notification: `${p.agent.name} hit its usage limit; continued on ${agent.name} in pane ${next.id}` })
    notify(`${p.info.title}: continued on ${agent.name}`, `${p.agent.name} hit its usage limit`)
  }

  function review(paneId: string, agentId: string): PaneInfo {
    const p = paneFor(paneId)
    if (!p.agent) throw new Error(`Pane ${p.info.id} is a shell, not an agent: there are no changes of its own to review`)
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
    // without a pane it waits for an agent: a shell tab is always "waiting"
    const now = id ? [panes.get(id)!] : agentPanes()
    const hit = now.find((p) => states.includes(p.info.status))
    if (hit) return Promise.resolve(hit.info)
    if (!id && !now.length) throw new Error('No agent panes to wait for')
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

  /**
   * sldev new from inside a pane: allowed only when the person started that pane with --allow-spawn <n>, at most
   * n times over its life, never from a pane an agent started, and always in a worktree (no --here, no shell
   * tab, no repeat). The count is taken before the start, so two at once can't both take the last place.
   */
  async function spawnChild(a: NewPaneArgs, caller: Pane): Promise<PaneInfo> {
    const id = caller.info.id
    if (caller.info.spawnedBy) throw new Error(`Pane ${id} was started by the agent in pane ${caller.info.spawnedBy}, so it can't start agents itself`)
    const limit = caller.info.allowSpawn ?? 0
    if (!limit)
      throw new Error(
        `Pane ${id} may not start agents: sldev new from inside a sldev pane is off unless the person starts that pane with --allow-spawn <n> (1-${MAX_SPAWN}), e.g. sldev new --allow-spawn 2 "…"`
      )
    if (a.allowSpawn !== undefined) throw new Error(`--allow-spawn can't be given from inside a pane: an agent another agent starts can't start agents`)
    if (a.shell) throw new Error(`Pane ${id} may start agents, not shell tabs`)
    if (a.repeat) throw new Error(`--repeat can't be started from inside a pane; ask the person to run it`)
    if (a.worktree === false) throw new Error(`--here is refused from inside a pane: an agent started there always gets a worktree of its own`)
    const used = caller.info.spawned ?? 0
    if (used >= limit) throw new Error(`Pane ${id} has started all ${limit} agent${limit === 1 ? '' : 's'} it may (--allow-spawn ${limit}); they count even after they end`)
    update(caller, { spawned: used + 1 })
    try {
      return await newPane(a, undefined, caller)
    } catch (err) {
      // a start that failed took no place
      if (panes.has(id)) update(caller, { spawned: Math.max(0, (caller.info.spawned ?? 1) - 1) })
      throw err
    }
  }

  /** a pane `target` whose agent `caller` started: directly, or the pane `caller` continues after a usage limit */
  function isChildOf(target: Pane, caller: Pane): boolean {
    const by = target.info.spawnedBy
    if (!by) return false
    const ids = [caller.info.id]
    for (let up = caller.info.parent; up?.kind === 'failover' && !ids.includes(up.id); up = panes.get(up.id)?.info.parent) ids.push(up.id)
    return ids.includes(by)
  }

  /** the panes `p`'s agent started that are still in the list */
  const childrenOf = (p: Pane): Pane[] => [...panes.values()].filter((x) => x !== p && isChildOf(x, p))

  /**
   * What a request from inside a pane may do: `ls`, `read`, `wait` and the like stay open; `send`, `kill` and
   * the other commands that act on one pane only on that pane's own children; `new` through spawnChild; and
   * nothing that drives the TUI, starts a review or stops the daemon. A request naming a pane that's gone is
   * refused the same way: it can't be told from one that lies.
   */
  function guard(cmd: Command, args: unknown, from: PaneOrigin): Pane | undefined {
    if (OPEN.has(cmd)) return undefined
    const caller = panes.get(from.pane)
    if (!caller || caller.info.shell) throw new Error(`sldev ${cmd} from inside a sldev pane: pane ${from.pane} isn't running any more`)
    if (cmd === 'new') return caller
    if (CHILD_ONLY.has(cmd)) {
      const target = paneFor(String((args as { pane?: unknown })?.pane ?? ''))
      if (!isChildOf(target, caller)) throw new Error(`From inside pane ${caller.info.id}, sldev ${cmd} works only on the agents that pane started; pane ${target.info.id} isn't one`)
      return caller
    }
    throw new Error(`sldev ${cmd} can't be run from inside a sldev pane; run it from your own terminal`)
  }

  const handlers: { [C in Command]: (args: Requests[C][0], client: Socket, caller?: Pane) => Requests[C][1] | Promise<Requests[C][1]> } = {
    ping: () => ({ version: VERSION, pid: process.pid }),
    ls: () => [...panes.values()].map((p) => p.info),
    new: (a, _c, caller) => (caller ? spawnChild(a, caller) : newPane(a)),
    send: (a) => {
      const p = paneFor(a.pane)
      if (p.info.pid === undefined) throw new Error(`Pane ${p.info.id} has exited`)
      p.tracker?.input()
      ptys.write(p.info.id, a.text)
      // the Enter goes on its own: a TUI may take a pasted newline as part of the text
      if (a.enter !== false) setTimeout(() => ptys.write(p.info.id, '\r'), 50)
      if (a.enter !== false && !p.info.shell && (p.info.status === 'waiting' || p.info.status === 'needs-input')) update(p, { status: 'working', notification: undefined, activityAt: Date.now() })
      return null
    },
    read: (a) => ({ text: screenText(paneFor(a.pane).term, Math.max(1, Math.min(a.lines ?? 60, 5000))) }),
    wait: (a) => wait(a),
    kill: (a) => {
      const p = paneFor(a.pane)
      const children = a.children ? childrenOf(p) : []
      for (const x of [p, ...children]) {
        removePane(x)
        if (x.info.repeat && isLive(x.info.status)) loops.ended(x.info.id, 'stopped')
      }
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
      p.tracker?.dispose()
      update(p, { pid: undefined, status: 'ended' })
      return null
    },
    loops: () => loops.list(),
    'loop-stop': (a) => loops.stop(a.loop),
    attach: (_a, c) => {
      clients.add(c)
      focused.set(c, null)
      return tabs.order.flatMap((id) => panes.get(id)?.info ?? [])
    },
    tabs: (a) => {
      if (Array.isArray(a.order)) {
        // a reordering of the panes that are there: unknown ids drop out, ones it left out keep their place at the end
        const known = a.order.filter((id, i) => panes.has(id) && a.order!.indexOf(id) === i)
        tabs.order = [...known, ...tabs.order.filter((id) => !known.includes(id))]
      }
      if (a.active !== undefined && (a.active === null || panes.has(a.active))) tabs.active = a.active
      if (typeof a.split === 'boolean') tabs.split = a.split
      saved.schedule()
      return { ...tabs, order: [...tabs.order] }
    },
    rename: (a) => {
      const p = paneFor(a.pane)
      const title = a.title?.trim().replace(/[\x00-\x1f]/g, ' ').slice(0, 80)
      if (!title) throw new Error('A tab needs a name')
      update(p, { title })
      return p.info
    },
    input: (a) => {
      const p = paneFor(a.pane)
      p.tracker?.input()
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
    screen: (a) => snapshot(paneFor(a.pane).term),
    stop: () => {
      // every agent stopped on purpose: the next daemon starts empty
      saved.forget()
      setTimeout(() => void close().then(() => process.exit(0)), 20)
      return null
    }
  }

  await restoreSessions()

  /**
   * The panes the last daemon left (a reboot, a crash, a killed process): shells reopen in their folder, agents
   * resume their own session in theirs, and the rest are listed as they were, with why. Nothing is sent again.
   */
  async function restoreSessions(): Promise<void> {
    const last = readSessions(dir)
    if (!last) return
    nextId = Math.max(nextId, last.nextId, ...last.panes.map((p) => Number(p.id) + 1).filter(Number.isFinite))
    const size = { cols: 120, rows: 40 }
    for (const info of last.panes) {
      const def = info.shell ? undefined : findAgent(info.options.agent, custom)
      const agent = def && def.id === info.options.agent && installedBin(def) ? def : undefined
      let plan = restorePlan(info, agent)
      try {
        if (plan.how === 'shell') await newShell({ shell: true, brief: '', cwd: info.cwd, title: info.title, ...size }, info)
        else if (plan.how === 'resume')
          spawnPane(
            { ...info, agent: agent!, prompt: info.prompt, options: info.options, ...size },
            { info, resume: plan.resume }
          )
      } catch (err) {
        plan = { how: 'ended', note: `Not resumed after sldev restarted: ${(err as Error).message}` }
      }
      if (plan.how !== 'ended') continue
      const wasLive = isLive(info.status)
      const pane: Pane = {
        info: { ...info, pid: undefined, ...(wasLive && { status: 'ended', updatedAt: Date.now() }), ...(plan.note && { notification: plan.note }) },
        agent: agent ?? null,
        term: createTerm(size.cols, size.rows)
      }
      if (plan.note) pane.term.write(`\x1b[2m${plan.note}\x1b[0m\r\n`)
      panes.set(info.id, pane)
    }
    tabs.order = [...last.tabs.order.filter((id) => panes.has(id)), ...[...panes.keys()].filter((id) => !last.tabs.order.includes(id))]
    tabs.active = last.tabs.active && panes.has(last.tabs.active) ? last.tabs.active : (tabs.order[0] ?? null)
    tabs.split = last.tabs.split
    saved.schedule()
  }

  const server: Server = createServer((c) => {
    c.on(
      'data',
      lineReader((m) => {
        const r = m as Request
        if (typeof r?.id !== 'number' || typeof r.cmd !== 'string') return
        const reply = (res: Response): void => void (!c.destroyed && c.write(JSON.stringify(res) + '\n'))
        // a command from a newer sldev gets an answer, never silence: a client waiting on it would hang
        if (!Object.hasOwn(handlers, r.cmd)) return reply({ id: r.id, ok: false, error: `sldev ${VERSION} doesn't know "${r.cmd}"` })
        // only a request that names this daemon's own instance comes from one of its panes; an app mission's doesn't
        const from = r.from && typeof r.from === 'object' && r.from.daemon === instance ? r.from : undefined
        Promise.resolve()
          .then(() => (handlers[r.cmd] as (a: unknown, c: Socket, caller?: Pane) => unknown)(r.args ?? {}, c, from ? guard(r.cmd, r.args ?? {}, from) : undefined))
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
    saved.end()
    for (const p of panes.values()) p.tracker?.dispose()
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

  return { socket, instance, close }
}

/** what a pane's agent may ask for about any pane */
export const OPEN = new Set<Command>(['ping', 'ls', 'read', 'wait', 'loops', 'screen', 'focus'])
/** what it may do only to the agents it started */
export const CHILD_ONLY = new Set<Command>(['send', 'kill', 'accept', 'input', 'resize', 'rename'])

/**
 * Git config, through the env, that makes every push from an agent another agent started fail (fetch and pull
 * still work): each remote's push URL is rewritten to a protocol git doesn't know. It comes after any
 * GIT_CONFIG_* the user already set. A guard against an unattended child pushing, not a sandbox.
 */
export function noPushEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const n = Number(env.GIT_CONFIG_COUNT)
  const at = Number.isInteger(n) && n > 0 ? n : 0
  return { GIT_CONFIG_COUNT: String(at + 1), [`GIT_CONFIG_KEY_${at}`]: 'url.sldev-child-pane-may-not-push::.pushInsteadOf', [`GIT_CONFIG_VALUE_${at}`]: '' }
}

/** --allow-spawn: a whole number from 1 to MAX_SPAWN, or nothing */
function spawnLimit(n: number | undefined): number | undefined {
  if (n === undefined || n === null) return undefined
  if (!Number.isInteger(n) || n < 1 || n > MAX_SPAWN) throw new Error(`--allow-spawn takes a number from 1 to ${MAX_SPAWN}`)
  return n
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
