import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findAgent } from '@shared/agents'
import { connect } from '../src/client'
import { startDaemon } from '../src/daemon'
import type { PaneInfo } from '../src/protocol'
import { readSessions, restorePlan, sessionWriter } from '../src/sessions'
import { removeTemp, useFakeAgents } from './fakePath'

const pane = (p: Partial<PaneInfo>): PaneInfo =>
  ({ id: '1', title: 't', prompt: 'do it', root: '/r', cwd: '/r', options: { agent: 'claude' }, status: 'waiting', createdAt: 1, updatedAt: 1, agentName: 'Claude Code', ...p }) as PaneInfo

describe('restorePlan', () => {
  const claude = findAgent('claude')
  const codex = findAgent('codex')
  const here = (): boolean => true

  it('resumes Claude by its session id and the others by their own "continue"', () => {
    expect(restorePlan(pane({ sessionId: 'abc' }), claude, here)).toEqual({ how: 'resume', resume: 'abc' })
    expect(restorePlan(pane({ options: { agent: 'codex' }, status: 'working' }), codex, here)).toEqual({ how: 'resume', resume: true })
    expect(restorePlan(pane({ shell: true, options: { agent: 'shell' } }), undefined, here)).toEqual({ how: 'shell' })
  })

  it('never starts a prompt again: no session yet, print mode, loop passes and children stay stopped', () => {
    expect(restorePlan(pane({ status: 'starting' }), claude, here)).toMatchObject({ how: 'ended', note: expect.stringContaining('no session') })
    expect(restorePlan(pane({ options: { agent: 'codex' }, status: 'starting' }), codex, here).how).toBe('ended')
    expect(restorePlan(pane({ sessionId: 'abc', options: { agent: 'claude', print: true } }), claude, here).how).toBe('ended')
    expect(restorePlan(pane({ sessionId: 'abc', repeat: { loop: 'l1', pass: 1, of: 3 } }), claude, here).how).toBe('ended')
    expect(restorePlan(pane({ sessionId: 'abc', spawnedBy: '2' }), claude, here).how).toBe('ended')
  })

  it('keeps finished panes as they were, and skips a folder that is gone or an agent that is not there', () => {
    expect(restorePlan(pane({ status: 'ended', sessionId: 'abc' }), claude, here)).toEqual({ how: 'ended' })
    expect(restorePlan(pane({ sessionId: 'abc' }), claude, () => false)).toMatchObject({ how: 'ended', note: expect.stringContaining('/r is gone') })
    expect(restorePlan(pane({ sessionId: 'abc' }), undefined, here)).toMatchObject({ how: 'ended', note: expect.stringContaining("isn't known") })
  })
})

describe('sessionWriter', () => {
  it('writes the file, stops at end, and forget removes it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sldev-sessions-'))
    let n = 1
    const w = sessionWriter(dir, () => ({ version: 1, nextId: n, tabs: { order: [], active: null, split: false }, panes: [] }))
    w.schedule()
    await new Promise((r) => setTimeout(r, 400))
    expect(readSessions(dir)?.nextId).toBe(1)
    n = 2
    w.end()
    n = 3
    w.schedule()
    await new Promise((r) => setTimeout(r, 400))
    // the last write is the one end made: nothing after it (the ptys being killed) is saved
    expect(readSessions(dir)?.nextId).toBe(2)
    w.forget()
    expect(existsSync(join(dir, 'sessions.json'))).toBe(false)
    removeTemp(dir)
  })
})

/** Windows PowerShell 5.1's `>>` writes UTF-16LE with a BOM; sh writes plain bytes. */
function readLog(file: string): string {
  const b = readFileSync(file)
  return b[0] === 0xff && b[1] === 0xfe ? b.subarray(2).toString('utf16le') : b.toString('utf8')
}

