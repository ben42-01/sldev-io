import { describe, expect, it } from 'vitest'
import { parseDiff } from '@shared/diff'
import { anchorOf, hunksOf, markOn, reviewDraft, type Part } from '@shared/review'
import { prMergeBlock, reviewPayload, reviewSummary, summarizeChecks, type ShipPr } from '@shared/ship'

const DIFF = [
  'diff --git a/src/app.js b/src/app.js',
  'index 1111111..2222222 100644',
  '--- a/src/app.js',
  '+++ b/src/app.js',
  '@@ -10,3 +10,4 @@ function main() {',
  '   const a = 1',
  '-  const b = 2',
  '+  const b = 3',
  '+  const c = 4',
  '   return a',
  'diff --git a/old.js b/old.js',
  'deleted file mode 100644',
  'index 3333333..0000000',
  '--- a/old.js',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-gone',
  '-too',
  'diff --git a/lib/a.js b/lib/b.js',
  'similarity index 90%',
  'rename from lib/a.js',
  'rename to lib/b.js',
  'index 4444444..5555555 100644',
  '--- a/lib/a.js',
  '+++ b/lib/b.js',
  '@@ -4,2 +4,2 @@',
  ' keep',
  '-before',
  '+after',
  ''
].join('\n')

const hunks = hunksOf(parseDiff(DIFF))
const part = (id: string, path: string): Pick<Part, 'id' | 'title' | 'hunks'> => ({ id, title: `Part ${id}`, hunks: hunks.filter((h) => h.path === path) })

describe('anchoring a note on a part', () => {
  it('an edited file: the first added line, on the PR side', () => {
    expect(anchorOf(part('a', 'src/app.js'))).toEqual({ path: 'src/app.js', line: 11, side: 'RIGHT' })
  })
  it('a deleted file: its first removed line, on the base side', () => {
    expect(anchorOf(part('d', 'old.js'))).toEqual({ path: 'old.js', line: 1, side: 'LEFT' })
  })
  it('a renamed file: the new path', () => {
    expect(anchorOf(part('r', 'lib/b.js'))).toEqual({ path: 'lib/b.js', line: 5, side: 'RIGHT' })
  })
})

describe('the review the notes make', () => {
  const parts = [part('a', 'src/app.js'), part('d', 'old.js'), part('r', 'lib/b.js')]
  it('each note becomes a comment on its part; a look-good mark is no comment', () => {
    const marks = { a: markOn(parts[0], { note: 'Why 3?' }), d: markOn(parts[1], { ok: true }), r: markOn(parts[2], { note: ' Keep the old name ' }) }
    const d = reviewDraft(parts, marks)
    expect(d.comments.map((c) => [c.path, c.line, c.side, c.body])).toEqual([
      ['src/app.js', 11, 'RIGHT', 'Why 3?'],
      ['lib/b.js', 5, 'RIGHT', 'Keep the old name']
    ])
    expect(d.summary).toEqual([])
  })
  it('a note whose lines changed since, or whose part is gone, goes into the summary', () => {
    const marks = { a: { note: 'Old note', hunks: ['src/app.js:something else'] }, gone: { note: 'On a part no longer there' } }
    const d = reviewDraft(parts, marks)
    expect(d.comments).toEqual([])
    expect(d.summary).toEqual(['Part a: Old note', 'A part that is gone: On a part no longer there'])
  })
})

describe('the review payload', () => {
  const sha = 'a'.repeat(40)
  it('pins the reviewed commit and keeps only real comments', () => {
    const p = reviewPayload('REQUEST_CHANGES', ' Please fix ', [{ path: 'a.js', line: 2, side: 'RIGHT', body: ' x ' }, { path: 'b.js', line: 1, side: 'RIGHT', body: '  ' }], sha)
    expect(p).toEqual({ event: 'REQUEST_CHANGES', body: 'Please fix', commit_id: sha, comments: [{ path: 'a.js', line: 2, side: 'RIGHT', body: 'x' }] })
  })
  it('request changes and comment need something to say; approve does not', () => {
    expect(reviewPayload('REQUEST_CHANGES', '', [], sha)).toEqual({ error: 'Say what should change' })
    expect(reviewPayload('COMMENT', '', [], sha)).toEqual({ error: 'Write a comment first' })
    expect(reviewPayload('APPROVE', '', [], sha)).toEqual({ event: 'APPROVE', body: '', commit_id: sha, comments: [] })
    expect(reviewPayload('APPROVE', '', [], 'not-a-sha')).toEqual({ error: 'The reviewed commit is unknown; refresh and try again' })
  })
  it('the summary carries the notes without a line', () => {
    expect(reviewSummary('Overall fine.', ['Part a: Old note'])).toBe('Overall fine.\n\n- Part a: Old note')
    expect(reviewSummary('', [])).toBe('')
  })
})

describe('merging a reviewed pull request', () => {
  const pr: ShipPr = { number: 128, title: 't', state: 'OPEN', url: 'u', isDraft: false, mergeable: 'MERGEABLE', mergeState: 'CLEAN', reviewDecision: '', base: 'main', headSha: 'b'.repeat(40) }
  const none = summarizeChecks([])
  it('is blocked by new commits since the review, first', () => {
    expect(prMergeBlock(pr, none, 'a'.repeat(40))).toMatch(/^New commits since you looked \(aaaaaaa → bbbbbbb\)/)
    expect(prMergeBlock({ ...pr, isDraft: true }, none, 'a'.repeat(40))).toMatch(/^New commits/)
  })
  it('otherwise follows the ship bar’s rules', () => {
    expect(prMergeBlock(pr, none, pr.headSha)).toBeNull()
    expect(prMergeBlock({ ...pr, isDraft: true }, none, pr.headSha)).toBe('The PR is a draft')
    expect(prMergeBlock({ ...pr, state: 'MERGED' }, none, pr.headSha)).toBe('#128 is already merged')
  })
})
