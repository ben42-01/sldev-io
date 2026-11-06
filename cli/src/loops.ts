import { spawn } from 'child_process'
import { beginPass, endPass, freshProgress, lastPass, nextPassNumber, passBrief, passChanged, progressLabel, repeatDue, type PassOutcome, type RepeatPlan, type RepeatProgress } from '@shared/repeat'
import type { Mission } from '@shared/types'
import { commitAll, diffStat, head, isRepo } from '../../src/main/git'
import type { LoopInfo, NewPaneArgs, PaneInfo } from './protocol'

/**
 * `sldev new --repeat`: the daemon's repeat loops. The rules (when a pass is over, what stops the loop, what
 * the next pass is told) are src/shared/repeat.ts, the same as the app's; this runs them: starts each pass's
 * pane, runs the check, commits the pass in its worktree and waits the gap. Loops live as long as the daemon.
 */

export interface PassStart {
  brief: string
  title: string
  /** the folder every pass after the first works in */
  cwd?: string
  worktree?: Mission['worktree']
  repeat: NonNullable<Mission['repeat']>
}

export interface LoopDeps {
  /** starts a pass's pane from the loop's own `sldev new` arguments */
  start: (args: NewPaneArgs, pass: PassStart) => Promise<PaneInfo>
  notify: (title: string, body: string) => void
  changed?: (loop: LoopInfo) => void
  /** runs the check command; a shell string, like a task's (tests stub it) */
  check?: (cwd: string, command: string) => Promise<{ ok: boolean; log: string }>
}

interface Loop {
  id: string
  name: string
  brief: string
  plan: RepeatPlan
  args: NewPaneArgs
  progress: RepeatProgress
  timer?: ReturnType<typeof setTimeout>
  busy: boolean
  /** a pass that ended while its start was still being recorded */
  pending?: { pane: string; outcome: PassOutcome; report?: string }
  /** finish after the running pass */
  stopping?: boolean
}

