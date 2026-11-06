import { ghRunSignal } from '@shared/status'
import type { GhRun } from '@shared/types'
import { listRuns, rerun } from '../../src/main/github'
import { findOnPath } from '../../src/main/launch'
import { run } from '../../src/main/git'

/**
 * GitHub Actions runs for `sldev workflows` and the TUI's Ctrl-b w, through the user's own GitHub CLI
 * (signed in as them; nothing goes anywhere else). Only asked when the user opens the view.
 */

/** What went wrong, in words the user can act on: gh missing, not signed in, not a GitHub repository. */
export function ghProblem(stderr: string): string {
  const t = stderr.trim()
  if (/ENOENT|not recognized as an internal|command not found|spawn gh/i.test(t)) return "The GitHub CLI (gh) isn't installed: https://cli.github.com"
  if (/gh auth login|not logged in|authentication|HTTP 401/i.test(t)) return 'Not signed in to GitHub: run gh auth login'
  if (/no git remotes|not a git repository|could not determine|none of the git remotes|no default repository/i.test(t)) return "This folder isn't a GitHub repository (no GitHub remote)"
  return t.split('\n')[0] || 'gh failed'
}

export async function loadRuns(cwd: string): Promise<GhRun[]> {
  if (!findOnPath('gh', process.env)) throw new Error(ghProblem('ENOENT'))
  try {
    return await listRuns(cwd)
  } catch (e) {
    throw new Error(ghProblem((e as Error).message))
  }
}

export async function rerunFailed(cwd: string, id: number): Promise<void> {
  try {
    await rerun(cwd, id, true)
  } catch (e) {
    throw new Error(ghProblem((e as Error).message))
  }
}

/** Opens the run on github.com in the browser (gh does that, so it works with GitHub Enterprise too). */
export async function openRun(cwd: string, id: number): Promise<void> {
  const r = await run('gh', ['run', 'view', String(id), '--web'], cwd, 15000)
  if (r.code !== 0) throw new Error(ghProblem(r.stderr))
}

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/** One run as columns: status, workflow, branch, title, age. */
export function runColumns(r: GhRun, now = Date.now()): { label: string; tone: ReturnType<typeof ghRunSignal>['tone']; text: string } {
  const sig = ghRunSignal(r)
  return { label: sig.label, tone: sig.tone, text: `${r.workflowName} · ${r.headBranch} · ${r.displayTitle}` + ` · ${ago(r.createdAt, now)} ago` }
}
