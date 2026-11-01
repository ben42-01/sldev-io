import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { Bot, Check, ExternalLink, History, FileText, GitPullRequest, MessageSquare, Pause, Play, RefreshCw, RotateCcw, Send, Square, SquareTerminal, Upload, Wrench, X } from 'lucide-react'
import { describeEvent, layout, sendBackTargets, statusesAt, type FactoryRun, type NodeRun, type RecipeNode } from '@shared/factory'
import { focusPanel, openTerminal } from './dockApi'
import { getAgent } from '../state/agents'
import { terminalTail } from '../lib/terminals'
import { openInEditor } from '../lib/actions'
import type { GhPrComment } from '@shared/types'
import { addressPrFeedback, approve, continueStage, keep, markDone, prFeedback, pushPrUpdate, reject, resume, retry, sendBack, stop, useRun } from '../state/factory'
import { getMission } from '../state/missions'
import { allAgents } from '../lib/agents'
import { workspace } from '../state/workspace'
import { showContextMenu } from '../components/ContextMenu'
import { focusOrResume, isLive, missions, reviewMission, useMission } from '../state/missions'
import { ago } from '../components/MissionCard'
import { StatusPill } from '../components/StatusDot'
import { nodeSignal, runSignal } from '@shared/status'

const W = 196
const BASE_H = 128
/** each bake-off version gets a row */
const ROW_H = 26
const GX = 44
const GY = 22

/** A factory run as a graph: columns follow `needs`, parallel branches stack, retry loops are dashed. */
export function PipelinePanel({ params }: IDockviewPanelProps<{ runId: string }>): React.JSX.Element {
  const run = useRun(params.runId)
  const [history, setHistory] = useState(false)
  /** replay position; null follows the live run */
  const [replayAt, setReplayAt] = useState<number | null>(null)
  const pos = useMemo(() => (run ? layout(run.recipe) : new Map<string, { col: number; row: number }>()), [run])
  const avail = useWidth()
  if (!run) return <div className="panel-page muted">This run was removed.</div>
  const H = BASE_H + ROW_H * Math.max(0, ...run.recipe.nodes.map((n) => (n.agents.length > 1 ? n.agents.length : 0)))

  const at = (id: string): { x: number; y: number } => {
    const p = pos.get(id) ?? { col: 0, row: 0 }
    return { x: p.col * (W + GX), y: p.row * (H + GY) }
  }
  const cols = Math.max(...[...pos.values()].map((p) => p.col)) + 1
  const rows = Math.max(...[...pos.values()].map((p) => p.row)) + 1
  const width = cols * (W + GX) - GX
  const height = rows * (H + GY) - GY + 40
  const done = Object.values(run.nodes).filter((n) => n.status === 'done').length
  const replayed = replayAt === null ? null : statusesAt(run, replayAt)

  return (
    <div className="panel-page pipeline">
      <div className="panel-page-head">
        <h2>{run.recipe.name}</h2>
        <StatusPill signal={runSignal(run.status, Object.values(run.nodes).some((n) => n.status === 'approval'))} />
        <span className="muted">{done}/{run.recipe.nodes.length} steps · {run.worktree.branch} from {run.worktree.base}</span>
        <span className="grow" />
        {(run.status === 'paused' || run.status === 'stopped' || run.status === 'failed') && (
          <button className="btn sm" onClick={() => resume(run.id)}><Play size={13} /> Resume</button>
        )}
        {run.status === 'running' && <button className="btn sm" onClick={() => stop(run.id)}><Pause size={13} /> Stop</button>}
        <button className={`btn sm${history ? ' active' : ''}`} onClick={() => (setHistory(!history), setReplayAt(null))}>
          <History size={13} /> History
        </button>
      </div>
      <p className="pipeline-intent">{run.intent}</p>
      {run.note && replayAt === null && <div className={`pipeline-note ${run.status}`}>{run.note}</div>}
      {history && <RunHistory run={run} at={replayAt} setAt={setReplayAt} />}
      <div className="pipeline-fit" ref={avail.ref}>
      {/* a wide graph shrinks to fit the panel (down to 65%) before it scrolls; zoom keeps clicks where they look */}
      <div className="pipeline-canvas" style={{ width, height, zoom: avail.width ? Math.min(1, Math.max(0.65, avail.width / width)) : 1 }}>
        <svg className="pipeline-edges" width={width} height={height} aria-hidden="true">
          {run.recipe.nodes.flatMap((n) =>
            n.needs.map((from) => {
              const a = at(from)
              const b = at(n.id)
              const x1 = a.x + W
              const y1 = a.y + H / 2
              const x2 = b.x
              const y2 = b.y + H / 2
              const live = run.nodes[from]?.status === 'done'
              return <path key={`${from}-${n.id}`} className={`edge${live ? ' live' : ''}`} d={`M${x1},${y1} C${x1 + GX / 2},${y1} ${x2 - GX / 2},${y2} ${x2},${y2}`} />
            })
          )}
          {run.recipe.nodes.flatMap((n) =>
            (n.onFail?.retry ?? []).map((to) => {
              const a = at(n.id)
              const b = at(to)
              const y = Math.max(a.y, b.y) + H + 14
              return <path key={`retry-${n.id}-${to}`} className="edge retry" d={`M${a.x + W / 2},${a.y + H} C${a.x + W / 2},${y + 10} ${b.x + W / 2},${y + 10} ${b.x + W / 2},${b.y + H}`} />
            })
          )}
        </svg>
        {run.recipe.nodes.map((n) => {
          const p = at(n.id)
          return (
            <div key={n.id} className="pipeline-node-wrap" style={{ left: p.x, top: p.y, width: W, height: H }}>
              {replayed ? (
                <PipelineNode run={run} node={n} nr={{ ...run.nodes[n.id], status: replayed[n.id], note: undefined, candidates: undefined }} readOnly />
              ) : (
                <PipelineNode run={run} node={n} nr={run.nodes[n.id]} />
              )}
            </div>
          )
        })}
      </div>
      </div>
      {run.pr && <PrFeedback run={run} />}
    </div>
  )
}

