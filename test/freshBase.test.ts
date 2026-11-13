import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { freshBase } from '../src/main/git'

// a story started after an earlier one's PR merged on GitHub must build on it, not on a stale local master
describe('freshBase', () => {
  let tmp: string
  let work: string
  let other: string
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  const g = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
  const commit = (cwd: string, file: string): void => {
    writeFileSync(join(cwd, file), file + '\n')
    g(cwd, 'add', file)
    g(cwd, 'commit', '-q', '-m', file)
  }

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sldev-freshbase-'))
    const origin = join(tmp, 'origin.git')
    g(tmp, 'init', '-q', '--bare', '-b', 'master', origin)
    work = join(tmp, 'work')
    other = join(tmp, 'other')
    g(tmp, 'clone', '-q', origin, work)
    commit(work, 'a.txt')
    g(work, 'push', '-q', '-u', 'origin', 'master')
    g(tmp, 'clone', '-q', origin, other)
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('keeps the branch when it is up to date, or has no upstream', async () => {
    expect(await freshBase(work, 'master')).toBe('master')
    g(work, 'branch', 'local-only')
    expect(await freshBase(work, 'local-only')).toBe('local-only')
  })

  it('fetches and starts from the upstream when the local branch is only behind (a PR merged on GitHub)', async () => {
    commit(other, 'merged-pr.txt')
    g(other, 'push', '-q', 'origin', 'master')
    expect(await freshBase(work, 'master')).toBe('origin/master')
    expect(g(work, 'rev-parse', 'origin/master')).toBe(g(other, 'rev-parse', 'HEAD'))
    // the user's checkout is left alone
    expect(g(work, 'log', '-1', '--format=%s').trim()).toBe('a.txt')
  })

  it('keeps a branch with commits of its own (ahead or diverged)', async () => {
    commit(work, 'local.txt')
    expect(await freshBase(work, 'master')).toBe('master')
  })
})
