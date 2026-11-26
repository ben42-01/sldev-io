import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isMine, parseOpenPrs, parsePrDetail, parsePrRuns, planPrWorktree, prChecks, prTabTitle, reviewOrder, waitingForMe, withChecks } from '@shared/prs'
import { prChecksSignal, prReviewSignal } from '@shared/status'
import { listWorktrees, prWorktree, removePrWorktree } from '../src/main/git'

const RAW = {
  number: 128,
  title: 'Rate limit the API',
  author: { login: 'maria', is_bot: false },
  headRefName: 'rate-limit',
  headRefOid: 'abc123',
  baseRefName: 'main',
  isDraft: false,
  additions: 120,
  deletions: 8,
  changedFiles: 4,
  reviewDecision: 'CHANGES_REQUESTED',
  createdAt: '2026-11-20T10:00:00Z',
  updatedAt: '2026-11-21T10:00:00Z',
  body: 'Adds a limiter.',
  url: 'https://github.com/acme/shop/pull/128'
}

describe('parseOpenPrs', () => {
  it('reads author, size, draft and review decision', () => {
    expect(parseOpenPrs([RAW])).toEqual([
      {
        number: 128,
        title: 'Rate limit the API',
        author: 'maria',
        authorIsBot: false,
        headRefName: 'rate-limit',
        headSha: 'abc123',
        baseRefName: 'main',
        isDraft: false,
        additions: 120,
        deletions: 8,
        changedFiles: 4,
        reviewDecision: 'CHANGES_REQUESTED',
        requested: [],
        createdAt: '2026-11-20T10:00:00Z',
        updatedAt: '2026-11-21T10:00:00Z',
        body: 'Adds a limiter.',
        url: 'https://github.com/acme/shop/pull/128'
      }
    ])
  })

  it('sorts newest first, caps the list and skips what is not a PR', () => {
    const list = [
      { ...RAW, number: 1, createdAt: '2026-01-01T00:00:00Z' },
      { ...RAW, number: 3, createdAt: '2026-03-01T00:00:00Z' },
      { title: 'no number' },
      null,
      { ...RAW, number: 2, createdAt: '2026-02-01T00:00:00Z' }
    ]
    expect(parseOpenPrs(list).map((p) => p.number)).toEqual([3, 2, 1])
    expect(parseOpenPrs(list, 2).map((p) => p.number)).toEqual([3, 2])
  })

  it('fills gaps: no review decision, a deleted author, a bot, missing numbers', () => {
    const [pr] = parseOpenPrs([{ number: 5, reviewDecision: '', author: null, isDraft: true }])
    expect(pr).toMatchObject({ number: 5, author: 'someone', reviewDecision: null, isDraft: true, additions: 0, title: '', body: '' })
    expect(parseOpenPrs([{ number: 6, author: { login: 'app/dependabot', is_bot: true } }])[0]).toMatchObject({ author: 'app/dependabot', authorIsBot: true })
  })

  it('takes anything that is not a list as no PRs', () => {
    expect(parseOpenPrs(null)).toEqual([])
    expect(parseOpenPrs({ number: 1 })).toEqual([])
  })
})

describe('the review list', () => {
  const pr = (number: number, createdAt: string, more: Record<string, unknown> = {}) => parseOpenPrs([{ ...RAW, number, createdAt, ...more }])[0]

  it('reads who is asked to review: users by login, teams by slug', () => {
    const [p] = parseOpenPrs([{ ...RAW, reviewRequests: [{ __typename: 'User', login: 'ben' }, { __typename: 'Team', slug: 'core', name: 'Core' }, {}] }])
    expect(p.requested).toEqual(['ben', 'core'])
  })

  it('puts the ones waiting for my review first, then the oldest, drafts last', () => {
    const list = [
      pr(1, '2026-01-03T00:00:00Z'),
      pr(2, '2026-01-01T00:00:00Z', { isDraft: true }),
      pr(3, '2026-01-04T00:00:00Z', { reviewRequests: [{ login: 'Ben' }] }),
      pr(4, '2026-01-02T00:00:00Z'),
      pr(5, '2026-01-05T00:00:00Z', { reviewRequests: [{ login: 'ben' }] })
    ]
    expect(reviewOrder(list, 'ben').map((p) => p.number)).toEqual([3, 5, 4, 1, 2])
    // nobody signed in: just the oldest first
    expect(reviewOrder(list, undefined).map((p) => p.number)).toEqual([4, 1, 3, 5, 2])
    expect(list.map((p) => p.number)).toEqual([1, 2, 3, 4, 5])
  })

  it('"mine" is what I opened or am asked to review', () => {
    const list = [pr(1, 'a', { author: { login: 'ben' } }), pr(2, 'b', { reviewRequests: [{ login: 'ben' }] }), pr(3, 'c')]
    expect(reviewOrder(list, 'ben', 'mine').map((p) => p.number)).toEqual([2, 1])
    expect(reviewOrder(list, undefined, 'mine')).toEqual([])
    expect(isMine(list[2], 'ben')).toBe(false)
    expect(waitingForMe(list[0], 'ben')).toBe(false)
  })

  it('titles the tab #<n> <title> and colours the decision by state', () => {
    expect(prTabTitle({ number: 7, title: 'Fix it' })).toBe('#7 Fix it')
    expect(prReviewSignal('APPROVED').tone).toBe('done')
    expect(prReviewSignal('CHANGES_REQUESTED').tone).toBe('attention')
    expect(prReviewSignal('REVIEW_REQUIRED').tone).toBe('review')
    expect(prReviewSignal(null)).toMatchObject({ tone: 'neutral', label: 'No review' })
  })
})

