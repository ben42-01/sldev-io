import type { WorktreeInfo, WorktreeStatus } from '@shared/types'
import type { FactoryRun } from '@shared/factory'
import { confirmAction, showNotice } from '../components/Modal'
import { getMission, isLive, missions, removeMission } from '../state/missions'
import { removeRun, runWorktrees } from '../state/factory'
import { runningTerminalsIn } from './terminals'

/**
 * Every destructive action asks first, in the app, and says what is removed and what is kept.
 * Worktrees with uncommitted work are only removed after the user ticks "discard", and never while
 * something still runs in them.
 */

const errText = (e: unknown): string => String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')

const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`

function lossText(st: WorktreeStatus): string | null {
  const parts = [st.modified && plural(st.modified, 'modified file'), st.untracked && plural(st.untracked, 'untracked file')].filter(Boolean)
  return parts.length ? parts.join(' and ') : null
}

const code = (s: string): React.JSX.Element => <code>{s}</code>

export async function removeMissionFlow(id: string): Promise<void> {
  const m = getMission(id)
  if (!m) return
  if (!m.worktree) {
    const ok = await confirmAction({
      title: 'Remove this mission?',
      message: m.title,
      removes: ['The mission from the list, with its history'],
      keeps: [<>All files in {code(m.cwd)} (this mission worked in the folder directly)</>],
      confirmLabel: 'Remove mission',
      cancelLabel: 'Keep mission',
      danger: true
    })
    if (ok) await removeMission(id, { removeWorktree: false, deleteBranch: false })
    return
  }
  const wt = m.worktree
  const st = await window.api.git.worktreeStatus(wt).catch(() => null)
  const loss = st && lossText(st)
  const blockers: React.ReactNode[] = []
  if (isLive(m.status) && missions.get().panels[id]) blockers.push('The agent is still running here. Stop it first.')
  const others = runningTerminalsIn(wt.path).filter((t) => t !== missions.get().panels[id])
  if (others.length) blockers.push(`${plural(others.length, 'terminal')} still running in this folder. Stop or close ${others.length === 1 ? 'it' : 'them'} first.`)
  const ok = await confirmAction({
    title: 'Remove this mission?',
    message: m.title,
    removes: [<>The worktree folder {code(wt.path)}</>, 'The mission from the list'],
    keeps: [<>The branch {code(wt.branch)}{st?.unmerged ? ` with its ${plural(st.unmerged, 'commit')}` : ''}, unless you tick below</>, 'Your main checkout'],
    blockers,
    checks: [
      ...(loss ? [{ id: 'discard', label: <>Discard {loss} in the worktree (not committed anywhere)</>, required: true }] : []),
      { id: 'branch', label: <>Also delete the branch {code(wt.branch)}{st?.unmerged ? ` (${plural(st.unmerged, 'commit')} not in ${wt.base})` : ''}</> }
    ],
    confirmLabel: 'Confirm remove',
    cancelLabel: 'Keep mission',
    danger: true
  })
  if (!ok) return
  try {
    await removeMission(id, { removeWorktree: true, deleteBranch: !!ok.branch, discard: !!ok.discard })
  } catch (e) {
    await showNotice('The worktree was not removed', errText(e))
  }
}

export async function removeRunFlow(run: FactoryRun, withWorktrees: boolean): Promise<void> {
  if (!withWorktrees) {
    const ok = await confirmAction({
      title: 'Remove this run from the list?',
      message: run.intent,
      removes: ['The run from the list'],
      keeps: [<>Its worktrees and branches, e.g. {code(run.worktree.branch)}</>],
      confirmLabel: 'Remove from list',
      danger: true
    })
    if (ok) await removeRun(run.id, { worktrees: false })
    return
  }
  const trees = runWorktrees(run)
  const statuses = await Promise.all(trees.map((w) => window.api.git.worktreeStatus(w).catch(() => null)))
  const dirty = trees.map((w, i) => [w, statuses[i] && lossText(statuses[i]!)] as [WorktreeInfo, string | null]).filter(([, l]) => l)
  const busy = trees.flatMap((w) => runningTerminalsIn(w.path))
  const ok = await confirmAction({
    title: 'Remove this run and its worktrees?',
    message: run.intent,
    removes: [...trees.filter((w) => statuses[trees.indexOf(w)]?.exists !== false).map((w) => <>{code(w.path)}</>), 'The branches of parallel stages', 'The run from the list'],
    keeps: [<>The run's branch {code(run.worktree.branch)}</>],
    blockers: run.status === 'running' ? ['The run is still going. Stop it first.'] : busy.length ? [`${plural(busy.length, 'terminal')} still running in these folders.`] : [],
    checks: dirty.length ? [{ id: 'discard', required: true, label: <>Discard uncommitted work: {dirty.map(([w, l]) => `${l} in ${w.branch}`).join('; ')}</> }] : [],
    confirmLabel: 'Confirm remove',
    cancelLabel: 'Keep run',
    danger: true
  })
  if (!ok) return
  try {
    await removeRun(run.id, { worktrees: true, discard: !!ok.discard })
  } catch (e) {
    await showNotice('Some worktrees were not removed', errText(e))
  }
}

/** A plain delete: one sentence on what goes, optionally what stays. */
export async function confirmDelete(what: string, name: string, opts: { keeps?: React.ReactNode[]; note?: React.ReactNode } = {}): Promise<boolean> {
  const ok = await confirmAction({
    title: `Delete this ${what}?`,
    message: (
      <>
        <strong>{name}</strong>
        {opts.note && <div className="muted small">{opts.note}</div>}
      </>
    ),
    keeps: opts.keeps,
    confirmLabel: 'Confirm delete',
    cancelLabel: `Keep ${what}`,
    danger: true
  })
  return !!ok
}

export { errText, showNotice }
