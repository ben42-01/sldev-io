import { describe, expect, it } from 'vitest'
import { baseCommitLabel, baseMovedLine, baseMovedSignal, currentRuns, mergeBlock, sendBackText, tailOutput, updateVerdict, type BaseMoved, type UpdateResult, nextStep, pickPr, shipBusy, summarizeChecks, type ShipPr, type ShipRun, type ShipStatus } from '../src/shared/ship'

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

describe('the base moved', () => {
  const moved = (over: Partial<BaseMoved> = {}): BaseMoved => ({
    base: 'master',
    ref: 'master',
    behind: 2,
    commits: [
      { sha: 'a'.repeat(40), subject: 'Install a team from the Agents panel (#25)' },
      { sha: 'b'.repeat(40), subject: 'Merge pull request #23 from x/team-recipe' }
    ],
    conflicts: [],
    ...over
  })

  it('labels PR commits by number', () => {
    expect(baseCommitLabel({ sha: '', subject: 'Add teams (#2)' })).toBe('#2 Add teams')
    expect(baseCommitLabel({ sha: '', subject: 'Merge pull request #7 from a/b' })).toBe('#7')
    expect(baseCommitLabel({ sha: '', subject: 'Fix a typo' })).toBe('Fix a typo')
  })

  it('says how many commits and which', () => {
    expect(baseMovedLine(moved())).toBe('master has 2 new commits since this branch: #25 Install a team from the Agents panel, #23')
    expect(baseMovedLine(moved({ behind: 0, commits: [] }))).toBeNull()
    expect(baseMovedLine(moved({ behind: 5 }))).toMatch(/and 3 more$/)
    expect(baseMovedLine(moved({ behind: 1, commits: [{ sha: 'c', subject: 'one' }], ref: 'origin/master' }))).toBe('origin/master has 1 new commit since this branch: one')
  })

  it('is red when the trial merge conflicts, amber when it merges', () => {
    expect(baseMovedSignal(moved({ conflicts: ['a.ts'] })).tone).toBe('error')
    expect(baseMovedSignal(moved()).tone).toBe('attention')
    expect(baseMovedSignal(moved({ conflicts: null })).label).toBe('master moved')
    expect(baseMovedSignal(moved({ behind: 0 })).tone).toBe('done')
  })

  const result = (over: Partial<UpdateResult> = {}): UpdateResult => ({ merged: true, conflicts: [], checks: [], skipped: [], ...over })

  it('gives a verdict for Update and check', () => {
    expect(updateVerdict(result({ merged: false, conflicts: ['a.ts', 'b.ts'] }), 'master')).toEqual({ ok: false, label: 'master conflicts in 2 files; the merge was undone' })
    expect(updateVerdict(result({ checks: [{ name: 'typecheck', command: 'tsc', code: 0, output: '' }, { name: 'test', command: 'vitest', code: 1, output: 'boom' }] }), 'master')).toEqual({ ok: false, label: 'Merged master; test failed' })
    expect(updateVerdict(result({ checks: [{ name: 'test', command: 'x', code: 0, output: '', timedOut: true }] }), 'master').ok).toBe(false)
    expect(updateVerdict(result({ checks: [{ name: 'test', command: 'x', code: 0, output: '' }] }), 'master')).toEqual({ ok: true, label: 'Merged master; test passed' })
    expect(updateVerdict(result(), 'master').ok).toBe(true)
  })

  it('sends back the failing output, or the conflicting files', () => {
    const t = sendBackText(result({ checks: [{ name: 'typecheck', command: 'npm run typecheck', code: 2, output: "error TS2451: Cannot redeclare 'installTeam'" }] }), 'master', 'feature/x')
    expect(t).toMatch(/^master moved and this no longer builds/)
    expect(t).toContain('`npm run typecheck` exited with 2')
    expect(t).toContain("Cannot redeclare 'installTeam'")
    expect(t).toContain("Don't push")
    const c = sendBackText(result({ merged: false, conflicts: ['src/a.ts'] }), 'master', 'feature/x')
    expect(c).toContain('- src/a.ts')
  })

  it('keeps the end of long output', () => {
    expect(tailOutput('x'.repeat(10) + 'END', 5)).toBe('…xxEND')
    expect(tailOutput('short\n\n')).toBe('short')
  })
})
