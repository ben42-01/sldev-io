import { useMemo, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { Bot, Check, FileText, GitPullRequest, Pause, Play, RotateCcw, Square, SquareTerminal, X } from 'lucide-react'
import { layout, type FactoryRun, type NodeRun, type RecipeNode } from '@shared/factory'
import { focusPanel } from './dockApi'
import { openInEditor } from '../lib/actions'
import { approve, markDone, reject, resume, retry, stop, useRun } from '../state/factory'
import { focusOrResume } from '../state/missions'
import { ago } from '../components/MissionCard'

const W = 196
const H = 112
const GX = 44
const GY = 22

const nodeLabel: Record<NodeRun['status'], string> = { pending: 'Waiting', running: 'Running', approval: 'Needs you', done: 'Done', failed: 'Failed' }

/** A factory run as a graph: columns follow `needs`, parallel branches stack, retry loops are dashed. */
export function PipelinePanel({ params }: IDockviewPanelProps<{ runId: string }>): React.JSX.Element {
  const run = useRun(params.runId)
  const pos = useMemo(() => (run ? layout(run.recipe) : new Map<string, { col: number; row: number }>()), [run])
  if (!run) return <div className="panel-page muted">This run was removed.</div>

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
    </div>
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
      {rejecting ? (
        <form className="pn-reject" onSubmit={(e) => (e.preventDefault(), reject(run.id, node.id, note), setRejecting(false))}>
          <input autoFocus value={note} placeholder="What should change?" onChange={(e) => setNote(e.target.value)} />
          <button className="icon-btn" title="Send back"><Check size={13} /></button>
        </form>
      ) : (
        <div className="pn-actions">
          {nr.status === 'approval' && (
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
          {nr.status === 'running' && node.kind === 'agent' && nr.missionIds[0] && (
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
