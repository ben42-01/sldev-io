import type { Action } from './automations'
import type { GhIssue } from './types'

/**
 * The work board: items move Backlog → Agent ready → In progress → Review → Done. With pick-up on,
 * the factory takes items from Agent ready on its own (highest priority first, a few at a time),
 * starts a factory run or a mission for each, and moves the item along as that work goes. It never
 * pushes, runs only while the app is open, and never moves an item back out of Done or Backlog: once
 * the human has put something there, it stays. This file is the pure part.
 */

export type BoardColumn = 'backlog' | 'ready' | 'progress' | 'review' | 'done'

export const BOARD_COLUMNS: Array<{ id: BoardColumn; title: string; hint: string }> = [
  { id: 'backlog', title: 'Backlog', hint: 'Ideas and work that isn’t ready for an agent yet.' },
  { id: 'ready', title: 'Agent ready', hint: 'Clear enough for an agent. Pick-up takes these, highest priority first.' },
  { id: 'progress', title: 'In progress', hint: 'An agent is on it. Each card shows how its run is going.' },
  { id: 'review', title: 'Review', hint: 'The agent is done: review the diff or the pull request.' },
  { id: 'done', title: 'Done', hint: 'Reviewed and merged. Drag a card here when you’re happy with it.' }
]

export type BoardPriority = 'high' | 'normal' | 'low'

/** what starts for an item: a recipe (factory run) or a mission; the same shape automations use */
export type BoardWork = Action

/** how the started work is going, read from its run or mission */
export type WorkState = 'working' | 'needs-you' | 'finished' | 'failed'

export interface BoardItem {
  id: string
  /** the project it belongs to */
  root: string
  /** a short number per project, shown as #12 */
  key: number
  title: string
  /** the details an agent gets with the title */
  body: string
  column: BoardColumn
  labels: string[]
  priority: BoardPriority
  /** this item's own work instead of the board's pick-up setting */
  work?: BoardWork
  /** the run or mission started for it */
  started?: { type: 'run' | 'mission'; id: string; at: number }
  /** the last state of that work, for the card */
  state?: WorkState
  /** why it couldn't start, or what happened to its work */
  note?: string
  /** the GitHub issue it was imported from; its run's pull request closes it */
  issue?: { number: number; url: string }
  createdAt: number
  updatedAt: number
  /** position inside its column: lower is higher up */
  order: number
}

export interface BoardSettings {
  root: string
  /** take items from Agent ready on its own, while the app is open */
  pickup: boolean
  /** what starts for an item without its own */
  work: BoardWork
  /** how many items may be in progress at once by pick-up */
  parallel: number
}

export const defaultBoardSettings = (root: string): BoardSettings => ({
  root,
  pickup: false,
  work: { type: 'mission', kind: 'build', brief: '' },
  parallel: 1
})

const RANK: Record<BoardPriority, number> = { high: 0, normal: 1, low: 2 }

/** A column's cards, top to bottom. */
export function columnItems(items: BoardItem[], column: BoardColumn): BoardItem[] {
  return items.filter((i) => i.column === column).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
}

/** Whether an item's started work is still going (so it counts against the pick-up limit). */
export const isActive = (i: BoardItem): boolean => !!i.started && (i.state === undefined || i.state === 'working' || i.state === 'needs-you')

/**
 * The items pick-up should start now: from Agent ready, by priority then position, as many as the
 * limit leaves room for. An item already started is never started twice.
 */
export function nextPickups(items: BoardItem[], s: BoardSettings): BoardItem[] {
  if (!s.pickup) return []
  const mine = items.filter((i) => i.root === s.root)
  const room = Math.max(0, s.parallel - mine.filter(isActive).length)
  if (!room) return []
  return mine
    .filter((i) => i.column === 'ready' && !i.started)
    .sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.order - b.order || a.createdAt - b.createdAt)
    .slice(0, room)
}

/**
 * Where an item goes as its work changes. Work only ever moves an item forward, from Agent ready or
 * In progress: finished or failed work lands in Review (a failure is flagged on the card). An item the
 * human moved to Review, Done or Backlog keeps its place and only shows the state.
 */
