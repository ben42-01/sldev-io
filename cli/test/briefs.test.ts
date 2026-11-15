import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BUILTIN_KINDS } from '@shared/missionKinds'
import { parseMissionDraft } from '@shared/sldevSkills'
import { connect, type Client } from '../src/client'
import { startDaemon, type Daemon } from '../src/daemon'
import { briefArgs, briefsDir, cliKinds, cliRoot, findBrief, launchBrief, launchedDir, listBriefs, newBriefFile, readBrief, takeEditedBrief, withLaunch } from '../src/briefs'
import { removeTemp, useFakeAgents } from './fakePath'

/** Briefs in .sldev-cli/briefs: read, listed, launched through a real daemon with the fake codex, moved, refused. */

const tmp = mkdtempSync(join(tmpdir(), 'sldev-briefs-'))
const data = join(tmp, 'data')
const repo = join(tmp, 'repo')
let daemon: Daemon
let c: Client
let restorePath: () => void
const git = (...a: string[]): string => execFileSync('git', a, { cwd: repo, encoding: 'utf8' })

const brief = (name: string, text: string): string => {
  mkdirSync(briefsDir(repo), { recursive: true })
  const f = join(briefsDir(repo), name)
  writeFileSync(f, text)
  return f
}

beforeAll(async () => {
  restorePath = useFakeAgents()
  mkdirSync(repo, { recursive: true })
  writeFileSync(join(repo, 'app.js'), "console.log('hi')\n")
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
  daemon = await startDaemon({ dataDir: data, notify: () => undefined })
  c = await connect({ dataDir: data, script: '', start: false })
})

afterAll(async () => {
  c?.close()
  await daemon?.close()
  restorePath()
  removeTemp(tmp)
})

