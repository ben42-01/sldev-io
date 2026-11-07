import type { Action } from './automations'
import type { GhIssue } from './types'

/**
 * The work board: items move Backlog → Proposed → Agent ready → In progress → Review → Done. Stories an
 * agent writes (or refines) land in Proposed, and only a person approves them into Agent ready. With pick-up on,
 * the factory takes items from Agent ready on its own (highest priority first, a few at a time),
 * starts a factory run or a mission for each, and moves the item along as that work goes. It never
 * pushes, runs only while the app is open, and never moves an item back out of Done or Backlog: once
 * the human has put something there, it stays. This file is the pure part.
 */

export type BoardColumn = 'backlog' | 'proposed' | 'ready' | 'progress' | 'review' | 'done'

export const BOARD_COLUMNS: Array<{ id: BoardColumn; title: string; hint: string }> = [
  { id: 'backlog', title: 'Backlog', hint: 'Ideas and work that isn’t ready for an agent yet.' },
  { id: 'proposed', title: 'Proposed', hint: 'Stories an agent wrote or refined. Read them, edit if you like, and approve them for the agents.' },
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
  /** the agent that wrote or refined it (it waits in Proposed until approved) */
  by?: string
  /** a story-writing mission is refining this card right now */
  refining?: string
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

/** Moving a card by hand. Back to Agent ready, Proposed or Backlog forgets the old work, so pick-up can start it again. */
export function moveItem(i: BoardItem, column: BoardColumn, now: number, order = now): BoardItem {
  const requeue = (column === 'ready' || column === 'backlog' || column === 'proposed') && i.column !== column && !!i.started && !isActive(i)
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

// ── stories: an agent turns a feature into well-defined cards ─────────────

/** A story as an agent hands it over, through sldev_board_add or a ```stories block. */
export interface StoryDraft {
  title: string
  details: string
  labels: string[]
  priority: BoardPriority
}

/** a story-writing mission, so its cards (or its reply) end up on the board */
export interface StoryJob {
  mission: string
  root: string
  /** what the user asked for, shown while the agent writes */
  feature: string
  /** the card being refined, when it is a refinement */
  card?: string
  /** cards it filed through the sldev tools */
  filed: number
  /** agents without the sldev tools write their stories here (JSON, under .sldev/runs) */
  file?: string
  done?: boolean
  at: number
}

export const STORY_SHAPE = [
  'Each story is one piece of work for one coding agent in one session (one pull request), independent of the others where it can be. Give each:',
  '- a title: imperative, under 80 characters ("Add rate limiting to /api/login")',
  '- details in Markdown with these parts: **Why** (one or two lines), **What to do** (the files and functions likely to change), **Acceptance criteria** (a checklist anyone can verify), **How to check** (the tests or commands to run)',
  '- labels: one to three, lowercase, e.g. feature, bug, tests, ui, api, refactor, docs',
  '- a priority: high, normal or low'
].join('\n')

/**
 * The prompt of a story-writing mission. With the sldev tools the agent files each story itself (they
 * land in Proposed); without them it writes them as JSON to `file`, which sldev-io reads when it stops.
 */
export function storiesPrompt(o: { feature: string; tools: boolean; max: number; file?: string; refine?: Pick<BoardItem, 'key' | 'title' | 'body' | 'labels'> }): string {
  const head = o.refine
    ? [`Refine card #${o.refine.key}: ${o.refine.title}`, o.refine.body.trim(), o.refine.labels.length ? `Labels: ${o.refine.labels.join(', ')}` : '', o.feature.trim() ? `From the user: ${o.feature.trim()}` : '', 'Rewrite this card as a well-defined story an agent can pick up without asking. If it is really several pieces of work, split it.']
    : [`Write stories: ${o.feature.trim().split('\n')[0].slice(0, 80)}`, o.feature.trim(), `Split this into well-defined stories for coding agents, at most ${o.max}. Leave out work that is already done or already on the board.`]
  const how = o.tools
    ? o.refine
      ? `First look at the board with sldev_board. Save the rewritten card with sldev_board_update (key ${o.refine.key}), and file any extra parts with sldev_board_add. They go to Proposed, where the user approves them. Then call sldev_done with a one-line summary.`
      : 'First look at the board with sldev_board so you do not file what is already there. File each story with sldev_board_add: they go to Proposed, where the user approves them for the agents. Then call sldev_done with a one-line summary.'
    : `When you are done, write the stories as a JSON array to ${o.file} (the one file you may create), each like {"title": "…", "details": "…", "labels": ["feature"], "priority": "normal"}. sldev-io adds them to the board's Proposed column${o.refine ? ', the first one in place of the card' : ''}. Then say in one line what you wrote.`
  const rules = o.tools ? 'Read whatever you need (code, docs, tests), but do not create, modify or delete any files, and do not commit.' : 'Read whatever you need (code, docs, tests), but do not change any project files, and do not commit.'
  return [...head, rules, STORY_SHAPE, 'Ask the user if something important is unclear instead of guessing.', how].filter(Boolean).join('\n\n')
}

const PRIORITIES: BoardPriority[] = ['high', 'normal', 'low']

/** One story from loose input (a tool call, a JSON object), or null without a title. */
export function storyDraft(v: { title?: unknown; details?: unknown; labels?: unknown; priority?: unknown }): StoryDraft | null {
  const title = typeof v.title === 'string' ? v.title.trim().slice(0, 120) : ''
  if (!title) return null
  const labels = parseLabels(Array.isArray(v.labels) ? v.labels.filter((l) => typeof l === 'string').join(',') : typeof v.labels === 'string' ? v.labels : '')
  const priority = PRIORITIES.includes(v.priority as BoardPriority) ? (v.priority as BoardPriority) : 'normal'
  return { title, details: typeof v.details === 'string' ? v.details.trim().slice(0, 6000) : '', labels, priority }
}

/** The stories in a file or a reply: a JSON array, or the last ```stories (or ```json) block holding one. */
export function parseStories(text: string): StoryDraft[] {
  const blocks = [text.trim(), ...[...text.matchAll(/```(?:stories|json)[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1])]
  for (const b of blocks.reverse()) {
    try {
      const v = JSON.parse(b) as unknown
      if (!Array.isArray(v)) continue
      const stories = v.map((x) => (x && typeof x === 'object' ? storyDraft(x as Record<string, unknown>) : null)).filter((x): x is StoryDraft => !!x)
      if (stories.length) return stories.slice(0, 30)
    } catch {
      // not JSON: try the block before it
    }
  }
  return []
}

/** Approving a Proposed card makes it Agent ready (at the bottom, by the order given). */
export const approveItem = (i: BoardItem, now: number, order = now): BoardItem => ({ ...i, column: 'ready', order, updatedAt: now, note: undefined })
