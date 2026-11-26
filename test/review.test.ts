import { describe, expect, it } from 'vitest'
import { parseDiff } from '@shared/diff'
import { addedDeps, askPrompt, buildCockpit, criteriaOf, fileNoise, fileOrder, formatMinutes, partMinutes, reviewMinutes, reviewOrder, type Flag, type Part, hunkNoise, hunksOf, parseWalkthrough, sendBackText, unusedNew, walkthroughPrompt } from '@shared/review'

const file = (path: string, body: string, head = ''): string => `diff --git a/${path} b/${path}\n${head}--- a/${path}\n+++ b/${path}\n${body}`

const DIFF = [
  file('src/api/invites.ts', '@@ -1,3 +1,6 @@\n import { db } from "./db"\n+export function invite(email: string) {\n+  return db.insert(email)\n+}\n+export class InviteFactoryProvider {}\n@@ -20,2 +23,3 @@\n const a = 1\n+invite("x")\n'),
  file('src/auth/session.ts', '@@ -5,2 +5,2 @@\n-const ttl = 60\n+const ttl = 3600\n'),
  file('src/ui/format.ts', '@@ -1,2 +1,2 @@\n-const  x = { a: 1 }\n+const x = {a: 1}\n'),
  file('package.json', '@@ -10,3 +10,4 @@\n   "dependencies": {\n-    "react": "18.2.0",\n+    "react": "18.3.1",\n+    "left-pad": "1.3.0",\n'),
  file('package-lock.json', '@@ -1,1 +1,1 @@\n-a\n+b\n'),
  file('test/invites.test.ts', '@@ -1,4 +1,2 @@\n-it("rejects bad email", () => {})\n-it("rejects twice", () => {})\n+it("invites", () => {})\n')
].join('')

describe('hunks and noise', () => {
  const hunks = hunksOf(parseDiff(DIFF))
  it('numbers hunks per file and folds the noise', () => {
    expect(hunks.filter((h) => h.path === 'src/api/invites.ts').map((h) => h.n)).toEqual([1, 2])
    expect(hunks.find((h) => h.path === 'package-lock.json')?.noise).toBe('lockfile')
    expect(hunks.find((h) => h.path === 'src/ui/format.ts')?.noise).toBe('whitespace only')
    expect(hunks.find((h) => h.path === 'src/auth/session.ts')?.noise).toBeUndefined()
  })
  it('knows reordered lines and generated files', () => {
    expect(hunkNoise([{ kind: 'del', text: 'import a' }, { kind: 'del', text: 'import b' }, { kind: 'add', text: 'import b' }, { kind: 'add', text: 'import a' }])).toBe('lines reordered')
    expect(fileNoise({ path: 'web/dist/app.js', status: 'modified', additions: 1, deletions: 0, binary: false })).toBe('generated')
    expect(fileNoise({ path: 'src/x.ts', status: 'renamed', additions: 0, deletions: 0, binary: false })).toBe('renamed, no changes')
  })
  it('lists a file without hunks (binary, renamed) once', () => {
    const h = hunksOf(parseDiff('diff --git a/logo.png b/logo.png\nnew file mode 100644\nBinary files /dev/null and b/logo.png differ\n'))
    expect(h).toHaveLength(1)
    expect(h[0].header).toBe('Binary file')
  })
})

describe('flags', () => {
  const c = buildCockpit(parseDiff(DIFF), null, [])
  const flagsOf = (path: string): string[] => c.parts.filter((p) => p.hunks.some((h) => h.path === path)).flatMap((p) => p.flags.map((f) => f.id))
  it('marks auth, new dependencies and removed tests', () => {
    expect(flagsOf('src/auth/session.ts')).toContain('auth')
    expect(flagsOf('package.json')).toContain('deps')
    expect(flagsOf('test/invites.test.ts')).toContain('tests')
  })
  it('names only dependencies that are new, not bumped', () => {
    const h = hunksOf(parseDiff(DIFF)).find((x) => x.path === 'package.json')!
    expect(addedDeps(h.path, h.lines)).toEqual(['left-pad'])
    expect(addedDeps('requirements.txt', [{ kind: 'add', text: 'httpx==0.27' }])).toEqual(['httpx'])
  })
  it('sees a secret and a silenced check', () => {
    const c2 = buildCockpit(parseDiff(file('src/x.ts', '@@ -1,1 +1,3 @@\n a\n+const apiKey = "abcdefghijklmnopqrstuv"\n+// @ts-ignore\n')), null, [])
    expect(c2.parts[0].flags.map((f) => f.id).sort()).toEqual(['secret', 'suppressed'])
  })
})