describe('reading a brief', () => {
  it('takes the mission draft front matter and the brief under it', () => {
    const b = readBrief('/x/fix-login.md', '---\ntitle: Fix login\nkind: plan\nagent: codex\nworktree: true\ncriteria:\n  - logs in\n  - npm test passes\nby: claude\n---\n\nThe login form loops.\n', BUILTIN_KINDS)
    expect(b.error).toBeUndefined()
    expect(b.slug).toBe('fix-login')
    expect(b.draft).toMatchObject({ title: 'Fix login', kind: 'plan', agent: 'codex', worktree: true, criteria: '- logs in\n- npm test passes', by: 'claude', brief: 'The login form loops.' })
    expect(briefArgs(b.draft!, { cwd: '/w' })).toMatchObject({ agent: 'codex', kind: 'plan', criteria: '- logs in\n- npm test passes', worktree: 'fix/login' })
    expect(briefArgs(b.draft!, { cwd: '/w', agent: 'claude' }).agent).toBe('claude')
  })

  it('refuses an empty brief, an unknown kind and criteria on a freeform brief, with the reason', () => {
    expect(readBrief('/x/a.md', '---\ntitle: nothing\n---\n', BUILTIN_KINDS).error).toMatch(/brief is empty/)
    expect(readBrief('/x/a.md', '---\nkind: nope\n---\ndo it', BUILTIN_KINDS).error).toMatch(/Unknown kind "nope"/)
    expect(readBrief('/x/a.md', '---\nkind: freeform\ncriteria: [x]\n---\ndo it', BUILTIN_KINDS).error).toMatch(/freeform/)
    expect(readBrief('/x/a.md', '---\ntitle: [oops\n  bad: {\n---\ndo it', BUILTIN_KINDS).error).toMatch(/isn't valid YAML/)
    // the app's reading of the same file still makes an unknown kind a build
    expect(parseMissionDraft('---\nkind: nope\n---\ndo it').draft?.kind).toBe('build')
  })

  it('notes the pane in the front matter, which still reads the same', () => {
    const at = new Date('2026-11-15T10:00:00Z')
    const src = withLaunch('---\ntitle: A\nkind: plan\n---\nbody\n', '7', at)
    expect(src).toBe('---\ntitle: A\nkind: plan\npane: "7"\nlaunched: "2026-11-15T10:00:00.000Z"\n---\nbody\n')
    expect(parseMissionDraft(src).draft).toMatchObject({ title: 'A', kind: 'plan', brief: 'body' })
    expect(withLaunch('just a brief', '3', at)).toMatch(/^---\npane: "3"\nlaunched: ".*"\n---\n\njust a brief$/)
  })
})

describe('the .sldev-cli folder', () => {
  it('is at the main checkout, also from inside a worktree', async () => {
    git('worktree', 'add', '-q', '-b', 'side', join(tmp, 'side'))
    expect(await cliRoot(join(tmp, 'side'))).toBe(resolve(repo))
    expect(await cliRoot(repo)).toBe(resolve(repo))
  })

  it('reads the project kinds from .sldev-cli/kinds, not .sldev/missions', async () => {
    mkdirSync(join(repo, '.sldev-cli', 'kinds'), { recursive: true })
    mkdirSync(join(repo, '.sldev', 'missions'), { recursive: true })
    writeFileSync(join(repo, '.sldev-cli', 'kinds', 'spike.md'), '---\nname: Spike\ndescription: try it\n---\nSPIKE CLOSING LINE\n\n{brief}\n\n{criteria}\n')
    writeFileSync(join(repo, '.sldev', 'missions', 'apponly.md'), '---\nname: AppOnly\n---\nAPP KIND\n\n{brief}\n')
    const names = (await cliKinds(repo, data)).map((k) => k.name)
    expect(names).toContain('Spike')
    expect(names).not.toContain('AppOnly')
    await expect(c.request('new', { agent: 'codex', brief: 'x', kind: 'apponly', cwd: repo })).rejects.toThrow(/Unknown mission kind/)
  })
})

describe('sldev new --criteria', () => {
  it('puts the criteria into the kind’s prompt, and needs a kind for them', async () => {
    const p = await c.request('new', { agent: 'codex', brief: 'Tidy the parser', kind: 'build', criteria: '- parser.test.ts passes', worktree: false, cwd: repo })
    expect(p.prompt).toContain('Acceptance criteria:\n- parser.test.ts passes')
    expect(p.criteria).toBe('- parser.test.ts passes')
    await c.request('kill', { pane: p.id })
    await expect(c.request('new', { agent: 'codex', brief: 'x', criteria: '- y', cwd: repo })).rejects.toThrow(/add --kind/)
    await expect(c.request('new', { agent: 'codex', brief: 'x', kind: 'freeform', criteria: '- y', cwd: repo })).rejects.toThrow(/freeform/)
  })
})

describe('listing and launching briefs', () => {
  it('lists the waiting ones, launches one with its kind and criteria, and moves it to launched/', async () => {
    const kinds = await cliKinds(repo, data)
    const f = brief('tidy-tests.md', '---\ntitle: Tidy the tests\nkind: build\nagent: codex\nworktree: false\ncriteria:\n  - npm test passes\n---\n\nRemove the duplicated fixtures.\n')
    brief('.new-123.md', '---\n---\nbeing written\n')
    brief('spike-cache.md', '---\nkind: spike\nagent: codex\nworktree: false\n---\nTry a cache.\n')
    const listed = await listBriefs(repo, kinds)
    expect(listed.map((b) => b.slug)).toEqual(['spike-cache', 'tidy-tests'])
    expect(findBrief(repo, 'tidy-tests', tmp)).toBe(f)
    expect(findBrief(repo, f, tmp)).toBe(f)

    const r = await launchBrief(c, repo, f, kinds, { cwd: repo })
    expect(r.pane.agentName).toBe('Codex')
    expect(r.pane.kind?.id).toBe('build')
    expect(r.pane.prompt).toContain('Remove the duplicated fixtures.')
    expect(r.pane.prompt).toContain('Acceptance criteria:\n- npm test passes')
    // the build kind's closing lines
    expect(r.pane.prompt).toContain('Do not commit, push or merge')
    expect(existsSync(f)).toBe(false)
    expect(r.moved).toBe(join(launchedDir(repo), 'tidy-tests.md'))
    expect(readFileSync(r.moved, 'utf8')).toContain(`pane: "${r.pane.id}"`)
    expect((await listBriefs(repo, kinds)).map((b) => b.slug)).toEqual(['spike-cache'])
    expect(() => findBrief(repo, r.moved, tmp)).toThrow(/launched already/)
    // the folder keeps itself out of git
    expect(readFileSync(join(repo, '.sldev-cli', '.gitignore'), 'utf8')).toMatch(/^\*$/m)
    expect(git('status', '--porcelain')).not.toContain('.sldev-cli')

    // a project kind from .sldev-cli/kinds, named in the brief
    const s = await launchBrief(c, repo, join(briefsDir(repo), 'spike-cache.md'), kinds, { cwd: repo })
    expect(s.pane.prompt).toContain('SPIKE CLOSING LINE')
    await c.request('kill', { pane: r.pane.id })
    await c.request('kill', { pane: s.pane.id })
  })

  it('refuses a bad brief, or one the daemon refuses, and leaves it where it is', async () => {
    const kinds = await cliKinds(repo, data)
    const bad = brief('bad.md', '---\ntitle: no body\n---\n')
    await expect(launchBrief(c, repo, bad, kinds, { cwd: repo })).rejects.toThrow(/bad: The brief is empty.*stays/)
    const agent = brief('agent.md', '---\nagent: nope\n---\nsomething\n')
    await expect(launchBrief(c, repo, agent, kinds, { cwd: repo })).rejects.toThrow(/Unknown agent "nope".*stays/)
    expect(existsSync(bad) && existsSync(agent)).toBe(true)
    expect(readdirSync(launchedDir(repo))).toEqual(['tidy-tests.md', 'spike-cache.md'].sort())
    expect(() => findBrief(repo, 'missing', repo)).toThrow(/No brief "missing"/)
  })

  it('takes a brief written in the editor, and drops one left empty', async () => {
    const empty = await newBriefFile(repo, 'codex')
    expect(await takeEditedBrief(repo, empty)).toBeNull()
    expect(existsSync(empty)).toBe(false)
    const f = await newBriefFile(repo, 'codex')
    const tpl = readFileSync(f, 'utf8')
    expect(tpl).toContain('agent: codex')
    writeFileSync(f, tpl.replace('title: ', 'title: Write the docs').replace(/-->\n/, '-->\nDocument the briefs folder.\n'))
    const saved = await takeEditedBrief(repo, f)
    expect(saved).toBe(join(briefsDir(repo), 'write-the-docs.md'))
    const b = readBrief(saved!, readFileSync(saved!, 'utf8'), BUILTIN_KINDS)
    expect(b.draft).toMatchObject({ title: 'Write the docs', agent: 'codex', kind: 'build', worktree: false, brief: 'Document the briefs folder.' })
    expect(b.draft?.criteria).toBeUndefined()
    expect(readFileSync(saved!, 'utf8')).not.toContain('sldev:')
  })
})

describe('the CLI and the app keep their inboxes apart', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : []))
  const root = resolve(__dirname, '../..')

  it('the app never mentions .sldev-cli', () => {
    const hits = [...files(join(root, 'src/main')), ...files(join(root, 'src/renderer')), ...files(join(root, 'src/preload'))].filter((f) => readFileSync(f, 'utf8').includes('.sldev-cli'))
    expect(hits).toEqual([])
  })

  it('the CLI never uses the drafts inbox', () => {
    const hits = files(join(root, 'cli/src')).filter((f) => /\b(listDrafts|settleDraft|prepareDrafts|DRAFTS_DIR)\b/.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
})
