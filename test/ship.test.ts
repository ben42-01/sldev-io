import { describe, expect, it } from 'vitest'
import { currentRuns, mergeBlock, nextStep, pickPr, shipBusy, summarizeChecks, type ShipPr, type ShipRun, type ShipStatus } from '../src/shared/ship'

const run = (o: Partial<ShipRun>): ShipRun => ({ id: 1, workflow: 'CI', title: 't', status: 'completed', conclusion: 'success', event: 'push', url: 'u', createdAt: '2026-11-16T10:00:00Z', headSha: 'aaa', ...o })
const pr = (o: Partial<ShipPr> = {}): ShipPr => ({ number: 7, title: 'x', state: 'OPEN', url: 'u', isDraft: false, mergeable: 'MERGEABLE', mergeState: 'CLEAN', reviewDecision: '', base: 'master', headSha: 'aaa', ...o })
const status = (o: Partial<ShipStatus> = {}): ShipStatus => ({ branch: 'feat', localSha: 'aaa', unpushed: 0, uncommitted: 0, pr: pr(), runs: [], ...o })
const passed = summarizeChecks([run({})])

describe('ship bar', () => {
  it('picks the open PR of a branch over older closed ones, else the newest', () => {
    expect(pickPr([{ number: 9, state: 'CLOSED' }, { number: 4, state: 'OPEN' }])?.number).toBe(4)
    expect(pickPr([{ number: 3, state: 'MERGED' }, { number: 8, state: 'CLOSED' }])?.number).toBe(8)
    expect(pickPr([])).toBeNull()
  })

  it('keeps the newest run per workflow and event on the reviewed commit', () => {
    const runs = [
      run({ id: 1, createdAt: '2026-11-16T09:00:00Z', conclusion: 'failure' }),
      run({ id: 2, createdAt: '2026-11-16T10:00:00Z' }),
      run({ id: 3, event: 'pull_request' }),
      run({ id: 4, headSha: 'old', conclusion: 'failure' })
    ]
    const c = currentRuns(runs, 'aaa')
    expect(c.stale).toBe(false)
    expect(c.runs.map((r) => r.id).sort()).toEqual([2, 3])
  })

  it('falls back to the branch runs, marked stale, when none ran on the commit yet', () => {
    const c = currentRuns([run({ headSha: 'old' })], 'new')
    expect(c.stale).toBe(true)
    expect(c.runs).toHaveLength(1)
    expect(currentRuns([], 'new').stale).toBe(false)
  })

  it('sums checks: a failure wins, then running, then passed', () => {
    expect(summarizeChecks([run({}), run({ conclusion: 'failure' }), run({ status: 'in_progress', conclusion: '' })]).signal.tone).toBe('error')
    const going = summarizeChecks([run({}), run({ status: 'queued', conclusion: '' })])
    expect(going.signal.tone).toBe('working')
    expect(going.pending).toBe(1)
    expect(summarizeChecks([run({}), run({ conclusion: 'skipped' })]).signal.tone).toBe('done')
    expect(summarizeChecks([]).label).toBe('No checks')
  })

  it('says the next step: commit, push and open a PR, push, merge, merged', () => {
    expect(nextStep(status({ uncommitted: 2 }), passed).kind).toBe('commit')
    expect(nextStep(status({ pr: null, unpushed: null }), passed)).toMatchObject({ kind: 'push-pr', why: 'The branch is not on GitHub yet' })
    expect(nextStep(status({ unpushed: 2 }), passed).kind).toBe('push')
    expect(nextStep(status(), passed)).toEqual({ kind: 'merge', ready: true, why: 'Ready to merge' })
    expect(nextStep(status({ pr: pr({ state: 'MERGED' }), uncommitted: 3 }), passed).kind).toBe('merged')
    expect(nextStep(status({ pr: pr({ state: 'CLOSED' }) }), passed).kind).toBe('closed')
    expect(nextStep(status({ pr: pr({ state: 'CLOSED' }), unpushed: 1 }), passed).kind).toBe('push-pr')
  })

  it('says why a merge is a bad idea right now', () => {
    expect(mergeBlock(pr({ isDraft: true }), passed)).toBe('The PR is a draft')
    expect(mergeBlock(pr({ mergeable: 'CONFLICTING' }), passed)).toBe('Conflicts with master')
    expect(mergeBlock(pr(), summarizeChecks([run({ conclusion: 'failure' })]))).toBe('1 check failed')
    expect(mergeBlock(pr(), summarizeChecks([run({ status: 'in_progress' })]))).toBe('1 check still running')
    expect(mergeBlock(pr({ mergeState: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }), passed)).toBe('Needs an approving review')
    expect(mergeBlock(pr({ mergeState: 'BEHIND' }), passed)).toMatch(/^Behind master/)
    expect(mergeBlock(pr(), passed)).toBeNull()
  })

  it('asks GitHub again soon only while something is still moving', () => {
    expect(shipBusy(status(), passed)).toBe(false)
    expect(shipBusy(status({ pr: pr({ mergeable: 'UNKNOWN' }) }), passed)).toBe(true)
    expect(shipBusy(status(), summarizeChecks([run({ status: 'queued' })]))).toBe(true)
    expect(shipBusy(status({ pr: pr({ state: 'MERGED', mergeable: 'UNKNOWN' }) }), passed)).toBe(false)
  })
})
