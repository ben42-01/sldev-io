import { describe, expect, it } from 'vitest'
import { beginPass, describeRepeat, endPass, freshProgress, nextPassNumber, parseGap, passBrief, passChanged, progressLabel, repeatDue, REPEAT_GRACE_MS, type RepeatPlan, type RepeatProgress } from '@shared/repeat'
import { passSignal } from '@shared/status'

const plan = (p: Partial<RepeatPlan> = {}): RepeatPlan => ({ times: 3, gapMinutes: 0, doneWhen: 'exit', ...p })
const T0 = 1_800_000_000_000
const clock = (t: number): string => new Date(t).toISOString().slice(11, 16)

/** a loop that has started `n` passes, each ended with outcome done except the running last one */
function started(pl: RepeatPlan, outcomes: Parameters<typeof endPass>[2]['outcome'][]): RepeatProgress {
  let p = freshProgress(T0)
  outcomes.forEach((o, i) => {
    p = beginPass(p, { mission: `m${i + 1}`, startedAt: T0 + i, base: `sha${i}` }, { cwd: '/wt', worktree: { path: '/wt', branch: 'feature/x', base: 'main', repo: '/r' } as never })
    p = endPass(pl, p, { outcome: o }, T0 + i + 1)
  })
  return p
}

describe('repeat loop', () => {
  it('starts with the first pass due now, then numbers passes from 1 and keeps the first pass’s folder', () => {
    const p = freshProgress(T0)
    expect(repeatDue(p, T0)).toBe('due')
    expect(nextPassNumber(p)).toBe(1)
    const a = beginPass(p, { mission: 'm1', startedAt: T0 }, { cwd: '/wt1' })
    expect(a.state).toBe('running')
    expect(a.passes[0].n).toBe(1)
    const b = beginPass(endPass(plan(), a, { outcome: 'done' }, T0 + 1), { mission: 'm2', startedAt: T0 + 2 }, { cwd: '/elsewhere' })
    expect(b.cwd).toBe('/wt1')
    expect(nextPassNumber(b)).toBe(3)
  })

  it('waits the gap after a pass is over, not on the clock', () => {
    const pl = plan({ gapMinutes: 30 })
    const p = endPass(pl, beginPass(freshProgress(T0), { mission: 'm1', startedAt: T0 }, { cwd: '/r' }), { outcome: 'done' }, T0 + 60_000)
    expect(p.state).toBe('waiting')
    expect(p.nextAt).toBe(T0 + 60_000 + 30 * 60_000)
    expect(repeatDue(p, T0 + 20 * 60_000)).toBe('wait')
    expect(repeatDue(p, p.nextAt!)).toBe('due')
    // the computer slept through it: no catching up
    expect(repeatDue(p, p.nextAt! + REPEAT_GRACE_MS + 1)).toBe('missed')
  })

  it('finishes after the planned number of passes', () => {
    const p = started(plan({ times: 2 }), ['done', 'done'])
    expect(p.state).toBe('finished')
    expect(p.reason).toBe('All 2 passes done')
    expect(repeatDue(p, T0 + 10)).toBe('wait')
  })

  it('stops when a pass changes nothing, unless told to keep going', () => {
    expect(started(plan({ times: 0 }), ['done', 'unchanged']).reason).toMatch(/Pass 2 changed nothing/)
    expect(started(plan({ times: 0, keepGoingUnchanged: true }), ['done', 'unchanged']).state).toBe('waiting')
  })

  it('stops on a failure, a usage limit or a stop, and after the check fails twice in a row', () => {
    expect(started(plan(), ['failed']).reason).toBe('Pass 1 failed')
    expect(started(plan(), ['limited']).reason).toMatch(/usage limit/)
    expect(started(plan(), ['stopped']).reason).toBe('Stopped during pass 1')
    expect(started(plan({ times: 5 }), ['check-failed']).state).toBe('waiting')
    expect(started(plan({ times: 5 }), ['check-failed', 'done', 'check-failed']).state).toBe('waiting')
    expect(started(plan({ times: 5 }), ['done', 'check-failed', 'check-failed']).reason).toBe('The check failed twice in a row (passes 2 and 3)')
  })

  it('tells whether a pass changed anything: committed, or a different working-tree diff', () => {
    const none = { files: 0, insertions: 0, deletions: 0 }
    expect(passChanged({ base: 'a' }, 'b', none)).toBe(true)
    expect(passChanged({ base: 'a' }, 'a', none)).toBe(false)
    expect(passChanged({ base: 'a' }, 'a', { files: 1, insertions: 2, deletions: 0 })).toBe(true)
    // in place: the user's own uncommitted changes from before don't count
    const mine = { files: 2, insertions: 5, deletions: 1 }
    expect(passChanged({ base: 'a', startStat: mine }, 'a', mine)).toBe(false)
    expect(passChanged({ base: 'a', startStat: mine }, 'a', { ...mine, insertions: 9 })).toBe(true)
  })

  it('hands the next pass its place in the loop, the last report and a failed check’s output', () => {
    const pl = plan({ times: 4, check: 'npm test' })
    expect(passBrief('Polish the sidebar', pl, 1)).toMatch(/^Polish the sidebar\n\nThis is pass 1 of 4/)
    let p = beginPass(freshProgress(T0), { mission: 'm1', startedAt: T0, base: 'sha' }, { cwd: '/wt' })
    p = endPass(pl, p, { outcome: 'check-failed', checkOutput: 'FAIL sidebar.test.ts', report: 'Tightened the spacing.' }, T0 + 1)
    const b = passBrief('Polish the sidebar', pl, 2, p.passes[0])
    expect(b).toContain('This is pass 2 of 4')
    expect(b).toContain('committed their changes')
    expect(b).toContain('the check `npm test` failed')
    expect(b).toContain('FAIL sidebar.test.ts')
    expect(b).toContain('Tightened the spacing.')
    // a single pass gets the brief as it is
    expect(passBrief('Polish the sidebar', plan({ times: 1 }), 1)).toBe('Polish the sidebar')
    // open-ended: no "of N"
    expect(passBrief('x', plan({ times: 0 }), 3)).toContain('This is pass 3 of a repeated')
  })

  it('clips long reports and keeps the end of long check output, where the error is', () => {
    let p = beginPass(freshProgress(T0), { mission: 'm1', startedAt: T0 }, { cwd: '/r' })
    p = endPass(plan(), p, { outcome: 'check-failed', checkOutput: `${'x'.repeat(5000)}THE ERROR`, report: `${'y'.repeat(5000)}` }, T0 + 1)
    expect(p.passes[0].checkOutput!.endsWith('THE ERROR')).toBe(true)
    expect(p.passes[0].checkOutput!.length).toBeLessThan(2600)
    expect(p.passes[0].report!.length).toBeLessThan(2600)
  })

  it('describes the plan and where the loop is', () => {
    expect(describeRepeat(plan({ times: 5, gapMinutes: 30, check: 'npm test' }))).toBe('5 passes, 30 min apart, unattended, checked with `npm test`')
    expect(describeRepeat(plan({ times: 0, doneWhen: 'accept' }))).toBe('Until nothing changes, back to back, you accept each')
    expect(describeRepeat(plan({ times: 1, gapMinutes: 120 }))).toBe('1 pass, 2 h apart, unattended')
    const pl = plan({ times: 3, gapMinutes: 10 })
    expect(progressLabel(pl, undefined, T0, clock)).toBe('Not started')
    const running = beginPass(freshProgress(T0), { mission: 'm1', startedAt: T0 }, { cwd: '/r' })
    expect(progressLabel(pl, running, T0, clock)).toBe('Pass 1 of 3 running')
    const waiting = endPass(pl, running, { outcome: 'done' }, T0)
    expect(progressLabel(pl, waiting, T0, clock)).toBe(`Pass 2 of 3 at ${clock(T0 + 600_000)}`)
    expect(progressLabel(pl, started(pl, ['failed']), T0, clock)).toBe('Pass 1 failed')
  })

  it('reads gaps the CLI is given', () => {
    expect(parseGap('30m')).toBe(30)
    expect(parseGap('45')).toBe(45)
    expect(parseGap('1h')).toBe(60)
    expect(parseGap('90s')).toBe(1.5)
    expect(parseGap('0')).toBe(0)
    expect(parseGap('soon')).toBeUndefined()
  })

  it('gives each pass outcome a status tone', () => {
    expect(passSignal('done').tone).toBe('done')
    expect(passSignal('check-failed').tone).toBe('attention')
    expect(passSignal('failed').tone).toBe('error')
    expect(passSignal(undefined).pulse).toBe(true)
  })
})
