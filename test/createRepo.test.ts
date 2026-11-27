import { execFileSync } from 'child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createdRepoUrl, createRepoArgs, isRepoNotFound, repoNameProblem, repoOwners } from '@shared/newProject'
import { createRepo, listRepoOwners, repoPushPlan } from '../src/main/github'

describe('the Create repository helpers', () => {
  it('builds gh repo create from the folder, with origin and the push', () => {
    const r = { dir: '/p/adder', owner: 'acme', name: 'adder', visibility: 'private' as const, description: '' }
    expect(createRepoArgs(r)).toEqual(['repo', 'create', 'acme/adder', '--private', '--source', '/p/adder', '--remote', 'origin', '--push'])
    expect(createRepoArgs({ ...r, visibility: 'public', description: ' Adds\n numbers ' })).toEqual([
      'repo', 'create', 'acme/adder', '--public', '--source', '/p/adder', '--remote', 'origin', '--push', '--description', 'Adds numbers'
    ])
  })
  it('checks names as GitHub does', () => {
    expect(repoNameProblem('weather-cli')).toBeNull()
    expect(repoNameProblem('a.b_c-1')).toBeNull()
    expect(repoNameProblem('')).toMatch(/name/)
    expect(repoNameProblem('..')).toMatch(/another/)
    expect(repoNameProblem('my app')).toMatch(/letters/)
    expect(repoNameProblem('a/b')).toMatch(/letters/)
    expect(repoNameProblem('x'.repeat(101))).toMatch(/100/)
  })
  it('lists the user first, then their organizations, once each', () => {
    expect(repoOwners('e2e', [{ login: 'acme' }, { login: 'e2e' }, { login: '' }, null, 'beta'])).toEqual(['e2e', 'acme', 'beta'])
    expect(repoOwners('e2e', 'nope')).toEqual(['e2e'])
  })
  it('tells a missing repository from a failure to ask', () => {
    expect(isRepoNotFound("GraphQL: Could not resolve to a Repository with the name 'acme/x'. (repository)")).toBe(true)
    expect(isRepoNotFound('HTTP 404: Not Found')).toBe(true)
    expect(isRepoNotFound('error connecting to api.github.com')).toBe(false)
  })
  it('reads the URL gh printed', () => {
    expect(createdRepoUrl('✓ Created repository acme/adder on GitHub\n  https://github.com/acme/adder\n', 'acme', 'adder')).toBe('https://github.com/acme/adder')
    expect(createdRepoUrl('', 'acme', 'adder')).toBe('https://github.com/acme/adder')
  })
})

