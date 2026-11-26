import { beforeEach, describe, expect, it, vi } from 'vitest'

// github.ts reaches gh only through run, so stubbing it keeps the test off the network
const run = vi.fn()
vi.mock('../src/main/git', () => ({ run: (...a: unknown[]) => run(...a) }))

const { openPrs, prDetail } = await import('../src/main/github')

const ok = (stdout: unknown): { code: number; stdout: string; stderr: string } => ({ code: 0, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '' })
const fail = (stderr: string): { code: number; stdout: string; stderr: string } => ({ code: 1, stdout: '', stderr })
const ghCalls = (): string[][] => run.mock.calls.map((c) => c[1] as string[])

beforeEach(() => { run.mockReset() })

describe('openPrs', () => {
  it('lists open PRs through a read-only gh pr list', async () => {
    run.mockImplementation(async (_cmd: string, args: string[]) =>
      args[0] === 'auth' ? ok('') : ok([{ number: 2, title: 'B', createdAt: '2026-02-01' }, { number: 1, title: 'A', createdAt: '2026-01-01' }])
    )
    const r = await openPrs('/repo')
    expect(r.error).toBeUndefined()
    expect(r.prs.map((p) => p.number)).toEqual([2, 1])
    const list = ghCalls()[1]
    expect(list.slice(0, 5)).toEqual(['pr', 'list', '--state', 'open', '--limit'])
    expect(list[list.indexOf('--json') + 1].split(',')).toEqual(expect.arrayContaining(['author', 'isDraft', 'reviewDecision', 'additions', 'headRefOid', 'body']))
  })

  it('reads CI with one read-only run list and leaves checks out when it fails', async () => {
    const pr = { number: 7, title: 'A', headRefOid: 'h1', createdAt: '2026-01-01' }
    run.mockImplementation(async (_c: string, args: string[]) =>
      args[0] === 'auth' ? ok('') : args[0] === 'run' ? ok([{ databaseId: 1, workflowName: 'CI', status: 'completed', conclusion: 'success', headSha: 'h1', createdAt: '2026-01-02' }]) : args[0] === 'pr' ? ok([pr]) : ok('')
    )
    expect((await openPrs('/repo')).prs[0].checks).toBe('passed')
    const runList = ghCalls().find((a) => a[0] === 'run')!
    expect(runList.slice(0, 4)).toEqual(['run', 'list', '--limit', '100'])
    expect(runList[runList.indexOf('--json') + 1].split(',')).toEqual(expect.arrayContaining(['headSha', 'status', 'conclusion', 'workflowName', 'createdAt']))
    expect(ghCalls().some((a) => a.join(' ').includes('statusCheckRollup'))).toBe(false)
    run.mockImplementation(async (_c: string, args: string[]) => (args[0] === 'auth' ? ok('') : args[0] === 'run' ? fail('HTTP 403') : args[0] === 'pr' ? ok([pr]) : ok('')))
    const r = await openPrs('/repo')
    expect(r.error).toBeUndefined()
    expect(r.prs[0].checks).toBeUndefined()
  })

  it('says who is signed in, and leaves it out when gh won\'t say', async () => {
    run.mockImplementation(async (_c: string, args: string[]) => (args[0] === 'auth' ? ok('') : args[0] === 'api' ? ok('ben42-01\n') : ok([])))
    expect(await openPrs('/repo')).toEqual({ prs: [], me: 'ben42-01' })
    expect(ghCalls().find((a) => a[0] === 'api')).toEqual(['api', 'user', '--jq', '.login'])
  })

  it('says gh is missing or logged out instead of throwing', async () => {
    run.mockResolvedValue(fail('spawn gh ENOENT'))
    expect(await openPrs('/repo')).toEqual({ prs: [], error: 'The GitHub CLI (gh) is not installed.' })
    run.mockResolvedValue(fail('You are not logged into any GitHub hosts.'))
    expect((await openPrs('/repo')).error).toMatch(/gh auth login/)
    expect(ghCalls().every((a) => a[0] === 'auth')).toBe(true)
  })

  it('passes on gh failing in a folder that is not on GitHub, and unreadable output', async () => {
    run.mockImplementation(async (_c: string, args: string[]) => (args[0] === 'auth' ? ok('') : fail('no git remotes found\nmore')))
    expect(await openPrs('/repo')).toEqual({ prs: [], error: 'no git remotes found' })
    run.mockImplementation(async (_c: string, args: string[]) => (args[0] === 'auth' ? ok('') : ok('not json')))
    expect((await openPrs('/repo')).error).toMatch(/Unexpected output from gh pr list/)
  })
})

describe('prDetail', () => {
  it('asks for the body and the issues it closes', async () => {
    run.mockImplementation(async (_c: string, args: string[]) => (args[0] === 'auth' ? ok('') : ok({ number: 5, body: 'Fixes #3', closingIssuesReferences: [{ number: 3, title: 'Bug', url: 'u' }] })))
    const pr = await prDetail('/repo', 5)
    expect(pr).toMatchObject({ number: 5, body: 'Fixes #3', linkedIssues: [{ number: 3, title: 'Bug', url: 'u' }] })
    const view = ghCalls()[1]
    expect(view.slice(0, 3)).toEqual(['pr', 'view', '5'])
    expect(view[4]).toContain('closingIssuesReferences')
  })

  it('throws a readable reason without gh', async () => {
    run.mockResolvedValue(fail('spawn gh ENOENT'))
    await expect(prDetail('/repo', 5)).rejects.toThrow('The GitHub CLI (gh) is not installed.')
  })
})
