import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { baseMoved, mergeBaseInto, trialMerge } from '../src/main/git'

describe('the base moved (ship bar)', () => {
  let tmp: string
  let repo: string
  let wt: string
  const ids = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  const saved: Record<string, string | undefined> = {}
  const g = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, ...ids }, stdio: ['ignore', 'pipe', 'pipe'] })
  const commit = (cwd: string, file: string, text: string, msg = `edit ${file}`): void => {
    writeFileSync(join(cwd, file), text)
    g(cwd, 'add', file)
    g(cwd, 'commit', '-q', '-m', msg)
  }
  const headOf = (cwd: string): string => g(cwd, 'rev-parse', 'HEAD').trim()

  beforeAll(() => {
    // mergeBaseInto commits through src/main/git, which uses process.env
    for (const [k, v] of Object.entries(ids)) {
      saved[k] = process.env[k]
      process.env[k] = v
    }
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sldev base ')))
    repo = join(tmp, 'repo')
    g(tmp, 'init', '-q', '-b', 'master', repo)
    commit(repo, 'a.txt', 'one\n')
    wt = join(tmp, 'wt')
    g(repo, 'worktree', 'add', '-q', '-b', 'feature', wt, 'master')
    commit(wt, 'b.txt', 'mine\n')
  })
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    rmSync(tmp, { recursive: true, force: true })
  })

  it('says nothing moved when the base has no new commits', async () => {
    expect(await baseMoved(wt, 'master')).toEqual({ base: 'master', ref: 'master', behind: 0, commits: [], conflicts: [] })
  })

  it('lists the base commits since the branch, newest first, and a clean trial merge', async () => {
    commit(repo, 'c.txt', 'c\n', 'Add c (#2)')
    commit(repo, 'd.txt', 'd\n', 'Add d (#3)')
    const b = await baseMoved(wt, 'master')
    expect(b.behind).toBe(2)
    expect(b.commits.map((c) => c.subject)).toEqual(['Add d (#3)', 'Add c (#2)'])
    expect(b.conflicts).toEqual([])
  })

  it('names conflicting files without touching the worktree', async () => {
    commit(repo, 'b.txt', 'theirs\n')
    const before = headOf(wt)
    expect(await trialMerge(wt, 'master')).toEqual(['b.txt'])
    expect((await baseMoved(wt, 'master')).conflicts).toEqual(['b.txt'])
    expect(headOf(wt)).toBe(before)
    expect(g(wt, 'status', '--porcelain')).toBe('')
    expect(readFileSync(join(wt, 'b.txt'), 'utf8')).toBe('mine\n')
  })

  it('undoes a conflicting merge and leaves the worktree as it was', async () => {
    const before = headOf(wt)
    const r = await mergeBaseInto(wt, 'master')
    expect(r).toMatchObject({ merged: false, conflicts: ['b.txt'] })
    expect(headOf(wt)).toBe(before)
    expect(g(wt, 'status', '--porcelain')).toBe('')
  })

  it('merges a clean base, and refuses with uncommitted changes', async () => {
    g(repo, 'reset', '-q', '--hard', 'HEAD~1')
    writeFileSync(join(wt, 'b.txt'), 'dirty\n')
    await expect(mergeBaseInto(wt, 'master')).rejects.toThrow(/not committed/)
    g(wt, 'checkout', '--', 'b.txt')
    const r = await mergeBaseInto(wt, 'master')
    expect(r.merged).toBe(true)
    expect((await baseMoved(wt, 'master')).behind).toBe(0)
    // a merge commit with the branch's own commit as first parent
    expect(g(wt, 'log', '-1', '--format=%P').trim().split(' ')).toHaveLength(2)
  })
})
