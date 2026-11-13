import { describe, expect, it } from 'vitest'
import type { GitStatus } from '@shared/types'
import { changeSummary, fetchOutcome, gitErrorLine, pullOutcome } from '../src/renderer/src/lib/git'

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