describe('a daemon restarted (a reboot, a crash)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sldev-restart-'))
  const data = join(tmp, 'data')
  const repo = join(tmp, 'repo')
  const argvLog = join(tmp, 'argv.log')
  let restorePath: () => void

  beforeAll(() => {
    restorePath = useFakeAgents()
    process.env.SLDEV_E2E_ARGV = argvLog
    mkdirSync(join(repo, 'src'), { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  })

  afterAll(() => {
    delete process.env.SLDEV_E2E_ARGV
    restorePath()
    removeTemp(tmp)
  })

  it('reopens shell tabs in their folder and resumes the agent’s own session, without its prompt', async () => {
    let runtimeId = ''
    const first = await startDaemon({ dataDir: data, notify: () => undefined })
    let c = await connect({ dataDir: data, script: '', start: false })
    const agent = await c.request('new', { agent: 'claude', brief: 'Fix the greeting', worktree: false, cwd: repo })
    expect((await c.request('wait', { pane: agent.id, for: 'ready', timeout: 20 }))?.sessionId).toBe('sess-123')
    const shell = await c.request('new', { shell: true, brief: '', cwd: join(repo, 'src'), title: 'logs' })
    // a runtime: its command is typed into the shell once, never again after the restart
    const ran = join(tmp, 'ran.log')
    const runtime = await c.request('new', { shell: true, brief: '', cwd: repo, title: 'mark', run: `echo ran >> "${ran}"` })
    expect(runtime.command).toBe(`echo ran >> "${ran}"`)
    for (let i = 0; i < 100 && !existsSync(ran); i++) await new Promise((r) => setTimeout(r, 100))
    expect(readLog(ran).trim()).toBe('ran')
    await c.request('kill', { pane: runtime.id })
    await c.request('new', { shell: true, brief: '', cwd: repo, title: 'mark', run: `echo ran >> "${ran}"` }).then((p) => (runtimeId = p.id))
    for (let i = 0; i < 100 && readLog(ran).trim().split(/\r?\n/).length < 2; i++) await new Promise((r) => setTimeout(r, 100))
    await c.request('tabs', { active: shell.id, split: true })
    c.close()
    await first.close()
    expect(readSessions(data)?.panes.map((p) => [p.id, p.status])).toEqual([
      [agent.id, 'waiting'],
      [shell.id, 'waiting'],
      [runtimeId, 'waiting']
    ])

    const second = await startDaemon({ dataDir: data, notify: () => undefined })
    try {
      c = await connect({ dataDir: data, script: '', start: false })
      const [a, s, r] = await c.request('attach', { cols: 80, rows: 24 })
      // the runtime's tab is a shell again, its command not typed a second time
      expect(r).toMatchObject({ id: runtimeId, title: 'mark', shell: true })
      expect(r.command).toBeUndefined()
      expect(a).toMatchObject({ id: agent.id, title: agent.title, cwd: repo, notification: 'Resumed after sldev restarted' })
      expect(a.pid).toBeGreaterThan(0)
      expect(s).toMatchObject({ id: shell.id, title: 'logs', cwd: join(repo, 'src'), shell: true })
      expect(s.pid).toBeGreaterThan(0)
      expect(await c.request('tabs', {})).toMatchObject({ active: shell.id, split: true })
      // a new pane doesn't take an id a restored one has
      const next = await c.request('new', { shell: true, brief: '', cwd: repo })
      expect(Number(next.id)).toBeGreaterThan(Number(shell.id))
      let runs: string[][] = []
      for (let i = 0; i < 50 && runs.length < 2; i++) {
        await new Promise((r) => setTimeout(r, 100))
        runs = existsSync(argvLog) ? readFileSync(argvLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]) : []
      }
      expect(runs[0]).toContain('Fix the greeting')
      expect(runs[1]).toEqual(expect.arrayContaining(['--resume', 'sess-123']))
      expect(runs[1]).not.toContain('Fix the greeting')
      await new Promise((res) => setTimeout(res, 1000))
      expect(readFileSync(join(tmp, 'ran.log'), 'utf8').trim().split(/\r?\n/)).toEqual(['ran', 'ran'])
      c.close()
    } finally {
      await second.close()
    }
  }, 60_000)
})
