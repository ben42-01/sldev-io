import { describe, expect, it } from 'vitest'
import { DEFAULT_LEAD, LEAD_METHOD, canDelegate, leadRoles, resolveRole, routeAgent, workerAgent, waitText, workerBrief, type WorkerView } from '@shared/lead'
import { STARTER_PROFILES } from '@shared/profiles'
import type { AgentProfile } from '@shared/types'
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
  const tagged = (agent: string, status: EvalAttempt['status'], role?: string, prompt?: { name: string; text: string }): EvalAttempt => ({ ...at(agent, status), ...(role ? { role } : {}), contestant: { agent, ...(prompt ? { prompt } : {}) } })
  // codex is best overall, claude is the better reviewer
  const mixed = [tagged('codex', 'passed'), tagged('codex', 'passed'), tagged('codex', 'failed', 'Reviewer'), tagged('claude', 'passed', 'Reviewer'), tagged('claude', 'failed')]
  it('routes a role by the evals tagged with it, any case', () => {
    expect(routeAgent(mixed, ['claude', 'codex'], 'gemini')).toMatchObject({ agent: 'codex', why: 'best on your evals: 2/3 passed (codex)' })
    expect(routeAgent(mixed, ['claude', 'codex'], 'gemini', 'reviewer')).toEqual({ agent: 'claude', model: undefined, why: 'best reviewer on your evals: 1/1 passed (claude)' })
    expect(routeAgent(mixed, ['claude', 'codex'], 'gemini', 'Reviewer').why).toBe('best Reviewer on your evals: 1/1 passed (claude)')
  })
  it('falls back from the role to all evals, then to the default, and says which', () => {
    expect(routeAgent(mixed, ['claude', 'codex'], 'gemini', 'QA')).toMatchObject({ agent: 'codex', why: 'best on your evals overall (no QA eval results yet): 2/3 passed (codex)' })
    // the role's best isn't installed, nor did anything else of the role pass
    expect(routeAgent(mixed, ['codex'], 'gemini', 'Reviewer')).toMatchObject({ agent: 'codex', why: expect.stringContaining('overall (no Reviewer eval results yet)') })
    expect(routeAgent([tagged('codex', 'failed', 'QA')], ['codex'], 'gemini', 'QA')).toMatchObject({ agent: 'gemini', why: expect.stringContaining('your default agent') })
  })
  it('a profile that pins an agent, or the Lead\'s own pick, is never re-routed', () => {
    const base = { attempts: mixed, installed: ['claude', 'codex'], fallback: 'gemini' }
    expect(workerAgent({ ...base, role: { name: 'Reviewer', agent: 'codex' } })).toEqual({ agent: 'codex', why: "the Reviewer role's agent" })
    expect(workerAgent({ ...base, named: 'gemini', role: { name: 'Reviewer' } })).toEqual({ agent: 'gemini', why: 'chosen by the Lead' })
    expect(workerAgent({ ...base, role: { name: 'Reviewer' } })).toMatchObject({ agent: 'claude', why: expect.stringContaining('best Reviewer') })
    expect(workerAgent(base).agent).toBe('codex')
  })
  it('ignores prompt variants for a role too', () => {
    const a = [tagged('codex', 'passed', 'Reviewer', { name: 'p', text: 't' }), tagged('claude', 'passed')]
    expect(routeAgent(a, ['claude', 'codex'], 'gemini', 'Reviewer')).toMatchObject({ agent: 'claude', why: expect.stringContaining('overall') })
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

describe('roles', () => {
  const ids = ['claude', 'codex', 'gemini']
  const qa: AgentProfile = { id: 'project:qa', name: 'QA', description: 'Tries it like a user', agent: 'codex', model: 'gpt-5', role: 'You test like a user.', scope: 'project' }
  const profiles = [qa, ...STARTER_PROFILES]
  it('resolves a profile by name, any case, and Profile@cli', () => {
    expect(resolveRole('reviewer', profiles, ids)).toMatchObject({ profile: { name: 'Reviewer' }, agent: undefined })
    expect(resolveRole('QA', profiles, ids)).toMatchObject({ profile: qa, agent: 'codex' })
    expect(resolveRole('Reviewer@gemini', profiles, ids)).toMatchObject({ profile: { name: 'Reviewer' }, agent: 'gemini' })
  })
  it('refuses an unknown role, or an agent given as a role, with the roles there are', () => {
    const r = resolveRole('Designer', profiles, ids)
    expect(r).toEqual({ error: expect.stringContaining('No role called "Designer". Roles: QA, Implementer, Spec writer, Reviewer, Test writer, Fixer.') })
    expect(resolveRole('codex', profiles, ids)).toEqual({ error: expect.stringContaining('No role called "codex"') })
    expect(resolveRole('Reviewer@aider', profiles, ids)).toEqual({ error: expect.stringMatching(/^Unknown agent "aider" in "Reviewer@aider"\. Roles: QA/) })
  })
  it('the Lead is told the roles, with what each does and where it runs', () => {
    const t = leadRoles(profiles)
    expect(t).toContain('role in sldev_delegate')
    expect(t).toContain('- QA: Tries it like a user (runs on codex gpt-5)')
    expect(t).toContain('- Reviewer: Reviews a diff')
    expect(leadRoles([qa, { ...qa, id: 'user:qa' }]).match(/- QA/g)).toHaveLength(1)
    expect(leadRoles([])).toBe('')
    expect(LEAD_METHOD).toContain('role')
  })
  it('sldev_wait names each worker\'s role', () => {
    const t = waitText([w('m-1', 'ended', { role: 'Reviewer' })], [w('m-2', 'working', { role: 'QA' }), w('m-3', 'working')])
    expect(t).toContain('m-1 · Codex as Reviewer · finished')
    expect(t).toContain('m-2 (Codex as QA, Task m-2); m-3 (Codex, Task m-3)')
  })
})