const clock = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export class Loops {
  private loops = new Map<string, Loop>()
  private next = 1

  constructor(private d: LoopDeps) {}

  /** Creates a loop and starts its first pass; resolves with that pass's pane. */
  async create(spec: { name: string; brief: string; plan: RepeatPlan; args: NewPaneArgs }): Promise<PaneInfo> {
    const loop: Loop = { id: `L${this.next++}`, name: spec.name, brief: spec.brief, plan: spec.plan, args: spec.args, progress: freshProgress(Date.now()), busy: false }
    this.loops.set(loop.id, loop)
    const pane = await this.startPass(loop)
    if (!pane) {
      const reason = loop.progress.reason ?? 'The first pass did not start'
      this.loops.delete(loop.id)
      throw new Error(reason)
    }
    return pane
  }

  list(): LoopInfo[] {
    return [...this.loops.values()].map((l) => this.info(l))
  }

  get(id: string): LoopInfo | undefined {
    const l = this.loops.get(id)
    return l && this.info(l)
  }

  /** No pass after this one: a waiting loop finishes now, a running one when its pass is over. */
  stop(id: string): LoopInfo {
    const l = this.loops.get(id)
    if (!l) throw new Error(`No loop "${id}". See sldev loops.`)
    l.stopping = true
    if (l.progress.state === 'waiting' || l.progress.state === 'paused') {
      clearTimeout(l.timer)
      l.progress = { ...l.progress, state: 'finished', nextAt: undefined, reason: `Stopped after pass ${lastPass(l.progress)?.n ?? 0}` }
    }
    this.changed(l)
    return this.info(l)
  }

  /** A pass's pane is over (the daemon says how: exited cleanly, failed, stopped, accepted, hit the limit). */
  ended(paneId: string, outcome: PassOutcome, report?: string): void {
    const l = [...this.loops.values()].find((x) => x.progress.passes.some((p) => p.mission === paneId) || x.pending?.pane === paneId)
    if (!l) return
    if (l.busy) {
      l.pending = { pane: paneId, outcome, report }
      return
    }
    void this.wrapUp(l, paneId, outcome, report)
  }

  dispose(): void {
    for (const l of this.loops.values()) clearTimeout(l.timer)
  }

  private info(l: Loop): LoopInfo {
    return { id: l.id, name: l.name, brief: l.brief, plan: l.plan, progress: l.progress, label: progressLabel(l.plan, l.progress, Date.now(), clock), stopping: l.stopping }
  }

  private changed(l: Loop): void {
    this.d.changed?.(this.info(l))
  }

  private async startPass(l: Loop): Promise<PaneInfo | undefined> {
    if (l.busy || l.progress.state === 'running' || l.progress.state === 'checking') return undefined
    l.busy = true
    const prog = l.progress
    const n = nextPassNumber(prog)
    let pane: PaneInfo | undefined
    try {
      // what a stopped pass left behind is kept, so this pass's own changes can be told apart
      if (prog.cwd && prog.worktree) await commitAll(prog.cwd, `${l.name}: work left before pass ${n}`.slice(0, 100)).catch(() => undefined)
      pane = await this.d.start(l.args, {
        brief: passBrief(l.brief, l.plan, n, lastPass(prog)),
        title: `${l.name} · pass ${n}${l.plan.times ? `/${l.plan.times}` : ''}`.slice(0, 80),
        cwd: prog.cwd,
        worktree: prog.worktree,
        repeat: { loop: l.id, pass: n, of: l.plan.times, accept: l.plan.doneWhen === 'accept' }
      })
      const repo = await isRepo(pane.cwd)
      const base = repo ? ((await head(pane.cwd)) ?? undefined) : undefined
      const startStat = repo && base && !pane.worktree && !prog.worktree ? await diffStat(pane.cwd, base).catch(() => undefined) : undefined
      l.progress = beginPass(prog, { mission: pane.id, startedAt: Date.now(), base, startStat }, { cwd: pane.cwd, worktree: pane.worktree })
    } catch (e) {
      l.progress = { ...prog, state: 'finished', nextAt: undefined, reason: `Couldn't start pass ${n}: ${(e as Error).message.split('\n')[0]}` }
      this.d.notify(`Repeat: ${l.name}`, l.progress.reason!)
    } finally {
      l.busy = false
    }
    this.changed(l)
    const p = l.pending
    l.pending = undefined
    if (p) void this.wrapUp(l, p.pane, p.outcome, p.report)
    return pane
  }

  private async wrapUp(l: Loop, paneId: string, first: PassOutcome, report: string | undefined): Promise<void> {
    const pass = lastPass(l.progress)
    if (!pass || pass.mission !== paneId || l.progress.state !== 'running' || l.busy) return
    l.busy = true
    try {
      let outcome = first
      let checkOutput: string | undefined
      const cwd = l.progress.cwd!
      const repo = await isRepo(cwd)
      if (outcome === 'done' && repo) {
        const headNow = await head(cwd)
        const stat = await diffStat(cwd, pass.base ?? headNow ?? 'HEAD').catch(() => undefined)
        if (!passChanged(pass, headNow, stat)) outcome = 'unchanged'
      }
      if (outcome === 'done' && l.plan.check?.trim()) {
        l.progress = { ...l.progress, state: 'checking' }
        this.changed(l)
        const r = await (this.d.check ?? runCheck)(cwd, l.plan.check.trim())
        if (!r.ok) {
          outcome = 'check-failed'
          checkOutput = r.log
        }
      }
      // each pass is its own commit in the loop's worktree; in place, nothing is committed
      if (repo && l.progress.worktree && outcome !== 'unchanged') await commitAll(cwd, `${l.name}: pass ${pass.n}`.slice(0, 100)).catch(() => undefined)
      let next = endPass(l.plan, { ...l.progress, state: 'running' }, { outcome, checkOutput, report }, Date.now())
      if (l.stopping && next.state === 'waiting') next = { ...next, state: 'finished', nextAt: undefined, reason: `Stopped after pass ${pass.n}` }
      l.progress = next
      if (next.state === 'finished') this.d.notify(`Repeat: ${l.name}`, next.reason ?? 'Finished')
    } finally {
      l.busy = false
    }
    this.changed(l)
    this.schedule(l)
  }

  private schedule(l: Loop): void {
    clearTimeout(l.timer)
    if (l.progress.state !== 'waiting' || l.progress.nextAt === undefined) return
    l.timer = setTimeout(
      () => {
        const state = repeatDue(l.progress, Date.now())
        // the machine slept through it: one gap from now, no catching up
        if (state === 'missed') {
          l.progress = { ...l.progress, nextAt: Date.now() + l.plan.gapMinutes * 60_000 }
          this.changed(l)
          return this.schedule(l)
        }
        if (state === 'due') void this.startPass(l)
      },
      Math.max(0, l.progress.nextAt - Date.now())
    )
  }
}

/** The check is a shell command line, the way tasks and factory run steps are typed; its last lines go to the next pass. */
export function runCheck(cwd: string, command: string): Promise<{ ok: boolean; log: string }> {
  return new Promise((resolve) => {
    let out = ''
    const add = (d: Buffer): void => void (out = (out + d.toString()).slice(-20_000))
    const child = spawn(command, { cwd, shell: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout?.on('data', add)
    child.stderr?.on('data', add)
    child.on('error', (e) => resolve({ ok: false, log: e.message }))
    child.on('close', (code) => resolve({ ok: code === 0, log: out.trim().split('\n').slice(-60).join('\n') }))
  })
}
