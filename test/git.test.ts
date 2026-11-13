import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { branchNameProblem, parseBranchList, parseRemoteBranches, parseStatus, parseWorktrees } from '@shared/git'
import { addWorktree, branchList, createBranch, fetch, listWorktrees, pruneWorktrees, pull, remoteBranches, removeWorktree, status, switchBranch, worktreeStatus } from '../src/main/git'

describe('parseStatus', () => {
  it('reads branch, upstream, ahead/behind and counts', () => {
    const out = [
      '# branch.oid 1234567890abcdef1234567890abcdef12345678',
      '# branch.head feature/x',
      '# branch.upstream origin/feature/x',
      '# branch.ab +2 -3',
      '1 M. N... 100644 100644 100644 aaa bbb src/a.ts',
      '1 .M N... 100644 100644 100644 aaa bbb src/b c.ts',
      '1 MM N... 100644 100644 100644 aaa bbb src/c.ts',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new name.ts\told name.ts',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts',
      '? new file.txt',
      '? other.txt',
      '! ignored.log',
      ''
    ].join('\n')
    expect(parseStatus(out)).toEqual({
      branch: 'feature/x',
      head: '1234567890abcdef1234567890abcdef12345678',
      detached: false,
      upstream: 'origin/feature/x',
      ahead: 2,
      behind: 3,
      staged: 3,
      unstaged: 2,
      untracked: 2,
      conflicted: 1
    })
  })

  it('handles a detached HEAD without upstream', () => {
    const s = parseStatus('# branch.oid abc\n# branch.head (detached)\n')
    expect(s).toMatchObject({ branch: null, detached: true, head: 'abc', upstream: null, ahead: 0, behind: 0 })
  })

  it('handles a branch with no upstream and a repo with no commits', () => {
    const s = parseStatus('# branch.oid (initial)\n# branch.head main\n? a\n')
    expect(s).toMatchObject({ branch: 'main', head: null, detached: false, upstream: null, untracked: 1 })
  })

  it('handles an upstream that is gone (no branch.ab line)', () => {
    expect(parseStatus('# branch.oid abc\n# branch.head x\n# branch.upstream origin/x\n')).toMatchObject({ upstream: 'origin/x', ahead: 0, behind: 0 })
  })
})

describe('parseWorktrees', () => {
  const lines = [
    'worktree /home/me/repo',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/master',
    '',
    'worktree /home/me/my worktrees/feature x',
    'HEAD 2222222222222222222222222222222222222222',
    'branch refs/heads/feature/x',
    'locked',
    '',
    'worktree /tmp/detached one',
    'HEAD 3333333333333333333333333333333333333333',
    'detached',
    'locked moved to a usb drive',
    'prunable gitdir file points to non-existent location',
    ''
  ]

  it('parses the line form', () => {
    const list = parseWorktrees(lines.join('\n'))
    expect(list).toHaveLength(3)
    expect(list[0]).toEqual({ path: '/home/me/repo', head: '1'.repeat(40), branch: 'master', detached: false, bare: false, locked: false, prunable: false, isMain: true })
    expect(list[1]).toMatchObject({ path: '/home/me/my worktrees/feature x', branch: 'feature/x', locked: true, isMain: false })
    expect(list[1].lockReason).toBeUndefined()
    expect(list[2]).toMatchObject({
      path: '/tmp/detached one',
      branch: null,
      detached: true,
      locked: true,
      lockReason: 'moved to a usb drive',
      prunable: true,
      prunableReason: 'gitdir file points to non-existent location'
    })
  })

  it('parses the -z form the same way, keeping newlines in paths', () => {
    const z = lines.join('\0').replace('/tmp/detached one', '/tmp/detached\none')
    const list = parseWorktrees(z)
    expect(list).toHaveLength(3)
    expect(list[2].path).toBe('/tmp/detached\none')
    expect(list[2].prunable).toBe(true)
  })

  it('marks a bare main repository', () => {
    const list = parseWorktrees('worktree /srv/repo.git\nbare\n\nworktree /srv/wt\nHEAD abc\nbranch refs/heads/main\n')
    expect(list[0]).toMatchObject({ bare: true, head: null, branch: null, isMain: true })
    expect(list[1]).toMatchObject({ branch: 'main', isMain: false })
  })
})

describe('parseRemoteBranches', () => {
  it('drops HEAD aliases and the refs/remotes prefix', () => {
    expect(parseRemoteBranches('refs/remotes/origin/HEAD\nrefs/remotes/origin/master\nrefs/remotes/upstream/feature/x\n')).toEqual(['origin/master', 'upstream/feature/x'])
  })
})

