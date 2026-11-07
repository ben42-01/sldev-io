import { describe, expect, it } from 'vitest'
import { buildRecap, firstLine, recapDuration, recapMarkdown, recapStart } from '@shared/recap'
import type { Mission } from '@shared/types'

const H = 3_600_000
// Wednesday 2026-11-04, 15:00 local time
const now = new Date(2026, 10, 4, 15, 0, 0).getTime()

const mission = (id: string, patch: Partial<Mission> = {}): Mission => ({
  id,
  title: `Mission ${id}`,
  prompt: 'p',
  root: '/p',
  cwd: '/p',
  options: { agent: 'claude' },
  status: 'ended',
  createdAt: now - 2 * H,
  updatedAt: now - H,
  history: [{ status: 'working', at: now - 2 * H }, { status: 'ended', at: now - H }],
  ...patch
})

const text = { project: 'shop', range: 'today' as const, agentName: (id: string | undefined) => ({ claude: 'Claude Code', codex: 'Codex' } as Record<string, string>)[id ?? ''] ?? 'agent', summaries: true }

describe('recapStart', () => {
  it('today starts at midnight', () => {
    expect(recapStart('today', now)).toBe(new Date(2026, 10, 4).getTime())
  })
  it('a standup covers yesterday and today', () => {
    expect(recapStart('standup', now)).toBe(new Date(2026, 10, 3).getTime())
  })
  it('a Monday standup looks back to Friday, and so does the weekend', () => {
    expect(recapStart('standup', new Date(2026, 10, 9, 9).getTime())).toBe(new Date(2026, 10, 6).getTime())
    expect(recapStart('standup', new Date(2026, 10, 8, 9).getTime())).toBe(new Date(2026, 10, 6).getTime())
    expect(recapStart('standup', new Date(2026, 10, 7, 9).getTime())).toBe(new Date(2026, 10, 6).getTime())
  })
  it('a week is today and the six days before it', () => {
    expect(recapStart('week', now)).toBe(new Date(2026, 9, 29).getTime())
  })
})

describe('firstLine', () => {
  it('takes the first real sentence of a report', () => {
    expect(firstLine('Done!\n\n## Summary\n- **Added** rate limiting to /api. Tests pass.')).toBe('Added rate limiting to /api.')
  })
  it('skips code fences and cuts long lines', () => {
    expect(firstLine('```\n' + 'x'.repeat(300), 20)).toHaveLength(20)
    expect(firstLine(undefined)).toBeUndefined()
    expect(firstLine('Done.')).toBeUndefined()
    expect(firstLine('Done! I updated src/app.js and added NOTES.md.')).toBe('I updated src/app.js and added NOTES.md.')
  })
})

describe('buildRecap', () => {
  const start = recapStart('today', now)
  it('groups by where each mission stands', () => {
    const r = buildRecap(
      [
        mission('done', { stats: { files: 2, insertions: 10, deletions: 3 } }),
        mission('review', { status: 'waiting', stats: { files: 1, insertions: 5, deletions: 0 } }),
        mission('working', { status: 'working', history: [{ status: 'working', at: now - H }] }),
        mission('failed', { status: 'failed' }),
        mission('asks', { status: 'needs-input' })
      ],
      start,
      now
    )
    expect(r.counts).toEqual({ done: 1, review: 1, working: 1, blocked: 2 })
    expect([r.insertions, r.deletions, r.files]).toEqual([15, 3, 3])
  })
  it('leaves out old missions, factory stages and missions another agent took over', () => {
    const old = mission('old', { createdAt: now - 50 * H, updatedAt: now - 48 * H, history: [{ status: 'working', at: now - 50 * H }, { status: 'ended', at: now - 48 * H }] })
    const r = buildRecap([old, mission('stage', { factory: { run: 'r', node: 'n' } }), mission('limited', { continuedBy: 'x', status: 'failed' }), mission('kept')], start, now)
    expect(r.items.map((i) => i.mission.id)).toEqual(['kept'])
  })
  it('keeps a live mission even when it started before the range', () => {
    const r = buildRecap([mission('long', { status: 'waiting', createdAt: now - 72 * H, updatedAt: now - 30 * H, history: [{ status: 'waiting', at: now - 72 * H }] })], start, now)
    expect(r.items).toHaveLength(1)
  })
  it('counts agent working time inside the range only', () => {
    const r = buildRecap([mission('a', { history: [{ status: 'working', at: start - H }, { status: 'ended', at: start + H }] })], start, now)
    expect(r.working).toBe(H)
  })
  it('does not use a terminal screen as a summary', () => {
    const r = buildRecap([mission('t', { report: 'Some screen text.', reportFrom: 'terminal' })], start, now)
    expect(r.items[0].summary).toBeUndefined()
  })
})

describe('recapMarkdown', () => {
  const start = recapStart('today', now)
  it('writes the groups that have something, with totals', () => {
    const md = recapMarkdown(
      buildRecap(
        [
          mission('a', { title: 'Add rate limiting', report: 'Added a token bucket to the API.', worktree: { path: '/w', branch: 'feature/rate', base: 'main' } as Mission['worktree'], stats: { files: 4, insertions: 120, deletions: 12 } }),
          mission('b', { title: 'Why is checkout slow', kind: { id: 'research', name: 'Research', readOnly: true }, status: 'failed', options: { agent: 'codex' } })
        ],
        start,
        now
      ),
      text
    )
    expect(md).toContain('## Today: shop (')
    expect(md).toContain('_2 missions · 1 done · +120 −12 in 4 files · 2 h of agent work_')
    expect(md).toContain('### Done\n- Add rate limiting (Claude Code, `feature/rate`, +120 −12)\n  Added a token bucket to the API.')
    expect(md).toContain('### Blocked / needs attention\n- Research: Why is checkout slow (Codex, failed)')
    expect(md).not.toContain('### In progress')
  })
  it('says so when nothing happened', () => {
    expect(recapMarkdown(buildRecap([], start, now), text)).toContain('No agent missions in this period.')
  })
  it('can leave the report lines out', () => {
    expect(recapMarkdown(buildRecap([mission('a', { report: 'Something useful.' })], start, now), { ...text, summaries: false })).not.toContain('Something useful')
  })
})

describe('recapDuration', () => {
  it('reads like a person wrote it', () => {
    expect(recapDuration(25 * 60_000)).toBe('25 min')
    expect(recapDuration(2 * H)).toBe('2 h')
    expect(recapDuration(2 * H + 10 * 60_000)).toBe('2 h 10 min')
  })
})
