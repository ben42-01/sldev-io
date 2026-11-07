import type { Mission } from './types'
import { activeIn, timeIn } from './usage'

/**
 * Recaps: what the agents got done in a stretch of time, as Markdown to paste into a standup, a status
 * update or a PR. Built only from the missions sldev already keeps (titles, reports, diff stats, status
 * history): no agent run, nothing leaves the machine.
 */

export type RecapRange = 'today' | 'standup' | 'week'

export const RECAP_RANGES: Array<{ id: RecapRange; label: string; hint: string }> = [
  { id: 'standup', label: 'Standup', hint: 'Since the start of your last working day' },
  { id: 'today', label: 'Today', hint: 'Since midnight' },
  { id: 'week', label: 'This week', hint: 'The last seven days' }
]

const DAY = 86_400_000

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** When a range starts. A standup covers the last working day and today: Monday looks back to Friday. */
export function recapStart(range: RecapRange, now: number): number {
  const today = startOfDay(now)
  if (range === 'today') return today
  if (range === 'week') return startOfDay(today - 6 * DAY + DAY / 2)
  const back = { 0: 2, 1: 3, 6: 1 }[new Date(now).getDay()] ?? 1
  // half a day off each step keeps a DST change from landing on 23:00 the day before
  return startOfDay(today - back * DAY + DAY / 2)
}

export type RecapGroup = 'done' | 'review' | 'working' | 'blocked'

export const RECAP_GROUPS: Array<{ id: RecapGroup; title: string; short: string }> = [
  { id: 'done', title: 'Done', short: 'Done' },
  { id: 'review', title: 'Ready for review', short: 'To review' },
  { id: 'working', title: 'In progress', short: 'In progress' },
  { id: 'blocked', title: 'Blocked / needs attention', short: 'Blocked' }
]

export interface RecapItem {
  mission: Mission
  group: RecapGroup
  /** the report's first real sentence or line, when the agent reported back */
  summary?: string
}

export interface Recap {
  start: number
  end: number
  items: RecapItem[]
  counts: Record<RecapGroup, number>
  /** time agents spent working within the range */
  working: number
  insertions: number
  deletions: number
  files: number
}

function groupOf(m: Mission): RecapGroup {
  if (m.status === 'failed' || m.status === 'needs-input' || (m.limited && !m.continuedBy)) return 'blocked'
  if (m.status === 'working' || m.status === 'starting') return 'working'
  if (m.status === 'waiting') return 'review'
  return 'done'
}

/** One line worth reading from a report: skips headings, fences and filler like "Done!". */
export function firstLine(report: string | undefined, max = 160): string | undefined {
  if (!report) return undefined
  for (const raw of report.split('\n')) {
    if (/^\s*(#|```)/.test(raw)) continue
    const line = raw
      .replace(/^[\s>*\-]+/, '')
      .replace(/\*\*/g, '')
      .replace(/^(done|ok|okay|all done|finished|summary)\s*[.!:]+\s*/i, '')
      .trim()
    if (!line || /^(done|ok|okay|all done|finished|summary)$/i.test(line)) continue
    const sentence = line.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? line
    return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence
  }
  return undefined
}

/**
 * The missions that belong in a recap of [start, end]: active in it, or still live. Factory stages are
 * left out (the run is the unit there), and so is a mission another agent continued after its usage
 * limit (the continuation tells the story).
 */
export function buildRecap(missions: Mission[], start: number, end: number): Recap {
  const live = (m: Mission): boolean => m.status !== 'ended' && m.status !== 'failed'
  const picked = missions
    .filter((m) => !m.factory && !m.eval && !m.explains && !m.continuedBy)
    .filter((m) => live(m) || activeIn(m, start, end, end) || (m.updatedAt >= start && m.updatedAt <= end))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const items = picked.map((m): RecapItem => ({ mission: m, group: groupOf(m), summary: m.reportFrom === 'terminal' ? undefined : firstLine(m.report) }))
  const counts = { done: 0, review: 0, working: 0, blocked: 0 }
  for (const i of items) counts[i.group]++
  const changed = picked.filter((m) => m.stats && m.stats.files > 0)
  return {
    start,
    end,
    items,
    counts,
    working: timeIn(picked, 'working', start, end, end),
    insertions: changed.reduce((t, m) => t + m.stats!.insertions, 0),
    deletions: changed.reduce((t, m) => t + m.stats!.deletions, 0),
    files: changed.reduce((t, m) => t + m.stats!.files, 0)
  }
}

export function recapDuration(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`
}

export interface RecapText {
  /** the project's folder name */
  project: string
  range: RecapRange
  /** the agent's display name for an agent id */
  agentName: (id: string | undefined) => string
  /** add the report line under each item */
  summaries: boolean
}

const dateLabel = (t: number): string => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

/** The recap as Markdown: a heading, one totals line, then the groups that have something in them. */
export function recapMarkdown(r: Recap, o: RecapText): string {
  const title = RECAP_RANGES.find((x) => x.id === o.range)!.label
  const span = startOfDay(r.start) === startOfDay(r.end) ? dateLabel(r.end) : `${dateLabel(r.start)} – ${dateLabel(r.end)}`
  const lines = [`## ${title}: ${o.project} (${span})`, '']
  if (!r.items.length) return [...lines, 'No agent missions in this period.', ''].join('\n')
  const totals = [
    `${r.items.length} mission${r.items.length === 1 ? '' : 's'}`,
    r.counts.done && `${r.counts.done} done`,
    r.files && `+${r.insertions} −${r.deletions} in ${r.files} file${r.files === 1 ? '' : 's'}`,
    r.working >= 60_000 && `${recapDuration(r.working)} of agent work`
  ].filter(Boolean)
  lines.push(`_${totals.join(' · ')}_`, '')
  for (const g of RECAP_GROUPS) {
    const items = r.items.filter((i) => i.group === g.id)
    if (!items.length) continue
    lines.push(`### ${g.title}`)
    for (const { mission: m, summary } of items) {
      // a Research mission's title often says so already
      const kind = m.kind && m.kind.id !== 'build' && !m.title.toLowerCase().startsWith(m.kind.name.toLowerCase()) ? `${m.kind.name}: ` : ''
      const meta = [
        o.agentName(m.options.agent),
        m.worktree && `\`${m.worktree.branch}\``,
        m.stats && m.stats.files > 0 && `+${m.stats.insertions} −${m.stats.deletions}`,
        m.status === 'failed' ? 'failed' : m.status === 'needs-input' ? 'waiting for an answer' : m.limited && !m.continuedBy ? 'hit the usage limit' : ''
      ].filter(Boolean)
      lines.push(`- ${kind}${m.title} (${meta.join(', ')})`)
      if (o.summaries && summary) lines.push(`  ${summary}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