export function followWork(i: BoardItem, state: WorkState, now: number): BoardItem | null {
  const auto = i.column === 'ready' || i.column === 'progress'
  const column: BoardColumn = !auto ? i.column : state === 'finished' || state === 'failed' ? 'review' : 'progress'
  if (column === i.column && state === i.state) return null
  return { ...i, column, state, updatedAt: now, order: column === i.column ? i.order : now }
}

/** Moving a card by hand. Back to Agent ready or Backlog forgets the old work, so pick-up can start it again. */
export function moveItem(i: BoardItem, column: BoardColumn, now: number, order = now): BoardItem {
  const requeue = (column === 'ready' || column === 'backlog') && i.column !== column && !!i.started && !isActive(i)
  return { ...i, column, order, updatedAt: now, ...(requeue ? { started: undefined, state: undefined } : {}) }
}

/** What the agent is told: the title, the details and the labels. */
export function itemIntent(i: Pick<BoardItem, 'key' | 'title' | 'body' | 'labels'>): string {
  return [`#${i.key} ${i.title}`, i.body.trim(), i.labels.length ? `Labels: ${i.labels.join(', ')}` : ''].filter(Boolean).join('\n\n')
}

/** "bug, UI ,  bug" → ["bug", "ui"] */
export function parseLabels(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((l) => l.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))].slice(0, 8)
}

export const nextKey = (items: BoardItem[], root: string): number => Math.max(0, ...items.filter((i) => i.root === root).map((i) => i.key)) + 1

/** Every label used in a project, most used first, for the filter. */
export function boardLabels(items: BoardItem[]): string[] {
  const n = new Map<string, number>()
  for (const i of items) for (const l of i.labels) n.set(l, (n.get(l) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l)
}

/** Case-insensitive match on the title, body, labels and #key. */
export function matchesItem(i: BoardItem, query: string, label: string | null): boolean {
  if (label && !i.labels.includes(label)) return false
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `#${i.key} ${i.title} ${i.body} ${i.labels.join(' ')}`.toLowerCase().includes(q)
}

/** The board as text for an agent (the sldev_board tool): one line per card, by column. */
export function boardCardLines(items: BoardItem[], column?: BoardColumn): string {
  const lines: string[] = []
  for (const c of BOARD_COLUMNS) {
    if (column && c.id !== column) continue
    for (const i of columnItems(items, c.id)) {
      const meta = [c.id, i.priority !== 'normal' && i.priority, i.labels.length && i.labels.join(',')].filter(Boolean).join(' · ')
      lines.push(`#${i.key} [${meta}] ${i.title}`)
    }
  }
  return lines.length ? lines.join('\n') : column ? `No cards in ${column}.` : 'The board is empty.'
}

/** Open issues not on the board yet (by issue number, in any column), to offer for import. */
export function importableIssues(items: BoardItem[], root: string, issues: GhIssue[]): GhIssue[] {
  const on = new Set(items.filter((i) => i.root === root && i.issue).map((i) => i.issue!.number))
  return issues.filter((x) => !on.has(x.number))
}

/** A card's fields from a GitHub issue: its title and body, its labels, and the link back. */
export function issueCard(x: GhIssue): Pick<BoardItem, 'title' | 'body' | 'labels' | 'priority' | 'issue'> {
  const labels = parseLabels((x.labels ?? []).join(','))
  const priority: BoardPriority = labels.some((l) => /^(p0|p1|priority:?-?high|urgent|critical)$/.test(l)) ? 'high' : 'normal'
  return { title: x.title.slice(0, 200), body: [x.body.trim(), x.url].filter(Boolean).join('\n\n'), labels, priority, issue: { number: x.number, url: x.url } }
}

/**
 * What a pull request's state does to its card. Merged moves it to Done from Review or In progress
 * (the work is in); closed without merging only says so. A card already moved by hand stays.
 */
export function followPr(i: BoardItem, pr: { number: number; state: 'OPEN' | 'MERGED' | 'CLOSED' }, now: number): BoardItem | null {
  const live = i.column === 'review' || i.column === 'progress'
  if (pr.state === 'MERGED' && live) return { ...i, column: 'done', note: `PR #${pr.number} merged`, updatedAt: now, order: now }
  if (pr.state === 'CLOSED' && live && i.note !== `PR #${pr.number} closed without merging`) return { ...i, note: `PR #${pr.number} closed without merging`, updatedAt: now }
  return null
}

/** How often a card's pull request is checked while it waits in Review. */
export const PR_POLL_MS = 5 * 60_000
