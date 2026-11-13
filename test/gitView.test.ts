import { describe, expect, it } from 'vitest'
import type { GitStatus } from '@shared/types'
import { changeSummary, fetchOutcome, gitErrorLine, pullOutcome, worktreeSummary, worktreeUsers, type WorktreeOwners } from '../src/renderer/src/lib/git'

const status = (p: Partial<GitStatus> = {}): GitStatus => ({ branch: 'main', head: 'abc', detached: false, upstream: 'origin/main', ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, ...p })

describe('Git view texts', () => {
  it('says what a fetch brought', () => {
    expect(fetchOutcome(status({ behind: 3 }))).toBe('Fetched · 3 new commits to pull from origin/main')
    expect(fetchOutcome(status({ behind: 1 }))).toBe('Fetched · 1 new commit to pull from origin/main')
    expect(fetchOutcome(status())).toBe('Fetched · up to date with origin/main')
    expect(fetchOutcome(status({ upstream: null }))).toBe('Fetched')
    expect(fetchOutcome(null)).toBe('Fetched')
  })

  it('says what a pull did', () => {
    expect(pullOutcome('Already up to date.', 0, 'origin/main')).toBe('Already up to date')
    expect(pullOutcome('Updating a..b\nFast-forward\n f | 1 +', 2, 'origin/main')).toBe('Pulled 2 commits from origin/main')
    expect(pullOutcome('Fast-forward', 1, null)).toBe('Pulled 1 commit')
  })

  it("takes git's fatal line for the toast, not its hints", () => {
    const msg = 'hint: Diverging branches can\'t be fast-forwarded, you need to either:\nhint:\nhint: \tgit merge --no-ff\nfatal: Not possible to fast-forward, aborting.'
    expect(gitErrorLine(msg)).toBe('Not possible to fast-forward, aborting.')
    expect(gitErrorLine('error: cannot pull with rebase: You have unstaged changes.')).toBe('cannot pull with rebase: You have unstaged changes.')
    expect(gitErrorLine('Could not resolve host: example.invalid')).toBe('Could not resolve host: example.invalid')
    expect(gitErrorLine('')).toBe('git failed')
  })

  it('counts changes, or says nothing for a clean tree', () => {
    expect(changeSummary(status())).toBeNull()
    expect(changeSummary(status({ staged: 2, unstaged: 1, untracked: 3, conflicted: 1 }))).toBe('1 conflict · 2 staged · 1 modified · 3 untracked')
  })
})

describe('who uses a worktree', () => {
  const wt = '/repos/.sldev-worktrees/app/feature-x'
  const owners: WorktreeOwners = {
    missions: [
      { id: 'm1', title: 'Add dark mode', status: 'working', cwd: wt, worktree: { path: wt + '/', base: 'main' } },
      { id: 'm2', title: 'Old one', status: 'done', cwd: wt, worktree: { path: wt, base: 'main' } },
      { id: 'm3', title: 'In place', status: 'working', cwd: '/repos/app/src' },
      { id: 'm4', title: 'In place, done', status: 'done', cwd: '/repos/app' },
      { id: 'm5', title: 'eval agent', status: 'working', cwd: wt + '-2', worktree: { path: wt + '-2', base: 'main' }, eval: { run: 'e', attempt: 'a' } }
    ],
    runs: [
      { id: 'r1', intent: 'Ship it', status: 'paused', worktrees: [{ path: '/elsewhere', base: 'main' }, { path: wt, base: 'sldev/run' }] },
      { id: 'r2', intent: 'Done run', status: 'done', worktrees: [{ path: wt + '-3', base: 'main' }] }
    ],
    evals: [{ id: 'e', attempts: [{ id: 'a', eval: 'fix-bug', status: 'checking', worktree: { path: wt + '-2', base: 'main' } }] }]
  }

  it('finds missions, runs and evals working there, and which are live', () => {
    const u = worktreeUsers(wt, false, owners)
    expect(u.map((x) => [x.kind, x.id, x.live])).toEqual([
      ['mission', 'm1', true],
      ['mission', 'm2', false],
      ['run', 'r1', true]
    ])
    expect(u[0].why).toMatch(/Mission "Add dark mode" is still running here/)
    expect(u[2].why).toMatch(/paused/)
    expect(u[2].base).toBe('sldev/run')
  })

  it('lists eval attempts once, under the eval, not as missions', () => {
    expect(worktreeUsers(wt + '-2', false, owners).map((x) => [x.kind, x.live])).toEqual([['eval', true]])
    expect(worktreeUsers(wt + '-3', false, owners).map((x) => [x.kind, x.live])).toEqual([['run', false]])
  })

  it('on the main checkout, only what is running there', () => {
    expect(worktreeUsers('/repos/app', true, owners).map((x) => x.id)).toEqual(['m3'])
    // a sibling folder whose name starts the same is not inside it
    expect(worktreeUsers('/repos/ap', true, owners)).toEqual([])
  })

  it('sums up what is not committed or merged', () => {
    expect(worktreeSummary(null)).toBeNull()
    expect(worktreeSummary({ modified: 0, untracked: 0, unmerged: 0 }, 'main')).toBeNull()
    expect(worktreeSummary({ modified: 2, untracked: 1, unmerged: 3 }, 'main')).toBe('2 modified · 1 untracked · 3 ahead of main')
  })
})
