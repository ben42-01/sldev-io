import { describe, expect, it } from 'vitest'
import { boardLabels, columnItems, defaultBoardSettings, followWork, isActive, itemIntent, matchesItem, moveItem, nextKey, nextPickups, parseLabels, type BoardItem } from '@shared/board'

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
  it('a question from the agent still holds the slot, a finished run frees it', () => {
    const asks = item({ column: 'progress', started: { type: 'mission', id: 'm', at: 1 }, state: 'needs-you' })
    const done = item({ column: 'review', started: { type: 'run', id: 'r', at: 1 }, state: 'finished' })
    expect(isActive(asks)).toBe(true)
    expect(isActive(done)).toBe(false)
    expect(nextPickups([asks, item()], on)).toEqual([])
    expect(nextPickups([done, item()], on)).toHaveLength(1)
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
