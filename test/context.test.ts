import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Mission } from '@shared/types'
import {
  MAP_SKILL,
  contextPointer,
  extractPaths,
  ftsQuery,
  hitLine,
  normalizePath,
  parseDoc,
  parseMemory,
  parsePinned,
  parseSkill,
  pathMatches,
  pinnedEntry,
  rankHits,
  recallText,
  staleness,
  writtenAt,
  type ContextHit
} from '@shared/context'
import { memoryEntry } from '@shared/memory'
import { BUILTIN_KINDS, renderKind } from '@shared/missionKinds'
import { closeContext, ensureIndex, initContext, installMapSkill, list, pin, recall, search, unpin } from '../src/main/context'
import { forget, remember } from '../src/main/memory'
import { handleMcp } from '../src/main/mcp'

const hit = (o: Partial<ContextHit>): ContextHit => ({ id: 1, score: 1, kind: 'learning', source: '.sldev/memory.md', line: 6, title: 'x', body: 'x', paths: [], ...o })

describe('project context: parsing', () => {
  it('finds file paths in notes, and keeps out what is not one', () => {
    expect(extractPaths('Edit `src/main/pty.ts` and package.json, not v1.2 or 0.1.0; see scripts/e2e/ and https://x.io/a/b.')).toEqual(['src/main/pty.ts', 'package.json', 'scripts/e2e'])
    expect(extractPaths('the `npm run dev` command at src/a.ts:12, ./b/c.md')).toEqual(['src/a.ts', 'b/c.md'])
    expect(extractPaths('nothing here at all')).toEqual([])
  })

  it('normalizes paths to the project, and refuses ones outside it', () => {
    expect(normalizePath('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
    expect(normalizePath('C:\\repo\\src\\a.ts', 'C:\\repo')).toBe('src/a.ts')
    expect(normalizePath('./src/')).toBe('src')
    expect(normalizePath('../etc/passwd')).toBeUndefined()
    expect(normalizePath('/etc/passwd', '/repo')).toBeUndefined()
    expect(normalizePath('/repo', '/repo')).toBeUndefined()
    expect(pathMatches('src/main', 'src/main/pty.ts') && pathMatches('src/main/pty.ts', 'src/main') && !pathMatches('src/ma', 'src/main')).toBe(true)
  })

  it('reads memory lines with their day, origin and files', () => {
    const text = [
      '# Project memory',
      '',
      memoryEntry('Tests need Postgres: docker compose up db', 'codex, mission "Fix (login)"', new Date(2026, 9, 30), ['docker-compose.yml']),
      memoryEntry('The `src/main/pty.ts` batching needs acks', 'you', new Date(2026, 9, 31)),
      '- not a dated line'
    ].join('\n')
    const [a, b] = parseMemory(text)
    expect(parseMemory(text)).toHaveLength(2)
    expect(a).toMatchObject({ kind: 'learning', line: 3, day: '2026-10-30', title: 'Tests need Postgres: docker compose up db (codex, mission "Fix (login)")', paths: ['docker-compose.yml'] })
    expect(b).toMatchObject({ line: 4, title: 'The `src/main/pty.ts` batching needs acks', origin: 'you', paths: ['src/main/pty.ts'] })
  })

  it('writes the files a note is about at the end of its line', () => {
    expect(memoryEntry('Run it · files: x', 'you', new Date(2026, 0, 2), ['a.ts', 'b,c.ts', 'a.ts'])).toBe('- 2026-01-02: Run it - files: x (you) · files: a.ts, bc.ts')
  })

  it('splits docs into sections by heading, ignoring headings in code blocks', () => {
    const doc = ['---', 'title: x', '---', 'Intro text', '# Architecture', 'Main is `src/main/index.ts`.', '```', '# not a heading', '```', '## Data flow', 'renderer → preload'].join('\n')
    const nodes = parseDoc(doc, '.sldev/context/architecture.md')
    expect(nodes.map((n) => [n.title, n.line])).toEqual([['architecture', 1], ['Architecture', 5], ['Data flow', 10]])
    expect(nodes[1].paths).toEqual(['src/main/index.ts'])
    expect(nodes[1].body).toContain('# not a heading')
  })

  it('reads skills and pinned files', () => {
    expect(parseSkill('---\nname: verify\ndescription: "Run the app"\n---\nUse scripts/e2e/run.cjs', '.claude/skills/verify/SKILL.md')).toMatchObject({ title: 'Skill: verify', paths: ['scripts/e2e/run.cjs'] })
    expect(parsePinned(`# Pinned\n\n${pinnedEntry('docs/arch.md', 'the big picture')}\n${pinnedEntry('src/x.ts')}\n- \`../out\``)).toEqual([
      { path: 'docs/arch.md', note: 'the big picture', line: 3 },
      { path: 'src/x.ts', note: undefined, line: 4 }
    ])
  })
})

describe('project context: ranking, staleness and prompts', () => {
  it('searches for the meaningful words of a brief, safely quoted', () => {
    expect(ftsQuery('Fix the "login" flow; add tests for it')).toBe('"login" OR "flow" OR "tests"')
    expect(ftsQuery('do it')).toBeNull()
  })

  it('puts notes about files the brief names first, and learnings above docs', () => {
    const kinds = new Map([[1, 'doc'], [2, 'learning'], [3, 'doc']] as const)
    expect(rankHits([{ id: 1, bm25: -2 }, { id: 2, bm25: -2 }], [3], new Map(kinds), 5).map((h) => h.id)).toEqual([3, 2, 1])
    expect(rankHits([{ id: 1, bm25: -2 }], [], new Map(kinds), 0)).toEqual([])
  })

  it('flags a note when a file it is about changed after it was written, or is gone', () => {
    const written = writtenAt({ day: '2026-10-30' }, undefined)!
    expect(new Date(written).getDate()).toBe(31)
    const times = new Map<string, number | undefined>([['a.ts', written - 1], ['b.ts', written + 1], ['gone.ts', undefined]])
    expect(staleness(['a.ts'], written, times)).toBeUndefined()
    expect(staleness(['a.ts', 'b.ts'], written, times)).toEqual({ path: 'b.ts', why: 'changed' })
    expect(staleness(['gone.ts'], written, times)).toEqual({ path: 'gone.ts', why: 'missing' })
    expect(staleness(['b.ts'], written, times, 'b.ts')).toBeUndefined()
    expect(staleness(['unknown.ts'], written, times)).toBeUndefined()
  })

  it('lists matching notes in the prompt with absolute paths, and tells agents with tools how to use them', () => {
    const h = [hit({ title: 'Tests need Postgres', day: '2026-10-30', stale: { path: 'docker-compose.yml', why: 'changed' } }), hit({ id: 2, kind: 'doc', source: '.sldev/context/commands.md', line: 1, title: 'Commands' })]
    expect(hitLine(h[0], '/p')).toBe('- /p/.sldev/memory.md:6: Tests need Postgres (2026-10-30) [may be out of date: docker-compose.yml changed since]')
    expect(hitLine(h[1], 'C:\\p')).toBe('- C:\\p\\.sldev\\context\\commands.md: Commands')
    const full = contextPointer(h, '/p', { memoryPath: '/p/.sldev/memory.md', memoryExists: true, tools: true })
    expect(full).toMatch(/^Project memory: .* in \/p\/\.sldev\/memory\.md\./)
    expect(full).toContain('Project context that looks relevant to this task')
    expect(full).toContain('sldev_recall')
    expect(full).toContain('sldev_remember')
    expect(contextPointer([], '/p', { memoryPath: 'm', memoryExists: false, tools: true })).toMatch(/^If you learn something/)
    expect(contextPointer([], '/p', { memoryPath: 'm', memoryExists: false, tools: false })).toBe('')
    expect(recallText([], '/p')).toMatch(/^Nothing in the project context matches/)
    expect(recallText([hit({ origin: 'you', paths: ['a.ts'] })], '/p', ['b.ts'])).toContain('from you · files: a.ts')
  })

  it('has a Map kind and skill that write only to .sldev', () => {
    const map = BUILTIN_KINDS.find((k) => k.id === 'map')!
    const prompt = renderKind(map, { title: 'Map this project', brief: '' })
    expect(prompt.startsWith('Mission: Map this project\n\nWrite reference docs')).toBe(true)
    expect(prompt).toContain('Create or change files only in .sldev/context/ and .sldev/skills/. Do not commit.')
    expect(MAP_SKILL).toMatch(/^---\nname: map-project\ndescription: /)
  })
})

describe('project context: the index', () => {
  let root = ''
  let data = ''
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_COMMITTER_DATE: '2026-01-01T00:00:00', GIT_AUTHOR_DATE: '2026-01-01T00:00:00' } })
  const write = (rel: string, text: string): void => {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), text)
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'sldev-ctx-'))
    data = mkdtempSync(join(tmpdir(), 'sldev-ctx-data-'))
    initContext(data)
    git('init', '-q')
    git('config', 'user.email', 't@t')
    git('config', 'user.name', 't')
    write('src/server/auth.ts', 'export const login = 1\n')
    write('src/ui/app.tsx', 'export {}\n')
    write('docker-compose.yml', 'services: {}\n')
    write('docs/arch.md', '# Big picture\nThe server signs tokens.\n')
    git('add', '.')
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'init')
    write('.sldev/memory.md', `# Project memory\n\n${memoryEntry('Integration tests need Postgres: docker compose up db', 'codex', new Date(2026, 5, 1), ['docker-compose.yml'])}\n${memoryEntry('Login tokens are signed in src/server/auth.ts with a 1h expiry', 'you', new Date(2025, 0, 1))}\n`)
    write('.sldev/context/architecture.md', '# Architecture\n\n## Authentication\nSessions start in `src/server/auth.ts`; the UI calls it from `src/ui/app.tsx`.\n\n## Releases\nTag and push.\n')
    write('.claude/skills/release/SKILL.md', '---\nname: release\ndescription: Cut a release and publish installers\n---\nSteps.\n')
  })
  afterAll(() => {
    closeContext()
    rmSync(root, { recursive: true, force: true })
    rmSync(data, { recursive: true, force: true })
  })

  it('finds learnings, doc sections and skills by topic', async () => {
    const hits = await search(root, 'Why do the integration tests fail? Postgres?')
    expect(hits[0]).toMatchObject({ kind: 'learning', title: expect.stringContaining('Postgres'), paths: ['docker-compose.yml'] })
    expect((await search(root, 'publish a release')).map((h) => h.title)).toEqual(expect.arrayContaining(['Skill: release', 'Releases']))
  })

  it('links notes to the files they mention, and finds them by file', async () => {
    const hits = await search(root, 'refactor src/server/auth.ts')
    expect(hits.slice(0, 2).map((h) => h.title).sort()).toEqual(['Authentication', expect.stringContaining('Login tokens')].sort())
    const { hits: about, related } = await recall(root, { path: 'src/server' })
    expect(about.map((h) => h.title)).toEqual(expect.arrayContaining(['Authentication']))
    expect(related).toContain('src/ui/app.tsx')
  })

  it('flags notes whose files changed after them, by commit time not checkout time', async () => {
    const before = await search(root, 'login tokens signed')
    expect(before.find((h) => h.title.startsWith('Login tokens'))?.stale).toEqual({ path: 'src/server/auth.ts', why: 'changed' })
    // a fresh checkout touches every file; the June note is newer than the January commit, so it is fine
    utimesSync(join(root, 'docker-compose.yml'), new Date(), new Date())
    expect((await search(root, 'Postgres integration tests'))[0].stale).toBeUndefined()
    rmSync(join(root, 'docker-compose.yml'))
    expect((await search(root, 'Postgres integration tests'))[0].stale).toEqual({ path: 'docker-compose.yml', why: 'missing' })
  })

  it('rebuilds when a source changes: remember, forget, pin, unpin, and the Map skill', async () => {
    await remember(root, 'Feature flags live in src/ui/app.tsx', 'you')
    expect((await search(root, 'feature flags'))[0]).toMatchObject({ title: 'Feature flags live in src/ui/app.tsx', origin: 'you', paths: ['src/ui/app.tsx'] })
    const entry = (await list(root)).nodes.find((n) => n.title.startsWith('Feature flags'))!
    await expect(forget(root, entry.line, 'something else')).rejects.toThrow(/changed/)
    await forget(root, entry.line, entry.title)
    expect(readFileSync(join(root, '.sldev/memory.md'), 'utf8')).not.toContain('Feature flags')

    expect(await pin(root, join(root, 'docs/arch.md'), 'the big picture')).toBe('docs/arch.md')
    await pin(root, 'docs/arch.md')
    expect(readFileSync(join(root, '.sldev/pinned.md'), 'utf8').match(/docs\/arch\.md/g)).toHaveLength(1)
    await expect(pin(root, '/etc/passwd')).rejects.toThrow(/inside the project/)
    const pinned = await search(root, 'signs tokens big picture')
    expect(pinned.map((h) => h.kind)).toContain('file')
    let l = await list(root)
    expect(l.stats).toMatchObject({ learnings: 2, docs: 2, files: 1, skills: 1 })
    await unpin(root, 'docs/arch.md')
    l = await list(root)
    expect(l.stats.files).toBe(0)

    const skill = await installMapSkill(root)
    expect(readFileSync(skill, 'utf8')).toBe(MAP_SKILL)
    await ensureIndex(root, true)
    expect((await list(root)).stats.skills).toBe(2)
  })

  it('answers sldev_recall and stores the files given to sldev_remember', async () => {
    const self = { id: 'a', root, cwd: join(root, '.wt'), title: 'Auth work', options: { agent: 'codex' } } as unknown as Mission
    const deps = { missions: () => [self], send: () => undefined }
    expect((await handleMcp({ mission: 'a', tool: 'sldev_recall', args: {}, cwd: root }, deps)).error).toMatch(/query, a path/)
    const r = await handleMcp({ mission: 'a', tool: 'sldev_recall', args: { path: join(root, 'src/server/auth.ts') }, cwd: root }, deps)
    expect(r.text).toContain('Authentication')
    expect(r.text).toContain('Related files')
    await handleMcp({ mission: 'a', tool: 'sldev_remember', args: { note: 'Auth has a rate limit', paths: [join(root, '.wt', 'src/server/auth.ts'), 42] }, cwd: root }, deps)
    expect(readFileSync(join(root, '.sldev/memory.md'), 'utf8')).toMatch(/Auth has a rate limit \(codex, mission "Auth work"\) · files: src\/server\/auth\.ts\n$/)
  })
})
