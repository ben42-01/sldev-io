import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownToLine, Check, ChevronDown, ExternalLink, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, LoaderCircle, MoreHorizontal, RefreshCw, RotateCcw, Send, Trash2, Upload, Wrench, X } from 'lucide-react'
import { resolveRun } from '@shared/factory'
import { baseMovedLine, baseMovedSignal, checkPassed, currentRuns, isMergeMethod, mergeBlock, METHOD_LABEL, nextStep, sendBackText, shipBusy, summarizeChecks, tailOutput, UPDATE_CHECKS, updateVerdict, type BaseMoved, type MergeMethod, type ShipRun, type ShipStatus, type UpdateCheck, type UpdateResult } from '@shared/ship'
import { ghRunSignal } from '@shared/status'
import type { Mission, WorktreeInfo } from '@shared/types'
import { removeMissionFlow } from '../lib/removals'
import { followUpMission, isLive, missions } from '../state/missions'
import { getAgent } from '../state/agents'
import { updateSettings, workspace } from '../state/workspace'
import { useStore } from '../state/store'
import { showContextMenu } from './ContextMenu'
import { ago } from './MissionCard'
import { confirmAction } from './Modal'
import { Divider, SHIP_RUNS, shipRunsHeight } from './PaneResizer'
import { StatusDot, StatusPill } from './StatusDot'
import { toast } from './Toast'

/** while a run is going (or GitHub is still working out mergeability), and otherwise */
const FAST_MS = 15_000
const SLOW_MS = 60_000
/** a project's typecheck or test suite, run by Update and check */
const CHECK_TIMEOUT_MS = 15 * 60_000

/** Update and check, from the click to its verdict */
type Update = { phase: 'merging' | 'checking'; doing: string } | { phase: 'done'; ref: string; result: UpdateResult }

interface Props {
  mission: Mission
  wt: WorktreeInfo
  /** the Review tab is on screen: GitHub is only asked while it is */
  visible: boolean
  /** changes whenever the Review tab read the diff again (a commit, Refresh): read the branch again too */
  stamp: number
  /** something changed the branch (push, merge): the diff should be read again */
  onChanged: () => void
  /** open the toolbar's commit form */
  onCommit: () => void
}

/**
 * The Review tab's ship bar: where the reviewed branch stands on its way into its base. The pull request,
 * the workflow runs on the commit under review, whether it can merge, and the one next step (commit, push
 * and open a PR, push, merge, pull the base). Merging happens on GitHub (gh pr merge) and only on a click;
 * merging locally without a PR is in the menu.
 */
