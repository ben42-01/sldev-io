import { describe, expect, it } from 'vitest'
import { acceptanceCriteria, blockersOf, boardFileText, defaultBoardSettings, mergeBoardFile, moveItem, nextPickups, parseBoardFile, parseKeys, parseLessons, prDescription, releaseGroup, releaseNotes, resolveAfter, retroPrompt, spentText, spentTotal, storyDraft, storySection, unreleased, wouldCycle, type BoardItem } from '@shared/board'

let n = 0
const item = (patch: Partial<BoardItem> = {}): BoardItem => {
  n++
  return { id: `i${n}`, root: '/p', key: n, title: `Item ${n}`, body: '', column: 'ready', labels: [], priority: 'normal', createdAt: n, updatedAt: n, order: n, ...patch }
}
const on = { ...defaultBoardSettings('/p'), pickup: true, parallel: 3 }

describe('blocked-by', () => {
  it('parses card numbers loosely', () => {
    expect(parseKeys('#3, 7 #9 3')).toEqual([3, 7, 9])
    expect(parseKeys('')).toEqual([])
  })
  it('pick-up skips a card until what it waits for is Done', () => {
    const a = item({ key: 101 })
    const b = item({ key: 102, blockedBy: [101], priority: 'high' })
    expect(nextPickups([a, b], on).map((i) => i.key)).toEqual([101])
    expect(blockersOf(b, [a, b]).map((i) => i.key)).toEqual([101])
    const done = { ...a, column: 'done' as const }
    expect(nextPickups([done, b], on).map((i) => i.key)).toEqual([102])
  })
  it('a deleted blocker no longer blocks', () => {
    const b = item({ key: 202, blockedBy: [999] })
    expect(blockersOf(b, [b])).toEqual([])
  })
  it('finds loops', () => {
    const a = item({ key: 301, blockedBy: [302] })
    const b = item({ key: 302 })
    expect(wouldCycle([a, b], '/p', 302, [301])).toBe(true)
    expect(wouldCycle([a, b], '/p', 302, [])).toBe(false)
    expect(wouldCycle([a, b], '/p', 303, [301])).toBe(false)
    expect(wouldCycle([a], '/p', 301, [301])).toBe(true)
  })
  it('resolves a story’s after by number or by title', () => {
    const a = item({ key: 401, title: 'Create a team' })
    expect(resolveAfter(['create a TEAM', 401, 'nope', 999], [a], '/p')).toEqual([401])
    expect(storyDraft({ title: 'x', after: ['#12', 'Create a team', 0, ''] })?.after).toEqual([12, 'Create a team'])
    expect(storyDraft({ title: 'x' })?.after).toBeUndefined()
  })
})

describe('spent', () => {
  it('reads like a receipt', () => {
    expect(spentText({ ms: 12 * 60_000, agentMs: 0, missions: 3, tokens: 840_000, cost: 1.2 })).toBe('12 min · 3 agents · 840k tokens · $1.20')
    expect(spentText({ ms: 30_000, agentMs: 0, missions: 1 })).toBe('30s')
  })
  it('adds up', () => {
    const t = spentTotal([item({ spent: { ms: 1000, agentMs: 500, missions: 1, tokens: 10, cost: 0.5 } }), item({ spent: { ms: 2000, agentMs: 500, missions: 2 } }), item()])
    expect(t).toEqual({ ms: 3000, agentMs: 1000, missions: 3, tokens: 10, cost: 0.5 })
    expect(spentTotal([item()])).toBeNull()
  })
})

const story = `**Why**
Owners need to grow their team.

**What to do**
Add POST /invites in src/api/invites.ts.

**Acceptance criteria**
- [ ] An owner can invite by email
- A member cannot
1. Invites expire after 7 days

**How to check**
npm test -- invites`

describe('PR description', () => {
  it('pulls the sections out of a story', () => {
    expect(storySection(story, /^\W*why/i)).toBe('Owners need to grow their team.')
    expect(acceptanceCriteria(story)).toEqual(['An owner can invite by email', 'A member cannot', 'Invites expire after 7 days'])
    expect(storySection('## How to check\n\nrun it\n## Next', /how to check/i)).toBe('run it')
  })
  it('has the issue, the report, criteria to tick and how to check', () => {
    const md = prDescription(item({ key: 14, title: 'Invite people by email', body: story, issue: { number: 42, url: 'u' } }), { report: 'Added the endpoint and tests.', agent: 'Codex', diff: { files: 4, insertions: 182, deletions: 12 } })
    expect(md).toContain('## Invite people by email')
    expect(md).toContain('Closes #42')
    expect(md).toContain('### What changed\n\nAdded the endpoint and tests.')
    expect(md).toContain('- [ ] A member cannot')
    expect(md).toContain('### How to check\n\nnpm test -- invites')
    expect(md).toContain('Card #14 · Agent: Codex · 4 files, +182 −12')
    expect(md).not.toContain('What to do')
  })
  it('a plain card keeps its text', () => {
    expect(prDescription(item({ title: 'Fix it', body: 'The button is dead.' }))).toBe('## Fix it\n\nThe button is dead.')
  })
})

