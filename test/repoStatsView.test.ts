import { describe, expect, it } from 'vitest'
import type { RepoStats } from '@shared/types'
import { branchPrsLine, branchSummary, countTile, needsGhSetup, statsLinks } from '../src/renderer/src/lib/repoStats'

const base = (): RepoStats => ({
  status: { value: { branch: 'feature/x', head: 'abc1234def', detached: false, upstream: 'origin/feature/x', ahead: 2, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 } },
  lastCommit: { value: { sha: 'abc1234def', short: 'abc1234', subject: 'Add stats', author: 'Ben', date: '2026-11-13T10:00:00Z' } },
  github: { value: { repo: 'acme/shop', url: 'https://github.com/acme/shop', defaultBranch: 'main', stars: 1, forks: 0, openIssues: 5, openPrs: 2 } },
  release: { value: { tag: 'v1.2.0/rc', name: 'v1.2.0', publishedAt: '', prerelease: true } },
  runs: { value: [] },
  branchPrs: { value: [{ number: 4, title: 'Stats', url: 'u', isDraft: false }] }
})

describe('GitHub stats panel helpers', () => {
  it('links every tile to the repo on GitHub', () => {
    const l = statsLinks(base())!
    expect(l.pulls).toBe('https://github.com/acme/shop/pulls')
    expect(l.issues).toBe('https://github.com/acme/shop/issues')
    expect(l.release).toBe('https://github.com/acme/shop/releases/tag/v1.2.0%2Frc')
    expect(l.commit).toBe('https://github.com/acme/shop/commit/abc1234def')
  })

  it('has no links and asks for gh setup when gh is missing', () => {
    const missing = 'The GitHub CLI (gh) is not installed.'
    const s: RepoStats = { ...base(), githubError: missing, github: { value: null, error: missing }, release: { value: null, error: missing }, runs: { value: null, error: missing }, branchPrs: { value: null, error: missing } }
    expect(statsLinks(s)).toBeNull()
    expect(needsGhSetup(s)).toBe(true)
    expect(needsGhSetup(base())).toBe(false)
    // the local tiles still read
    expect(branchSummary(s)).toEqual({ value: 'feature/x', sub: '2 ahead of origin/feature/x' })
  })

  it('says where the branch stands', () => {
    const s = base()
    s.status.value!.behind = 3
    expect(branchSummary(s).sub).toBe('2 ahead, 3 behind origin/feature/x')
    s.status.value!.ahead = 0
    expect(branchSummary(s).sub).toBe('3 behind origin/feature/x')
    s.status.value!.behind = 0
    expect(branchSummary(s).sub).toBe('Up to date with origin/feature/x')
    s.status.value = { ...s.status.value!, branch: null, detached: true, upstream: null }
    expect(branchSummary(s)).toEqual({ value: 'detached at abc1234', sub: 'Detached HEAD: no upstream' })
    expect(branchSummary({ ...s, status: { value: null, error: 'not a git repository' } })).toEqual({ value: '—', sub: 'not a git repository' })
  })

  it('shows a dash and the reason for a part that failed', () => {
    expect(countTile({ value: null, error: 'boom' }, undefined)).toEqual({ value: '—', failed: true, why: 'boom' })
    expect(countTile({ value: {} }, 0)).toEqual({ value: '0', failed: false })
  })

  it("counts the current branch's PRs", () => {
    const s = base()
    expect(branchPrsLine(s)).toBe('1 PR for feature/x')
    s.branchPrs.value = []
    expect(branchPrsLine(s)).toBe('None for feature/x')
    s.branchPrs = { value: null, error: 'x' }
    expect(branchPrsLine(s)).toBe("Couldn't read this branch's PRs")
  })
})
