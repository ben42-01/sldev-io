import { execFileSync, spawn } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, daemonEnv, type Client } from '../src/client'
import { paneOrigin } from '../src/protocol'
import { noPushEnv, startDaemon, type Daemon } from '../src/daemon'
import { removeTemp, useFakeAgents } from './fakePath'
import type { PaneInfo } from '../src/protocol'

/**
 * The daemon end to end against the e2e harness's fake CLIs (scripts/e2e/fakebin): no real agent runs.
 * The fake claude fires the hooks from --settings; the fake codex prints, goes quiet, then asks with a bell.
 */

const tmp = mkdtempSync(join(tmpdir(), 'sldev-cli-'))
const data = join(tmp, 'data')
const repo = join(tmp, 'repo')
let daemon: Daemon
let c: Client
const notes: string[] = []
let restorePath: () => void
/** shells the tests start: Windows keeps a folder locked until the process in it is really gone */
const shellPids: number[] = []
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

beforeAll(async () => {
  restorePath = useFakeAgents()
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src/app.js'), "console.log('hi')\n")
  const git = (...a: string[]): string => execFileSync('git', a, { cwd: repo, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
  daemon = await startDaemon({ dataDir: data, notify: (title) => notes.push(title) })
  c = await connect({ dataDir: data, script: '', start: false })
})

afterAll(async () => {
  c?.close()
  await daemon?.close()
  for (let i = 0; i < 100 && shellPids.some(alive); i++) await new Promise((r) => setTimeout(r, 100))
  restorePath()
  // Windows keeps a just-killed process's folder locked for a moment (EBUSY): retry instead of failing
  removeTemp(tmp)
})

const ls = async (id: string): Promise<PaneInfo> => (await c.request('ls', {})).find((p) => p.id === id)!

describe('sldev daemon', () => {
  it('answers ping and refuses a second daemon on the same socket', async () => {
    expect((await c.request('ping', {})).version).toMatch(/^\d+\.\d+\.\d+/)
    await expect(startDaemon({ dataDir: data })).rejects.toThrow(/already running/)
  })

  it('writes its runtime files straight into its own data folder', () => {
    expect(existsSync(join(data, 'claude-hooks.json'))).toBe(true)
    expect(existsSync(join(data, 'sldev-mcp.cjs'))).toBe(true)
    expect(existsSync(join(data, 'cli'))).toBe(false)
  })

  it('tracks Claude through its hooks, in a new worktree, with the kind’s prompt', async () => {
    const p = await c.request('new', { agent: 'claude', brief: 'Change the greeting', kind: 'build', worktree: 'feature/greeting', cwd: repo })
    expect(p.worktree?.branch).toBe('feature/greeting')
    expect(p.prompt).toContain('Change the greeting')
    expect(p.prompt).not.toBe('Change the greeting')
    const asked = await c.request('wait', { pane: p.id, for: 'needs-you', timeout: 15 })
    expect(asked?.notification).toContain('permission')
    const done = await c.request('wait', { pane: p.id, for: 'ready', timeout: 15 })
    expect(done?.report).toContain('Done!')
    // the fake claude edited the worktree, not the main checkout
    expect(readFileSync(join(p.cwd, 'src/app.js'), 'utf8')).toContain('hello from mission')
    expect(readFileSync(join(repo, 'src/app.js'), 'utf8')).toBe("console.log('hi')\n")
    // the diff stat comes from git a moment after the agent stops (slower on Windows, under a full run)
    let stats = (await ls(p.id)).stats
    for (let i = 0; !stats?.files && i < 50; i++) {
      await new Promise((r) => setTimeout(r, 200))
      stats = (await ls(p.id)).stats
    }
    expect(stats?.files).toBeGreaterThan(0)
    expect(notes).toContain('Change the greeting needs you')
  }, 40_000)

  it('watches Codex from its screen: working, ready, then needs-you at its prompt; send answers it', async () => {
    const p = await c.request('new', { agent: 'codex', brief: 'tidy up', cwd: repo })
    // without a kind the brief goes as written
    expect(p.prompt).toBe('tidy up')
    expect(p.worktree).toBeUndefined()
    expect(p.baseCommit ?? (await ls(p.id)).baseCommit).toMatch(/^[0-9a-f]{40}$/)
    expect((await c.request('wait', { pane: p.id, for: 'ready', timeout: 20 }))?.status).toBe('waiting')
    const asked = await c.request('wait', { pane: p.id, for: 'needs-you', timeout: 20 })
    expect(asked?.notification).toContain('rm -rf build')
    await c.request('send', { pane: p.id, text: 'n' })
    await new Promise((r) => setTimeout(r, 800))
    expect((await c.request('read', { pane: p.id, lines: 3 })).text).toContain('you said n')
  }, 60_000)

  it('hands the work to the next agent when one hits its usage limit', async () => {
    const p = await c.request('new', { agent: 'claude', brief: 'HIT_LIMIT finish the parser', cwd: repo, worktree: false, failover: ['codex'] })
    const next = await new Promise<PaneInfo>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no failover')), 15_000)
      const poll = setInterval(async () => {
        const all = await c.request('ls', {})
        const n = all.find((x) => x.parent?.id === p.id)
        if (n) {
          clearInterval(poll)
          clearTimeout(t)
          resolve(n)
        }
      }, 300)
    })
    expect(next.agentName).toBe('Codex')
    expect(next.parent?.kind).toBe('failover')
    expect(next.cwd).toBe(p.cwd)
    expect(next.prompt).toContain('stopped at its usage limit')
    expect(next.prompt).not.toMatch(/limit reached/)
    const prev = await ls(p.id)
    expect(prev.limited?.text).toMatch(/usage limit reached/)
    expect(prev.continuedBy).toBe(next.id)
  }, 30_000)

  it('starts a read-only second opinion on a pane’s changes', async () => {
    const first = (await c.request('ls', {}))[0]
    const r = await c.request('review', { pane: first.id, agent: 'codex' })
    expect(r.options.permissionMode).toBe('read-only')
    expect(r.prompt).toContain('Do not edit any files')
    expect(r.prompt).toContain(`git diff ${first.worktree?.base ?? first.baseCommit}`)
    expect(r.cwd).toBe(first.cwd)
  })

  it('refuses unknown agents, kinds and panes with a clear message', async () => {
    await expect(c.request('new', { agent: 'nope', brief: 'x', cwd: repo })).rejects.toThrow(/Unknown agent "nope"/)
    await expect(c.request('new', { agent: 'codex', brief: 'x', kind: 'nope', cwd: repo })).rejects.toThrow(/Unknown mission kind/)
    await expect(c.request('read', { pane: '999' })).rejects.toThrow(/No pane "999"/)
    await expect(c.request('wait', { pane: '1', for: 'soon' as never })).rejects.toThrow(/wait for/)
  })

  it('answers the sldev MCP tools for its panes, through the script agents start', async () => {
    const p = (await c.request('ls', {})).find((x) => x.agentName === 'Codex')!
    const rpc = (id: number, name: string, args: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
    const input = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      rpc(2, 'sldev_remember', { note: 'The fake codex rings the bell', paths: ['scripts/e2e/fakebin/codex'] }),
      rpc(3, 'sldev_missions', {}),
      rpc(4, 'sldev_status', { state: 'needs_input', message: 'Which file?' })
    ].join('\n')
    // async: the daemon runs in this process, so a sync spawn would block its replies
    const out = await new Promise<string>((resolve) => {
      const child = spawn(process.execPath, [join(data, 'sldev-mcp.cjs'), '--mission', p.id], { cwd: p.cwd })
      let text = ''
      child.stdout.on('data', (d) => (text += d))
      child.on('close', () => resolve(text))
      child.stdin.end(input + '\n')
    })
    // tool calls answer as they finish, so match replies by id
    const replies = Object.fromEntries(out.trim().split('\n').map((l) => JSON.parse(l)).map((r) => [r.id, r]))
    expect(replies[1].result.serverInfo.name).toBe('sldev')
    expect(replies[2].result.content[0].text).toBe('Saved to the project memory.')
    expect(readFileSync(join(repo, '.sldev/memory.md'), 'utf8')).toContain('The fake codex rings the bell (codex, mission "tidy up")')
    expect(replies[3].result.content[0].text).toContain('claude · waiting · feature/greeting')
    await new Promise((r) => setTimeout(r, 100))
    expect(await ls(p.id)).toMatchObject({ status: 'needs-input', notification: 'Which file?' })
  })

  it('kills a pane and tells attached clients', async () => {
    const watcher = await connect({ dataDir: data, script: '', start: false })
    const closed: string[] = []
    watcher.onEvent((e) => e.event === 'closed' && closed.push(e.pane))
    await watcher.request('attach', { cols: 80, rows: 24 })
    const p = (await c.request('ls', {}))[0]
    await c.request('kill', { pane: p.id })
    await new Promise((r) => setTimeout(r, 100))
    expect(closed).toEqual([p.id])
    expect((await c.request('ls', {})).some((x) => x.id === p.id)).toBe(false)
    watcher.close()
  })

  it('runs a plain shell in a tab: no mission status, not a mission for the tools or wait, and send/read/kill work', async () => {
    const shell = await c.request('new', { shell: true, brief: '', cwd: repo })
    // root comes from git, which on Windows gives the long form of an 8.3 temp path: only its folder name is compared
    expect(shell).toMatchObject({ shell: true, status: 'waiting', cwd: repo, prompt: '' })
    expect(basename(shell.root)).toBe(basename(repo))
    expect(shell.title).toBe(shell.agentName)
    expect(shell.pid).toBeGreaterThan(0)
    shellPids.push(shell.pid!)
    await c.request('send', { pane: shell.id, text: process.platform === 'win32' ? 'echo ("sldev-" + (40+2))' : 'echo sldev-$((40+2))' })
    let text = ''
    for (let i = 0; i < 50 && !text.includes('sldev-42'); i++) {
      await new Promise((r) => setTimeout(r, 100))
      text = (await c.request('read', { pane: shell.id })).text
    }
    expect(text).toContain('sldev-42')
    expect((await ls(shell.id)).status).toBe('waiting')
    // a second opinion needs an agent's changes
    await expect(c.request('review', { pane: shell.id, agent: 'codex' })).rejects.toThrow(/is a shell/)
    // wait without a pane is about agents: the shell's "waiting" doesn't answer it
    const agents = (await c.request('ls', {})).filter((p) => !p.shell)
    const idle = await c.request('wait', { for: 'idle', timeout: 1 })
    if (idle) expect(agents.map((p) => p.id)).toContain(idle.id)

    // exiting the shell closes its tab
    const watcher = await connect({ dataDir: data, script: '', start: false })
    const closed: string[] = []
    watcher.onEvent((e) => e.event === 'closed' && closed.push(e.pane))
    await watcher.request('attach', { cols: 80, rows: 24 })
    await c.request('send', { pane: shell.id, text: 'exit' })
    for (let i = 0; i < 50 && !closed.length; i++) await new Promise((r) => setTimeout(r, 100))
    expect(closed).toEqual([shell.id])
    expect((await c.request('ls', {})).some((p) => p.id === shell.id)).toBe(false)
    watcher.close()
  }, 20_000)

  it('keeps the tab order, names, the active tab and the split for the next attach', async () => {
    const a = await c.request('new', { shell: true, brief: '', cwd: repo, title: 'one' })
    const b = await c.request('new', { shell: true, brief: '', cwd: repo })
    shellPids.push(a.pid!, b.pid!)
    let tabs = await c.request('tabs', {})
    expect(tabs.order.slice(-2)).toEqual([a.id, b.id])
    const all = tabs.order
    // a reorder of known panes; an unknown id drops out and the ones left out keep their place
    tabs = await c.request('tabs', { order: [b.id, '999', a.id], active: b.id, split: true })
    expect(tabs.order).toEqual([b.id, a.id, ...all.filter((id) => id !== a.id && id !== b.id)])
    expect(tabs).toMatchObject({ active: b.id, split: true })
    expect(await c.request('tabs', { active: '999' })).toMatchObject({ active: b.id })
    await expect(c.request('rename', { pane: b.id, title: '  ' })).rejects.toThrow(/needs a name/)
    expect((await c.request('rename', { pane: b.id, title: 'logs' })).title).toBe('logs')

    const again = await connect({ dataDir: data, script: '', start: false })
    const panes = await again.request('attach', { cols: 80, rows: 24 })
    expect(panes.map((p) => p.id)).toEqual(tabs.order)
    expect(panes[0].title).toBe('logs')
    again.close()

    // closing the active tab brings the one in its place to the front
    await c.request('kill', { pane: b.id })
    tabs = await c.request('tabs', {})
    expect(tabs.order).not.toContain(b.id)
    expect(tabs.active).toBe(a.id)
    await c.request('kill', { pane: a.id })
    await c.request('tabs', { split: false })
  }, 20_000)
})

