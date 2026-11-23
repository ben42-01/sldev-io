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
  /** cards (by number) that must be Done before pick-up starts this one */
  blockedBy?: number[]
  /** what its work took, measured when it finished: wall time, agent time, and tokens where the agent's logs tell */
  spent?: Spent
  /** a retro mission read what happened and saved lessons to the project memory */
  retro?: { mission: string; done?: boolean; lessons?: number }
  /** when it reached Done, for release notes */
  doneAt?: number
  /** the release notes it went out in (Mark as released) */
  released?: string
  /** another card's PR was merged into this card's base while it waited in Review: re-check it. Local, never in the board file */
  baseMoved?: BaseMovedFlag
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
  /** keep the board in .sldev/board.json, to commit and share with the team */
  sync?: boolean
  /** cards deleted here while syncing, so a teammate's copy in the file doesn't bring them back */
  removed?: string[]
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
    .filter((i) => i.column === 'ready' && !i.started && !blockersOf(i, mine).length)
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
  const done = column === 'done' && i.column !== 'done' ? { doneAt: now } : column !== 'done' ? { doneAt: undefined, released: undefined } : {}
  // the re-check flag belongs to the card waiting in Review; out of Review it means nothing
  const moved = column !== i.column ? { baseMoved: undefined } : {}
  return { ...i, column, order, updatedAt: now, ...done, ...moved, ...(requeue ? { started: undefined, state: undefined, spent: undefined } : {}) }
}

/** What the agent is told: the title, the details and the labels. */
export function itemIntent(i: Pick<BoardItem, 'key' | 'title' | 'body' | 'labels'>): string {
  return [`#${i.key} ${i.title}`, i.body.trim(), i.labels.length ? `Labels: ${i.labels.join(', ')}` : ''].filter(Boolean).join('\n\n')
}

/**
 * The brief of a picked-up card: the work's own text, then the card. The closing lines come from the mission
 * kind (`renderKind`), so a card built in a worktree also merges its base and re-runs the checks before it
 * reports; a recipe's stages get this as `{intent}`.
 */