export function ShipBar({ mission, wt, visible, stamp, onChanged, onCommit }: Props): React.JSX.Element {
  const [s, setS] = useState<ShipStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [moved, setMoved] = useState<BaseMoved | null>(null)
  const [upd, setUpd] = useState<Update | null>(null)
  const runsHeight = useStore(workspace, (w) => shipRunsHeight(w.shipRunsHeight))
  const method = useStore(workspace, (w) => (isMergeMethod(w.mergeMethod) ? w.mergeMethod : 'squash'))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // the base is local git (plus a fetch now and then): its failure never hides the PR
      const [ship, base] = await Promise.all([window.api.gh.ship(wt.path, wt.branch), window.api.git.baseMoved(wt.path, wt.base).catch(() => null)])
      setS(ship)
      setMoved(base)
    } catch (e) {
      setError(clean(e))
    } finally {
      setLoading(false)
    }
  }, [wt.path, wt.branch, wt.base])

  const sha = s?.pr?.state === 'OPEN' && s.pr.headSha ? s.pr.headSha : (s?.localSha ?? '')
  const cur = useMemo(() => currentRuns(s?.runs ?? [], sha), [s, sha])
  const checks = useMemo(() => summarizeChecks(cur.runs), [cur])
  const step = s ? nextStep(s, checks) : null
  const fast = shipBusy(s, checks)

  // asked when it comes on screen, then every 15 s while a run is going (60 s otherwise), never while hidden
  useEffect(() => {
    if (!visible) return
    void load()
  }, [visible, load, stamp])
  useEffect(() => {
    if (!visible) return
    const t = window.setInterval(() => void load(), fast ? FAST_MS : SLOW_MS)
    return () => window.clearInterval(t)
  }, [visible, fast, load])

  const act = async (label: string, fn: () => Promise<string | void>, changed = true): Promise<void> => {
    setBusy(label)
    setError('')
    try {
      const out = await fn()
      if (typeof out === 'string' && out.trim()) toast(out.trim().split('\n').slice(-1)[0])
      if (changed) onChanged()
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy('')
      // a change to the branch reads the diff again, which reads this again (stamp)
      if (!changed) void load()
    }
  }

  const pushPr = (): Promise<void> => act('Opening the pull request', () => window.api.git.pushAndPr(wt.path, wt.branch, wt.base, mission.title))
  const push = (): Promise<void> => act('Pushing', async () => void (await window.api.git.push(wt.path, wt.branch)))

  const merge = async (m: MergeMethod, auto: boolean): Promise<void> => {
    const pr = s?.pr
    if (!pr) return
    const block = auto ? null : mergeBlock(pr, checks)
    const r = await confirmAction({
      title: auto ? `Merge #${pr.number} when its checks pass?` : `Merge #${pr.number} into ${pr.base}?`,
      message: auto
        ? `GitHub merges it (${METHOD_LABEL[m].toLowerCase()}) as soon as the required checks pass. The repository must allow auto-merge.`
        : `${METHOD_LABEL[m]} on GitHub, exactly the commit you reviewed (${pr.headSha.slice(0, 7)}). If someone pushed since, GitHub refuses.`,
      keeps: [`The worktree and the branch ${wt.branch}: remove them after, from here or the mission`],
      checks: block ? [{ id: 'anyway', label: `Merge anyway: ${block.toLowerCase()}`, required: true }] : undefined,
      confirmLabel: auto ? 'Merge when ready' : 'Merge'
    })
    if (!r) return
    if (m !== method) updateSettings({ mergeMethod: m })
    await act(auto ? 'Turning on auto-merge' : 'Merging', () => window.api.gh.mergePr(wt.repo, pr.number, m, pr.headSha, auto), false)
  }

  const mergeMenu = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    showContextMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => e.preventDefault() }, [
      { type: 'header', label: 'Merge on GitHub' },
      ...(['squash', 'merge', 'rebase'] as MergeMethod[]).map((m) => ({ label: `${METHOD_LABEL[m]}${m === method ? '  ✓' : ''}`, run: () => void merge(m, false) })),
      ...(checks.pending > 0 ? [{ label: 'Merge when checks pass', icon: <LoaderCircle size={13} />, run: () => void merge(method, true) }] : [])
    ])
  }

  /** the main checkout may be on another branch: only fast-forward the base when it's checked out there */
  const pullBase = (): Promise<void> =>
    act(`Pulling ${wt.base}`, async () => {
      const st = await window.api.git.status(wt.repo)
      if (st.branch !== wt.base) throw new Error(`The main checkout is on ${st.branch ?? 'a detached HEAD'}, not ${wt.base}. Pull it from the Git view.`)
      return window.api.git.pull(wt.repo)
    }, false)

  const mergeLocally = async (): Promise<void> => {
    const r = await confirmAction({
      title: `Merge ${wt.branch} into ${wt.base} locally?`,
      message: `git merge --no-ff in the main checkout (${wt.repo}), without a pull request. Nothing is pushed; ${wt.base} on GitHub doesn't change until you push it.`,
      confirmLabel: 'Merge locally'
    })
    if (r) await act('Merging locally', () => window.api.git.merge(wt.repo, wt.branch, wt.base), false)
  }

  const more = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    showContextMenu({ clientX: r.right - 220, clientY: r.bottom + 4, preventDefault: () => e.preventDefault() }, [
      ...(s?.pr ? [{ label: `Open #${s.pr.number} on GitHub`, icon: <ExternalLink size={13} />, run: () => void window.api.shell.openExternal(s.pr!.url) }] : []),
      ...(s?.pr?.state === 'OPEN' && s.unpushed === 0 ? [{ label: 'Merge on GitHub…', icon: <GitMerge size={13} />, run: () => void merge(method, false) }] : []),
      { label: `Merge into ${wt.base} locally, without a PR…`, icon: <GitBranch size={13} />, disabled: !!busy, run: () => void mergeLocally() },
      { label: `Pull ${wt.base} in the main checkout`, icon: <ArrowDownToLine size={13} />, disabled: !!busy, run: () => void pullBase() },
      { type: 'separator' },
      { label: 'Remove the mission and its worktree…', icon: <Trash2 size={13} />, run: () => void removeMissionFlow(mission.id) }
    ])
  }

  const fix = async (run: ShipRun): Promise<void> => {
    const agent = getAgent(mission.options.agent).name
    const text = `The ${run.workflow} workflow failed on this branch (${wt.branch}), run ${run.id}: ${run.url}\n\nRead why with \`gh run view ${run.id} --log-failed\`, fix the cause, run the same check locally if you can, and commit the fix. Don't push; I push from the review.`
    try {
      const m = await followUpMission(mission.id, text)
      if (m) toast(`Asked ${agent} to fix ${run.workflow}`)
    } catch (e) {
      setError(clean(e))
    }
  }
  // a follow-up (Fix with, Send back) is a mission of its own in the same worktree: any live one counts
  const live = useStore(missions, (st) => st.list.some((m) => m.cwd === wt.path && isLive(m.status)))

  /**
   * Update and check, on a click only: merge the base into the worktree (a conflict is undone), then run the
   * project's typecheck and test there, as factory recipes resolve them. The merge commit stays local.
   */
  const updateAndCheck = async (): Promise<void> => {
    if (!moved || live) return
    const ref = moved.ref
    setError('')
    setUpd({ phase: 'merging', doing: `Merging ${ref}` })
    let merged: { merged: boolean; conflicts: string[] }
    try {
      merged = await window.api.git.mergeBaseInto(wt.path, ref)
    } catch (e) {
      setUpd(null)
      setError(clean(e))
      return
    }
    if (!merged.merged) {
      setUpd({ phase: 'done', ref, result: { merged: false, conflicts: merged.conflicts, checks: [], skipped: [] } })
      void load()
      return
    }
    onChanged()
    const checks: UpdateCheck[] = []
    const skipped: string[] = []
    try {
      const detected = await window.api.runtimes.detect(wt.path).catch(() => [])
      const refs = detected.map((d) => ({ name: d.name, command: d.command, rel: d.cwd === wt.path ? '' : d.cwd.slice(wt.path.length + 1) }))
      for (const entry of UPDATE_CHECKS) {
        const { command, skipped: none } = resolveRun([entry], refs)
        skipped.push(...none)
        if (!command) continue
        const name = entry.replace(/\?$/, '')
        setUpd({ phase: 'checking', doing: `Running ${name}` })
        const r = await window.api.evals.check(wt.path, command, CHECK_TIMEOUT_MS)
        checks.push({ name, command, ...r })
      }
    } catch (e) {
      checks.push({ name: 'checks', command: '', code: null, output: clean(e) })
    }
    setUpd({ phase: 'done', ref, result: { merged: true, conflicts: [], checks, skipped } })
    void load()
  }

  const sendBack = async (result: UpdateResult, ref: string): Promise<void> => {
    const agent = getAgent(mission.options.agent).name
    try {
      const m = await followUpMission(mission.id, sendBackText(result, ref, wt.branch))
      if (m) {
        toast(`Sent back to ${agent}`)
        setUpd(null)
      }
    } catch (e) {
      setError(clean(e))
    }
  }

  const pr = s?.pr
  /** the runs list only means something before the merge */
  const canRuns = pr?.state !== 'MERGED' && (cur.runs.length > 0 || (!!pr && !s?.error))
  const PrIcon = !pr ? GitPullRequest : pr.state === 'MERGED' ? GitMerge : pr.state === 'CLOSED' ? GitPullRequestClosed : pr.isDraft ? GitPullRequestDraft : GitPullRequest
  const prTone = !pr ? '' : pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.isDraft ? 'draft' : 'open'
  const busyBtn = (label: string): React.ReactNode => (busy === label ? <LoaderCircle size={13} className="spin" /> : null)

  return (
    <div className="ship">
      <div className="ship-row">
        <span className="ship-branch mono" title={`${wt.branch} into ${wt.base}`}>
          <GitBranch size={12} /> <span className="ship-ref">{wt.branch}</span> <span className="muted">→</span> <span className="ship-ref">{wt.base}</span>
        </span>

        {pr ? (
          <button type="button" className={`ship-pr ${prTone}`} title={`${pr.title}\nOpen on GitHub`} onClick={() => void window.api.shell.openExternal(pr.url)}>
            <PrIcon size={13} /> #{pr.number} <span className="ship-pr-state">{pr.state === 'OPEN' ? (pr.isDraft ? 'Draft' : 'Open') : pr.state === 'MERGED' ? 'Merged' : 'Closed'}</span>
          </button>
        ) : s && !s.error ? (
          <span className="ship-pr none muted">
            <GitPullRequest size={13} /> No PR
          </span>
        ) : null}

        {canRuns && (
          <button
            type="button"
            className={`ship-checks${open ? ' on' : ''}`}
            aria-expanded={open}
            title={cur.stale ? 'These runs are on an older commit than the one under review' : checks.signal.label}
            onClick={() => setOpen((o) => !o)}
          >
            <StatusPill signal={checks.signal} label={`${checks.label}${cur.stale ? ' · older commit' : ''}`} />
            <ChevronDown size={12} className={open ? 'up' : ''} />
          </button>
        )}

        {step && (
          <span className={`ship-why${step.kind === 'merge' && step.ready ? ' ready' : ''}`} title={step.why}>
            {step.kind === 'merge' && step.ready && <Check size={12} />} {step.why}
          </span>
        )}
        {s?.error && <span className="ship-why muted" title={s.error}>GitHub: {s.error}</span>}

        <span className="spacer" />
        {busy && <span className="ship-busy muted">{busy}…</span>}
        <button className="icon-btn" title="Ask GitHub again" aria-label="Refresh the pull request and checks" disabled={loading} onClick={() => void load()}>
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
        </button>

        {step?.kind === 'commit' && (
          <button className="btn sm primary" disabled={!!busy} onClick={onCommit}>
            <GitCommitHorizontal size={13} /> Commit first
          </button>
        )}
        {step?.kind === 'push-pr' && (
          <button className="btn sm primary" disabled={!!busy || !!s?.error} title={`git push, then gh pr create into ${wt.base}`} onClick={() => void pushPr()}>
            {busyBtn('Opening the pull request') ?? <GitPullRequest size={13} />} Push & open PR
          </button>
        )}
        {step?.kind === 'push' && (
          <button className="btn sm primary" disabled={!!busy} title={`git push origin ${wt.branch}`} onClick={() => void push()}>
            {busyBtn('Pushing') ?? <Upload size={13} />} Push {s?.unpushed === 1 ? '1 commit' : `${s?.unpushed} commits`}
          </button>
        )}
        {step?.kind === 'merge' && (
          <div className="ship-split">
            <button
              className={`btn sm${step.ready ? ' primary' : ''}`}
              disabled={!!busy}
              title={step.ready ? `${METHOD_LABEL[method]} on GitHub` : `${step.why}. You can still merge, after confirming.`}
              onClick={() => void merge(method, false)}
            >
              {busyBtn('Merging') ?? <GitMerge size={13} />} {method === 'squash' ? 'Squash & merge' : method === 'rebase' ? 'Rebase & merge' : 'Merge PR'}
            </button>
            <button className={`btn sm${step.ready ? ' primary' : ''}`} disabled={!!busy} title="Merge method" aria-label="Pick how to merge" onClick={mergeMenu}>
              <ChevronDown size={12} />
            </button>
          </div>
        )}
        {step?.kind === 'merged' && (
          <>
            <button className="btn sm" disabled={!!busy} title={`Fast-forward ${wt.base} in the main checkout to what GitHub has`} onClick={() => void pullBase()}>
              {busyBtn(`Pulling ${wt.base}`) ?? <ArrowDownToLine size={13} />} Pull {wt.base}
            </button>
            <button className="btn sm" title="Remove the mission and its worktree…" onClick={() => void removeMissionFlow(mission.id)}>
              <Trash2 size={13} /> Clean up
            </button>
          </>
        )}
        <button className="icon-btn" title="More: merge locally, pull the base, remove" aria-label="More ship actions" onClick={more}>
          <MoreHorizontal size={14} />
        </button>
      </div>

      {error && <pre className="ship-error selectable">{error}</pre>}

      {pr?.state !== 'MERGED' && (moved?.behind || upd) ? (
        <BaseRow moved={moved} upd={upd} live={live} busy={!!busy} agent={getAgent(mission.options.agent).name} onUpdate={() => void updateAndCheck()} onSendBack={(r, ref) => void sendBack(r, ref)} onDismiss={() => setUpd(null)} />
      ) : null}

      {open && canRuns && (
        <ul className="ship-runs" aria-label="Workflow runs" style={{ height: runsHeight }}>
          {cur.runs.length === 0 && <li className="muted ship-run-empty">{loading ? 'Asking GitHub…' : 'No workflow runs on this branch yet. They start when it is pushed, if the repository has workflows.'}</li>}
          {cur.runs.map((r) => {
            const sig = ghRunSignal(r)
            return (
              <li key={r.id} className="ship-run">
                <StatusDot signal={sig} />
                <span className="ship-run-name">{r.workflow}</span>
                <span className="muted ship-run-event">{r.event.replace(/_/g, ' ')}</span>
                <span className="muted ship-run-title" title={r.title}>{r.title}</span>
                <span className="spacer" />
                <span className="muted ship-run-when">{sig.label} · {ago(Date.parse(r.createdAt))}</span>
                {sig.tone === 'error' && (
                  <>
                    <button className="btn sm ghost" disabled={live} title={live ? 'The agent is still working' : `A follow-up to ${getAgent(mission.options.agent).name}: read the failed log, fix it, commit`} onClick={() => void fix(r)}>
                      <Wrench size={12} /> Fix with {getAgent(mission.options.agent).name}
                    </button>
                    <button className="btn sm ghost" disabled={!!busy} title="Run the failed jobs again" onClick={() => void act('Re-running', () => window.api.gh.rerun(wt.path, r.id, true), false)}>
                      <RotateCcw size={12} /> Re-run failed
                    </button>
                  </>
                )}
                <button className="icon-btn" title="Open the run on GitHub" aria-label="Open the run on GitHub" onClick={() => void window.api.shell.openExternal(r.url)}>
                  <ExternalLink size={12} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {canRuns && (
        <Divider
          axis="y"
          className="ship-divider"
          label="Resize the workflow runs"
          title={open ? 'Drag to resize the runs · drag up to close · double-click to close' : 'Drag down to show the workflow runs'}
          start={() => (open ? shipRunsHeight(workspace.get().shipRunsHeight) : 0)}
          onSize={(h, done) => {
            // dragged up past the smallest useful list: closed; anything else opens it at that height
            if (h < SHIP_RUNS.min / 2) return setOpen(false)
            setOpen(true)
            const v = shipRunsHeight(h)
            if (done) updateSettings({ shipRunsHeight: v })
            else workspace.set({ shipRunsHeight: v })
          }}
          onReset={() => setOpen((o) => !o)}
        />
      )}
    </div>
  )
}

interface BaseRowProps {
  moved: BaseMoved | null
  upd: Update | null
  live: boolean
  busy: boolean
  agent: string
  onUpdate: () => void
  onSendBack: (r: UpdateResult, ref: string) => void
  onDismiss: () => void
}

/** "master has 2 new commits since this branch", the trial merge's conflicts, Update and check and its verdict */
function BaseRow({ moved, upd, live, busy, agent, onUpdate, onSendBack, onDismiss }: BaseRowProps): React.JSX.Element {
  const line = moved ? baseMovedLine(moved) : null
  const running = upd?.phase === 'merging' || upd?.phase === 'checking'
  const done = upd?.phase === 'done' ? upd : null
  const verdict = done ? updateVerdict(done.result, done.ref) : null
  const failed = done ? done.result.checks.filter((c) => !checkPassed(c)) : []
  return (
    <div className="ship-base" data-testid="ship-base">
      {line && moved && (
        <div className="ship-base-row">
          <StatusDot signal={baseMovedSignal(moved)} />
          <span className="ship-base-line" title={moved.commits.map((c) => `${c.sha.slice(0, 7)} ${c.subject}`).join('\n')}>
            {line}
          </span>
          {moved.conflicts?.length ? (
            <span className="ship-base-conflicts" title={moved.conflicts.join('\n')}>
              · conflicts in {moved.conflicts.slice(0, 3).join(', ')}
              {moved.conflicts.length > 3 ? ` and ${moved.conflicts.length - 3} more` : ''}
            </span>
          ) : moved.conflicts ? (
            <span className="muted">· merges without conflicts</span>
          ) : null}
          <span className="spacer" />
          {running && <span className="ship-busy muted">{upd.doing}…</span>}
          <button
            className="btn sm"
            disabled={live || busy || running}
            title={live ? `${agent} is still working in this worktree` : `Merge ${moved.ref} into this branch here (nothing is pushed), then run the project's typecheck and test`}
            onClick={onUpdate}
          >
            {running ? <LoaderCircle size={13} className="spin" /> : <GitMerge size={13} />} Update and check
          </button>
        </div>
      )}
      {done && verdict && (
        <div className={`ship-update${verdict.ok ? ' passed' : ' failed'}`} data-testid="ship-update">
          <div className="ship-base-row">
            <StatusPill signal={{ tone: verdict.ok ? 'done' : 'error', label: verdict.ok ? 'Passed' : 'Failed', pulse: false }} />
            <span className="ship-base-line">{verdict.label}</span>
            <span className="spacer" />
            {!verdict.ok && (
              <button className="btn sm" disabled={live} title={live ? `${agent} is still working` : `A follow-up to ${agent} with ${done.result.conflicts.length ? 'the conflicting files' : 'the failing output'}`} onClick={() => onSendBack(done.result, done.ref)}>
                <Send size={12} /> Send back
              </button>
            )}
            <button className="icon-btn" title="Hide" aria-label="Hide the update result" onClick={onDismiss}>
              <X size={12} />
            </button>
          </div>
          {done.result.conflicts.length > 0 && <pre className="ship-error selectable">{done.result.conflicts.join('\n')}</pre>}
          {done.result.checks.map((c) => (
            <div key={c.name} className="ship-check">
              <StatusDot signal={{ tone: checkPassed(c) ? 'done' : 'error', label: checkPassed(c) ? 'Passed' : 'Failed', pulse: false }} />
              <span className="ship-run-name">{c.name}</span>
              <span className="muted mono ship-run-title" title={c.command}>{c.command}</span>
              <span className="muted">{checkPassed(c) ? 'passed' : c.timedOut ? 'timed out' : `exit ${c.code ?? '?'}`}</span>
            </div>
          ))}
          {failed.map((c) => (
            <pre key={c.name} className="ship-error selectable" aria-label={`${c.name} output`}>
              {tailOutput(c.output) || '(no output)'}
            </pre>
          ))}
          {done.result.skipped.length > 0 && <div className="muted ship-check">No {done.result.skipped.join(' or ')} in this project</div>}
        </div>
      )}
    </div>
  )
}

function clean(e: unknown): string {
  return String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')
}