describe('parseBranchList', () => {
  it('splits local and remote branches, marks the current one and other worktrees', () => {
    const line = (...f: string[]): string => f.join('\0')
    const out = [
      line('refs/heads/main', '*', '1700000000', 'origin/main', '/repo', 'Fix: the thing'),
      line('refs/heads/feature/x', ' ', '1690000000', '', '/repo-wt/x', 'wip'),
      line('refs/heads/old', ' ', '', '', '', ''),
      line('refs/remotes/origin/HEAD', ' ', '1700000000', '', '', ''),
      line('refs/remotes/origin/main', ' ', '1700000000', '', '', 'Fix: the thing'),
      ''
    ].join('\n')
    const list = parseBranchList(out, '/repo/')
    expect(list.local).toEqual([
      { name: 'main', current: true, committedAt: 1700000000000, subject: 'Fix: the thing', upstream: 'origin/main', worktree: null },
      { name: 'feature/x', current: false, committedAt: 1690000000000, subject: 'wip', upstream: null, worktree: '/repo-wt/x' },
      { name: 'old', current: false, committedAt: 0, subject: '', upstream: null, worktree: null }
    ])
    expect(list.remote.map((b) => b.name)).toEqual(['origin/main'])
    expect(list.remote[0]).toMatchObject({ current: false, upstream: null, worktree: null })
  })
})

