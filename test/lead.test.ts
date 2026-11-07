import { describe, expect, it } from 'vitest'
import { DEFAULT_LEAD, LEAD_METHOD, canDelegate, routeAgent, waitText, workerBrief, type WorkerView } from '@shared/lead'
import { BUILTIN_KINDS, renderKind } from '@shared/missionKinds'
import type { EvalAttempt } from '@shared/evals'

const w = (id: string, status: WorkerView['status'], extra: Partial<WorkerView> = {}): WorkerView => ({ id, title: `Task ${id}`, agent: 'Codex', status, ...extra })

describe('limits', () => {
  it('stops at the total and at the parallel limit', () => {
    expect(canDelegate(DEFAULT_LEAD, [])).toBeNull()
    expect(canDelegate({ maxWorkers: 6, parallel: 2 }, [w('a', 'working'), w('b', 'starting')])).toContain('Call sldev_wait')
    expect(canDelegate({ maxWorkers: 6, parallel: 2 }, [w('a', 'working'), w('b', 'ended')])).toBeNull()
    expect(canDelegate({ maxWorkers: 2, parallel: 5 }, [w('a', 'ended'), w('b', 'failed')])).toContain('all 2 workers')
  })
})

describe('routing', () => {
  const at = (agent: string, status: EvalAttempt['status']): EvalAttempt => ({ id: `${agent}${Math.random()}`, eval: 'x', contestant: { agent }, status, checks: [{ label: 'c', ok: status === 'passed' }] })
  it('picks the best installed agent on the evals, and says why', () => {
    const attempts = [at('codex', 'passed'), at('codex', 'passed'), at('claude', 'passed'), at('claude', 'failed')]
    expect(routeAgent(attempts, ['claude', 'codex'], 'claude')).toEqual({ agent: 'codex', model: undefined, why: 'best on your evals: 2/2 passed (codex)' })
    expect(routeAgent(attempts, ['claude'], 'claude').agent).toBe('claude')
  })
  it('falls back to the default without results', () => {
    expect(routeAgent([], ['codex'], 'claude')).toMatchObject({ agent: 'claude', why: expect.stringContaining('no eval results') })
    expect(routeAgent([at('codex', 'failed')], ['codex'], 'claude').agent).toBe('claude')
  })
})

describe('what the Lead and its workers are told', () => {
  it('a worker gets its task, the criteria and the bigger goal', () => {
    const b = workerBrief({ goal: 'Teams feature\nwith details', task: 'Add invites', criteria: '- link works once' })
    expect(b).toBe('Add invites\n\nAcceptance criteria:\n- link works once\n\nThis is one part of a bigger goal another agent is coordinating: Teams feature. Do only this part; don\'t start on the others.')
  })
  it('sldev_wait lists what finished with branch, diff and report, and what is still going', () => {
    const t = waitText([w('m-1', 'ended', { branch: 'feature/invites', diff: { files: 2, lines: 40 }, report: 'Added invites.' })], [w('m-2', 'working')])
    expect(t).toContain('m-1 · Codex · finished · Task m-1')
    expect(t).toContain('branch feature/invites, 40 changed lines in 2 files')
    expect(t).toContain('Report:\nAdded invites.')
    expect(t).toContain('Still running: m-2 (Codex, Task m-2).')
    expect(t).toContain('sldev_mission_diff')
    expect(waitText([], [w('m-2', 'working')])).toContain('Call sldev_wait again')
  })
  it('the Lead kind works in a worktree and says how to delegate, review and integrate', () => {
    const k = BUILTIN_KINDS.find((x) => x.id === 'lead')!
    expect(k.worktree).toBe(true)
    const p = renderKind(k, { title: 'Teams', brief: 'Build teams.' })
    expect(p.startsWith('Lead: Teams\n\nBuild teams.')).toBe(true)
    for (const tool of ['sldev_delegate', 'sldev_wait', 'sldev_mission_diff', 'sldev_followup', 'sldev_integrate']) expect(LEAD_METHOD).toContain(tool)
    expect(p).toContain('Do not push')
  })
})