// main's createRepo against a fake gh on PATH: it records `repo create` and, like gh, adds origin and pushes to a bare repo
describe.skipIf(process.platform === 'win32')('createRepo', () => {
  let tmp: string
  let dir: string
  let path0: string | undefined
  const log = (): string[] => (existsSync(join(tmp, 'calls.txt')) ? readFileSync(join(tmp, 'calls.txt'), 'utf8').trim().split('\n') : [])
  const creates = (): string[] => log().filter((l) => l.startsWith('repo create'))
  const git = (...a: string[]): string => execFileSync('git', a, { cwd: dir }).toString().trim()
  const req = (name: string, more: object = {}) => ({ dir, owner: 'acme', name, visibility: 'private' as const, description: '', ...more })

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sldev-create-repo-'))
    mkdirSync(join(tmp, 'bin'))
    mkdirSync(join(tmp, 'remotes'))
    writeFileSync(
      join(tmp, 'bin', 'gh'),
      `#!/bin/sh
echo "$*" >> "${tmp}/calls.txt"
[ -f "${tmp}/logged-out" ] && { echo "You are not logged into any GitHub hosts." >&2; exit 1; }
case "$1 $2" in
  "auth status") exit 0 ;;
  "api user") echo '{"login":"e2e"}'; exit 0 ;;
  "api user/orgs") echo '[{"login":"acme"}]'; exit 0 ;;
  "repo view")
    [ -d "${tmp}/remotes/$3.git" ] && { echo "{\\"nameWithOwner\\":\\"$3\\"}"; exit 0; }
    [ "$3" = "acme/offline" ] && { echo "error connecting to api.github.com" >&2; exit 1; }
    echo "GraphQL: Could not resolve to a Repository with the name '$3'. (repository)" >&2; exit 1 ;;
  "repo create")
    case "$3" in */boom) echo "HTTP 422: Repository creation failed." >&2; exit 1 ;; esac
    bare="${tmp}/remotes/$3.git"; mkdir -p "$bare"; git init -q --bare "$bare"
    git -C "$6" remote add origin "$bare"
    case "$3" in */nopush) echo "error: failed to push some refs" >&2; exit 1 ;; esac
    git -C "$6" push -q -u origin HEAD 2>/dev/null
    echo "https://github.com/$3"; exit 0 ;;
esac
exit 1
`
    )
    chmodSync(join(tmp, 'bin', 'gh'), 0o755)
    path0 = process.env.PATH
    process.env.PATH = `${join(tmp, 'bin')}${delimiter}${path0}`
    mkdirSync(join(tmp, 'remotes', 'acme', 'taken.git'), { recursive: true })
  })
  afterAll(() => {
    process.env.PATH = path0
    rmSync(tmp, { recursive: true, force: true })
  })
  beforeEach(() => {
    dir = mkdtempSync(join(tmp, 'project-'))
    git('init', '-q', '-b', 'main')
    writeFileSync(join(dir, 'README.md'), '# adder\n')
    git('add', '-A')
    git('-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-qm', 'Initial project setup')
    rmSync(join(tmp, 'calls.txt'), { force: true })
  })

  it('lists the owners from gh api', async () => {
    expect(await listRepoOwners()).toEqual({ owners: ['e2e', 'acme'] })
  })
  it('says what a first push carries', async () => {
    expect(await repoPushPlan(dir)).toEqual({ branch: 'main', commits: 1, origin: null })
  })
  it('creates the repository, sets origin and pushes the first commit', async () => {
    expect(await createRepo(req('adder', { description: 'Adds' }))).toBe('https://github.com/acme/adder')
    expect(creates()).toEqual([`repo create acme/adder --private --source ${dir} --remote origin --push --description Adds`])
    expect(git('remote', 'get-url', 'origin')).toBe(join(tmp, 'remotes', 'acme', 'adder.git'))
    expect(execFileSync('git', ['--git-dir', join(tmp, 'remotes', 'acme', 'adder.git'), 'log', '--format=%s', 'main']).toString().trim()).toBe('Initial project setup')
  })
  it('refuses a name that exists before creating anything', async () => {
    await expect(createRepo(req('taken'))).rejects.toThrow(/acme\/taken already exists/)
    expect(creates()).toEqual([])
    expect(git('remote')).toBe('')
  })
  it('refuses when it can’t tell whether the name is free', async () => {
    await expect(createRepo(req('offline'))).rejects.toThrow(/Couldn’t check.*error connecting/)
    expect(creates()).toEqual([])
  })
  it('refuses bad names, a project with an origin or without a commit, and a logged-out gh', async () => {
    await expect(createRepo(req('my app'))).rejects.toThrow(/letters/)
    git('remote', 'add', 'origin', 'https://example.com/x.git')
    await expect(createRepo(req('adder2'))).rejects.toThrow(/already has a remote/)
    git('remote', 'remove', 'origin')
    const empty = mkdtempSync(join(tmp, 'empty-'))
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: empty })
    await expect(createRepo({ ...req('adder3'), dir: empty })).rejects.toThrow(/no commit/)
    writeFileSync(join(tmp, 'logged-out'), '')
    try {
      await expect(createRepo(req('adder4'))).rejects.toThrow(/Not logged in/)
    } finally {
      rmSync(join(tmp, 'logged-out'))
    }
    expect(creates()).toEqual([])
  })
  it('shows gh’s error and leaves the project as it was', async () => {
    await expect(createRepo(req('boom'))).rejects.toThrow(/HTTP 422: Repository creation failed/)
    expect(git('remote')).toBe('')
    expect(git('log', '--format=%s')).toBe('Initial project setup')
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('# adder\n')
  })
  it('says how to finish when the repository was made but the push failed', async () => {
    await expect(createRepo(req('nopush'))).rejects.toThrow(/push didn’t finish.*git push -u origin main/s)
  })
})
