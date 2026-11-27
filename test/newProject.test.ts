import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cloneError, cloneProgress, filterRepos, folderNameProblem, newProjectBrief, parseCloneInput, parseRepoList, projectSlug, repoFolderName } from '@shared/newProject'
import { cloneRepo, cloneTarget } from '../src/main/git'
import { createProjectFolder, readNewProjectResult } from '../src/main/newProject'

describe('parseCloneInput', () => {
  it('reads URLs, scp-style, local paths and owner/name', () => {
    expect(parseCloneInput('https://github.com/acme/shop')).toEqual({ url: 'https://github.com/acme/shop', name: 'shop' })
    expect(parseCloneInput('  https://gitlab.com/a/b/tool.git ')).toEqual({ url: 'https://gitlab.com/a/b/tool.git', name: 'tool' })
    expect(parseCloneInput('git@github.com:acme/shop.git')).toEqual({ url: 'git@github.com:acme/shop.git', name: 'shop' })
    expect(parseCloneInput('ssh://git@host:22/x/y.git')?.name).toBe('y')
    expect(parseCloneInput('/srv/git/shop.git')).toEqual({ url: '/srv/git/shop.git', name: 'shop' })
    expect(parseCloneInput('C:\\repos\\shop')?.name).toBe('shop')
    expect(parseCloneInput('acme/shop')).toEqual({ url: 'https://github.com/acme/shop', name: 'shop' })
    expect(parseCloneInput('acme/shop.git')).toEqual({ url: 'https://github.com/acme/shop', name: 'shop' })
    expect(parseCloneInput('github.com/acme/shop')).toEqual({ url: 'https://github.com/acme/shop', name: 'shop' })
  })
  it('leaves searches alone', () => {
    for (const q of ['', 'shop', 'rate limit', 'acme/', '/', 'a/b/c']) expect(parseCloneInput(q)).toBeNull()
  })
})

describe('repoFolderName and folderNameProblem', () => {
  it('names the folder like git does', () => {
    expect(repoFolderName('https://github.com/acme/shop/')).toBe('shop')
    expect(repoFolderName('acme/shop')).toBe('shop')
    expect(repoFolderName('git@h:shop.git')).toBe('shop')
  })
  it('refuses names that are not one folder', () => {
    expect(folderNameProblem('shop')).toBeNull()
    expect(folderNameProblem('my shop')).toBeNull()
    for (const n of ['', '  ', '.', '..', 'a/b', 'a\\b', 'a:b']) expect(folderNameProblem(n)).not.toBeNull()
  })
})

describe('parseRepoList and filterRepos', () => {
  const list = parseRepoList([
    { nameWithOwner: 'acme/old', description: null, isPrivate: false, updatedAt: '2025-01-01T00:00:00Z', url: 'https://github.com/acme/old' },
    { nameWithOwner: 'acme/shop', description: 'The web shop', isPrivate: true, updatedAt: '2026-11-01T00:00:00Z' },
    { description: 'no name' },
    null
  ])
  it('keeps named repos, newest first, with a URL', () => {
    expect(list.map((r) => r.nameWithOwner)).toEqual(['acme/shop', 'acme/old'])
    expect(list[0]).toMatchObject({ url: 'https://github.com/acme/shop', isPrivate: true, description: 'The web shop' })
    expect(list[1].description).toBe('')
    expect(parseRepoList({})).toEqual([])
  })
  it('filters by every word in name or description', () => {
    expect(filterRepos(list, '').length).toBe(2)
    expect(filterRepos(list, 'WEB').map((r) => r.nameWithOwner)).toEqual(['acme/shop'])
    expect(filterRepos(list, 'acme old').map((r) => r.nameWithOwner)).toEqual(['acme/old'])
    expect(filterRepos(list, 'nope')).toEqual([])
  })
})

describe('cloneProgress and cloneError', () => {
  it('reads the latest progress line', () => {
    expect(cloneProgress('')).toBeNull()
    expect(cloneProgress("Cloning into 'shop'...\n")).toEqual({ phase: 'Connecting', percent: null })
    const out = "Cloning into 'shop'...\nremote: Counting objects: 100% (5/5), done.\nReceiving objects:  12% (1/8)\rReceiving objects:  50% (4/8)\r"
    expect(cloneProgress(out)).toEqual({ phase: 'Receiving objects', percent: 50 })
    expect(cloneProgress(out + 'Resolving deltas:   3% (1/30)\r')).toEqual({ phase: 'Resolving deltas', percent: 3 })
  })
  it('keeps the message, not the progress', () => {
    expect(cloneError("Cloning into 'x'...\nReceiving objects:  50% (4/8)\rfatal: repository 'x' does not exist\n")).toBe("fatal: repository 'x' does not exist")
    expect(cloneError('')).toBe('git clone failed.')
  })
})

