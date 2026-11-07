import { stageMode } from '@shared/agents'
import { contestantKey, diffCheckResult, judgePrompt, judgeResult, nextAttempts, parseEval, plannedAttempts, runCheckResult, attemptDone, attemptStatus, slugifyEval, evalTemplate, type CheckResult, type Contestant, type EvalAttempt, type EvalRun, type EvalSpec } from '@shared/evals'
import { renderKind } from '@shared/missionKinds'
import type { Mission } from '@shared/types'
import { activatePanel, activePanelId, closePanel } from '../dock/dockApi'
import { openMissionControl } from '../dock/MissionControlPanel'
import { openInEditor } from '../lib/actions'
import { getAgent } from './agents'
import { getKind } from './missionKinds'
import { getMission, missions, removeMission, startMission, stopMission } from './missions'
import { createStore, useStore } from './store'
import { workspace } from './workspace'

/**
 * Eval runs: every attempt gets its own worktree from the eval's base, a print-mode mission for its
 * contestant (agent and model), then its checks. Like the factory, this runs only while the app is
 * open, never pushes, and a restart stops what was running (Continue picks up the queued attempts).
 */

export interface EvalFile {
  path: string
  spec?: EvalSpec
  error?: string
}

export const evals = createStore<{ runs: EvalRun[]; files: EvalFile[]; filesRoot: string | null }>({ runs: [], files: [], filesRoot: null })

export const useEvalRuns = (root: string | null): EvalRun[] => {
  const runs = useStore(evals, (s) => s.runs)
  return root ? runs.filter((r) => r.root === root) : []
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function persist(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void window.api.store.set('evals', { runs: evals.get().runs }), 300)
}

const now = (): number => Date.now()
const newId = (p: string): string => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

export async function loadEvals(): Promise<void> {
  const data = (await window.api.store.get('evals')) ?? { runs: [] }
  // what was running when the app closed is stopped; the queue waits for Continue
  const runs = (data.runs ?? []).map((r): EvalRun => {
    if (r.finishedAt) return r
    const attempts = r.attempts.map((a): EvalAttempt => (a.status === 'running' || a.status === 'checking' ? { ...a, status: 'stopped', note: 'The app closed while it ran' } : a))
    return { ...r, attempts, stopped: true }
  })
  evals.set((s) => ({ ...s, runs }))
}

/** The project's eval files, parsed (a broken one keeps its error, to show next to it). */
export async function loadEvalFiles(root: string | null): Promise<void> {
  if (!root) return evals.set((s) => ({ ...s, files: [], filesRoot: null }))
  const list = await window.api.evals.list(root).catch(() => [])
  const files = list.map(({ path, text }): EvalFile => ({ path, ...parseEval(text, path) }))
  evals.set((s) => ({ ...s, files, filesRoot: root }))
}

/** A new eval file from the template (or from a mission's brief); returns its path. */
export async function newEvalFile(root: string, name?: string, brief?: string): Promise<string> {
  const p = await window.api.evals.save(root, slugifyEval(name ?? 'my-first-eval'), evalTemplate(name, brief))
  await loadEvalFiles(root)
  return p
}

/**
 * A mission's brief as a new eval, starting from the commit it started from: the task an agent
 * already did becomes one every agent can be measured on. The checks are the template's, to edit.
 */
export async function saveAsEval(m: Mission): Promise<void> {
  const p = await newEvalFile(m.root, m.title.replace(/^Eval: /, ''), m.brief ?? m.prompt)
  const base = m.worktree?.base ?? m.baseCommit
  if (base) {
    const text = (await window.api.evals.list(m.root)).find((f) => f.path === p)?.text
    if (text) await window.api.evals.write(p, text.replace('# base: main          # a branch or commit to start from (default: HEAD when the suite starts)', `base: ${base}          # where the mission started`))
    await loadEvalFiles(m.root)
  }
  openMissionControl('evals')
  void openInEditor(p)
}

function setRun(id: string, f: (r: EvalRun) => EvalRun): void {
  evals.set((s) => ({ ...s, runs: s.runs.map((r) => (r.id === id ? f(r) : r)) }))
  persist()
}
const getRun = (id: string): EvalRun | undefined => evals.get().runs.find((r) => r.id === id)

function patchAttempt(runId: string, attemptId: string, patch: Partial<EvalAttempt>): void {
  setRun(runId, (r) => ({ ...r, attempts: r.attempts.map((a) => (a.id === attemptId ? { ...a, ...patch } : a)) }))
}

