import { describe, expect, it } from 'vitest'
import { BUILTIN_KINDS, findKind, renderKind } from '@shared/missionKinds'
import { approveItem, cardBrief, parseStories, storiesPrompt, storyDraft, boardLabels, columnItems, followPr, importableIssues, issueCard, defaultBoardSettings, followWork, isActive, itemIntent, matchesItem, moveItem, nextKey, nextPickups, parseLabels, type BoardItem } from '@shared/board'

let n = 0
const item = (patch: Partial<BoardItem> = {}): BoardItem => {
  n++
  return { id: `i${n}`, root: '/p', key: n, title: `Item ${n}`, body: '', column: 'ready', labels: [], priority: 'normal', createdAt: n, updatedAt: n, order: n, ...patch }
}
const on = { ...defaultBoardSettings('/p'), pickup: true }

describe('nextPickups', () => {
  it('takes nothing while pick-up is off', () => {
    expect(nextPickups([item()], defaultBoardSettings('/p'))).toEqual([])
  })
  it('takes the highest priority first, then the top of the column', () => {
    const a = item({ order: 1 })
    const b = item({ order: 2, priority: 'high' })
    const c = item({ order: 0, priority: 'low' })
    expect(nextPickups([a, b, c], { ...on, parallel: 2 }).map((i) => i.id)).toEqual([b.id, a.id])
  })
  it('leaves room only for what the limit allows', () => {
    const busy = item({ column: 'progress', started: { type: 'run', id: 'r', at: 1 }, state: 'working' })
    expect(nextPickups([busy, item()], on)).toEqual([])
    expect(nextPickups([busy, item()], { ...on, parallel: 2 })).toHaveLength(1)
  })
  it('a question from the agent still holds the slot; a finished run frees it once Done (or at once, waitForDone off)', () => {
    const asks = item({ column: 'progress', started: { type: 'mission', id: 'm', at: 1 }, state: 'needs-you' })
    const done = item({ column: 'review', started: { type: 'run', id: 'r', at: 1 }, state: 'finished' })
    expect(isActive(asks)).toBe(true)
    expect(isActive(done)).toBe(false)
    expect(nextPickups([asks, item()], on)).toEqual([])
    expect(nextPickups([done, item()], on)).toEqual([])
    expect(nextPickups([done, item()], { ...on, waitForDone: false })).toHaveLength(1)
  })
  it('never starts an item twice, and only from Agent ready in its own project', () => {
    expect(nextPickups([item({ started: { type: 'run', id: 'r', at: 1 } }), item({ column: 'backlog' }), item({ root: '/other' })], { ...on, parallel: 5 })).toEqual([])
  })
})

describe('followWork', () => {
  it('moves an item forward as its work goes', () => {
    const i = item({ column: 'ready', started: { type: 'run', id: 'r', at: 1 } })
    const working = followWork(i, 'working', 100)!
    expect(working.column).toBe('progress')
    expect(followWork(working, 'working', 101)).toBeNull()
    expect(followWork(working, 'needs-you', 102)).toMatchObject({ column: 'progress', state: 'needs-you' })
    expect(followWork(working, 'finished', 103)).toMatchObject({ column: 'review', state: 'finished', order: 103 })
    expect(followWork(working, 'failed', 104)).toMatchObject({ column: 'review', state: 'failed' })
  })
  it('never moves a card the human put in Review, Done or Backlog', () => {
    for (const column of ['review', 'done', 'backlog'] as const) {
      const r = followWork(item({ column, state: 'working' }), 'failed', 5)
      expect(r?.column).toBe(column)
      expect(r?.state).toBe('failed')
    }
  })
})

describe('moveItem', () => {
  it('back to Agent ready forgets finished work so it can be picked up again', () => {
    const i = moveItem(item({ column: 'review', started: { type: 'run', id: 'r', at: 1 }, state: 'failed' }), 'ready', 10)
    expect(i).toMatchObject({ column: 'ready', started: undefined, state: undefined })
    expect(nextPickups([i], on)).toHaveLength(1)
  })
  it('keeps work that is still going', () => {
    const i = moveItem(item({ column: 'progress', started: { type: 'run', id: 'r', at: 1 }, state: 'working' }), 'ready', 10)
    expect(i.started?.id).toBe('r')
  })
})