describe('parsePrDetail', () => {
  it('adds the issues the PR closes, with their repo', () => {
    const pr = parsePrDetail({
      ...RAW,
      closingIssuesReferences: [
        { number: 42, title: 'Too many requests', url: 'https://github.com/acme/shop/issues/42', repository: { name: 'shop', owner: { login: 'acme' } } },
        { number: 7, url: 'https://github.com/acme/api/issues/7' },
        { title: 'no number' }
      ]
    })
    expect(pr?.body).toBe('Adds a limiter.')
    expect(pr?.linkedIssues).toEqual([
      { number: 42, title: 'Too many requests', url: 'https://github.com/acme/shop/issues/42', repo: 'acme/shop' },
      { number: 7, title: '', url: 'https://github.com/acme/api/issues/7' }
    ])
  })

  it('reads the GraphQL nodes shape and no links at all', () => {
    expect(parsePrDetail({ ...RAW, closingIssuesReferences: { nodes: [{ number: 9 }] } })?.linkedIssues.map((i) => i.number)).toEqual([9])
    expect(parsePrDetail(RAW)?.linkedIssues).toEqual([])
    expect(parsePrDetail({ title: 'x' })).toBeNull()
  })
})

describe('planPrWorktree', () => {
  it('creates, reuses at the same head, moves to new commits', () => {
    expect(planPrWorktree(null, 'b', 1)).toEqual({ do: 'create' })
    expect(planPrWorktree({ head: 'b', branch: null, dirty: 0 }, 'b', 1)).toEqual({ do: 'reuse' })
    expect(planPrWorktree({ head: 'b', branch: null, dirty: 2 }, 'b', 1)).toEqual({ do: 'reuse' })
    expect(planPrWorktree({ head: 'a', branch: null, dirty: 0 }, 'b', 1)).toEqual({ do: 'move' })
  })

  it('never moves over changed files or a branch someone checked out there', () => {
    expect(planPrWorktree({ head: 'a', branch: null, dirty: 1 }, 'b', 3)).toMatchObject({ do: 'refuse', reason: expect.stringMatching(/1 changed file\b/) })
    expect(planPrWorktree({ head: 'b', branch: 'fix', dirty: 0 }, 'b', 3)).toMatchObject({ do: 'refuse', reason: expect.stringMatching(/branch fix/) })
  })
})

