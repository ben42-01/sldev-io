import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitStatus } from '@shared/types'

// repoStats reaches git and gh only through these two, so stubbing them keeps the test off the network
const run = vi.fn()
const status = vi.fn()
vi.mock('../src/main/git', () => ({ run: (...a: unknown[]) => run(...a), status: (...a: unknown[]) => status(...a) }))

const { repoStats } = await import('../src/main/github')

const ok = (stdout: unknown): { code: number; stdout: string; stderr: string } => ({ code: 0, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '' })
const fail = (stderr: string): { code: number; stdout: string; stderr: string } => ({ code: 1, stdout: '', stderr })

const gitStatus: GitStatus = { branch: 'feature/x', head: 'abc1234def', detached: false, upstream: 'origin/feature/x', ahead: 2, behind: 1, staged: 0, unstaged: 1, untracked: 0, conflicted: 0 }
const LOG = ['abc1234def', 'abc1234', 'Add stats', 'Ben', '2026-11-13T10:00:00+00:00'].join('\0') + '\n'

type Answer = (args: string[]) => { code: number; stdout: string; stderr: string }
function answer(gh: Answer): void {
  run.mockImplementation(async (cmd: string, args: string[]) => (cmd === 'git' ? ok(LOG) : gh(args)))
}

const READ_ONLY = ['auth status', 'repo view', 'release list', 'run list', 'pr list']
const ghCalls = (): string[][] => run.mock.calls.filter((c) => c[0] === 'gh').map((c) => c[1] as string[])

beforeEach(() => {
  run.mockReset()
  status.mockReset().mockResolvedValue(gitStatus)
})

describe('repoStats', () => {
  it('returns local parts and one reason for every GitHub part when gh is not installed', async () => {
    answer(() => fail('spawn gh ENOENT'))
    const s = await repoStats('/repo')
    expect(s.status.value).toEqual(gitStatus)
    expect(s.lastCommit.value).toEqual({ sha: 'abc1234def', short: 'abc1234', subject: 'Add stats', author: 'Ben', date: '2026-11-13T10:00:00+00:00' })
    expect(s.githubError).toMatch(/not installed/)
    for (const p of [s.github, s.release, s.runs, s.branchPrs]) expect(p).toEqual({ value: null, error: s.githubError })
    expect(ghCalls()).toEqual([['auth', 'status']])
  })

  it('returns local parts and asks to log in when gh is not authenticated', async () => {
    answer(() => fail('You are not logged into any GitHub hosts. To log in, run: gh auth login'))
    const s = await repoStats('/repo')
    expect(s.status.value?.ahead).toBe(2)
    expect(s.lastCommit.value?.short).toBe('abc1234')
    expect(s.githubError).toMatch(/gh auth login/)
    expect(s.release.error).toBe(s.githubError)
    expect(ghCalls()).toEqual([['auth', 'status']])
  })

  it('reads every GitHub part, for the current branch', async () => {
    answer((a) => {
      const cmd = a.slice(0, 2).join(' ')
      if (cmd === 'auth status') return ok('')
      if (cmd === 'repo view') return ok({ nameWithOwner: 'acme/shop', url: 'https://github.com/acme/shop', defaultBranchRef: { name: 'main' }, stargazerCount: 12, forkCount: 3, issues: { totalCount: 5 }, pullRequests: { totalCount: 2 } })
      if (cmd === 'release list') return ok([{ tagName: 'v1.2.0', name: '', publishedAt: '2026-11-01T00:00:00Z', isPrerelease: true }])
      if (cmd === 'run list') return ok([{ databaseId: 1, displayTitle: 'CI', workflowName: 'ci', status: 'completed', conclusion: 'success', headBranch: 'feature/x', event: 'push', createdAt: '', url: '', number: 9 }])
      if (cmd === 'pr list') return ok([{ number: 4, title: 'Stats', url: 'https://github.com/acme/shop/pull/4', isDraft: false }])
      return fail('unexpected')
    })
    const s = await repoStats('/repo')
    expect(s.githubError).toBeUndefined()
    expect(s.github.value).toEqual({ repo: 'acme/shop', url: 'https://github.com/acme/shop', defaultBranch: 'main', stars: 12, forks: 3, openIssues: 5, openPrs: 2 })
    expect(s.release.value).toEqual({ tag: 'v1.2.0', name: 'v1.2.0', publishedAt: '2026-11-01T00:00:00Z', prerelease: true })
    expect(s.runs.value).toHaveLength(1)
    expect(s.branchPrs.value?.[0].number).toBe(4)
    const calls = ghCalls()
    expect(calls.find((a) => a[0] === 'run')).toEqual(expect.arrayContaining(['--limit', '3', '--branch', 'feature/x']))
    expect(calls.find((a) => a[0] === 'pr')).toEqual(expect.arrayContaining(['--head', 'feature/x', '--state', 'open']))
  })

  it('lets each GitHub part fail on its own, and treats no releases as nothing rather than an error', async () => {
    answer((a) => {
      const cmd = a.slice(0, 2).join(' ')
      if (cmd === 'auth status') return ok('')
      if (cmd === 'run list') return fail('HTTP 403: Resource not accessible\nmore detail')
      if (cmd === 'release list') return ok('')
      if (cmd === 'repo view') return ok('not json')
      return ok([])
    })
    const s = await repoStats('/repo')
    expect(s.runs).toEqual({ value: null, error: 'HTTP 403: Resource not accessible' })
    expect(s.github.error).toMatch(/Unexpected output/)
    expect(s.release).toEqual({ value: null })
    expect(s.branchPrs).toEqual({ value: [] })
  })

  it('keeps going when the local parts fail, and skips the branch PRs when HEAD is detached', async () => {
    status.mockResolvedValue({ ...gitStatus, branch: null, detached: true })
    run.mockImplementation(async (cmd: string, args: string[]) =>
      cmd === 'git' ? fail("fatal: your current branch 'main' does not have any commits yet") : args[0] === 'auth' ? ok('') : ok([])
    )
    const s = await repoStats('/repo')
    expect(s.lastCommit).toEqual({ value: null })
    expect(s.branchPrs).toEqual({ value: [] })
    expect(ghCalls().some((a) => a[0] === 'pr')).toBe(false)
    expect(ghCalls().find((a) => a[0] === 'run')).not.toContain('--branch')

    status.mockRejectedValue(new Error('fatal: not a git repository'))
    const t = await repoStats('/nowhere')
    expect(t.status).toEqual({ value: null, error: 'fatal: not a git repository' })
  })

  it('only ever runs read-only gh commands', async () => {
    answer((a) => (a[0] === 'auth' ? ok('') : ok([])))
    await repoStats('/repo')
    const used = ghCalls().map((a) => a.slice(0, 2).join(' '))
    expect(used.length).toBe(5)
    for (const u of used) expect(READ_ONLY).toContain(u)
  })
})
