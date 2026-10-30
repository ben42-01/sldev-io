import { describe, expect, it } from 'vitest'
import { ciIntent, describeTrigger, newFailures, newIssues, nextRun, remember, scheduleState, SCHEDULE_GRACE_MS, shouldPoll, POLL_MS, type Automation } from '@shared/automations'
import type { GhRun } from '@shared/types'

// local times, so the tests hold in any time zone
const at = (y: number, mo: number, d: number, h = 0, mi = 0): number => new Date(y, mo - 1, d, h, mi).getTime()

const auto = (trigger: Automation['trigger'], extra: Partial<Automation> = {}): Automation => ({
  id: 'a',
  name: 'x',
  root: '/r',
  enabled: true,
  trigger,
  action: { type: 'recipe', recipe: 'Fix CI', intent: 'Fix it' },
  createdAt: at(2026, 11, 2, 8),
  ...extra
})

describe('schedules', () => {
  it('finds the next time for each kind of schedule', () => {
    // 2026-11-02 is a Monday
    expect(nextRun({ type: 'schedule', every: 'day', at: '09:00' }, at(2026, 11, 2, 8))).toBe(at(2026, 11, 2, 9))
    expect(nextRun({ type: 'schedule', every: 'day', at: '09:00' }, at(2026, 11, 2, 9))).toBe(at(2026, 11, 3, 9))
    expect(nextRun({ type: 'schedule', every: 'weekdays', at: '09:00' }, at(2026, 11, 6, 10))).toBe(at(2026, 11, 9, 9))
    expect(nextRun({ type: 'schedule', every: 'week', at: '07:30', day: 3 }, at(2026, 11, 2, 8))).toBe(at(2026, 11, 4, 7, 30))
    expect(nextRun({ type: 'schedule', every: 'hour', at: '00:15' }, at(2026, 11, 2, 8, 20))).toBe(at(2026, 11, 2, 9, 15))
  })

  it('runs when due, and skips a time missed while the app was closed instead of catching up', () => {
    const a = auto({ type: 'schedule', every: 'day', at: '09:00' })
    expect(scheduleState(a, at(2026, 11, 2, 8, 59))).toBe('wait')
    expect(scheduleState(a, at(2026, 11, 2, 9, 1))).toBe('due')
    expect(scheduleState(a, at(2026, 11, 2, 9) + SCHEDULE_GRACE_MS + 1)).toBe('missed')
    expect(scheduleState({ ...a, lastRunAt: at(2026, 11, 2, 9, 1) }, at(2026, 11, 2, 12))).toBe('wait')
  })
})

describe('GitHub triggers', () => {
  const run = (id: number, conclusion: string, branch = 'main', createdAt = '2026-11-02T10:00:00Z'): GhRun => ({ databaseId: id, displayTitle: 'Bump', workflowName: 'CI', status: 'completed', conclusion, headBranch: branch, event: 'push', createdAt, url: `https://x/${id}`, number: id })

  it('acts once on each new failure on the branch', () => {
    const a = auto({ type: 'ci-failed', branch: 'main' }, { createdAt: Date.parse('2026-11-02T09:00:00Z') })
    const runs = [run(1, 'failure'), run(2, 'success'), run(3, 'failure', 'dev'), run(4, 'failure', 'main', '2026-11-01T10:00:00Z'), run(5, 'failure')]
    expect(newFailures(runs, a).map((r) => r.databaseId)).toEqual([1, 5])
    expect(newFailures(runs, { ...a, seen: remember(a, [1, 5]) })).toEqual([])
  })

  it('acts once on each labelled issue', () => {
    const a = auto({ type: 'issue-label', label: 'sldev' }, { seen: [7] })
    expect(newIssues([{ number: 7, title: '', body: '', url: '' }, { number: 8, title: '', body: '', url: '' }], a).map((i) => i.number)).toEqual([8])
  })

  it('polls every few minutes, never for schedules', () => {
    expect(shouldPoll(auto({ type: 'ci-failed', branch: 'main' }), 1e13)).toBe(true)
    expect(shouldPoll(auto({ type: 'ci-failed', branch: 'main' }, { lastCheckAt: 1e13 - POLL_MS + 1 }), 1e13)).toBe(false)
    expect(shouldPoll(auto({ type: 'schedule', every: 'day', at: '09:00' }), 1e13)).toBe(false)
  })

  it('hands the failing run to the agent', () => {
    const t = ciIntent('Fix CI', run(42, 'failure'))
    expect(t).toContain('gh run view 42 --log-failed')
    expect(t.startsWith('Fix CI\n\nCI failed: CI (run 42) on main')).toBe(true)
  })

  it('describes triggers for the list', () => {
    expect(describeTrigger({ type: 'schedule', every: 'weekdays', at: '9:05' })).toBe('Every weekday at 09:05')
    expect(describeTrigger({ type: 'schedule', every: 'week', at: '07:30', day: 5 })).toBe('Every Friday at 07:30')
    expect(describeTrigger({ type: 'ci-failed', branch: 'main' })).toBe('When CI fails on main')
  })
})