describe('items', () => {
  it('tells the agent the title, the details and the labels', () => {
    expect(itemIntent({ key: 7, title: 'Dark mode toggle', body: 'In settings.\n', labels: ['ui', 'feature'] })).toBe('#7 Dark mode toggle\n\nIn settings.\n\nLabels: ui, feature')
    expect(itemIntent({ key: 1, title: 'x', body: '  ', labels: [] })).toBe('#1 x')
  })

  it('tells a picked-up card in a worktree to merge its base and re-run the checks before it reports', () => {
    const card = { key: 13, title: 'Merge the base', body: 'Do it.', labels: [] }
    const brief = cardBrief(card, ' Follow the plan. ')
    expect(brief).toBe('Follow the plan.\n\n#13 Merge the base\n\nDo it.')
    expect(cardBrief(card)).toBe(itemIntent(card))
    const build = findKind(BUILTIN_KINDS, 'build')
    const sent = renderKind(build, { title: '#13 Merge the base', brief, worktree: true, base: 'origin/master' })
    expect(sent).toContain('merge `origin/master`')
    expect(sent).toMatch(/re-run the checks/)
    expect(sent).toMatch(/never push/)
    // a card worked in place (no git repo) is on the user's checkout: nothing to merge
    expect(renderKind(build, { title: '#13 Merge the base', brief, worktree: false })).not.toMatch(/git fetch/)
  })
  it('cleans labels', () => {
    expect(parseLabels('Bug, UI ,  bug, needs design')).toEqual(['bug', 'ui', 'needs-design'])
  })
  it('numbers items per project', () => {
    expect(nextKey([item({ key: 4 }), item({ key: 9, root: '/q' })], '/p')).toBe(5)
    expect(nextKey([], '/p')).toBe(1)
  })
  it('lists labels by use and filters by text, #key and label', () => {
    const a = item({ title: 'Fix login', labels: ['bug', 'auth'], key: 12 })
    const b = item({ title: 'Docs', labels: ['bug'] })
    expect(boardLabels([a, b])).toEqual(['bug', 'auth'])
    expect(matchesItem(a, 'LOGIN', null)).toBe(true)
    expect(matchesItem(a, '#12', null)).toBe(true)
    expect(matchesItem(b, '', 'auth')).toBe(false)
  })
  it('sorts a column by position', () => {
    expect(columnItems([item({ order: 5 }), item({ order: 1 }), item({ column: 'done' })], 'ready').map((i) => i.order)).toEqual([1, 5])
  })
})

describe('GitHub', () => {
  const issue = (number: number, labels: string[] = []) => ({ number, title: `Issue ${number}`, body: 'Steps to reproduce.', url: `https://github.com/acme/shop/issues/${number}`, labels })
  it('offers only issues that are not on the board yet', () => {
    const on = item({ issue: { number: 42, url: 'u' }, column: 'done' })
    expect(importableIssues([on, item({ root: '/q', issue: { number: 7, url: 'u' } })], '/p', [issue(42), issue(7)]).map((x) => x.number)).toEqual([7])
  })
  it('makes a card with the labels, the link back, and a high priority for urgent labels', () => {
    expect(issueCard(issue(42, ['Bug', 'P1']))).toEqual({ title: 'Issue 42', body: 'Steps to reproduce.\n\nhttps://github.com/acme/shop/issues/42', labels: ['bug', 'p1'], priority: 'high', issue: { number: 42, url: 'https://github.com/acme/shop/issues/42' } })
    expect(issueCard(issue(7)).priority).toBe('normal')
  })
  it('a merged pull request moves its card to Done', () => {
    expect(followPr(item({ column: 'review' }), { number: 12, state: 'MERGED' }, 9)).toMatchObject({ column: 'done', note: 'PR #12 merged' })
    // an open one is only remembered on the card (not an edit), then nothing more
    const open = followPr(item({ column: 'review' }), { number: 12, state: 'OPEN' }, 9)!
    expect(open).toMatchObject({ column: 'review', pr: { number: 12, state: 'OPEN' } })
    expect(followPr(open, { number: 12, state: 'OPEN' }, 10)).toBeNull()
  })
  it('a closed one only says so, once, and a card moved by hand stays', () => {
    const closed = followPr(item({ column: 'review' }), { number: 12, state: 'CLOSED' }, 9)!
    expect(closed).toMatchObject({ column: 'review', note: 'PR #12 closed without merging' })
    expect(followPr(closed, { number: 12, state: 'CLOSED' }, 10)).toBeNull()
    expect(followPr(item({ column: 'backlog' }), { number: 12, state: 'MERGED' }, 9)).toMatchObject({ column: 'backlog' })
  })
})

