import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, type Client } from '../src/client'
import { startDaemon, type Daemon } from '../src/daemon'
import type { LoopInfo, PaneInfo } from '../src/protocol'
import { useFakeAgents } from './fakePath'

/**
 * `sldev new --repeat` end to end against the fake claude (scripts/e2e/fakebin): print-mode passes that
 * exit when done, a check after each, a commit per pass in the loop's worktree, and passes you accept.
 */

const tmp = mkdtempSync(join(tmpdir(), 'sldev-loops-'))
const data = join(tmp, 'data')
const repo = join(tmp, 'repo')
let daemon: Daemon
let c: Client
const notes: string[] = []
const GIT_ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
let restorePath: () => void
// checks that run the same in sh and cmd.exe
const HAS_CHANGES = `node -e "process.exit(require('fs').existsSync('CHANGES.md') ? 0 : 1)"`
const BROKEN = `node -e "console.log('BROKEN-BUILD'); process.exit(3)"`
const git = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8' })

beforeAll(async () => {
  restorePath = useFakeAgents()
  // the loop commits each pass; CI has no git identity
  Object.assign(process.env, GIT_ID)
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src/app.js'), "console.log('hi')\n")
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'init')
  daemon = await startDaemon({ dataDir: data, notify: (title) => notes.push(title) })
  c = await connect({ dataDir: data, script: '', start: false })
})

afterAll(async () => {
  c?.close()
  await daemon?.close()
  restorePath()
  for (const k of Object.keys(GIT_ID)) delete process.env[k]
  // Windows keeps a just-killed process's folder locked for a moment (EBUSY): retry instead of failing
  rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
})

