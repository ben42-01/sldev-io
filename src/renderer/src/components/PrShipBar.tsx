import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, LoaderCircle, MessageSquare, RefreshCw, ThumbsUp, Undo2 } from 'lucide-react'
import { currentRuns, isMergeMethod, METHOD_LABEL, prMergeBlock, shipBusy, summarizeChecks, type MergeMethod, type ShipPr, type ShipRun } from '@shared/ship'
import { ghRunSignal } from '@shared/status'
import { openPostReview, postReview } from '../state/review'
import type { ReviewSource } from '../state/reviewTargets'
import { updateSettings, workspace } from '../state/workspace'
import { useStore } from '../state/store'
import { showContextMenu } from './ContextMenu'
import { ago } from './MissionCard'
import { confirmAction } from './Modal'
import { StatusDot, StatusPill } from './StatusDot'
import { toast } from './Toast'

const FAST_MS = 15_000
const SLOW_MS = 60_000

interface Props {
  source: ReviewSource
  /** the Review tab is on screen: GitHub is only asked while it is */
  visible: boolean
  /** changes whenever the tab read the diff again */
  stamp: number
  /** something changed on GitHub (merged): read the diff again */
  onChanged: () => void
}

/**
 * The Review tab's bar for a pull request: its checks (the head branch's Actions runs), and what a reviewer does
 * next, each only on a click and said first: approve, request changes or comment (one review, with the notes on
 * their lines), and merge exactly the reviewed commit. Nothing local changes.
 */