export async function startEvalRun(root: string, o: { specs: EvalSpec[]; contestants: Contestant[]; repeat: number; parallel: number }): Promise<string> {
  const head = (await window.api.git.head(root)) ?? 'HEAD'
  const run: EvalRun = { id: newId('ev'), root, specs: o.specs, contestants: o.contestants, repeat: o.repeat, parallel: o.parallel, head, attempts: plannedAttempts(o.specs, o.contestants, o.repeat, () => newId('at')), createdAt: now() }
  evals.set((s) => ({ ...s, runs: [run, ...s.runs].slice(0, 50) }))
  persist()
  void tick(run.id)
  return run.id
}

/** Continue a run a restart (or Stop) left: the queued attempts start again. */
export function continueRun(id: string): void {
  setRun(id, (r) => ({ ...r, stopped: false }))
  void tick(id)
}

/** Stop: running agents are stopped, nothing more starts. */
export function stopRun(id: string): void {
  const run = getRun(id)
  if (!run) return
  setRun(id, (r) => ({ ...r, stopped: true }))
  for (const a of run.attempts) if (a.mission && (a.status === 'running' || a.status === 'checking')) stopMission(a.mission)
}

/** Ask first (EvalsView). Removes the run, its worktrees and branches (scratch work), and its missions. */
export async function removeRun(id: string): Promise<void> {
  const run = getRun(id)
  if (!run) return
  stopRun(id)
  for (const a of run.attempts) if (a.worktree) await window.api.git.removeWorktree(a.worktree, { deleteBranch: true, discard: true }).catch(() => undefined)
  for (const m of missions.get().list.filter((x) => x.eval?.run === id)) await removeMission(m.id, { removeWorktree: false, deleteBranch: false })
  evals.set((s) => ({ ...s, runs: s.runs.filter((r) => r.id !== id) }))
  persist()
}

const ticking = new Set<string>()
async function tick(runId: string): Promise<void> {
  if (ticking.has(runId)) return
  ticking.add(runId)
  try {
    const run = getRun(runId)
    if (!run) return
    for (const a of nextAttempts(run)) {
      patchAttempt(runId, a.id, { status: 'running', startedAt: now() })
      void runAttempt(runId, a.id)
    }
    const cur = getRun(runId)
    if (cur && !cur.finishedAt && cur.attempts.every(attemptDone)) setRun(runId, (r) => ({ ...r, finishedAt: now() }))
  } finally {
    ticking.delete(runId)
  }
}

/** Resolves when the mission's process ends, or 'timeout' after `ms`. */
function missionEnd(id: string, ms: number): Promise<'ended' | 'failed' | 'timeout'> {
  return new Promise<'ended' | 'failed' | 'timeout'>((done) => {
    let stop = (): void => undefined
    const check = (): boolean => {
      const m = getMission(id)
      if (!m || m.status === 'ended' || m.status === 'failed') {
        stop()
        clearTimeout(timer)
        done(m?.status === 'ended' ? 'ended' : 'failed')
        return true
      }
      return false
    }
    const timer = setTimeout(() => {
      stop()
      done('timeout')
    }, ms)
    if (!check()) stop = missions.subscribe(() => void check())
  }).then((end) => {
    // a finished attempt's terminal tab goes away (its mission keeps the report); one that failed stays to look at
    const panel = missions.get().panels[id]
    if (end === 'ended' && panel) closePanel(panel)
    return end
  })
}

/** Print-mode missions start a terminal tab; the tab the user was on stays in front. */
async function quietly<T>(f: () => Promise<T>): Promise<T> {
  const front = activePanelId()
  try {
    return await f()
  } finally {
    if (front) activatePanel(front)
  }
}

const runsDir = (cwd: string, runId: string): string => `${cwd}/.sldev/runs/${runId}`

