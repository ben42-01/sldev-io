import { useEffect, useMemo, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { Bot, Check, ExternalLink, FileText, GitPullRequest, MessageSquare, Pause, Play, RefreshCw, RotateCcw, Square, SquareTerminal, Upload, X } from 'lucide-react'
import { layout, type FactoryRun, type NodeRun, type RecipeNode } from '@shared/factory'
import { focusPanel } from './dockApi'
import { openInEditor } from '../lib/actions'
import type { GhPrComment } from '@shared/types'
import { addressPrFeedback, approve, keep, markDone, prFeedback, pushPrUpdate, reject, resume, retry, stop, useRun } from '../state/factory'
import { focusOrResume, isLive, reviewMission, useMission } from '../state/missions'
import { ago } from '../components/MissionCard'

const W = 196
const BASE_H = 112
/** each bake-off version gets a row */
const ROW_H = 26
const GX = 44
const GY = 22

const nodeLabel: Record<NodeRun['status'], string> = { pending: 'Waiting', running: 'Running', approval: 'Needs you', done: 'Done', failed: 'Failed' }

/** A factory run as a graph: columns follow `needs`, parallel branches stack, retry loops are dashed. */
export function PipelinePanel({ params }: IDockviewPanelProps<{ runId: string }>): React.JSX.Element {
  const run = useRun(params.runId)
  const pos = useMemo(() => (run ? layout(run.recipe) : new Map<string, { col: number; row: number }>()), [run])
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

  return (
    <div className="panel-page pipeline">
      <div className="panel-page-head">
        <h2>{run.recipe.name}</h2>
        <span className={`run-pill ${run.status}`}>{run.status}</span>
        <span className="muted">{done}/{run.recipe.nodes.length} steps · {run.worktree.branch} from {run.worktree.base}</span>
        <span className="grow" />
        {(run.status === 'paused' || run.status === 'stopped' || run.status === 'failed') && (
          <button className="btn sm" onClick={() => resume(run.id)}><Play size={13} /> Resume</button>
        )}
        {run.status === 'running' && <button className="btn sm" onClick={() => stop(run.id)}><Pause size={13} /> Stop</button>}
      </div>
      <p className="pipeline-intent">{run.intent}</p>
      {run.note && <div className={`pipeline-note ${run.status}`}>{run.note}</div>}
      <div className="pipeline-canvas" style={{ width, height }}>
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
              <PipelineNode run={run} node={n} nr={run.nodes[n.id]} />
            </div>
          )
        })}
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
          <button className="icon-btn" title="Open its terminal" onClick={() => focusOrResume(mission.id)}><SquareTerminal size={13} /></button>
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

function PipelineNode({ run, node, nr }: { run: FactoryRun; node: RecipeNode; nr: NodeRun }): React.JSX.Element {
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const Icon = node.kind === 'agent' ? Bot : node.kind === 'run' ? SquareTerminal : GitPullRequest
  const who = node.kind === 'agent' ? node.agents.join(' vs ') : node.kind === 'run' ? node.run.join(' · ') : `into ${run.worktree.base}`
  const out = `${run.outDir}/${node.id}.md`
  const time = nr.startedAt ? (nr.endedAt ? duration(nr.endedAt - nr.startedAt) : `started ${ago(nr.startedAt)}`) : ''

  return (
    <div className={`pipeline-node ${node.kind} ${nr.status}`} data-node={node.id}>
      <div className="pn-head">
        <Icon size={13} />
        <b>{node.id}</b>
        <span className={`pn-status ${nr.status}`}>{nodeLabel[nr.status]}</span>
      </div>
      <div className="pn-who" title={who}>{who}</div>
      <div className="pn-meta">
        {time}
        {nr.attempts > 1 ? ` · try ${nr.attempts}` : ''}
        {nr.worktree ? ' · own worktree' : ''}
      </div>
      {nr.note && <div className="pn-note" title={nr.note}>{nr.note}</div>}
      {nr.candidates && (
        <div className="pn-candidates">
          {nr.candidates.map((c) => (
            <div key={c.missionId} className={`pn-candidate ${c.status}${nr.winner === c.missionId ? ' winner' : ''}`}>
              <span className="pn-cand-name" title={c.spec}>{c.spec}</span>
              <span className="pn-cand-stats">
                {c.status === 'running' ? 'working…' : c.status === 'failed' ? 'failed' : c.stats ? <><span className="add">+{c.stats.insertions}</span> <span className="del">−{c.stats.deletions}</span></> : ''}
              </span>
              {c.status !== 'running' && !nr.winner && (
                <button className="icon-btn" title="Review its diff" onClick={() => reviewMission(c.missionId)}><FileText size={12} /></button>
              )}
              {nr.status === 'approval' && c.status === 'done' && (
                <button className="btn sm" onClick={() => void keep(run.id, node.id, c.missionId)}>Keep</button>
              )}
              {nr.winner === c.missionId && <Check size={12} className="ok" />}
            </div>
          ))}
        </div>
      )}
      {rejecting ? (
        <form className="pn-reject" onSubmit={(e) => (e.preventDefault(), reject(run.id, node.id, note), setRejecting(false))}>
          <input autoFocus value={note} placeholder="What should change?" onChange={(e) => setNote(e.target.value)} />
          <button className="icon-btn" title="Send back"><Check size={13} /></button>
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
            <button className="icon-btn" title="Open its terminal" onClick={() => focusOrResume(nr.missionIds[0])}><SquareTerminal size={13} /></button>
          )}
          {nr.status === 'running' && node.kind === 'run' && nr.panelId && (
            <button className="icon-btn" title="Open its terminal" onClick={() => focusPanel(nr.panelId!)}><SquareTerminal size={13} /></button>
          )}
          {nr.status === 'running' && node.interactive && (
            <button className="btn sm" onClick={() => markDone(run.id, node.id)}><Square size={11} /> Done</button>
          )}
          {node.kind === 'agent' && (nr.status === 'done' || nr.status === 'approval') && (
            <button className="icon-btn" title="Open its output" onClick={() => void openInEditor(out)}><FileText size={13} /></button>
          )}
          {(nr.status === 'failed' || nr.status === 'done') && run.status !== 'running' && (
            <button className="icon-btn" title="Run this step again" onClick={() => retry(run.id, node.id)}><RotateCcw size={13} /></button>
          )}
        </div>
      )}
    </div>
  )
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