export function PrShipBar({ source, visible, stamp, onChanged }: Props): React.JSX.Element | null {
  const pr0 = source.pr!
  const [pr, setPr] = useState<ShipPr | null>(null)
  const [runs, setRuns] = useState<ShipRun[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState(false)
  const method = useStore(workspace, (w) => (isMergeMethod(w.mergeMethod) ? w.mergeMethod : 'squash'))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await window.api.gh.prShip(pr0.root, pr0.number)
      setPr(r.pr)
      setRuns(r.runs)
      setError(r.error ?? '')
    } catch (e) {
      setError(clean(e))
    } finally {
      setLoading(false)
    }
  }, [pr0.root, pr0.number])

  const cur = useMemo(() => currentRuns(runs, pr?.headSha ?? ''), [runs, pr])
  const checks = useMemo(() => summarizeChecks(cur.runs), [cur])
  const fast = shipBusy(pr ? { branch: '', localSha: '', unpushed: 0, uncommitted: 0, pr, runs } : null, checks)
  const reviewed = source.head
  const block = pr ? prMergeBlock(pr, checks, reviewed) : null
  const moved = !!(pr && reviewed && pr.headSha && pr.headSha !== reviewed)

  useEffect(() => {
    if (visible) void load()
  }, [visible, load, stamp])
  useEffect(() => {
    if (!visible) return
    const t = window.setInterval(() => void load(), fast ? FAST_MS : SLOW_MS)
    return () => window.clearInterval(t)
  }, [visible, fast, load])

  const approve = async (): Promise<void> => {
    if (!pr) return
    const ok = await confirmAction({
      title: `Approve #${pr.number}?`,
      message: `Posts an approving review on GitHub as you, on the commit you reviewed (${(reviewed ?? pr.headSha).slice(0, 7)}). Nothing is merged.`,
      confirmLabel: 'Approve'
    })
    if (!ok) return
    setBusy('Approving')
    setError('')
    try {
      toast(await postReview(source.target, 'APPROVE', '', [], []))
      void load()
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy('')
    }
  }

  const merge = async (m: MergeMethod, auto: boolean): Promise<void> => {
    if (!pr || !reviewed) return
    if (moved) {
      setError(block ?? 'New commits since you looked: refresh the review first')
      return
    }
    const r = await confirmAction({
      title: auto ? `Merge #${pr.number} when its checks pass?` : `Merge #${pr.number} into ${pr.base}?`,
      message: auto
        ? `GitHub merges it (${METHOD_LABEL[m].toLowerCase()}) as soon as the required checks pass, if the commit is still the one you reviewed (${reviewed.slice(0, 7)}).`
        : `${METHOD_LABEL[m]} on GitHub, exactly the commit you reviewed (${reviewed.slice(0, 7)}). If someone pushed since, GitHub refuses. Nothing local changes.`,
      checks: !auto && block ? [{ id: 'anyway', label: `Merge anyway: ${block.toLowerCase()}`, required: true }] : undefined,
      confirmLabel: auto ? 'Merge when ready' : 'Merge'
    })
    if (!r) return
    if (m !== method) updateSettings({ mergeMethod: m })
    setBusy('Merging')
    setError('')
    try {
      toast((await window.api.gh.mergePr(pr0.root, pr.number, m, reviewed, auto)).split('\n').slice(-1)[0])
      onChanged()
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy('')
      void load()
    }
  }

  const mergeMenu = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    showContextMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => e.preventDefault() }, [
      { type: 'header', label: 'Merge on GitHub' },
      ...(['squash', 'merge', 'rebase'] as MergeMethod[]).map((x) => ({ label: `${METHOD_LABEL[x]}${x === method ? '  ✓' : ''}`, run: () => void merge(x, false) })),
      ...(checks.pending > 0 ? [{ label: 'Merge when checks pass', icon: <LoaderCircle size={13} />, run: () => void merge(method, true) }] : [])
    ])
  }

  const PrIcon = !pr ? GitPullRequest : pr.state === 'MERGED' ? GitMerge : pr.state === 'CLOSED' ? GitPullRequestClosed : pr.isDraft ? GitPullRequestDraft : GitPullRequest
  const tone = !pr ? '' : pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.isDraft ? 'draft' : 'open'
  const live = pr?.state === 'OPEN'
  const spin = (label: string): React.ReactNode => (busy === label ? <LoaderCircle size={13} className="spin" /> : null)
  const decision = pr?.reviewDecision === 'APPROVED' ? 'Approved' : pr?.reviewDecision === 'CHANGES_REQUESTED' ? 'Changes requested' : pr?.reviewDecision === 'REVIEW_REQUIRED' ? 'Review required' : ''

  return (
    <div className="ship" data-testid="pr-ship">
      <div className="ship-row">
        {pr ? (
          <button type="button" className={`ship-pr ${tone}`} title={`${pr.title}\nOpen on GitHub`} onClick={() => void window.api.shell.openExternal(pr.url)}>
            <PrIcon size={13} /> #{pr.number} <span className="ship-pr-state">{pr.state === 'OPEN' ? (pr.isDraft ? 'Draft' : 'Open') : pr.state === 'MERGED' ? 'Merged' : 'Closed'}</span>
          </button>
        ) : null}
        {pr && live && (
          <button type="button" className={`ship-checks${open ? ' on' : ''}`} aria-expanded={open} title={cur.stale ? 'These runs are on an older commit' : checks.signal.label} onClick={() => setOpen((o) => !o)}>
            <StatusPill signal={checks.signal} label={`${checks.label}${cur.stale ? ' · older commit' : ''}`} />
            <ChevronDown size={12} className={open ? 'up' : ''} />
          </button>
        )}
        {decision && live && <span className="ship-why muted">{decision}</span>}
        {live && (
          <span className={`ship-why${!block ? ' ready' : ''}`} title={block ?? 'Ready to merge'}>
            {!block && <Check size={12} />} {block ?? 'Ready to merge'}
          </span>
        )}
        {error && !pr && <span className="ship-why muted" title={error}>GitHub: {error}</span>}

        <span className="spacer" />
        {busy && <span className="ship-busy muted">{busy}…</span>}
        <button className="icon-btn" title="Ask GitHub again" aria-label="Refresh the pull request and checks" disabled={loading} onClick={() => void load()}>
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
        </button>
        {live && (
          <>
            <button className="btn sm" disabled={!!busy} title="A review with a comment, and your notes on their lines" onClick={() => openPostReview(source.key, 'COMMENT')}>
              <MessageSquare size={13} /> Comment…
            </button>
            <button className="btn sm" disabled={!!busy} title="Request changes: your notes go on their lines, with a summary" onClick={() => openPostReview(source.key, 'REQUEST_CHANGES')}>
              <Undo2 size={13} /> Request changes…
            </button>
            <button className="btn sm" disabled={!!busy || moved} title={moved ? 'New commits since you looked: refresh the review first' : 'An approving review on GitHub, as you'} onClick={() => void approve()}>
              {spin('Approving') ?? <ThumbsUp size={13} />} Approve
            </button>
            <div className="ship-split">
              <button className={`btn sm${!block ? ' primary' : ''}`} disabled={!!busy || moved || !reviewed} title={moved ? (block ?? '') : block ? `${block}. You can still merge, after confirming.` : `${METHOD_LABEL[method]} on GitHub`} onClick={() => void merge(method, false)}>
                {spin('Merging') ?? <GitMerge size={13} />} {method === 'squash' ? 'Squash & merge' : method === 'rebase' ? 'Rebase & merge' : 'Merge PR'}
              </button>
              <button className={`btn sm${!block ? ' primary' : ''}`} disabled={!!busy || moved || !reviewed} title="Merge method" aria-label="Pick how to merge" onClick={mergeMenu}>
                <ChevronDown size={12} />
              </button>
            </div>
          </>
        )}
        {pr && (
          <button className="icon-btn" title={`Open #${pr.number} on GitHub`} aria-label={`Open #${pr.number} on GitHub`} onClick={() => void window.api.shell.openExternal(pr.url)}>
            <ExternalLink size={13} />
          </button>
        )}
      </div>
      {error && pr && <pre className="ship-error selectable">{error}</pre>}
      {open && live && (
        <ul className="ship-runs" aria-label="Workflow runs">
          {cur.runs.length === 0 && <li className="muted ship-run-empty">{loading ? 'Asking GitHub…' : 'No workflow runs on this branch.'}</li>}
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
                <button className="icon-btn" title="Open the run on GitHub" aria-label="Open the run on GitHub" onClick={() => void window.api.shell.openExternal(r.url)}>
                  <ExternalLink size={12} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function clean(e: unknown): string {
  return String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')
}
