import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { WorktreeInfo } from '@shared/types'
import { addWorktree } from '../../src/main/git'
import { describeClean, planClean, runClean } from '../src/clean'
import type { LoopInfo, PaneInfo } from '../src/protocol'

/** sldev clean against a real repository and real worktrees; the panes are plain objects. */

const tmp = mkdtempSync(join(tmpdir(), 'sldev-clean-'))
const repo = join(tmp, 'repo')
const data = join(tmp, 'data')
const git = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8' })
const GIT_ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }

beforeAll(() => {
  Object.assign(process.env, GIT_ID)
  mkdirSync(repo, { recursive: true })
  mkdirSync(data, { recursive: true })
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'init')
})

afterAll(() => {
  for (const k of Object.keys(GIT_ID)) delete process.env[k]
  // Windows keeps a just-killed process's folder locked for a moment (EBUSY): retry instead of failing
  rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
})

const pane = (id: string, status: PaneInfo['status'], worktree?: WorktreeInfo, extra: Partial<PaneInfo> = {}): PaneInfo =>
  ({ id, title: `job ${id}`, prompt: '', root: repo, cwd: worktree?.path ?? repo, worktree, options: {}, status, createdAt: 0, updatedAt: 0, agentName: 'Codex', ...extra }) as PaneInfo

const loop = (id: string, state: LoopInfo['progress']['state']): LoopInfo => ({ id, name: id, brief: '', plan: { times: 3, gapMinutes: 0, doneWhen: 'exit' }, progress: { state, passes: [] }, label: '' })

describe('sldev clean', () => {
  it('removes finished panes and their worktrees, and keeps what is still in use or has uncommitted work', async () => {
    const done = await addWorktree(repo, 'feature/done', 'main')
    const dirty = await addWorktree(repo, 'feature/dirty', 'main')
    writeFileSync(join(dirty.path, 'wip.txt'), 'not committed\n')
    const live = await addWorktree(repo, 'feature/live', 'main')
    const looped = await addWorktree(repo, 'feature/loop', 'main')
    const panes = [
      pane('1', 'ended', done),
      pane('2', 'failed', dirty),
      pane('3', 'working', live),
      // a finished pass of a loop that goes on: its worktree is the next pass's
      pane('4', 'ended', looped, { repeat: { loop: 'L1', pass: 1, of: 3 } }),
      // an earlier pane in the folder of a live one (a failover, say)
      pane('5', 'ended', live),
      pane('6', 'ended')
    ]
    const o = { dataDir: data, repo }
    const items = await planClean(panes, [loop('L1', 'waiting')], o)
    const lines = describeClean(items).join('\n')
    expect(lines).toContain(`remove pane 1 job 1: ${done.path}; branch feature/done stays`)
    expect(lines).toMatch(/keep {3}pane 2 job 2: .*1 uncommitted file \(--discard/)
    expect(lines).toMatch(/keep {3}pane 5 job 5: .*pane 3 still works there/)
    expect(lines).toContain('remove pane 6 job 6 from the list')
    expect(lines).not.toContain('pane 3 job 3')
    expect(lines).not.toContain('pane 4 job 4')

    const removed: string[] = []
    expect(await runClean(items, o, async (id) => void removed.push(id))).toEqual([])
    expect(existsSync(done.path)).toBe(false)
    expect(existsSync(dirty.path)).toBe(true)
    expect(existsSync(live.path)).toBe(true)
    expect(removed).toEqual(['1', '6'])
    // its branch and commits stay unless asked
    expect(git(repo, 'branch', '--list', 'feature/done')).toContain('feature/done')
  })

  it('throws away uncommitted work only with --discard, and deletes only branches with nothing of their own', async () => {
    const dirty = await addWorktree(repo, 'feature/scratch', 'main')
    writeFileSync(join(dirty.path, 'wip.txt'), 'scratch\n')
    const ahead = await addWorktree(repo, 'feature/ahead', 'main')
    writeFileSync(join(ahead.path, 'b.txt'), 'b\n')
    git(ahead.path, 'add', '-A')
    git(ahead.path, 'commit', '-qm', 'only here')
    const o = { dataDir: data, repo, discard: true, branches: true }
    const items = await planClean([pane('7', 'ended', dirty), pane('8', 'ended', ahead)], [], o)
    expect(describeClean(items).join('\n')).toMatch(/remove pane 8 .*branch feature\/ahead stays; 1 commit only on feature\/ahead/)
    expect(await runClean(items, o, async () => undefined)).toEqual([])
    expect(existsSync(dirty.path)).toBe(false)
    expect(git(repo, 'branch', '--list', 'feature/scratch')).toBe('')
    expect(git(repo, 'branch', '--list', 'feature/ahead')).toContain('feature/ahead')
  })

  it('finds orphan sldev worktrees with --orphans, but never one the app’s missions use', async () => {
    const orphan = await addWorktree(repo, 'feature/orphan', 'main')
    const appOwned = await addWorktree(repo, 'feature/app-mission', 'main')
    writeFileSync(join(data, 'missions.json'), JSON.stringify({ missions: [{ id: 'm1', cwd: appOwned.path, worktree: appOwned }] }))
    expect(await planClean([], [], { dataDir: data, repo })).toEqual([])
    const lines = describeClean(await planClean([], [], { dataDir: data, repo, orphans: true })).join('\n')
    expect(lines).toContain(`remove worktree feature/orphan: ${orphan.path}`)
    expect(lines).not.toContain('app-mission')
  })
})
