import { mkdtempSync, promises as fsp, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { parseRecipe } from '../src/shared/factory'
import { parseEval } from '../src/shared/evals'
import { SKILLS_VERSION, SLDEV_SKILLS, checkSkillFile, copyState, draftKind, parseMissionDraft, parseStoriesDraft, skillFileKind, skillText, skillVersionOf } from '../src/shared/sldevSkills'
import { installSkills, listDrafts, settleDraft, skillsState } from '../src/main/sldevSkills'

const skill = (name: string): (typeof SLDEV_SKILLS)[number] => SLDEV_SKILLS.find((s) => s.name === name)!
/** the first ```<lang> block in a skill's text */
const example = (name: string, lang: string): string => new RegExp('```' + lang + '\\n([\\s\\S]*?)```').exec(skill(name).body)![1]

describe('the skills teach formats the app reads', () => {
  it('the recipe example is a valid recipe', () => {
    const r = parseRecipe(example('sldev-recipe', 'yaml'))
    expect(r.error).toBeUndefined()
    expect(r.recipe!.nodes.map((n) => n.kind)).toEqual(['agent', 'agent', 'run', 'agent', 'pr'])
  })
  it('the eval example is a valid eval', () => {
    const e = parseEval(example('sldev-eval', 'yaml'))
    expect(e.error).toBeUndefined()
    expect(e.spec!.checks.map((c) => c.type)).toEqual(['run', 'run', 'diff', 'judge'])
  })
  it('the mission example is a valid draft', () => {
    const { draft } = parseMissionDraft(example('sldev-mission', 'markdown'))
    expect(draft).toMatchObject({ title: 'Retry failed uploads', kind: 'build', by: 'claude' })
    expect(draft!.criteria!.split('\n')).toHaveLength(3)
  })
  it('the stories example is a valid draft', () => {
    const { stories, by } = parseStoriesDraft(example('sldev-stories', 'json'))
    expect(by).toBe('claude')
    expect(stories.map((s) => s.title)).toEqual(['Store login attempts per IP', 'Rate-limit /api/login'])
    expect(stories[1].after).toEqual(['Store login attempts per IP'])
  })
  it('every skill has a name the folder matches and a description agents can trigger on', () => {
    for (const s of SLDEV_SKILLS) {
      expect(s.name).toMatch(/^sldev-[a-z]+$/)
      expect(s.description.length).toBeGreaterThan(80)
      expect(skillText(s)).toMatch(new RegExp(`^---\\nname: ${s.name}\\n`))
    }
  })
})

describe('installed copies', () => {
  const s = SLDEV_SKILLS[0]
  it('know their version', () => {
    expect(skillVersionOf(skillText(s))).toBe(SKILLS_VERSION)
    expect(skillVersionOf('---\nname: x\n---\nbody')).toBeNull()
  })
  it('are current, outdated, edited or someone else’s', () => {
    expect(copyState(s, null)).toBe('missing')
    expect(copyState(s, skillText(s))).toBe('current')
    expect(copyState(s, skillText(s).replace(/\n/g, '\r\n'))).toBe('current')
    expect(copyState(s, skillText(s).replace(`"${SKILLS_VERSION}"`, '"0"'))).toBe('outdated')
    expect(copyState(s, skillText(s) + '\nMy own rule.\n')).toBe('edited')
    expect(copyState(s, '---\nname: sldev-mission\n---\nmine')).toBe('foreign')
  })
})

describe('mission drafts', () => {
  it('reads the front matter and the brief', () => {
    const { draft } = parseMissionDraft('---\ntitle: Fix it\nkind: Investigate\nagent: Codex\nworktree: false\ncriteria: |\n  - one\n  two\n---\nThe brief.\n')
    expect(draft).toEqual({ title: 'Fix it', brief: 'The brief.', criteria: '- one\n- two', kind: 'investigate', agent: 'codex', worktree: false, by: undefined })
  })
  it('takes a plain brief, and an unknown kind as build', () => {
    expect(parseMissionDraft('Just do the thing').draft).toMatchObject({ brief: 'Just do the thing', kind: 'build' })
    expect(parseMissionDraft('---\nkind: launch-rockets\n---\nx').draft!.kind).toBe('build')
    expect(parseMissionDraft('---\nkind: mine\n---\nx', ['build', 'mine']).draft!.kind).toBe('mine')
  })
  it('refuses an empty brief or broken front matter', () => {
    expect(parseMissionDraft('---\ntitle: x\n---\n\n').error).toMatch(/empty/)
    // not YAML, but plain key: value lines: kept, with a warning (see "a draft an agent got slightly wrong")
    expect(parseMissionDraft('---\ntitle: [x\n---\nbrief')).toMatchObject({ draft: { title: '[x' }, warning: expect.stringMatching(/YAML/) })
  })
})

describe('story drafts', () => {
  it('takes a bare array too', () => {
    expect(parseStoriesDraft('[{"title":"A"}]').stories.map((s) => s.title)).toEqual(['A'])
    expect(parseStoriesDraft('{"stories": "nope"}').stories).toEqual([])
  })
  it('knows a draft by its name', () => {
    expect(draftKind('mission-retry.md')).toBe('mission')
    expect(draftKind('stories-login.json')).toBe('stories')
    expect(draftKind('mission-retry.md.bad')).toBeNull()
    expect(draftKind('.gitignore')).toBeNull()
  })
})

describe('in a project', () => {
  it('installs both copies, keeps a hand-edited one, and lists and clears drafts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sldev-skills-'))
    expect((await skillsState(root)).every((s) => s.state === 'missing')).toBe(true)
    expect(await installSkills(root)).toHaveLength(SLDEV_SKILLS.length * 2)
    expect((await skillsState(root)).every((s) => s.state === 'current')).toBe(true)
    expect(await fsp.readFile(join(root, '.sldev/drafts/.gitignore'), 'utf8')).toBe('*\n')

    const mine = join(root, '.agents/skills/sldev-eval/SKILL.md')
    await fsp.appendFile(mine, '\nAlways use pnpm.\n')
    expect(await installSkills(root)).toEqual([])
    expect((await skillsState(root)).find((s) => s.name === 'sldev-eval')!.state).toBe('edited')
    expect(await installSkills(root, ['sldev-eval'])).toEqual([mine])

    const one = mkdtempSync(join(tmpdir(), 'sldev-skills-one-'))
    for (const s of SLDEV_SKILLS) {
      await fsp.mkdir(join(one, '.agents/skills', s.name), { recursive: true })
      await fsp.writeFile(join(one, '.agents/skills', s.name, 'SKILL.md'), skillText(s))
    }
    expect((await skillsState(one)).every((s) => s.state === 'current')).toBe(true)

    const dir = join(root, '.sldev/drafts')
    const old = Date.now() / 1000 - 60
    for (const [n, t] of [['mission-a.md', 'brief A'], ['stories-b.json', '[]'], ['notes.txt', 'x']]) {
      writeFileSync(join(dir, n), t)
      utimesSync(join(dir, n), old, old)
    }
    writeFileSync(join(dir, 'mission-still-writing.md'), 'half')
    expect((await listDrafts(root)).map((d) => d.name).sort()).toEqual(['mission-a.md', 'stories-b.json'])
    await settleDraft(root, 'mission-a.md', true)
    await settleDraft(root, 'stories-b.json', false)
    expect((await fsp.readdir(dir)).sort()).toEqual(['.gitignore', 'mission-still-writing.md', 'notes.txt', 'stories-b.json.bad'])
    await expect(settleDraft(root, '../../package.json', true)).rejects.toThrow('Not a draft')
  })
})