describe('branchNameProblem', () => {
  it('accepts ordinary names', () => {
    for (const n of ['main', 'feature/login-form', 'fix/issue-12', 'release/1.2.3', 'a.b', 'üñî']) expect(branchNameProblem(n), n).toBeNull()
  })

  it('says what is wrong with names git rejects', () => {
    const cases: [string, RegExp][] = [
      ['', /Enter a name/],
      ['   ', /Enter a name/],
      ['my branch', /No spaces/],
      ['-f', /dash/],
      ['HEAD', /reserved/],
      ['@', /reserved/],
      ['a..b', /"\.\."/],
      ['a@{1}', /@\{/],
      ['a~1', /"~"/],
      ['a^', /"\^"/],
      ['a:b', /":"/],
      ['a?', /"\?"/],
      ['a*', /"\*"/],
      ['a[b', /"\["/],
      ['a\\b', /"\\"/],
      ['a\x01b', /control/],
      ['/a', /Slashes/],
      ['a/', /Slashes/],
      ['a//b', /Slashes/],
      ['a.', /dot/],
      ['.a', /dot/],
      ['a/.b', /dot/],
      ['a.lock', /\.lock/],
      ['a/b.lock/c', /\.lock/]
    ]
    for (const [n, re] of cases) expect(branchNameProblem(n), JSON.stringify(n)).toMatch(re)
  })

  it('refuses existing names and folder clashes', () => {
    const existing = ['main', 'feature/x']
    expect(branchNameProblem('main', existing)).toMatch(/already exists/)
    expect(branchNameProblem('feature', existing)).toMatch(/Clashes with the branch feature\/x/)
    expect(branchNameProblem('main/sub', existing)).toMatch(/Clashes with the branch main/)
    expect(branchNameProblem('feature/y', existing)).toBeNull()
  })
})

describe('git operations against temp repos', () => {
  let tmp: string
  let origin: string
  let work: string
  let other: string
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  const g = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
  const commit = (cwd: string, file: string, text: string): void => {
    writeFileSync(join(cwd, file), text)
    g(cwd, 'add', file)
    g(cwd, 'commit', '-q', '-m', `edit ${file}`)
  }

  beforeAll(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sldev git ')))
    origin = join(tmp, 'origin.git')
    g(tmp, 'init', '-q', '--bare', '-b', 'master', origin)
    work = join(tmp, 'work')
    other = join(tmp, 'other')
    g(tmp, 'clone', '-q', origin, work)
    g(work, 'switch', '-q', '-c', 'master')
    commit(work, 'a.txt', 'one\n')
    g(work, 'push', '-q', '-u', 'origin', 'master')
    g(tmp, 'clone', '-q', origin, other)
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('status reports branch, upstream and file counts', async () => {
    writeFileSync(join(work, 'a.txt'), 'changed\n')
    writeFileSync(join(work, 'new file.txt'), 'x\n')
    const s = await status(work)
    expect(s).toMatchObject({ branch: 'master', upstream: 'origin/master', ahead: 0, behind: 0, unstaged: 1, untracked: 1, staged: 0 })
    g(work, 'checkout', '-q', '--', 'a.txt')
    rmSync(join(work, 'new file.txt'))
  })

  it('fetch sees new remote commits and pull fast-forwards to them', async () => {
    commit(other, 'b.txt', 'b\n')
    g(other, 'push', '-q', 'origin', 'master')
    await fetch(work)
    expect(await status(work)).toMatchObject({ ahead: 0, behind: 1 })
    expect(await remoteBranches(work)).toEqual(['origin/master'])
    await pull(work)
    expect(await status(work)).toMatchObject({ ahead: 0, behind: 0 })
    expect(g(work, 'rev-parse', 'HEAD')).toBe(g(other, 'rev-parse', 'HEAD'))
  })

  it('pull refuses a diverged branch with git’s message and makes no merge commit', async () => {
    commit(other, 'c.txt', 'c\n')
    g(other, 'push', '-q', 'origin', 'master')
    commit(work, 'd.txt', 'd\n')
    const before = g(work, 'rev-parse', 'HEAD')
    // even a user config that asks for merges or rebases must not change what pull does
    g(work, 'config', 'pull.rebase', 'true')
    await expect(pull(work)).rejects.toThrow(/fast-forward/i)
    g(work, 'config', 'pull.rebase', 'false')
    g(work, 'config', 'pull.ff', 'true')
    await expect(pull(work)).rejects.toThrow(/fast-forward/i)
    expect(g(work, 'rev-parse', 'HEAD')).toBe(before)
    expect(await status(work)).toMatchObject({ ahead: 1, behind: 1 })
  })

  it('createBranch validates the name, then creates or switches', async () => {
    await expect(createBranch(work, 'bad..name', '', false)).rejects.toThrow(/valid branch name/)
    await expect(createBranch(work, '-f', '', false)).rejects.toThrow(/valid branch name/)
    await expect(createBranch(work, '@{-1}', '', false)).rejects.toThrow(/valid branch name/)
    await expect(createBranch(work, 'x', '--orphan', false)).rejects.toThrow(/valid base/)

    expect(await createBranch(work, 'feature/kept', 'origin/master', false)).toBe('feature/kept')
    expect((await status(work)).branch).toBe('master')
    expect(g(work, 'rev-parse', 'feature/kept')).toBe(g(work, 'rev-parse', 'origin/master'))

    await createBranch(work, 'feature/now', '', true)
    const s = await status(work)
    expect(s).toMatchObject({ branch: 'feature/now', upstream: null })
    await expect(createBranch(work, 'feature/now', '', false)).rejects.toThrow(/already exists/)
    g(work, 'switch', '-q', 'master')
  })

  it('listWorktrees lists the main tree, a path with spaces, locked and detached ones', async () => {
    const spaced = join(tmp, 'wt with spaces')
    const gone = join(tmp, 'wt gone')
    g(work, 'worktree', 'add', '-q', '-b', 'wt-branch', spaced)
    g(work, 'worktree', 'add', '-q', '--detach', gone)
    g(work, 'worktree', 'lock', '--reason', 'on a usb stick', spaced)
    rmSync(gone, { recursive: true, force: true })
    const list = await listWorktrees(work)
    expect(list).toHaveLength(3)
    const at = (p: string) => list.find((w) => w.path === p)
    expect(list[0]).toMatchObject({ path: work, isMain: true, branch: 'master', locked: false })
    expect(at(spaced)).toMatchObject({ isMain: false, branch: 'wt-branch', locked: true, lockReason: 'on a usb stick', prunable: false })
    expect(at(gone)).toMatchObject({ isMain: false, detached: true, branch: null, prunable: true })
    // asked from inside a linked worktree, the main one still comes first
    expect((await listWorktrees(spaced))[0].path).toBe(work)
  })

  it('branchList lists local and remote branches, and the worktree a branch is checked out in', async () => {
    const list = await branchList(work)
    const local = (n: string) => list.local.find((b) => b.name === n)
    expect(local('master')).toMatchObject({ current: true, upstream: 'origin/master', worktree: null })
    expect(local('master')!.committedAt).toBeGreaterThan(Date.now() - 3600_000)
    expect(local('master')!.subject).toBe('edit d.txt')
    expect(local('wt-branch')).toMatchObject({ current: false, worktree: join(tmp, 'wt with spaces') })
    expect(local('feature/kept')).toMatchObject({ current: false, worktree: null, upstream: null })
    expect(list.remote.map((b) => b.name)).toEqual(['origin/master'])
    // from inside the linked worktree, its own branch is the current one there
    const inWt = await branchList(join(tmp, 'wt with spaces'))
    expect(inWt.local.find((b) => b.name === 'wt-branch')).toMatchObject({ current: true, worktree: null })
    expect(inWt.local.find((b) => b.name === 'master')).toMatchObject({ current: false, worktree: work })
  })

  it('switchBranch refuses while tracked files have uncommitted changes, and changes nothing', async () => {
    const head = g(work, 'rev-parse', 'HEAD')
    writeFileSync(join(work, 'a.txt'), 'not committed\n')
    await expect(switchBranch(work, 'feature/kept')).rejects.toThrow(/local changes[\s\S]*a\.txt[\s\S]*commit or stash/)
    expect((await status(work)).branch).toBe('master')
    expect(g(work, 'rev-parse', 'HEAD')).toBe(head)
    expect(g(work, 'status', '--porcelain')).toBe(' M a.txt\n')
    g(work, 'checkout', '-q', '--', 'a.txt')

    // an untracked file doesn't block a switch; a branch checked out elsewhere is refused by git itself
    writeFileSync(join(work, 'scratch.txt'), 'x\n')
    await switchBranch(work, 'feature/kept')
    expect((await status(work)).branch).toBe('feature/kept')
    await expect(switchBranch(work, 'wt-branch')).rejects.toThrow(/already (checked out|used by worktree)/)
    await expect(switchBranch(work, '--detach')).rejects.toThrow(/Not a branch/)
    await switchBranch(work, 'master')
    rmSync(join(work, 'scratch.txt'))
  })

  it('pruneWorktrees forgets worktrees whose folder is gone, and keeps the rest', async () => {
    expect((await listWorktrees(work)).some((w) => w.prunable)).toBe(true)
    await pruneWorktrees(work)
    const list = await listWorktrees(work)
    expect(list.some((w) => w.prunable)).toBe(false)
    expect(list.some((w) => w.branch === 'wt-branch')).toBe(true)
  })

  it('addWorktree by hand: a new branch as typed, or an existing one, in .sldev-worktrees', async () => {
    const dir = join(tmp, '.sldev-worktrees', 'work')
    await expect(addWorktree(work, 'bad..name', '', { exact: true })).rejects.toThrow(/valid branch name/)
    await expect(addWorktree(work, 'x', '--orphan', { exact: true })).rejects.toThrow(/valid base/)
    await expect(addWorktree(work, 'master', '', { exact: true })).rejects.toThrow(/already exists/)
    await expect(addWorktree(work, 'nope', '', { existing: true })).rejects.toThrow(/no branch/)

    const fresh = await addWorktree(work, 'feature/by-hand', '')
    // missions (no options) keep their -2 and sldev/ behaviour; this is just a slashed name
    expect(fresh).toMatchObject({ path: join(dir, 'feature-by-hand'), branch: 'feature/by-hand', base: 'master', repo: work })
    rmSync(fresh.path, { recursive: true, force: true })
    await pruneWorktrees(work)

    const typed = await addWorktree(work, 'plain', 'origin/master', { exact: true })
    expect(typed).toMatchObject({ path: join(dir, 'plain'), branch: 'plain', base: 'origin/master' })
    expect(g(typed.path, 'rev-parse', 'HEAD')).toBe(g(work, 'rev-parse', 'origin/master'))

    await createBranch(work, 'feature/kept-2', 'master', false)
    const ex = await addWorktree(work, 'feature/kept-2', 'master', { existing: true })
    expect(ex).toMatchObject({ path: join(dir, 'feature-kept-2'), branch: 'feature/kept-2', base: 'master' })
    expect((await status(ex.path)).branch).toBe('feature/kept-2')
    // git checks a branch out in one place only
    await expect(addWorktree(work, 'feature/kept-2', 'master', { existing: true })).rejects.toThrow()

    // removing without discard refuses uncommitted files; the branch stays unless asked
    writeFileSync(join(typed.path, 'wip.txt'), 'wip\n')
    expect(await worktreeStatus(typed)).toMatchObject({ exists: true, untracked: 1 })
    await expect(removeWorktree(typed, { deleteBranch: false, discard: false })).rejects.toThrow()
    expect(existsSync(typed.path)).toBe(true)
    await removeWorktree(typed, { deleteBranch: false, discard: true })
    expect(existsSync(typed.path)).toBe(false)
    expect(g(work, 'branch', '--list', 'plain').trim()).not.toBe('')
    await removeWorktree(ex, { deleteBranch: true, discard: false })
    expect(g(work, 'branch', '--list', 'feature/kept-2').trim()).toBe('')
  })
})
