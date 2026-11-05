import { Bot, Check, FileText, FlaskConical, GitPullRequest, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { BRAND, C, MONO, beats, pop, progress } from '../lib'
import { Button, Headline, Pointer, Window } from '../ui'

type NodeState = 'pending' | 'running' | 'approval' | 'done' | 'failed' | 'shipped'
const TONE: Record<NodeState, string> = { pending: C.subtle, running: C.blue, approval: C.amber, done: C.green, failed: C.red, shipped: C.purple }
const LABEL: Record<NodeState, string> = { pending: 'Waiting', running: 'Running', approval: 'Needs your OK', done: 'Done', failed: 'Failed', shipped: 'PR open' }

interface Node {
  id: string
  title: string
  who: string
  icon: ReactNode
  x: number
  y: number
  timeline: Array<[number, NodeState, string?]>
}

const W = 270
const H = 128
const NODES: Node[] = [
  { id: 'spec', title: 'Write the spec', who: 'Codex', icon: <FileText size={16} />, x: 70, y: 300, timeline: [[beats(2), 'running'], [beats(6), 'approval'], [beats(9), 'done']] },
  { id: 'backend', title: 'Build the API', who: 'Claude Code', icon: <Bot size={16} />, x: 430, y: 150, timeline: [[beats(9), 'running'], [beats(15), 'done']] },
  { id: 'frontend', title: 'Build the UI', who: 'Codex', icon: <Bot size={16} />, x: 430, y: 460, timeline: [[beats(9), 'running'], [beats(16), 'done'], [beats(19), 'running', 'attempt 2 · fixing the test'], [beats(22), 'done', 'attempt 2']] },
  { id: 'tests', title: 'Run the tests', who: 'npm test', icon: <FlaskConical size={16} />, x: 790, y: 300, timeline: [[beats(16), 'running'], [beats(18), 'failed', '1 failed: refund button'], [beats(22), 'running', 'attempt 2'], [beats(24), 'done', '26 passed']] },
  { id: 'pr', title: 'Pull request', who: 'you decide', icon: <GitPullRequest size={16} />, x: 1150, y: 300, timeline: [[beats(24), 'approval'], [beats(28), 'shipped', '#129 · checks passing']] }
]
const EDGES: Array<[string, string]> = [
  ['spec', 'backend'],
  ['spec', 'frontend'],
  ['backend', 'tests'],
  ['frontend', 'tests'],
  ['tests', 'pr']
]
const byId = Object.fromEntries(NODES.map((n) => [n.id, n]))

function stateOf(n: Node, frame: number): [NodeState, string | undefined] {
  let s: [NodeState, string | undefined] = ['pending', undefined]
  for (const t of n.timeline) if (frame >= t[0]) s = [t[1], t[2]]
  return s
}

/** Software Factory: a recipe runs as a graph of agents, loops back on a failing test, and waits for your click. */
export function FactoryScene() {
  const frame = useCurrentFrame()
  const win = pop(frame, 0, 18)
  const done = NODES.filter((n) => ['done', 'shipped'].includes(stateOf(n, frame)[0])).length
  const retry = progress(frame, beats(18), 14)
  return (
    <AbsoluteFill style={{ alignItems: 'center' }}>
      <Headline at={0} out={beats(8)}>
        {'Software Factory: an idea in, *a PR out.*'}
      </Headline>
      <Headline at={beats(9)} out={beats(17)}>Agents build in parallel.</Headline>
      <Headline at={beats(18)} out={beats(24)}>Tests fail? It loops back and fixes.</Headline>
      <Headline at={beats(25)}>Nothing ships without *your click.*</Headline>
      <div style={{ position: 'absolute', top: 180, opacity: win, transform: `translateY(${(1 - win) * 60}px)` }}>
        <Window width={1560} height={880} active={3}>
          <div style={{ position: 'absolute', left: 24, right: 24, top: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, color: C.muted, letterSpacing: '0.08em', fontWeight: 700 }}>RECIPE · SHIP A FEATURE</div>
              <div style={{ fontSize: 23, fontWeight: 700 }}>&ldquo;Let customers refund an order&rdquo;</div>
            </div>
            <div style={{ marginLeft: 'auto', width: 360 }}>
              <div style={{ fontSize: 13, color: C.muted, textAlign: 'right', marginBottom: 6 }}>{done} of 5 steps</div>
              <div style={{ height: 4, background: C.border }}>
                <div style={{ height: '100%', width: `${(done / 5) * 100}%`, background: BRAND }} />
              </div>
            </div>
          </div>
          <svg width={1504} height={784} style={{ position: 'absolute', inset: 0 }}>
            {EDGES.map(([a, b], i) => {
              const A = byId[a]
              const B = byId[b]
              const x1 = A.x + W
              const y1 = A.y + H / 2
              const x2 = B.x
              const y2 = B.y + H / 2
              const d = `M${x1},${y1} C${x1 + 70},${y1} ${x2 - 70},${y2} ${x2},${y2}`
              const draw = progress(frame, 6 + i * 4, 16)
              const live = stateOf(B, frame)[0] !== 'pending'
              return <path key={i} d={d} fill="none" stroke={live ? '#4a4a4a' : C.borderStrong} strokeWidth={2} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
            })}
            {frame >= beats(18) && (
              <path
                d={`M${byId.tests.x + W / 2},${byId.tests.y + H} C${byId.tests.x + W / 2},${byId.tests.y + H + 170} ${byId.frontend.x + W + 120},${byId.frontend.y + H / 2} ${byId.frontend.x + W},${byId.frontend.y + H / 2}`}
                fill="none"
                stroke={frame < beats(22) ? C.red : '#5a3a3f'}
                strokeWidth={2.5}
                strokeDasharray="8 7"
                strokeDashoffset={-frame * 0.8}
                opacity={retry}
              />
            )}
          </svg>
          {frame >= beats(18) && (
            <div style={{ position: 'absolute', left: byId.tests.x + W / 2 - 40, top: byId.tests.y + H + 108, display: 'flex', gap: 6, alignItems: 'center', fontSize: 14, color: C.red, opacity: retry, fontFamily: MONO }}>
              <RotateCcw size={14} /> retry build-ui
            </div>
          )}
          {NODES.map((n, i) => {
            const [s, note] = stateOf(n, frame)
            const appear = pop(frame, 4 + i * 3)
            const flash = n.timeline.map((t) => frame - t[0]).filter((d) => d >= 0 && d < 10).length ? 1 : 0
            return (
              <div key={n.id} style={{ position: 'absolute', left: n.x, top: n.y, width: W, height: H, padding: '14px 16px', background: C.elev, border: `1px solid ${s === 'pending' ? C.border : `${TONE[s]}aa`}`, boxShadow: s === 'pending' ? 'none' : `0 0 ${20 + flash * 30}px ${TONE[s]}${flash ? '55' : '22'}`, opacity: appear, transform: `scale(${0.9 + 0.1 * appear})` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 14 }}>
                  {n.icon} {n.who}
                  <span style={{ marginLeft: 'auto', color: TONE[s], fontWeight: 700, fontSize: 13, display: 'flex', gap: 5, alignItems: 'center' }}>
                    {s === 'done' && <Check size={14} />}
                    {LABEL[s]}
                  </span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>{n.title}</div>
                {s === 'running' && (
                  <div style={{ height: 3, marginTop: 12, background: C.border, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: '40%', background: C.blue, transform: `translateX(${((frame * 6) % 400) - 120}%)` }} />
                  </div>
                )}
                {s === 'approval' && (
                  <div style={{ marginTop: 10 }}>
                    <Button primary style={{ padding: '5px 12px', fontSize: 13 }}>
                      {n.id === 'pr' ? 'Push and open PR' : 'Approve'}
                    </Button>
                  </div>
                )}
                {note && s !== 'running' && s !== 'approval' && <div style={{ fontSize: 13, color: C.muted, marginTop: 10, fontFamily: MONO }}>{note}</div>}
                {note && s === 'running' && <div style={{ fontSize: 13, color: C.muted, marginTop: 8, fontFamily: MONO }}>{note}</div>}
              </div>
            )
          })}
          <Pointer
            path={[
              [0, 700, 720],
              [beats(6), 700, 720],
              [beats(8), byId.spec.x + 60, byId.spec.y + 100],
              [beats(24), byId.spec.x + 60, byId.spec.y + 100],
              [beats(27), byId.pr.x + 90, byId.pr.y + 100]
            ]}
            click={[beats(8.5), beats(27.5)]}
          />
        </Window>
      </div>
    </AbsoluteFill>
  )
}
