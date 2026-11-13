import type { GitStatus } from '@shared/types'

/** What the Git view and its toasts say; pure, so it is unit-tested. */

const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`

/** The toast after a fetch, from the status read right after it. */
export function fetchOutcome(after: GitStatus | null): string {
  if (!after?.upstream) return 'Fetched'
  if (after.behind) return `Fetched · ${plural(after.behind, 'new commit')} to pull from ${after.upstream}`
  return `Fetched · up to date with ${after.upstream}`
}

/** The toast after a fast-forward pull; `behindBefore` is how far behind the branch was before it. */
export function pullOutcome(output: string, behindBefore: number, upstream: string | null): string {
  if (/already up.to.date/i.test(output) || !behindBefore) return 'Already up to date'
  return `Pulled ${plural(behindBefore, 'commit')}${upstream ? ` from ${upstream}` : ''}`
}

/** The line of git's error worth a toast ("fatal: Not possible to fast-forward, aborting." → that sentence); the view shows the whole message. */
export function gitErrorLine(message: string): string {
  const lines = message.split('\n').map((l) => l.trim()).filter(Boolean)
  const line = lines.find((l) => /^(fatal|error):/i.test(l)) ?? lines.find((l) => !/^hint:/i.test(l)) ?? lines[0] ?? 'git failed'
  return line.replace(/^(fatal|error):\s*/i, '')
}

/** "2 staged · 1 modified · 3 untracked · 1 conflict", or null when the working tree is clean. */
export function changeSummary(s: GitStatus): string | null {
  const parts = [
    s.conflicted && plural(s.conflicted, 'conflict'),
    s.staged && `${s.staged} staged`,
    s.unstaged && `${s.unstaged} modified`,
    s.untracked && `${s.untracked} untracked`
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

// ── worktrees ────────────────────────────────────────────────────

/** Something in the app that works in a worktree. `live` ones block removing it. */
export interface WorktreeUser {
  kind: 'mission' | 'run' | 'eval'
  id: string
  label: string
  /** running (or paused, for a factory run, which continues there) */
  live: boolean
  /** why it can't be removed while live, in a sentence */
  why?: string
  /** the base it was branched from, for counting its own commits */
  base?: string
}

/** The fields of missions, runs and eval runs the lookup needs (so tests don't build whole ones). */
export interface WorktreeOwners {
  missions: Array<{ id: string; title: string; status: string; cwd: string; worktree?: { path: string; base: string }; eval?: unknown; explains?: unknown }>
  runs: Array<{ id: string; intent: string; status: string; worktrees: Array<{ path: string; base: string }> }>
  evals: Array<{ id: string; attempts: Array<{ id: string; eval: string; status: string; worktree?: { path: string; base: string } }> }>
}

const LIVE_MISSION = ['starting', 'working', 'waiting', 'needs-input']
const LIVE_ATTEMPT = ['queued', 'running', 'checking']

/** Paths as git and the stores write them can differ by a trailing separator. */
export const samePath = (a: string, b: string): boolean => a.replace(/[\\/]+$/, '') === b.replace(/[\\/]+$/, '')

const inside = (dir: string, p: string): boolean => {
  const d = dir.replace(/[\\/]+$/, '')
  return samePath(d, p) || p.startsWith(d + '/') || p.startsWith(d + '\\')
}

const quote = (s: string, max = 60): string => `"${s.length > max ? s.slice(0, max - 1) + '…' : s}"`

/**
 * Who uses the worktree at `path`: missions that work in it (their own worktree, or started in the
 * folder), factory runs with a stage worktree there, eval attempts. For the main checkout only live
 * ones are listed: every in-place mission ran there.
 */
export function worktreeUsers(path: string, isMain: boolean, o: WorktreeOwners): WorktreeUser[] {
  const out: WorktreeUser[] = []
  for (const m of o.missions) {
    // eval attempts are listed under their eval run below
    if (m.eval) continue
    if (!(m.worktree ? samePath(m.worktree.path, path) : inside(path, m.cwd))) continue
    const live = LIVE_MISSION.includes(m.status)
    if (isMain && !live) continue
    out.push({ kind: 'mission', id: m.id, label: m.title, live, base: m.worktree?.base, why: live ? `Mission ${quote(m.title)} is still running here. Stop it first.` : undefined })
  }
  for (const r of o.runs) {
    const wt = r.worktrees.find((w) => samePath(w.path, path))
    if (!wt) continue
    const live = r.status === 'running' || r.status === 'paused'
    if (isMain && !live) continue
    const why = r.status === 'running' ? `Factory run ${quote(r.intent)} is still going here. Stop it first.` : `Factory run ${quote(r.intent)} is paused and continues here. Stop or remove the run first.`
    out.push({ kind: 'run', id: r.id, label: r.intent, live, base: wt.base, why: live ? why : undefined })
  }
  for (const e of o.evals) {
    for (const a of e.attempts) {
      if (!a.worktree || !samePath(a.worktree.path, path)) continue
      const live = LIVE_ATTEMPT.includes(a.status)
      if (isMain && !live) continue
      out.push({ kind: 'eval', id: a.id, label: `eval ${a.eval}`, live, base: a.worktree.base, why: live ? `An attempt of eval ${quote(a.eval)} is still running here. Stop the eval run first.` : undefined })
    }
  }
  return out
}

/** "2 modified · 1 untracked · 3 ahead", or null when there is nothing to say. */
export function worktreeSummary(st: { modified: number; untracked: number; unmerged: number } | null | undefined, base?: string): string | null {
  if (!st) return null
  const parts = [st.modified && `${st.modified} modified`, st.untracked && `${st.untracked} untracked`, st.unmerged && `${st.unmerged} ahead${base ? ` of ${base}` : ''}`].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}