// a bare "GitHub" with refs/pull/<n>/head like the real one (a fork's PR lives only there, on no branch)
describe('prWorktree', () => {
  let tmp: string
  let origin: string
  let work: string
  let fork: string
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  const g = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = (cwd: string, file: string): string => {
    writeFileSync(join(cwd, file), file + '\n')
    g(cwd, 'add', file)
    g(cwd, 'commit', '-q', '-m', file)
    return g(cwd, 'rev-parse', 'HEAD')
  }
  /** push a fork's commit as PR `n`'s head, the way GitHub records it */
  const openPr = (n: number, sha: string): void => {
    g(fork, 'push', '-q', '--force', origin, `${sha}:refs/pull/${n}/head`)
  }
  const wtPath = (n: number): string => join(dirname(work), '.sldev-worktrees', 'work', `pr-${n}`)

  beforeAll(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sldev-prwt-')))
    origin = join(tmp, 'origin.git')
    g(tmp, 'init', '-q', '--bare', '-b', 'main', origin)
    work = join(tmp, 'work')
    fork = join(tmp, 'fork')
    g(tmp, 'clone', '-q', origin, work)
    commit(work, 'a.txt')
    g(work, 'push', '-q', '-u', 'origin', 'main')
    g(tmp, 'clone', '-q', origin, fork)
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('checks out the head detached in its own worktree, leaving branches and the main checkout alone', async () => {
    const sha = commit(fork, 'feature.txt')
    openPr(7, sha)
    const branchesBefore = g(work, 'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes')
    const wt = await prWorktree(work, 7, sha)
    expect(wt).toEqual({ number: 7, path: wtPath(7), head: sha, repo: work, action: 'created', listedOther: false })
    expect(existsSync(join(wt.path, 'feature.txt'))).toBe(true)
    expect(g(work, 'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes')).toBe(branchesBefore)
    expect(g(work, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(existsSync(join(work, 'feature.txt'))).toBe(false)
    expect(g(work, 'rev-parse', 'refs/sldev/pr/7')).toBe(sha)
    expect((await listWorktrees(work)).find((w) => w.path === wt.path)).toMatchObject({ detached: true, head: sha })
  })

  it('reuses the worktree at the same head, also when asked from inside a worktree', async () => {
    const sha = g(work, 'rev-parse', 'refs/sldev/pr/7')
    expect((await prWorktree(work, 7, sha)).action).toBe('reused')
    expect((await prWorktree(wtPath(7), 7)).action).toBe('reused')
  })

  it('moves to new commits, and says when the list it was picked from was older', async () => {
    const old = g(work, 'rev-parse', 'refs/sldev/pr/7')
    const next = commit(fork, 'more.txt')
    openPr(7, next)
    const wt = await prWorktree(work, 7, old)
    expect(wt).toMatchObject({ action: 'moved', head: next, listedOther: true })
    expect(g(wt.path, 'rev-parse', 'HEAD')).toBe(next)
    expect(existsSync(join(wt.path, 'more.txt'))).toBe(true)
  })

  it('follows a force push, but not over changed files', async () => {
    g(fork, 'reset', '-q', '--hard', 'HEAD~1')
    const rewritten = commit(fork, 'other.txt')
    openPr(7, rewritten)
    writeFileSync(join(wtPath(7), 'feature.txt'), 'edited\n')
    await expect(prWorktree(work, 7, rewritten)).rejects.toThrow(/1 changed file/)
    g(wtPath(7), 'checkout', '--', 'feature.txt')
    expect(await prWorktree(work, 7, rewritten)).toMatchObject({ action: 'moved', head: rewritten })
  })

  it('says when there is no such PR', async () => {
    await expect(prWorktree(work, 999)).rejects.toThrow(/no pull request #999/)
    await expect(prWorktree(work, 0)).rejects.toThrow(/Not a pull request number/)
  })

  it('removes without --force (refusing untracked files) and drops the fetched ref', async () => {
    writeFileSync(join(wtPath(7), 'notes.txt'), 'mine\n')
    await expect(removePrWorktree(work, 7)).rejects.toThrow()
    expect(existsSync(wtPath(7))).toBe(true)
    await removePrWorktree(work, 7, { discard: true })
    expect(existsSync(wtPath(7))).toBe(false)
    expect(() => g(work, 'rev-parse', '--verify', '--quiet', 'refs/sldev/pr/7')).toThrow()
    // a folder already gone is just pruned
    const sha = g(fork, 'rev-parse', 'HEAD')
    const wt = await prWorktree(work, 7, sha)
    rmSync(wt.path, { recursive: true, force: true })
    expect((await prWorktree(work, 7, sha)).action).toBe('created')
    await removePrWorktree(work, 7)
    expect(existsSync(wtPath(7))).toBe(false)
  })
})

describe('prChecks', () => {
  const run = (headSha: string, status: string, conclusion: string, createdAt: string, workflowName = 'CI') => ({ databaseId: 1, workflowName, status, conclusion, headSha, createdAt, event: 'pull_request' })

  it('counts only runs on the head commit, not an older one of the PR', () => {
    const runs = parsePrRuns([run('old', 'completed', 'success', '2026-11-20T10:00:00Z'), run('head', 'completed', 'failure', '2026-11-21T10:00:00Z')])
    expect(prChecks(runs, 'head')).toBe('failed')
    expect(prChecks(parsePrRuns([run('old', 'completed', 'success', '2026-11-20T10:00:00Z')]), 'head')).toBe('none')
    expect(prChecks(runs, '')).toBe('none')
  })

  it('passed, running or failed from the newest run of each workflow', () => {
    expect(prChecks(parsePrRuns([run('h', 'completed', 'success', '1'), run('h', 'completed', 'success', '2', 'Lint')]), 'h')).toBe('passed')
    expect(prChecks(parsePrRuns([run('h', 'completed', 'success', '1'), run('h', 'in_progress', '', '2', 'Lint')]), 'h')).toBe('running')
    // a re-run that passed replaces the failure it re-ran
    expect(prChecks(parsePrRuns([run('h', 'completed', 'failure', '1'), run('h', 'completed', 'success', '2')]), 'h')).toBe('passed')
    expect(prChecks(parsePrRuns([run('h', 'in_progress', '', '2'), run('h', 'completed', 'failure', '1', 'Lint')]), 'h')).toBe('failed')
  })

  it('gives each PR its own head\'s checks and drops runs without a commit', () => {
    expect(parsePrRuns('nope')).toEqual([])
    expect(parsePrRuns([{ databaseId: 3 }])).toEqual([])
    const prs = parseOpenPrs([RAW, { ...RAW, number: 131, headRefOid: 'def456', createdAt: '2026-11-22T10:00:00Z' }])
    const out = withChecks(prs, parsePrRuns([run('abc123', 'completed', 'failure', '1')]))
    expect(out.map((p) => [p.number, p.checks])).toEqual([[131, 'none'], [128, 'failed']])
  })

  it('maps to tones, pulsing only while running', () => {
    expect(prChecksSignal('passed')).toMatchObject({ tone: 'done', pulse: false })
    expect(prChecksSignal('failed')).toMatchObject({ tone: 'error', pulse: false })
    expect(prChecksSignal('running')).toMatchObject({ tone: 'working', pulse: true })
    expect(prChecksSignal('none')).toMatchObject({ tone: 'neutral', pulse: false })
  })
})