async function runAttempt(runId: string, attemptId: string): Promise<void> {
  const fail = (status: 'error' | 'stopped', note: string): void => patchAttempt(runId, attemptId, { status, note })
  try {
    const run = getRun(runId)!
    const a = run.attempts.find((x) => x.id === attemptId)!
    const spec = run.specs.find((s) => s.name === a.eval)!
    const agent = getAgent(a.contestant.agent)
    const slug = `eval-${slugifyEval(spec.name).slice(0, 24)}-${slugifyEval(contestantKey(a.contestant)).slice(0, 16)}-${attemptId.slice(-4)}`
    const wt = await window.api.git.addWorktree(run.root, slug, spec.base || run.head)
    patchAttempt(runId, attemptId, { worktree: wt })
    await window.api.factory.prepare(runsDir(wt.path, runId))
    const setup = await window.api.factory.setupPlan(wt.path, spec.setup).catch(() => null)
    if (setup) {
      const r = await window.api.factory.setup(wt.path, setup)
      if (!r.ok) return fail('error', `Setup failed (${setup}): ${r.log.trim().split('\n').slice(-2).join(' ').slice(0, 240)}`)
    }
    // what setup left is not the agent's work
    await window.api.git.commitAll(wt.path, 'eval: setup').catch(() => undefined)
    const base = (await window.api.git.head(wt.path)) ?? wt.base
    if (getRun(runId)?.stopped) return fail('stopped', 'Stopped before the agent started')

    const kind = getKind('build')
    const m = await quietly(() =>
      startMission({
        prompt: renderKind(kind, { title: spec.name, brief: spec.brief }),
        brief: spec.brief,
        title: `Eval: ${spec.name} · ${agent.name}${a.contestant.model ? ` ${a.contestant.model}` : ''}`.slice(0, 60),
        root: run.root,
        cwd: wt.path,
        // nobody approves tool calls in print mode: the same unattended mode as factory stages
        options: { agent: agent.id, model: a.contestant.model, print: true, permissionMode: stageMode(agent, workspace.get().factoryModes) },
        worktree: false,
        kind: { id: kind.id, name: kind.name, readOnly: false },
        eval: { run: runId, attempt: attemptId }
      })
    )
    const started = now()
    patchAttempt(runId, attemptId, { mission: m.id })
    const end = await missionEnd(m.id, spec.timeout * 60_000)
    const agentMs = now() - started
    if (end === 'timeout') stopMission(m.id)
    if (getRun(runId)?.stopped) return fail('stopped', 'Stopped while the agent worked')
    await window.api.git.commitAll(wt.path, `eval: ${agent.name}'s work`).catch(() => undefined)
    const stat = await window.api.git.diffStat(wt.path, base).catch(() => ({ files: 0, insertions: 0, deletions: 0 }))
    const diff = { files: stat.files, lines: stat.insertions + stat.deletions }
    patchAttempt(runId, attemptId, { status: 'checking', agentMs, diff })

    const checks: CheckResult[] = []
    for (const c of spec.checks) {
      if (c.type === 'run') checks.push(runCheckResult(c, await window.api.evals.check(wt.path, c.command, 10 * 60_000)))
      else if (c.type === 'diff') checks.push(diffCheckResult(c, diff))
      else checks.push(await judge(runId, attemptId, spec, c.rubric, wt.path, base))
      patchAttempt(runId, attemptId, { checks: [...checks] })
    }
    const note = end === 'timeout' ? `The agent was stopped after ${spec.timeout} min` : end === 'failed' ? `${agent.name} exited with an error` : undefined
    patchAttempt(runId, attemptId, { status: end === 'ended' ? attemptStatus(checks) : 'failed', note })
  } catch (e) {
    fail('error', (e as Error).message.split('\n')[0])
  } finally {
    void tick(runId)
  }
}

/** A read-only agent reads the diff against the rubric and writes its verdict to a file. */
async function judge(runId: string, attemptId: string, spec: EvalSpec, rubric: string, cwd: string, base: string): Promise<CheckResult> {
  const agent = getAgent(workspace.get().defaultAgent)
  const file = `${runsDir(cwd, runId)}/judge-${attemptId}.md`
  const m: Mission = await quietly(() =>
    startMission({
      prompt: judgePrompt(spec, rubric, base, file),
      title: `Judge: ${spec.name}`.slice(0, 60),
      root: getRun(runId)!.root,
      cwd,
      // it has to write its verdict file, so not the read-only mode; the prompt says not to touch anything else
      options: { agent: agent.id, print: true, permissionMode: stageMode(agent, workspace.get().factoryModes) },
      worktree: false,
      kind: { id: 'review', name: 'Judge', readOnly: true },
      eval: { run: runId, attempt: attemptId, judge: true }
    })
  )
  const end = await missionEnd(m.id, 10 * 60_000)
  if (end === 'timeout') stopMission(m.id)
  return judgeResult(await window.api.factory.read(file))
}