export function cardBrief(i: Pick<BoardItem, 'key' | 'title' | 'body' | 'labels'>, text = ''): string {
  return [text.trim(), itemIntent(i)].filter(Boolean).join('\n\n')
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
      const meta = [c.id, i.priority !== 'normal' && i.priority, i.labels.length && i.labels.join(','), i.blockedBy?.length && `after ${i.blockedBy.map((k) => `#${k}`).join(',')}`].filter(Boolean).join(' · ')
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
  if (pr.state === 'MERGED' && live) return { ...i, column: 'done', note: `PR #${pr.number} merged`, updatedAt: now, order: now, doneAt: now, baseMoved: undefined }
  if (pr.state === 'CLOSED' && live && i.note !== `PR #${pr.number} closed without merging`) return { ...i, note: `PR #${pr.number} closed without merging`, updatedAt: now }
  return null
}

/** How often a card's pull request is checked while it waits in Review. */
export const PR_POLL_MS = 5 * 60_000

// ── the base moved: a merged PR flags the cards still in Review ──────────

export interface BaseMovedFlag {
  /** the base the merged cards went into ("master") */
  base: string
  /** the merged cards, by number */
  cards: number[]
  /** files this card changed that a merged card changed too */
  files: string[]
  /** this card was `after` a merged card */
  after: boolean
  /** this card's branch head when it was flagged: the flag clears once the branch moved on and has the base */
  head?: string
  at: number
}

/** What the board knows about a card's branch: its base, the files it changed (null: unknown), its head. */
export interface BranchFacts {
  base: string
  files: string[] | null
  head?: string | null
}

/** "origin/master", "refs/heads/master" and "master" are the same base. */
export const sameBase = (a: string, b: string): boolean => {
  const n = (x: string): string => x.trim().replace(/^refs\/(heads|remotes)\//, '').replace(/^origin\//, '')
  return !!a && n(a) === n(b)
}

/**
 * After `merged`'s PR went in, the other cards waiting in Review on the same base get the re-check flag (stronger
 * when they share changed files with it or were `after` it). Only local state changes: no `updatedAt` bump, so the
 * shared board file stays as it was. Cards whose branch is unknown (`facts` has no entry) are left alone.
 */
export function flagBaseMoved(items: BoardItem[], merged: BoardItem, mergedFacts: BranchFacts, facts: Record<string, BranchFacts>, now: number): BoardItem[] {
  const theirs = new Set(mergedFacts.files ?? [])
  return items.map((i) => {
    const f = facts[i.id]
    if (i.id === merged.id || i.root !== merged.root || i.column !== 'review' || !f || !sameBase(f.base, mergedFacts.base)) return i
    const prev = i.baseMoved
    const shared = (f.files ?? []).filter((x) => theirs.has(x))
    const flag: BaseMovedFlag = {
      base: prev?.base ?? f.base.replace(/^origin\//, ''),
      cards: [...new Set([...(prev?.cards ?? []), merged.key])],
      files: [...new Set([...(prev?.files ?? []), ...shared])].sort(),
      after: !!prev?.after || !!i.blockedBy?.includes(merged.key),
      // the newest head: a branch updated since an earlier flag must be updated again
      head: f.head ?? prev?.head,
      at: now
    }
    return { ...i, baseMoved: flag }
  })
}

/** The flag goes once the branch moved on from where it was flagged and has every commit of its base again. */
export const baseMovedCleared = (flag: BaseMovedFlag, head: string | null, behind: number): boolean => !!head && head !== flag.head && behind === 0

/** Shared files or an `after` make it more than a heads-up. */
export const baseMovedStrong = (flag: BaseMovedFlag): boolean => flag.files.length > 0 || flag.after

/** The badge: "master moved: re-check". */
export const baseMovedBadge = (flag: BaseMovedFlag): string => `${flag.base} moved: re-check`

/** The badge's second half: "shares 2 files with #2", "was waiting for #2", or "#2 merged". */
export function baseMovedShort(flag: BaseMovedFlag): string {
  const keys = flag.cards.map((k) => `#${k}`).join(', ')
  if (flag.files.length) return `shares ${flag.files.length} file${flag.files.length === 1 ? '' : 's'} with ${keys}`
  if (flag.after) return `was waiting for ${keys}`
  return `${keys} merged`
}

/** What happened, for the badge's line: which cards merged, and the files or `after` it shares with them. */
export function baseMovedDetail(flag: BaseMovedFlag): string {
  const keys = flag.cards.map((k) => `#${k}`).join(', ')
  const parts = [`${keys} merged into ${flag.base}`]
  if (flag.files.length) {
    const shown = flag.files.slice(0, 3).join(', ')
    parts.push(`shares ${flag.files.length} file${flag.files.length === 1 ? '' : 's'} with it: ${shown}${flag.files.length > 3 ? ` and ${flag.files.length - 3} more` : ''}`)
  }
  if (flag.after) parts.push('this card was waiting for it')
  return `${parts.join('; ')}. Update the branch and run the checks.`
}

// ── stories: an agent turns a feature into well-defined cards ─────────────

/** A story as an agent hands it over, through sldev_board_add or a ```stories block. */
export interface StoryDraft {
  title: string
  details: string
  labels: string[]
  priority: BoardPriority
  /** what it waits for: card numbers, or the titles of stories filed before it */
  after?: Array<number | string>
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
  '- a priority: high, normal or low',
  '- after: only when it can\'t start before another story is done, that story\'s title (or a card number like 12); agents pick it up once those are Done'
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
    : `When you are done, write the stories as a JSON array to ${o.file} (the one file you may create), each like {"title": "…", "details": "…", "labels": ["feature"], "priority": "normal", "after": ["title of an earlier story"]} (after is optional). sldev-io adds them to the board's Proposed column${o.refine ? ', the first one in place of the card' : ''}. Then say in one line what you wrote.`
  const rules = o.tools ? 'Read whatever you need (code, docs, tests), but do not create, modify or delete any files, and do not commit.' : 'Read whatever you need (code, docs, tests), but do not change any project files, and do not commit.'
  return [...head, rules, STORY_SHAPE, 'Ask the user if something important is unclear instead of guessing.', how].filter(Boolean).join('\n\n')
}

const PRIORITIES: BoardPriority[] = ['high', 'normal', 'low']

/** One story from loose input (a tool call, a JSON object), or null without a title. */
export function storyDraft(v: { title?: unknown; details?: unknown; labels?: unknown; priority?: unknown; after?: unknown }): StoryDraft | null {
  const title = typeof v.title === 'string' ? v.title.trim().slice(0, 120) : ''
  if (!title) return null
  const labels = parseLabels(Array.isArray(v.labels) ? v.labels.filter((l) => typeof l === 'string').join(',') : typeof v.labels === 'string' ? v.labels : '')
  const priority = PRIORITIES.includes(v.priority as BoardPriority) ? (v.priority as BoardPriority) : 'normal'
  const raw = Array.isArray(v.after) ? v.after : v.after === undefined || v.after === null || v.after === '' ? [] : [v.after]
  const after = raw
    .map((x) => (typeof x === 'number' ? x : typeof x === 'string' ? (/^#?\d+$/.test(x.trim()) ? Number(x.trim().replace('#', '')) : x.trim()) : null))
    .filter((x): x is number | string => x !== null && x !== '' && x !== 0)
    .slice(0, 8)
  return { title, details: typeof v.details === 'string' ? v.details.trim().slice(0, 6000) : '', labels, priority, ...(after.length ? { after } : {}) }
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

// ── dependencies: a card waits for others to be Done ─────────────────

/** "#3, 7 #9" → [3, 7, 9] */
export function parseKeys(text: string): number[] {
  return [...new Set([...text.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n > 0))].slice(0, 12)
}

/** The cards this one still waits for: those it is blocked by that aren't Done (a deleted card no longer blocks). */
export function blockersOf(i: Pick<BoardItem, 'root' | 'blockedBy'>, items: BoardItem[]): BoardItem[] {
  if (!i.blockedBy?.length) return []
  return items.filter((x) => x.root === i.root && i.blockedBy!.includes(x.key) && x.column !== 'done')
}

/** The cards waiting for this one, for the card's "unblocks" line. */
export const dependentsOf = (i: Pick<BoardItem, 'root' | 'key'>, items: BoardItem[]): BoardItem[] => items.filter((x) => x.root === i.root && x.blockedBy?.includes(i.key))

/** Whether `key` waiting for `blockedBy` would make a loop (a card that, through others, waits for itself). */
export function wouldCycle(items: BoardItem[], root: string, key: number, blockedBy: number[]): boolean {
  const deps = new Map(items.filter((x) => x.root === root).map((x) => [x.key, x.blockedBy ?? []]))
  deps.set(key, blockedBy)
  const seen = new Set<number>()
  const stack = [...blockedBy]
  while (stack.length) {
    const k = stack.pop()!
    if (k === key) return true
    if (seen.has(k)) continue
    seen.add(k)
    stack.push(...(deps.get(k) ?? []))
  }
  return false
}

/** A story's `after` as card numbers: numbers stay, titles are looked up among the project's cards. */
export function resolveAfter(after: Array<number | string> | undefined, items: BoardItem[], root: string): number[] {
  const keys = (after ?? []).map((a) => (typeof a === 'number' ? a : items.find((x) => x.root === root && x.title.toLowerCase() === a.toLowerCase())?.key)).filter((k): k is number => !!k && items.some((x) => x.root === root && x.key === k))
  return [...new Set(keys)]
}

// ── what a card's work took ──────────────────────────────────────────

export interface Spent {
  /** from the start of its work to when it finished */
  ms: number
  /** the time its agents were working (several at once count several times) */
  agentMs: number
  /** how many missions worked on it: stages, follow-ups, a Lead's workers */
  missions: number
  tokens?: number
  /** USD at API list prices, for the tokens with a known price */
  cost?: number
}

export const durationText = (ms: number): string => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`)
export const tokenText = (n: number): string => (n < 1000 ? `${n}` : n < 1_000_000 ? `${Math.round(n / 1000)}k` : `${(n / 1_000_000).toFixed(1)}M`)

/** "12 min · 3 agents · 840k tokens · $1.20" */
export function spentText(s: Spent): string {
  return [durationText(s.ms), s.missions > 1 && `${s.missions} agents`, s.tokens ? `${tokenText(s.tokens)} tokens` : '', s.cost ? `$${s.cost < 0.01 ? '<0.01' : s.cost.toFixed(2)}` : ''].filter(Boolean).join(' · ')
}

/** The board's totals for a set of cards (Done this week, a release). */
export function spentTotal(items: BoardItem[]): Spent | null {
  const s = items.map((i) => i.spent).filter((x): x is Spent => !!x)
  if (!s.length) return null
  const sum = (f: (x: Spent) => number | undefined): number => s.reduce((n, x) => n + (f(x) ?? 0), 0)
  return { ms: sum((x) => x.ms), agentMs: sum((x) => x.agentMs), missions: sum((x) => x.missions), tokens: sum((x) => x.tokens) || undefined, cost: sum((x) => x.cost) || undefined }
}

// ── a pull request description from a card ───────────────────────────

/** The part of a story under a heading such as **Acceptance criteria** or ## How to check, without the heading. */
export function storySection(body: string, name: RegExp): string {
  const lines = body.split('\n')
  // "## Why", "**Why**", "**Why:** text on the same line"
  const head = (l: string): { title: string; rest: string } | null => {
    const m = /^\s*(?:#{1,6}\s+(.+?)\s*$|\*\*([^*]+?)\*\*:?\s*(.*)$|__([^_]+?)__:?\s*(.*)$)/.exec(l)
    return m ? { title: (m[1] ?? m[2] ?? m[4]).replace(/:$/, ''), rest: (m[3] ?? m[5] ?? '').replace(/^:\s*/, '') } : null
  }
  const start = lines.findIndex((l) => {
    const h = head(l)
    return !!h && name.test(h.title)
  })
  if (start < 0) return ''
  const out = [head(lines[start])!.rest]
  for (const l of lines.slice(start + 1)) {
    if (head(l)) break
    out.push(l)
  }
  return out.join('\n').trim()
}

/** The acceptance criteria as plain lines, without their bullets or ticks. */
export function acceptanceCriteria(body: string): string[] {
  return storySection(body, /acceptance/i)
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s*(?:\[[ xX]\]\s*)?/, '').trim())
    .filter(Boolean)
}

/** A pull request description: what it is, what changed (the agent's report), the criteria to tick, how to check, and the issue it closes. */
export function prDescription(i: Pick<BoardItem, 'key' | 'title' | 'body' | 'issue' | 'spent'>, o: { report?: string; agent?: string; diff?: { files: number; insertions: number; deletions: number } } = {}): string {
  const why = storySection(i.body, /^\W*why/i)
  const criteria = acceptanceCriteria(i.body)
  const check = storySection(i.body, /how to (check|test|verify)/i)
  const plain = !why && !criteria.length && !check ? i.body.replace(/\n*https:\/\/github\.com\/\S+\/issues\/\d+\s*$/, '').trim() : ''
  const report = o.report?.trim().replace(/^#+\s*/gm, '').slice(0, 3000)
  const meta = [o.agent && `Agent: ${o.agent}`, o.diff && `${o.diff.files} file${o.diff.files === 1 ? '' : 's'}, +${o.diff.insertions} −${o.diff.deletions}`, i.spent && spentText(i.spent)].filter(Boolean).join(' · ')
  return [
    `## ${i.title}`,
    i.issue ? `Closes #${i.issue.number}` : '',
    why || plain,
    report ? `### What changed\n\n${report}` : '',
    criteria.length ? `### Acceptance criteria\n\n${criteria.map((c) => `- [ ] ${c}`).join('\n')}` : '',
    check ? `### How to check\n\n${check}` : '',
    meta ? `---\n\n<sub>Card #${i.key} · ${meta}</sub>` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

// ── release notes from Done ──────────────────────────────────────────

const GROUPS: Array<{ title: string; match: RegExp }> = [
  { title: 'Fixes', match: /^(bug|fix|bugfix|hotfix|regression)$/ },
  { title: 'Docs', match: /^(docs?|documentation)$/ },
  { title: 'Under the hood', match: /^(tests?|refactor|chore|ci|build|deps|infra|perf)$/ }
]

/** Done cards that haven't gone out in release notes yet, in the order they were finished. */
export const unreleased = (items: BoardItem[]): BoardItem[] => items.filter((i) => i.column === 'done' && !i.released).sort((a, b) => (a.doneAt ?? a.updatedAt) - (b.doneAt ?? b.updatedAt))

/** Which section a card goes under: its first label that names one, else New. */
export function releaseGroup(i: Pick<BoardItem, 'labels'>): string {
  for (const l of i.labels) for (const g of GROUPS) if (g.match.test(l)) return g.title
  return 'New'
}

/** Release notes in Markdown: New, Fixes, Docs, Under the hood, one line per card (with its issue). */
export function releaseNotes(items: BoardItem[], title: string): string {
  if (!items.length) return `## ${title}\n\nNothing new yet.`
  const order = ['New', ...GROUPS.map((g) => g.title)]
  const by = new Map<string, BoardItem[]>()
  for (const i of items) by.set(releaseGroup(i), [...(by.get(releaseGroup(i)) ?? []), i])
  const sections = order.filter((g) => by.has(g)).map((g) => `### ${g}\n\n${by.get(g)!.map((i) => `- ${i.title}${i.issue ? ` (#${i.issue.number})` : ''}`).join('\n')}`)
  return [`## ${title}`, ...sections].join('\n\n')
}

// ── retros: lessons from a card's work, into the project memory ──────

/** What a retro mission is told: what happened, and to save only lessons a future agent needs. */
export function retroPrompt(o: { card: Pick<BoardItem, 'key' | 'title' | 'body'>; story: string[]; base?: string; tools: boolean; file?: string }): string {
  return [
    `Retro: card #${o.card.key} ${o.card.title}`,
    `Agents worked on this card. Look back at how it went and save what the next agent on this project should know.`,
    `The card:\n\n${o.card.body.trim() || '(no details)'}`,
    o.story.length ? `What happened:\n\n${o.story.map((l) => `- ${l}`).join('\n')}` : '',
    o.base ? `The work is the diff from ${o.base} (git diff ${o.base}); read it and whatever code you need.` : '',
    'Find at most three lessons: a project convention the agent missed, a command that has to run, a gotcha in this code, a reviewer\'s correction that will come up again. Each is one or two sentences a future agent can act on, naming the files it is about. Not a summary of the change, nothing that is obvious from the code or already in the project memory. If nothing is worth remembering, save nothing and say so.',
    'Do not change any project files and do not commit.',
    o.tools
      ? 'Save each lesson with sldev_remember (with the paths it is about). Then call sldev_done with a one-line summary.'
      : `Write the lessons as a JSON array to ${o.file} (the one file you may create), each like {"note": "…", "paths": ["src/x.ts"]}; an empty array when there is nothing. sldev-io adds them to the project memory. Then say in one line what you saved.`
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Lessons from a retro's file: [{note, paths}] or plain strings. */
export function parseLessons(text: string): Array<{ note: string; paths?: string[] }> {
  const blocks = [text.trim(), ...[...text.matchAll(/```(?:json)?[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1])]
  for (const b of blocks.reverse()) {
    try {
      const v = JSON.parse(b) as unknown
      if (!Array.isArray(v)) continue
      return v
        .map((x) => (typeof x === 'string' ? { note: x } : x && typeof x === 'object' && typeof (x as { note?: unknown }).note === 'string' ? { note: (x as { note: string }).note, paths: Array.isArray((x as { paths?: unknown }).paths) ? ((x as { paths: unknown[] }).paths.filter((p) => typeof p === 'string') as string[]) : undefined } : null))
        .filter((x): x is { note: string; paths?: string[] } => !!x && !!x.note.trim())
        .map((x) => ({ ...x, note: x.note.trim().slice(0, 600) }))
        .slice(0, 3)
    } catch {
      // not JSON
    }
  }
  return []
}

// ── the board in git: .sldev/board.json, shared with the team ─────────

export const BOARD_FILE = '.sldev/board.json'

/** the fields a teammate sees; runs, missions and their state stay on the machine that ran them */
const SHARED = ['id', 'key', 'title', 'body', 'column', 'labels', 'priority', 'work', 'by', 'issue', 'blockedBy', 'doneAt', 'released', 'createdAt', 'updatedAt', 'order'] as const
export type SharedCard = Pick<BoardItem, (typeof SHARED)[number]>

export interface BoardFile {
  version: 1
  cards: SharedCard[]
  /** ids of cards deleted, so an older copy elsewhere doesn't bring them back */
  removed?: string[]
}

const shared = (i: BoardItem): SharedCard => {
  const out: Record<string, unknown> = {}
  for (const k of SHARED) if (i[k] !== undefined && !(Array.isArray(i[k]) && !(i[k] as unknown[]).length && k === 'blockedBy')) out[k] = i[k]
  return out as unknown as SharedCard
}

/** The file's text: cards by number, two-space JSON, so a change is a readable diff. */
export function boardFileText(items: BoardItem[], root: string, removed: string[] = []): string {
  const cards = items.filter((i) => i.root === root).sort((a, b) => a.key - b.key).map(shared)
  const file: BoardFile = { version: 1, cards, ...(removed.length ? { removed: [...removed].sort() } : {}) }
  return `${JSON.stringify(file, null, 2)}\n`
}

/** The file, or why it can't be read (a merge left conflict markers in it). */
export function parseBoardFile(text: string): { file?: BoardFile; error?: string } {
  if (/^(<{7}|>{7}|={7})( |$)/m.test(text)) return { error: `${BOARD_FILE} has merge conflicts. Resolve them in your editor; the board waits until then.` }
  try {
    const v = JSON.parse(text) as Partial<BoardFile>
    if (!v || !Array.isArray(v.cards)) return { error: `${BOARD_FILE} has no cards list` }
    const cards = v.cards.filter((c): c is SharedCard => !!c && typeof c.id === 'string' && typeof c.key === 'number' && typeof c.title === 'string' && BOARD_COLUMNS.some((x) => x.id === c.column))
    return { file: { version: 1, cards: cards.map((c) => ({ ...c, body: c.body ?? '', labels: Array.isArray(c.labels) ? c.labels : [], priority: PRIORITIES.includes(c.priority) ? c.priority : 'normal' })), removed: Array.isArray(v.removed) ? v.removed.filter((x) => typeof x === 'string') : [] } }
  } catch (e) {
    return { error: `${BOARD_FILE} is not valid JSON: ${(e as Error).message}` }
  }
}

/**
 * The board after reading a teammate's file. A card's newer side wins (by updatedAt), and only the shared
 * fields come from the file: which run or mission worked on it stays local. A card deleted on either side
 * goes. A new card whose number is taken by another card here keeps its number, and the local one, which
 * nobody else has seen yet, gets the next free one.
 */
export function mergeBoardFile(items: BoardItem[], root: string, file: BoardFile, removedHere: string[] = []): { items: BoardItem[]; changed: boolean } {
  const gone = new Set([...(file.removed ?? []), ...removedHere])
  let changed = false
  const fileIds = new Set(file.cards.map((c) => c.id))
  let out = items.filter((i) => {
    if (i.root !== root || !gone.has(i.id)) return true
    changed = true
    return false
  })
  for (const c of file.cards) {
    if (gone.has(c.id)) continue
    const cur = out.find((i) => i.id === c.id)
    if (cur) {
      if (c.updatedAt <= cur.updatedAt) continue
      const next: BoardItem = { ...cur, ...c, root }
      for (const k of SHARED) if (!(k in c)) delete (next as unknown as Record<string, unknown>)[k]
      // a card moved back to a waiting column elsewhere forgets this machine's finished run, like moving it here
      if (cur.column !== c.column) delete next.baseMoved
      if (cur.column !== c.column && (c.column === 'ready' || c.column === 'backlog' || c.column === 'proposed') && cur.started && !isActive(cur)) Object.assign(next, { started: undefined, state: undefined, spent: undefined })
      out = out.map((i) => (i.id === c.id ? next : i))
      changed = true
      continue
    }
    const clash = out.find((i) => i.root === root && i.key === c.key && !fileIds.has(i.id))
    if (clash) {
      const key = Math.max(nextKey(out, root), ...file.cards.map((x) => x.key + 1))
      // cards here that wait for the renumbered one follow it
      out = out.map((i) => (i.id === clash.id ? { ...i, key } : i.root === root && !fileIds.has(i.id) && i.blockedBy?.includes(c.key) ? { ...i, blockedBy: i.blockedBy.map((k) => (k === c.key ? key : k)) } : i))
    }
    out = [...out, { ...c, root, body: c.body ?? '', labels: c.labels ?? [] } as BoardItem]
    changed = true
  }
  return { items: out, changed }
}