describe('unused new code', () => {
  it('finds exports nothing in the change uses', () => {
    const u = unusedNew(hunksOf(parseDiff(DIFF)))
    expect(u.map((x) => x.name)).toEqual(['InviteFactoryProvider'])
  })
  it('lands on the part as a flag', () => {
    const c = buildCockpit(parseDiff(DIFF), null, [])
    expect(c.parts.find((p) => p.hunks.some((h) => h.path === 'src/api/invites.ts'))?.flags.find((f) => f.id === 'unused')?.why).toContain('InviteFactoryProvider')
  })
})

describe('walkthrough', () => {
  const walk = parseWalkthrough(
    'Done.\n```json\n' +
      JSON.stringify({
        summary: 'Adds invites.',
        parts: [
          { title: 'The invite call', why: 'The story asks for it', need: 'asked', serves: [1, 9], files: [{ path: 'src/api/invites.ts', hunks: [1] }] },
          { title: 'Longer sessions', need: 'extra', simpler: 'Leave the TTL alone', files: ['./src/auth/session.ts'] },
          { title: 'Ghost', files: ['src/nowhere.ts'] },
          { title: 'Lockfile', files: ['package-lock.json'] }
        ],
        criteria: [{ n: 1, met: true }, { n: 2, met: false, note: 'no email sent' }]
      }) +
      '\n```'
  )
  it('parses the JSON from a fenced block', () => {
    expect(walk?.parts).toHaveLength(4)
    expect(parseWalkthrough('no json here')).toBeNull()
    expect(parseWalkthrough('[{"title":"a","files":["x"]}]')?.parts[0].title).toBe('a')
  })
  it('puts the parts over the real diff and keeps what nobody explained', () => {
    const c = buildCockpit(parseDiff(DIFF), walk, ['Invite by email', 'Send an email'])
    expect(c.parts.map((p) => p.title)).toEqual(['The invite call', 'Longer sessions', 'Not in the walkthrough'])
    // hunk 2 of invites.ts wasn't claimed, so it shows up with the rest
    expect(c.parts[2].hunks.map((h) => h.id)).toContain('src/api/invites.ts#2')
    expect(c.parts[0].serves).toEqual([1])
    expect(c.noise.map((h) => h.path).sort()).toEqual(['package-lock.json', 'src/ui/format.ts'])
    expect(c.totals.extra).toBe(2)
    expect(c.criteria[0].parts).toEqual(['the-invite-call'])
    expect(c.criteria[1]).toMatchObject({ met: false, note: 'no email sent' })
  })
  it('groups an unexplained diff by folder, code first', () => {
    const c = buildCockpit(parseDiff(DIFF), null, [])
    expect(c.parts.map((p) => p.title)).toEqual(['Changes in src/api', 'Changes in src/auth', 'Config and dependencies', 'Tests'])
    expect(c.parts.every((p) => p.source === 'auto' && p.need === 'unknown')).toBe(true)
  })
})