describe('cloneTarget and cloneRepo', () => {
  let tmp: string
  let bare: string
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sldev-clone-'))
    const src = join(tmp, 'src')
    mkdirSync(src)
    const g = (...a: string[]): void => void execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: src, stdio: 'ignore' })
    g('init', '-q', '-b', 'main')
    writeFileSync(join(src, 'README.md'), 'hi\n')
    g('add', '.')
    g('commit', '-qm', 'init')
    bare = join(tmp, 'shop.git')
    execFileSync('git', ['clone', '-q', '--bare', src, bare], { stdio: 'ignore' })
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('says why a target cannot be used', async () => {
    mkdirSync(join(tmp, 'parent', 'full'), { recursive: true })
    writeFileSync(join(tmp, 'parent', 'full', 'x'), '')
    mkdirSync(join(tmp, 'parent', 'empty'))
    writeFileSync(join(tmp, 'parent', 'file'), '')
    const p = join(tmp, 'parent')
    expect(await cloneTarget(p, 'new')).toEqual({ dest: join(p, 'new'), problem: null })
    expect((await cloneTarget(p, 'empty')).problem).toBeNull()
    expect((await cloneTarget(p, 'full')).problem).toMatch(/isn’t empty/)
    expect((await cloneTarget(p, 'file')).problem).toMatch(/is a file/)
    expect((await cloneTarget(join(tmp, 'missing'), 'x')).problem).toMatch(/doesn’t exist/)
    expect((await cloneTarget(p, 'a/b')).problem).toMatch(/slash/)
    expect((await cloneTarget('~', 'x')).dest).toBe(join(homedir(), 'x'))
  })

  it('clones, passing git’s progress along', async () => {
    let out = ''
    const dest = join(tmp, 'parent', 'shop')
    await cloneRepo(bare, dest, (t) => (out += t))
    expect(existsSync(join(dest, 'README.md'))).toBe(true)
    expect(out).toMatch(/Cloning into/)
  })

  it('refuses a non-empty folder without touching it', async () => {
    await expect(cloneRepo(bare, join(tmp, 'parent', 'full'), () => undefined)).rejects.toThrow(/isn’t empty/)
    expect(readdirSync(join(tmp, 'parent', 'full'))).toEqual(['x'])
  })

  it('removes what a failed clone left, and keeps an empty folder that was there', async () => {
    await expect(cloneRepo(join(tmp, 'nope.git'), join(tmp, 'parent', 'gone'), () => undefined)).rejects.toThrow(/does not exist|not appear to be a git repository/)
    expect(existsSync(join(tmp, 'parent', 'gone'))).toBe(false)
    await expect(cloneRepo(join(tmp, 'nope.git'), join(tmp, 'parent', 'empty'), () => undefined)).rejects.toThrow()
    expect(readdirSync(join(tmp, 'parent', 'empty'))).toEqual([])
  })

  it('stops on cancel and removes the partial folder', async () => {
    const ac = new AbortController()
    ac.abort()
    const dest = join(tmp, 'parent', 'cancelled')
    await expect(cloneRepo(bare, dest, () => undefined, ac.signal)).rejects.toThrow('Cancelled.')
    expect(existsSync(dest)).toBe(false)
  })
})

describe('Start from scratch', () => {
  it('names the folder from the description when no name is given', () => {
    expect(projectSlug('A command-line weather app in Rust that prints the forecast')).toBe('command-line-weather-rust')
    expect(projectSlug('Invoice API\nwith Postgres')).toBe('invoice-api')
    expect(projectSlug('!!!')).toBe('new-project')
    expect(folderNameProblem(projectSlug('Ein Tool für Ärzte: Termine'))).toBeNull()
  })
  it('tells the agent the name and license picked', () => {
    expect(newProjectBrief({ description: ' A Go API \n', name: 'pets-api', license: 'MIT' })).toBe('A Go API\n\nName: pets-api (use it as the repository name)\nLicense: MIT')
    expect(newProjectBrief({ description: 'A Go API', license: 'Apache-2.0' })).toMatch(/Name: none given; suggest one/)
  })
  it('creates only a missing or empty folder, and reads the result the mission leaves', async () => {
    const base = mkdtempSync(join(tmpdir(), 'sldev-scratch-'))
    const dest = join(base, 'fresh')
    expect(await createProjectFolder(dest)).toBe(dest)
    expect(readdirSync(dest)).toEqual([])
    expect(await createProjectFolder(dest)).toBe(dest)
    writeFileSync(join(dest, 'keep.txt'), 'mine')
    await expect(createProjectFolder(dest)).rejects.toThrow(/isn’t empty/)
    await expect(createProjectFolder('relative/x')).rejects.toThrow(/full path/)
    expect(await readNewProjectResult(dest)).toBeNull()
    mkdirSync(join(dest, '.sldev', 'runs'), { recursive: true })
    writeFileSync(join(dest, '.sldev', 'runs', 'new-project.json'), '{"name":"fresh"}')
    expect(await readNewProjectResult(dest)).toBe('{"name":"fresh"}')
    rmSync(base, { recursive: true, force: true })
  })
})