describe('a draft an agent got slightly wrong', () => {
  it('keeps a mission whose title has an unquoted colon, and says how to write it', () => {
    const src = '---\ntitle: Fix: the parser drops the last line\nkind: build\ncriteria:\n  - Retries: up to 3\n  - "npm test passes"\nworktree: false\n---\nThe brief.\n'
    const r = parseMissionDraft(src)
    expect(r.draft).toMatchObject({ title: 'Fix: the parser drops the last line', kind: 'build', worktree: false, brief: 'The brief.' })
    expect(r.draft!.criteria).toBe('- Retries: up to 3\n- npm test passes')
    expect(r.warning).toMatch(/isn't valid YAML.*double quotes/)
  })
  it('reads a criterion YAML took for a mapping as the line it was', () => {
    const r = parseMissionDraft('---\ncriteria:\n  - Retries: up to 3\n---\nBrief\n')
    expect(r.warning).toBeUndefined()
    expect(r.draft!.criteria).toBe('- Retries: up to 3')
  })
  it('still refuses a header that is neither YAML nor key: value lines, or an empty brief', () => {
    expect(parseMissionDraft('---\ntitle: "unclosed\n  {broken\n---\nBrief\n').error).toMatch(/isn't valid YAML/)
    expect(parseMissionDraft('---\ntitle: x\n---\n\n').error).toMatch(/brief is empty/)
  })
  it('warns about an unknown kind instead of silently building', () => {
    expect(parseMissionDraft('---\nkind: refactor\n---\nBrief\n').warning).toMatch(/Unknown kind "refactor"/)
  })
})

describe('checking the files the skills write', () => {
  it('knows each file by where it sits', () => {
    expect(skillFileKind('/p/.sldev/drafts/mission-x.md')).toBe('mission')
    expect(skillFileKind('C:\\p\\.sldev\\drafts\\stories-x.json')).toBe('stories')
    expect(skillFileKind('/p/.sldev/factory/feature.yml')).toBe('recipe')
    expect(skillFileKind('.sldev/evals/pages.yaml')).toBe('eval')
    expect(skillFileKind('/p/.sldev/evals/prompts/terse.md')).toBeNull()
    expect(skillFileKind('/p/mission-x.md')).toBeNull()
  })
  it('passes every skill’s own example', () => {
    expect(checkSkillFile('.sldev/drafts/mission-a.md', example('sldev-mission', 'markdown'))).toMatchObject({ ok: true, kind: 'mission' })
    expect(checkSkillFile('.sldev/drafts/stories-a.json', example('sldev-stories', 'json'))).toMatchObject({ ok: true, kind: 'stories' })
    expect(checkSkillFile('.sldev/factory/a.yml', example('sldev-recipe', 'yaml'))).toMatchObject({ ok: true, kind: 'recipe' })
    expect(checkSkillFile('.sldev/evals/a.yml', example('sldev-eval', 'yaml'))).toMatchObject({ ok: true, kind: 'eval' })
  })
  it('says what is wrong in each format', () => {
    const fail = (path: string, src: string): string => {
      const c = checkSkillFile(path, src)
      return c.ok ? 'ok' : c.error
    }
    expect(fail('.sldev/drafts/stories-a.json', '{"stories": [{"title": "A", }]}')).toMatch(/Not valid JSON/)
    expect(fail('.sldev/drafts/stories-a.json', '{"by": "codex"}')).toMatch(/"stories" array/)
    expect(fail('.sldev/drafts/stories-a.json', '[{"details": "no title"}]')).toMatch(/needs at least a "title"/)
    expect(fail('.sldev/factory/a.yml', 'name: Fix: it\nstages: []\n')).toMatch(/YAML/)
    expect(fail('.sldev/evals/a.yml', 'name: x\nbrief: y\n')).not.toBe('ok')
    expect(fail('notes/mission.md', 'x')).toMatch(/doesn't read notes\/mission\.md/)
    const some = checkSkillFile('.sldev/drafts/stories-a.json', '[{"title": "A"}, {"details": "x"}]')
    expect(some).toMatchObject({ ok: true, warning: expect.stringMatching(/1 of the 2 entries were skipped/) })
  })
  it('every skill tells the agent to check its file before it reports done', () => {
    for (const s of SLDEV_SKILLS) {
      expect(s.body).toContain('sldev_check')
      expect(s.body).toContain('sldev skills check <file>')
      expect(s.body).toMatch(/Say it's done only once it passes/)
    }
  })
})