/** Review comments on the run's PR go back to an agent in the same worktree; pushing the fix is a click. */
function PrFeedback({ run }: { run: FactoryRun }): React.JSX.Element {
  const pr = run.pr!
  const specs = [...new Set(run.recipe.nodes.flatMap((n) => n.agents))]
  const [spec, setSpec] = useState(specs[0] ?? '')
  const [comments, setComments] = useState<GhPrComment[] | null>(null)
  const [busy, setBusy] = useState<'check' | 'push' | null>(null)
  const [error, setError] = useState('')
  const mission = useMission(pr.missionId ?? '')
  const working = mission && isLive(mission.status) && mission.status !== 'waiting'
  const unpushed = pr.addressedAt && (!pr.pushedAt || pr.pushedAt < pr.addressedAt) && !working

  const act = async (kind: 'check' | 'push', f: () => Promise<void>): Promise<void> => {
    setBusy(kind)
    setError('')
    await f().catch((e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').split('\n')[0]))
    setBusy(null)
  }
  const check = (): Promise<void> => act('check', async () => setComments(await prFeedback(run.id)))
  useEffect(() => {
    void check()
  }, [run.id, pr.addressedAt])

  return (
    <section className="pr-feedback">
      <div className="pr-feedback-head">
        <MessageSquare size={13} />
        <b>Review feedback</b>
        <button className="link" onClick={() => void window.api.shell.openExternal(pr.url)}>
          #{pr.number} <ExternalLink size={11} />
        </button>
        <span className="grow" />
        <button className="btn sm" disabled={busy !== null} onClick={() => void check()}>
          <RefreshCw size={12} /> {busy === 'check' ? 'Checking…' : 'Check again'}
        </button>
      </div>
      {error && <div className="pr-feedback-error">{error}</div>}
      {working && (
        <div className="pr-feedback-row">
          An agent is addressing the comments.
          <button className="icon-btn" title="Open its terminal" aria-label="Open its terminal" onClick={() => focusOrResume(mission.id)}><SquareTerminal size={13} /></button>
        </div>
      )}
      {unpushed && (
        <div className="pr-feedback-row">
          Ready to update the pull request with the agent's commits.
          <button className="btn sm primary" title={`Push ${run.worktree.branch}`} disabled={busy !== null} onClick={() => void act('push', () => pushPrUpdate(run.id))}>
            <Upload size={12} /> {busy === 'push' ? 'Pushing…' : 'Push update'}
          </button>
        </div>
      )}
      {pr.pushedAt && !unpushed && !working && <div className="muted small">Update pushed {ago(pr.pushedAt)}.</div>}
      {comments && comments.length === 0 && !working && <div className="muted small">No new review comments.</div>}
      {comments && comments.length > 0 && !working && (
        <>
          <ul className="pr-comments">
            {comments.map((c) => (
              <li key={c.id}>
                <span className="pr-comment-who">
                  {c.author}
                  {c.path && <span className="mono"> {c.path}{c.line ? `:${c.line}` : ''}</span>}
                </span>
                <span className="pr-comment-body">{c.body}</span>
              </li>
            ))}
          </ul>
          <div className="pr-feedback-row">
            <select value={spec} onChange={(e) => setSpec(e.target.value)} aria-label="Agent">
              {specs.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button className="btn sm primary" disabled={!spec} onClick={() => void act('check', () => addressPrFeedback(run.id, spec, comments))}>
              <Bot size={12} /> Address {comments.length} comment{comments.length === 1 ? '' : 's'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

/** The run's timeline: drag to see the graph as it was, click an event to jump there. */
function RunHistory({ run, at, setAt }: { run: FactoryRun; at: number | null; setAt: (t: number | null) => void }): React.JSX.Element {
  const events = run.events ?? []
  if (!events.length) return <div className="run-history muted small">No history yet. Runs started before this version have none.</div>
  const start = events[0].at
  const end = Math.max(events[events.length - 1].at, start + 1)
  const pos = at ?? end
  return (
    <section className="run-history">
      <div className="run-history-scrub">
        <input
          type="range"
          min={start}
          max={end}
          value={pos}
          aria-label="Replay position"
          onChange={(e) => {
            const t = Number(e.target.value)
            setAt(t >= end ? null : t)
          }}
        />
        <span className="mono small">{at === null ? 'live' : `+${duration(at - start)}`}</span>
      </div>
      <ol className="run-events">
        {events.map((e, i) => (
          <li key={i} className={`${e.at <= pos ? 'past' : 'future'}${e.kind === 'node' ? ` ${e.status}` : ''}`}>
            <button className="link" onClick={() => setAt(i === events.length - 1 ? null : e.at)}>
              <span className="mono">+{duration(e.at - start)}</span>
              <span>{describeEvent(e, i === 0)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

function PipelineNode({ run, node, nr, readOnly }: { run: FactoryRun; node: RecipeNode; nr: NodeRun; readOnly?: boolean }): React.JSX.Element {
  /** the note box: rejecting an approval, or sending a failed stage back */
  const [asking, setAsking] = useState<'reject' | 'send' | null>(null)
  const [note, setNote] = useState('')
  const setRejecting = (on: boolean): void => setAsking(on ? 'reject' : null)
  const targets = nr.status === 'failed' ? sendBackTargets(run, node.id) : []
  const cwd = nr.worktree?.path ?? run.worktree.path
  const Icon = node.kind === 'agent' ? Bot : node.kind === 'run' ? SquareTerminal : GitPullRequest
  const who = node.kind === 'agent' ? `${node.agents.join(' vs ')}${node.skill ? ` · ${node.skill}` : ''}` : node.kind === 'run' ? node.run.join(' · ') : `into ${run.worktree.base}`
  const out = `${run.outDir}/${node.id}.md`
  const time = nr.startedAt ? (nr.endedAt ? duration(nr.endedAt - nr.startedAt) : `started ${ago(nr.startedAt)}`) : ''

  return (
    <div className={`pipeline-node ${node.kind} ${nr.status}`} data-node={node.id}>
      <div className="pn-head">
        <Icon size={13} />
        <b>{node.id}</b>
        <span className="pn-status"><StatusPill signal={nodeSignal(nr.status)} /></span>
      </div>
      <div className="pn-who" title={who}>{who}</div>
      <div className="pn-meta">
        {time}
        {nr.attempts > 1 ? ` · try ${nr.attempts}` : ''}
        {nr.worktree ? ' · own worktree' : ''}
      </div>
      {nr.note && <div className="pn-note" title={nr.note}>{nr.note}</div>}
      {nr.status === 'running' && node.kind === 'agent' && !nr.candidates && nr.missionIds[0] && <StageActivity missionId={nr.missionIds[0]} />}
      {nr.candidates && (
        <div className="pn-candidates">
          {nr.candidates.map((c) => (
            <div key={c.missionId} className={`pn-candidate ${c.status}${nr.winner === c.missionId ? ' winner' : ''}`}>
              <span className="pn-cand-name" title={c.spec}>{c.spec}</span>
              <span className="pn-cand-stats">
                {c.status === 'running' ? 'working…' : c.status === 'failed' ? 'failed' : c.stats ? <><span className="add">+{c.stats.insertions}</span> <span className="del">−{c.stats.deletions}</span></> : ''}
              </span>
              {c.status !== 'running' && !nr.winner && (
                <button className="icon-btn" title="Review its diff" aria-label="Review its diff" onClick={() => reviewMission(c.missionId)}><FileText size={12} /></button>
              )}
              {nr.status === 'approval' && c.status === 'done' && (
                <button className="btn sm" onClick={() => void keep(run.id, node.id, c.missionId)}>Keep</button>
              )}
              {nr.winner === c.missionId && <Check size={12} className="ok" />}
            </div>
          ))}
        </div>
      )}
      {readOnly ? null : asking ? (
        <form
          className="pn-reject"
          onSubmit={(e) => {
            e.preventDefault()
            if (asking === 'reject') reject(run.id, node.id, note)
            else sendBack(run.id, node.id, note)
            setAsking(null)
            setNote('')
          }}
        >
          <input autoFocus value={note} placeholder={asking === 'reject' ? 'What should change?' : 'What should it do? (optional)'} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setAsking(null)} />
          <button className="icon-btn" title={asking === 'reject' ? 'Send back' : `Send to ${targets.join(', ')}`}><Check size={13} /></button>
        </form>
      ) : (
        <div className="pn-actions">
          {nr.status === 'approval' && !nr.candidates && (
            <>
              <button className="btn sm primary" onClick={() => void approve(run.id, node.id)}>
                {node.kind === 'pr' ? 'Push and open PR' : 'Approve'}
              </button>
              {node.kind !== 'pr' && (
                <button className="btn sm" onClick={() => setRejecting(true)}>
                  <X size={12} /> Reject
                </button>
              )}
            </>
          )}
          {nr.status === 'approval' && nr.candidates && (
            <button className="btn sm" onClick={() => setRejecting(true)}>
              <X size={12} /> None, run again
            </button>
          )}
          {nr.status === 'running' && node.kind === 'agent' && !nr.candidates && nr.missionIds[0] && (
            <button className="icon-btn" title="Open its terminal" aria-label="Open its terminal" onClick={() => focusOrResume(nr.missionIds[0])}><SquareTerminal size={13} /></button>
          )}
          {nr.status === 'running' && node.kind === 'run' && nr.panelId && (
            <button className="icon-btn" title="Open its terminal" aria-label="Open its terminal" onClick={() => focusPanel(nr.panelId!)}><SquareTerminal size={13} /></button>
          )}
          {nr.status === 'running' && node.interactive && (
            <button className="btn sm" onClick={() => markDone(run.id, node.id)}><Square size={11} /> Done</button>
          )}
          {node.kind === 'agent' && (nr.status === 'done' || nr.status === 'approval') && (
            <button className="icon-btn" title="Open its output" aria-label="Open its output" onClick={() => void openInEditor(out)}><FileText size={13} /></button>
          )}
          {nr.status === 'failed' && node.kind === 'agent' && nr.missionIds[0] && getMission(nr.missionIds[0])?.limited && (
            <button
              className="btn sm"
              title="Run this stage on another agent, starting from where this one stopped"
              onClick={(e) => {
                const current = getMission(nr.missionIds[0])?.options.agent
                showContextMenu(e, allAgents(workspace.get().customAgents).filter((a) => a.id !== current).map((a) => ({ label: a.name, run: () => void continueStage(run.id, node.id, a.id) })))
              }}
            >
              <Bot size={11} /> Continue on…
            </button>
          )}
          {nr.status === 'failed' && run.status !== 'running' && targets.length > 0 && (
            <button className="btn sm" title="Run it again with the failure and your note" onClick={() => setAsking('send')}>
              <Send size={11} /> {targets.length === 1 && targets[0] === node.id ? 'Try again' : `Send to ${targets.join(', ')}`}
            </button>
          )}
          {(nr.status === 'failed' || nr.status === 'done' || nr.status === 'approval') && node.kind === 'agent' && !nr.candidates && nr.missionIds[0] && (
            <button className="icon-btn" title="Talk to it: continues its session in a terminal. What it changes is committed before the next stage." aria-label="Talk to it: continues its session in a terminal. What it changes is committed before the next stage." onClick={() => focusOrResume(nr.missionIds[0])}>
              <MessageSquare size={13} />
            </button>
          )}
          {nr.status === 'failed' && (
            <button className="icon-btn" title={`Open a terminal in the worktree to fix it by hand (${cwd})`} onClick={() => openTerminal({ cwd, title: `${node.id} · fix` })}>
              <Wrench size={13} />
            </button>
          )}
          {(nr.status === 'failed' || nr.status === 'done') && run.status !== 'running' && (
            <button className="icon-btn" title={node.kind === 'run' ? 'Check again' : 'Run this step again'} aria-label={node.kind === 'run' ? 'Check again' : 'Run this step again'} onClick={() => retry(run.id, node.id)}><RotateCcw size={13} /></button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * What a running agent stage is doing right now. Print mode shows nothing in the terminal until the
 * agent exits, so without this a long stage looks stuck. Hook agents report each tool call; for the
 * others the terminal's last line is the best there is.
 */
function StageActivity({ missionId }: { missionId: string }): React.JSX.Element | null {
  const m = useMission(missionId)
  // re-render every few seconds so the time moves; the time itself is read at render
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000)
    return () => clearInterval(t)
  }, [])
  if (!m || !isLive(m.status)) return null
  const hooks = getAgent(m.options.agent).hooks
  const panel = missions.get().panels[missionId]
  const text = hooks ? m.activity : panel ? terminalTail(panel, 20).split('\n').filter((l) => l.trim()).pop()?.trim() : undefined
  const at = m.activityAt
  // a hook agent's time is how long the current step has run; for the others, how long since any output
  const since = at ? duration(Math.max(0, Date.now() - at)) : ''
  const when = since && (hooks ? `for ${since}` : `${since} ago`)
  if (!text && !when) return null
  return (
    <div className="pn-activity" title={text}>
      {text ?? 'working'}
      {when && <span className="pn-activity-when"> · {when}</span>}
    </div>
  )
}

/** The width of an element, kept current with a ResizeObserver. */
function useWidth(): { ref: (el: HTMLDivElement | null) => void; width: number } {
  const [width, setWidth] = useState(0)
  const ro = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect()
    if (!el) return
    ro.current = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.current.observe(el)
  }, [])
  return { ref, width }
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