async function until<T>(what: string, get: () => Promise<T | undefined>, timeout = 30_000): Promise<T> {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const v = await get()
    if (v) return v
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const loop = async (id: string): Promise<LoopInfo | undefined> => (await c.request('loops', {})).find((l) => l.id === id)
const finished = (id: string): Promise<LoopInfo> => until(`loop ${id} to finish`, async () => ((await loop(id))?.progress.state === 'finished' ? loop(id) : undefined))
const pane = async (id: string): Promise<PaneInfo> => (await c.request('ls', {})).find((p) => p.id === id)!

describe('sldev repeat loops', () => {
  it('runs the passes in print mode in one worktree, checks and commits each, and hands the next pass its place', async () => {
    const first = await c.request('new', { agent: 'claude', brief: 'Polish the greeting', kind: 'build', worktree: 'feature/polish', cwd: repo, repeat: { times: 2, gapMinutes: 0, doneWhen: 'exit', check: HAS_CHANGES } })
    expect(first.repeat).toMatchObject({ pass: 1, of: 2 })
    expect(first.options.print).toBe(true)
    // nobody approves in print mode: the unattended mode, as for factory stages
    expect(first.options.permissionMode).toBe('auto')
    expect(first.title).toBe('Polish the greeting · pass 1/2')
    expect(first.prompt).toContain('This is pass 1 of 2')
    const l = await finished(first.repeat!.loop)
    expect(l.progress.reason).toBe('All 2 passes done')
    expect(l.progress.passes.map((p) => p.outcome)).toEqual(['done', 'done'])
    const second = await pane(l.progress.passes[1].mission)
    expect(second.cwd).toBe(first.cwd)
    expect(second.prompt).toContain('This is pass 2 of 2')
    expect(second.prompt).toContain('committed their changes')
    expect(git(first.cwd, 'log', '--format=%s', '-3')).toMatch(/Polish the greeting: pass 2\nPolish the greeting: pass 1\ninit/)
    expect(readFileSync(join(first.cwd, 'CHANGES.md'), 'utf8').trim().split('\n')).toHaveLength(2)
    expect(notes).toContain('Repeat: Polish the greeting')
  }, 60_000)

  it('stops when a pass changes nothing, in place, without counting what was already uncommitted', async () => {
    writeFileSync(join(repo, 'MINE.md'), 'my own work in progress\n')
    const first = await c.request('new', { agent: 'claude', brief: 'NO_CHANGES look for more to tidy', worktree: false, cwd: repo, repeat: { times: 0, gapMinutes: 0, doneWhen: 'exit' } })
    const l = await finished(first.repeat!.loop)
    expect(l.progress.passes).toHaveLength(1)
    expect(l.progress.reason).toBe('Pass 1 changed nothing: nothing left to improve')
    // in place nothing is committed
    expect(git(repo, 'log', '--format=%s')).toBe('init\n')
  }, 40_000)

  it('gives the next pass a failed check’s output, and stops after two failures in a row', async () => {
    const first = await c.request('new', { agent: 'claude', brief: 'Make the check pass', worktree: 'feature/check', cwd: repo, repeat: { times: 5, gapMinutes: 0, doneWhen: 'exit', check: BROKEN } })
    const l = await finished(first.repeat!.loop)
    expect(l.progress.passes.map((p) => p.outcome)).toEqual(['check-failed', 'check-failed'])
    expect(l.progress.reason).toBe('The check failed twice in a row (passes 1 and 2)')
    const second = await pane(l.progress.passes[1].mission)
    expect(second.prompt).toContain(`the check \`${BROKEN}\` failed`)
    expect(second.prompt).toContain('BROKEN-BUILD')
  }, 60_000)

  it('waits for sldev accept when passes are interactive', async () => {
    const first = await c.request('new', { agent: 'claude', brief: 'Steer this one', worktree: 'feature/steer', cwd: repo, repeat: { times: 1, gapMinutes: 0, doneWhen: 'accept' } })
    expect(first.options.print).toBeUndefined()
    expect(first.repeat?.accept).toBe(true)
    await c.request('wait', { pane: first.id, for: 'ready', timeout: 20 })
    // the agent stopping its turn isn't the end of the pass: it waits for you
    expect((await loop(first.repeat!.loop))?.progress.state).toBe('running')
    await c.request('accept', { pane: first.id })
    const l = await finished(first.repeat!.loop)
    expect(l.progress.passes[0].outcome).toBe('done')
    expect(l.progress.reason).toBe('The pass is done')
    expect(git(first.cwd, 'log', '--format=%s', '-1')).toBe('Steer this one: pass 1\n')
  }, 40_000)

  it('ends a loop whose pass is killed, and refuses accept on panes that don’t wait for it', async () => {
    const first = await c.request('new', { agent: 'claude', brief: 'Will be stopped', worktree: 'feature/stop', cwd: repo, repeat: { times: 3, gapMinutes: 10, doneWhen: 'accept' } })
    await c.request('kill', { pane: first.id })
    const l = await finished(first.repeat!.loop)
    expect(l.progress.reason).toBe('Stopped during pass 1')
    const plain = await c.request('new', { agent: 'codex', brief: 'just once', cwd: repo, worktree: false })
    await expect(c.request('accept', { pane: plain.id })).rejects.toThrow(/isn't a pass that waits for you/)
    await expect(c.request('loop-stop', { loop: 'L99' })).rejects.toThrow(/No loop "L99"/)
  }, 30_000)

  it('stops a waiting loop right away and a running one after its pass', async () => {
    const first = await c.request('new', { agent: 'claude', brief: 'Slow polish', worktree: 'feature/gap', cwd: repo, repeat: { times: 3, gapMinutes: 60, doneWhen: 'exit' } })
    const id = first.repeat!.loop
    const waiting = await until('the gap', async () => ((await loop(id))?.progress.state === 'waiting' ? loop(id) : undefined))
    expect(waiting.label).toMatch(/^Pass 2 of 3 at /)
    const stopped = await c.request('loop-stop', { loop: id })
    expect(stopped.progress.state).toBe('finished')
    expect(stopped.progress.reason).toBe('Stopped after pass 1')
  }, 30_000)
})