describe('agents starting agents from inside a pane', () => {
  /** a client as the sldev an agent runs in pane `id` would be */
  const inside = async (id: string, daemonId = daemon.instance): Promise<Client> => {
    const x = await connect({ dataDir: data, script: '', start: false })
    x.from = { pane: id, daemon: daemonId }
    return x
  }
  const quiet = { agent: 'codex', cwd: repo } as const

  it('refuses sldev new from a pane started without --allow-spawn, and says how to allow it', async () => {
    const p = await c.request('new', { ...quiet, brief: 'plain', worktree: false })
    const x = await inside(p.id)
    await expect(x.request('new', { ...quiet, brief: 'more' })).rejects.toThrow(/--allow-spawn <n> \(1-8\)/)
    x.close()
    await c.request('kill', { pane: p.id })
  })

  it('takes --allow-spawn from 1 to 8 only', async () => {
    await expect(c.request('new', { ...quiet, brief: 'x', allowSpawn: 0 })).rejects.toThrow(/from 1 to 8/)
    await expect(c.request('new', { ...quiet, brief: 'x', allowSpawn: 9 })).rejects.toThrow(/from 1 to 8/)
    await expect(c.request('new', { ...quiet, brief: 'x', allowSpawn: 1.5 })).rejects.toThrow(/from 1 to 8/)
  })

  it('lets a pane start n children in print mode and worktrees, refuses the next, and children can’t spawn', async () => {
    const lead = await c.request('new', { ...quiet, brief: 'lead', worktree: false, allowSpawn: 2 })
    expect(lead.allowSpawn).toBe(2)
    const x = await inside(lead.id)
    // refusals that take no place
    await expect(x.request('new', { ...quiet, brief: 'here', worktree: false })).rejects.toThrow(/--here is refused/)
    await expect(x.request('new', { shell: true, brief: '', cwd: repo })).rejects.toThrow(/not shell tabs/)
    await expect(x.request('new', { ...quiet, brief: 'loop', repeat: { times: 2, gapMinutes: 0, doneWhen: 'exit' } })).rejects.toThrow(/--repeat/)
    await expect(x.request('new', { ...quiet, brief: 'grand', allowSpawn: 1 })).rejects.toThrow(/--allow-spawn can't be given/)
    await expect(x.request('new', { agent: 'nope', brief: 'x', cwd: repo })).rejects.toThrow(/Unknown agent/)
    expect((await ls(lead.id)).spawned ?? 0).toBe(0)

    const one = await x.request('new', { ...quiet, brief: 'part one' })
    const two = await x.request('new', { ...quiet, brief: 'part two', worktree: 'kid/two' })
    for (const k of [one, two]) {
      expect(k.spawnedBy).toBe(lead.id)
      expect(k.options.print).toBe(true)
      expect(k.worktree?.path).toBeTruthy()
      expect(k.failover).toBeUndefined()
    }
    expect(two.worktree?.branch).toBe('kid/two')
    expect((await ls(lead.id)).spawned).toBe(2)
    await expect(x.request('new', { ...quiet, brief: 'part three' })).rejects.toThrow(/started all 2 agents/)

    // a child asking is refused, even with a place left nowhere
    const k = await inside(one.id)
    await expect(k.request('new', { ...quiet, brief: 'grandchild' })).rejects.toThrow(/started by the agent in pane/)

    // killed children still count
    await x.request('kill', { pane: one.id })
    await expect(x.request('new', { ...quiet, brief: 'again' })).rejects.toThrow(/started all 2/)
    k.close()
    x.close()
    await c.request('kill', { pane: lead.id, children: true })
    expect((await c.request('ls', {})).some((p) => p.id === two.id)).toBe(false)
  }, 30_000)

  it('lets send and kill reach only the pane’s own children; ls, read and wait stay open; the rest is refused', async () => {
    const lead = await c.request('new', { ...quiet, brief: 'lead two', worktree: false, allowSpawn: 1 })
    const other = await c.request('new', { ...quiet, brief: 'someone else', worktree: false })
    const x = await inside(lead.id)
    const kid = await x.request('new', { ...quiet, brief: 'kid' })
    const k = await inside(kid.id)

    await expect(x.request('send', { pane: other.id, text: 'hi' })).rejects.toThrow(new RegExp(`pane ${other.id} isn't one`))
    await expect(x.request('kill', { pane: other.id })).rejects.toThrow(/only on the agents that pane started/)
    await expect(x.request('input', { pane: other.id, data: 'x' })).rejects.toThrow(/only on the agents/)
    await expect(x.request('rename', { pane: other.id, title: 'mine' })).rejects.toThrow(/only on the agents/)
    await expect(x.request('accept', { pane: other.id })).rejects.toThrow(/only on the agents/)
    // not on itself, and a child not on its parent
    await expect(x.request('kill', { pane: lead.id })).rejects.toThrow(/only on the agents/)
    await expect(k.request('send', { pane: lead.id, text: 'hi' })).rejects.toThrow(/only on the agents/)
    for (const cmd of ['stop', 'attach', 'tabs', 'loop-stop'] as const) await expect(x.request(cmd, { cols: 80, rows: 24, loop: 'L1' } as never)).rejects.toThrow(/from your own terminal/)
    await expect(x.request('review', { pane: kid.id, agent: 'codex' })).rejects.toThrow(/from your own terminal/)

    expect((await x.request('ls', {})).map((p) => p.id)).toContain(other.id)
    expect(typeof (await x.request('read', { pane: other.id, lines: 5 })).text).toBe('string')
    expect(await x.request('wait', { pane: other.id, for: 'idle', timeout: 1 })).not.toBeUndefined()

    // its own child is fine (rename: the print-mode fake may have exited already, which send would refuse)
    expect((await x.request('rename', { pane: kid.id, title: 'part' })).title).toBe('part')
    expect((await c.request('ls', {})).some((p) => p.id === other.id)).toBe(true)

    // a pane that's gone can't ask for anything that acts
    const gone = await inside('999')
    await expect(gone.request('new', { ...quiet, brief: 'x' })).rejects.toThrow(/isn't running any more/)
    expect(Array.isArray(await gone.request('ls', {}))).toBe(true)
    // another daemon's (or the app's) mission id isn't one of these panes: it behaves like any shell
    const app = await inside(lead.id, 'not-this-daemon')
    const free = await app.request('new', { ...quiet, brief: 'outside', worktree: false })
    expect(free.spawnedBy).toBeUndefined()
    await app.request('kill', { pane: free.id })

    // killing the parent leaves its children unless asked
    await c.request('kill', { pane: lead.id })
    expect((await ls(kid.id)).spawnedBy).toBe(lead.id)
    await c.request('kill', { pane: kid.id })
    await c.request('kill', { pane: other.id })
    for (const y of [x, k, gone, app]) y.close()
  }, 30_000)

  it('knows a pane from its env, and a daemon started there doesn’t pass the pane on', () => {
    expect(paneOrigin({})).toBeNull()
    // the app's missions set SLDEV_MISSION_ID too: without the daemon's id it's not a pane
    expect(paneOrigin({ SLDEV_MISSION_ID: '3' })).toBeNull()
    expect(paneOrigin({ SLDEV_MISSION_ID: '3', SLDEV_CLI_DAEMON: 'abc' })).toEqual({ pane: '3', daemon: 'abc' })
    expect(daemonEnv({ PATH: '/bin', SLDEV_MISSION_ID: '3', SLDEV_CLI_DAEMON: 'abc', SLDEV_HOOK_PORT: '1', SLDEV_HOOK_TOKEN: 't' })).toEqual({ PATH: '/bin' })
  })

  it('makes a child’s git push fail, after any GIT_CONFIG_* already set, while fetch still works', () => {
    expect(noPushEnv({})).toEqual({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: expect.stringMatching(/^url\..+\.pushInsteadOf$/), GIT_CONFIG_VALUE_0: '' })
    expect(noPushEnv({ GIT_CONFIG_COUNT: '2' })).toMatchObject({ GIT_CONFIG_COUNT: '3', GIT_CONFIG_VALUE_2: '' })
    const remote = join(tmp, 'remote.git')
    execFileSync('git', ['init', '-q', '--bare', remote])
    const env = { ...process.env, ...noPushEnv(process.env) }
    expect(() => execFileSync('git', ['push', '-q', remote, 'HEAD:refs/heads/x'], { cwd: repo, env, stdio: 'pipe' })).toThrow()
    execFileSync('git', ['push', '-q', remote, 'HEAD:refs/heads/x'], { cwd: repo, stdio: 'pipe' })
    execFileSync('git', ['fetch', '-q', remote, 'x'], { cwd: repo, env, stdio: 'pipe' })
  })
})
