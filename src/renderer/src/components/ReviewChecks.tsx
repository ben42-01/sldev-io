import { useEffect, useState } from 'react'
import { ChevronDown, FlaskConical, LoaderCircle, Play, RotateCcw, SquareTerminal } from 'lucide-react'
import { checkLabel, checksState, checksSummary } from '@shared/reviewChecks'
import type { ReviewCheck } from '@shared/types'
import { focusPanel } from '../dock/dockApi'
import { terminalInfo } from '../lib/terminals'
import { runChecks, runningChecks } from '../state/reviewChecks'
import type { ReviewSource } from '../state/reviewTargets'
import { useStore } from '../state/store'
import { StatusDot, StatusPill } from './StatusDot'

/**
 * Run checks, in the review cockpit: the project's typecheck and tests on exactly the code under review, in its
 * own folder (a PR's worktree), on a click only. Each check says passed or failed with the end of its output and
 * opens its terminal for the whole log; the result is tied to the commit it ran on and says "stale" after new ones.
 */
export function ReviewChecks({ source, diff }: { source: ReviewSource; diff: string }): React.JSX.Element {
  const c = source.review.checks
  const live = useStore(runningChecks, (s) => !!s.keys[source.key])
  const head = useHead(source, diff)
  const state = checksState(c, head, diff, live)
  const sum = checksSummary(c, state, head, diff)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  // a failure opens the details by itself; a pass stays one line
  useEffect(() => setOpen(state === 'failed'), [state, c?.at])

  const run = (): void => {
    setError('')
    runChecks(source.target, diff).catch((e: Error) => setError(e.message))
  }
  const rows = c?.results ?? []
  const details = !!c && (rows.length > 0 || !!c.setup || !!c.error)
  const installing = live && !!c?.setup && rows.every((r) => r.status === 'waiting')

  return (
    <section className={`rc-checks ${state}`} aria-label="Project checks" data-testid="review-checks">
      <div className="rc-checks-row">
        <span className="field-label">
          <FlaskConical size={11} /> Checks
        </span>
        <StatusPill signal={sum.signal} />
        <span className="rc-checks-line" title={c ? `${c.path}\n${c.head}` : undefined}>
          {sum.line}
        </span>
        <span className="spacer" />
        {details && (
          <button type="button" className="icon-btn" aria-expanded={open} title={open ? 'Hide the checks' : 'Show each check'} aria-label={open ? 'Hide the checks' : 'Show each check'} onClick={() => setOpen((o) => !o)}>
            <ChevronDown size={13} className={open ? 'up' : ''} />
          </button>
        )}
        <button
          type="button"
          className={`btn sm${state === 'none' || state === 'stale' ? ' primary' : ''}`}
          disabled={live}
          title={source.mission ? `Run the project's typecheck and test in ${source.cwd}` : 'Check out the head in its own worktree, install its dependencies once, then run the project\'s typecheck and test there. Nothing is pushed.'}
          onClick={run}
        >
          {live ? <LoaderCircle size={13} className="spin" /> : state === 'none' ? <Play size={13} /> : <RotateCcw size={13} />} {state === 'none' ? 'Run checks' : live ? 'Running' : 'Run again'}
        </button>
      </div>
      {error && <div className="rc-error">{error}</div>}
      {open && c && (
        <div className="rc-checks-list">
          {c.setup && (
            <div className="rc-check">
              <StatusDot signal={{ tone: !c.setup.ok ? 'error' : installing ? 'working' : 'done', label: 'Dependencies', pulse: installing }} />
              <span className="rc-check-name">install</span>
              <code className="muted rc-check-cmd">{c.setup.command}</code>
              <span className="muted rc-check-end">{!c.setup.ok ? 'failed' : installing ? 'running' : 'done'}</span>
            </div>
          )}
          {c.setup?.tail && <pre className="rc-check-out selectable">{c.setup.tail}</pre>}
          {rows.map((r) => (
            <CheckRow key={r.name} r={r} live={live} />
          ))}
          {c.skipped.length > 0 && <div className="muted rc-check">No {c.skipped.join(' or ')} in this project</div>}
          {c.error && <pre className="rc-check-out selectable">{c.error}</pre>}
        </div>
      )}
    </section>
  )
}

function CheckRow({ r, live }: { r: ReviewCheck; live: boolean }): React.JSX.Element {
  const term = r.panelId && terminalInfo(r.panelId) ? r.panelId : null
  const tone = r.status === 'passed' ? 'done' : r.status === 'failed' ? 'error' : r.status === 'running' ? 'working' : 'neutral'
  return (
    <>
      <div className={`rc-check ${r.status}`} data-check={r.name}>
        <StatusDot signal={{ tone, label: checkLabel(r), pulse: r.status === 'running' && live }} />
        <span className="rc-check-name">{r.name}</span>
        <code className="muted rc-check-cmd" title={r.command}>
          {r.command}
        </code>
        <span className="muted rc-check-end">{checkLabel(r)}</span>
        <button
          type="button"
          className="btn sm ghost"
          disabled={!term}
          title={term ? 'Open its terminal: the whole log' : 'Its terminal was closed (or the app restarted); run the checks again for a new one'}
          onClick={() => term && focusPanel(term)}
        >
          <SquareTerminal size={12} /> Log
        </button>
      </div>
      {r.status === 'failed' && <pre className="rc-check-out selectable" aria-label={`${r.name} output`}>{r.tail || '(no output)'}</pre>}
    </>
  )
}

/** The commit under review: the source's own (a PR's head), else what is checked out in its folder. */
function useHead(source: ReviewSource, diff: string): string {
  const [local, setLocal] = useState('')
  useEffect(() => {
    if (source.head) return
    let live = true
    void window.api.git.head(source.cwd).then((h) => live && setLocal(h ?? ''), () => undefined)
    return () => {
      live = false
    }
  }, [source.head, source.cwd, diff])
  return source.head ?? local
}