describe('release notes', () => {
  it('groups Done cards by label and skips released ones', () => {
    const a = item({ column: 'done', title: 'Teams', labels: ['feature'], doneAt: 2 })
    const b = item({ column: 'done', title: 'Safari login', labels: ['bug'], issue: { number: 9, url: 'u' }, doneAt: 1 })
    const c = item({ column: 'done', title: 'Old', released: '1.0' })
    const d = item({ column: 'review', title: 'Not yet' })
    const u = unreleased([a, b, c, d])
    expect(u.map((i) => i.title)).toEqual(['Safari login', 'Teams'])
    expect(releaseGroup({ labels: ['tests'] })).toBe('Under the hood')
    expect(releaseNotes(u, '1.1')).toBe('## 1.1\n\n### New\n\n- Teams\n\n### Fixes\n\n- Safari login (#9)')
    expect(releaseNotes([], 'x')).toContain('Nothing new')
  })
  it('Done is stamped when a card arrives, and cleared when it leaves', () => {
    const a = moveItem(item({ column: 'review' }), 'done', 50)
    expect(a.doneAt).toBe(50)
    const back = moveItem({ ...a, released: '1.0' }, 'review', 60)
    expect(back.doneAt).toBeUndefined()
    expect(back.released).toBeUndefined()
  })
})

describe('retros', () => {
  it('tells the agent where lessons go', () => {
    const card = item({ title: 'Invites', body: story })
    expect(retroPrompt({ card, story: ['sent back once'], base: 'abc', tools: true })).toContain('sldev_remember')
    const p = retroPrompt({ card, story: [], tools: false, file: '/r/lessons.json' })
    expect(p).toContain('/r/lessons.json')
    expect(p).toContain('Do not change any project files')
  })
  it('reads lessons', () => {
    expect(parseLessons('[{"note":"Run npm run gen after editing the schema","paths":["prisma/schema.prisma"]},"Use the logger", {"x":1}]')).toEqual([
      { note: 'Run npm run gen after editing the schema', paths: ['prisma/schema.prisma'] },
      { note: 'Use the logger' }
    ])
    expect(parseLessons('nothing')).toEqual([])
    expect(parseLessons('[]')).toEqual([])
  })
})

describe('board file', () => {
  const run = { started: { type: 'mission' as const, id: 'm1', at: 1 }, state: 'finished' as const }
  it('keeps runs on this machine and is stable', () => {
    const a = item({ key: 2, ...run, note: 'x' })
    const b = item({ key: 1, root: '/p' })
    const text = boardFileText([a, b, item({ root: '/other' })], '/p', ['gone'])
    const f = parseBoardFile(text).file!
    expect(f.cards.map((c) => c.key)).toEqual([1, 2])
    expect(text).not.toContain('m1')
    expect(text).not.toContain('"root"')
    expect(f.removed).toEqual(['gone'])
  })
  it('refuses a file with conflict markers', () => {
    expect(parseBoardFile('<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> x\n').error).toContain('merge conflicts')
    expect(parseBoardFile('nope').error).toContain('not valid JSON')
  })
  it('takes the newer side, keeps local runs, adds and removes', () => {
    const mine = item({ key: 1, title: 'Mine', updatedAt: 10, ...run, column: 'review' })
    const old = item({ key: 2, title: 'Old here', updatedAt: 5 })
    const deleted = item({ key: 3 })
    const file = parseBoardFile(
      boardFileText(
        [
          { ...mine, title: 'Theirs, older', updatedAt: 9 },
          { ...old, title: 'Newer there', updatedAt: 6 },
          item({ id: 'new', key: 9, title: 'From a teammate' })
        ],
        '/p',
        [deleted.id]
      )
    ).file!
    const { items, changed } = mergeBoardFile([mine, old, deleted], '/p', file)
    expect(changed).toBe(true)
    expect(items.find((i) => i.id === mine.id)?.title).toBe('Mine')
    expect(items.find((i) => i.id === old.id)?.title).toBe('Newer there')
    expect(items.find((i) => i.id === 'new')?.root).toBe('/p')
    expect(items.some((i) => i.id === deleted.id)).toBe(false)
    expect(mergeBoardFile(items, '/p', file).changed).toBe(false)
  })
  it('a newer move back to Agent ready forgets the finished run here', () => {
    const mine = item({ key: 1, updatedAt: 1, column: 'review', ...run })
    const file = parseBoardFile(boardFileText([{ ...mine, column: 'ready', updatedAt: 2 }], '/p')).file!
    const got = mergeBoardFile([mine], '/p', file).items[0]
    expect(got.column).toBe('ready')
    expect(got.started).toBeUndefined()
  })
  it('a number clash renumbers the card nobody else has seen', () => {
    const local = item({ id: 'local', key: 5, title: 'Local' })
    const waits = item({ id: 'waits', key: 6, blockedBy: [5] })
    const file = parseBoardFile(boardFileText([item({ id: 'theirs', key: 5, title: 'Theirs' })], '/p')).file!
    const got = mergeBoardFile([local, waits], '/p', file).items
    expect(got.find((i) => i.id === 'theirs')?.key).toBe(5)
    const moved = got.find((i) => i.id === 'local')!.key
    expect(moved).toBeGreaterThan(6)
    expect(got.find((i) => i.id === 'waits')?.blockedBy).toEqual([moved])
  })
})

describe('story sections on one line', () => {
  it('reads **Why** text and **How to check:** text', () => {
    const body = '**Why** Teams share projects.\n\n**Acceptance criteria**\n- [ ] POST /teams creates one\n\n**How to check:** npm test'
    expect(storySection(body, /^\W*why/i)).toBe('Teams share projects.')
    expect(acceptanceCriteria(body)).toEqual(['POST /teams creates one'])
    expect(storySection(body, /how to check/i)).toBe('npm test')
  })
})