describe('prompts', () => {
  const s = { title: 'Invites', brief: 'Let admins invite', criteria: ['Invite by email'], base: 'abc123' }
  it('asks for parts by purpose, with the hunks numbered', () => {
    const p = walkthroughPrompt(s, [{ path: 'src/a.ts', hunks: 2, lines: 10 }], '/r/.sldev/runs/x/walkthrough.json')
    expect(p).toContain('git diff abc123')
    expect(p).toContain('- src/a.ts (2 hunks, 10 lines)')
    expect(p).toContain('1. Invite by email')
    expect(p).toContain('"extra"')
    expect(p).toContain('/r/.sldev/runs/x/walkthrough.json')
  })
  it('quotes the part in a question and lists the parts sent back', () => {
    const c = buildCockpit(parseDiff(DIFF), null, [])
    expect(askPrompt(s, c.parts[0], 'Why a class?', '/f.md')).toContain('+export class InviteFactoryProvider {}')
    expect(sendBackText([{ part: c.parts[1], note: 'keep the TTL' }])).toContain('1. Changes in src/auth (src/auth/session.ts): keep the TTL')
  })
  it('reads criteria from the field or the story', () => {
    expect(criteriaOf({ criteria: '- [ ] one\n- two' })).toEqual(['one', 'two'])
    expect(criteriaOf({ brief: 'Story\n\n## Acceptance criteria\n- a\n- b' })).toEqual(['a', 'b'])
  })
})

describe('review order and time', () => {
  const flag = (id: Flag['id']): Flag => ({ id, label: id, why: '' })
  const p = (id: string, lines: number, o: Partial<Part> = {}): Part => ({ id, title: id, need: 'asked', serves: [], hunks: [{ id: `${o.title ?? id}#1`, path: o.title ?? `src/${id}.ts`, n: 1, header: '@@', lines: [], additions: lines, deletions: 0, status: 'modified' }], flags: [], lines, source: 'agent', ...o })
  // a fixed cockpit, in the agent's reading order
  const parts = [
    p('core', 120),
    p('helper', 40, { need: 'extra', title: 'a/helper.ts' }),
    p('tests', 16, { flags: [flag('tests')], title: 'test/x.test.ts' }),
    p('session', 8, { flags: [flag('auth')], title: 'src/auth/session.ts' }),
    p('docs', 24, { flags: [flag('unused')], title: 'docs/x.md' }),
    p('key', 2, { flags: [flag('secret'), flag('deps')], title: 'src/config.ts' }),
    p('option', 10, { need: 'extra', title: 'src/option.ts' })
  ]
  const c = { parts }
  it('puts risky flags first, then parts nobody asked for, then size', () => {
    expect(reviewOrder(c).map((x) => x.id)).toEqual(['key', 'tests', 'session', 'helper', 'option', 'core', 'docs'])
  })
  it('keeps the cockpit order on a tie and leaves the cockpit alone', () => {
    expect(reviewOrder({ parts: [p('a', 5), p('b', 5)] }).map((x) => x.id)).toEqual(['a', 'b'])
    expect(parts[0].id).toBe('core')
  })
  it('orders by file too', () => {
    expect(fileOrder(c).map((x) => x.id)).toEqual(['helper', 'docs', 'session', 'key', 'core', 'option', 'tests'])
  })
  it('estimates each part and the whole review', () => {
    expect(partMinutes(parts[0])).toBe(15)
    expect(partMinutes(parts[5])).toBe(2.75) // 2 lines, a secret (2 min) and a new dependency (0.5)
    const t = reviewMinutes(c)
    expect(t.total).toBe(15 + 5 + 4 + 3 + 3.5 + 2.75 + 1.25)
    expect(reviewMinutes(c, (x) => x.id === 'core').left).toBe(t.total - 15)
    expect(formatMinutes(t.total)).toBe('about 35 min')
  })
  it('says the time plainly', () => {
    expect(formatMinutes(0)).toBe('nothing to read')
    expect(formatMinutes(0.4)).toBe('under a minute')
    expect(formatMinutes(12.4)).toBe('about 12 min')
    expect(formatMinutes(60)).toBe('about 1 h')
    expect(formatMinutes(83)).toBe('about 1 h 25 min')
  })
  it('ranks a built cockpit: removed tests before auth, noise not a part', () => {
    const built = buildCockpit(parseDiff(DIFF), null, [])
    const order = reviewOrder(built)
    expect(order[0].flags.map((f) => f.id)).toContain('tests')
    expect(order.flatMap((x) => x.hunks).some((h) => h.noise)).toBe(false)
  })
})