describe('stories', () => {
  it('asks for well-defined stories, filed with the tools when the agent has them', () => {
    const p = storiesPrompt({ feature: 'Teams: invite people by email', tools: true, max: 6 })
    expect(p.split('\n')[0]).toBe('Write stories: Teams: invite people by email')
    expect(p).toContain('at most 6')
    expect(p).toContain('**Acceptance criteria**')
    expect(p).toContain('sldev_board_add')
    expect(p).toContain('do not create, modify or delete any files')
  })
  it('without the tools, asks for a JSON file it can read back', () => {
    const p = storiesPrompt({ feature: 'x', tools: false, max: 3, file: '/p/.sldev/runs/stories-1/stories.json' })
    expect(p).not.toContain('sldev_board_add')
    expect(p).toContain('JSON array to /p/.sldev/runs/stories-1/stories.json (the one file you may create)')
    expect(parseStories('[{"title": "From a file"}]')).toEqual([{ title: 'From a file', details: '', labels: [], priority: 'normal' }])
  })
  it('a refinement names the card and the update tool', () => {
    const p = storiesPrompt({ feature: '', tools: true, max: 3, refine: { key: 4, title: 'Login is slow', body: 'Users wait 5s.', labels: ['perf'] } })
    expect(p.split('\n')[0]).toBe('Refine card #4: Login is slow')
    expect(p).toContain('Users wait 5s.')
    expect(p).toContain('sldev_board_update (key 4)')
    expect(p).not.toContain('From the user')
  })
  it('reads the last stories block of a reply, skipping what is not a story', () => {
    const reply = 'Here is a draft:\n```json\n[{"title": "old"}]\n```\nFinal:\n```stories\n[{"title": "Add invites", "details": "**Why**", "labels": ["Feature"], "priority": "high"}, {"details": "no title"}, {"title": "Remove members", "priority": "urgent"}]\n```\n'
    expect(parseStories(reply)).toEqual([
      { title: 'Add invites', details: '**Why**', labels: ['feature'], priority: 'high' },
      { title: 'Remove members', details: '', labels: [], priority: 'normal' }
    ])
    expect(parseStories('no block')).toEqual([])
    expect(parseStories('```stories\nnot json\n```')).toEqual([])
  })
  it('cleans a story from a tool call', () => {
    expect(storyDraft({ title: '  ', details: 'x' })).toBeNull()
    expect(storyDraft({ title: 'A', labels: 'ui, UI', priority: 'low' })).toEqual({ title: 'A', details: '', labels: ['ui'], priority: 'low' })
  })
  it('approving makes a proposed card Agent ready, so pick-up can take it', () => {
    const i = approveItem(item({ column: 'proposed', note: 'x' }), 50)
    expect(i).toMatchObject({ column: 'ready', note: undefined, order: 50 })
    expect(nextPickups([i], on)).toHaveLength(1)
    expect(nextPickups([item({ column: 'proposed' })], on)).toEqual([])
  })
})
