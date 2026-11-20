import { Check, GitBranch, Network, RotateCcw, Trophy } from 'lucide-react'
import type { CSSProperties } from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, C, MONO, beats, pop, progress, typed } from '../lib'
import { Button, Camera, Headline, Pointer, Scrim, Spotlight, Window, focus } from '../ui'

/** the scene was timed for a longer cut; every beat is scaled to fit its bars */
const bt = (n: number): number => beats(n * 0.97)

/**
 * A Lead mission: one agent plans a goal, delegates the parts to three agents from different vendors
 * (routed by the project's evals), reviews a diff and sends it back, then merges everything with the
 * tests as the check. The app's Lead card in Mission Control, drawn as a graph.
 */

type WState = 'pending' | 'working' | 'done' | 'back'
const TONE: Record<WState, string> = { pending: C.subtle, working: C.blue, done: C.green, back: C.amber }
const LABEL: Record<WState, string> = { pending: 'Starting', working: 'Working', done: 'Done', back: 'Sent back' }

interface Worker {
  agent: string
  task: string
  y: number
  why?: string
  timeline: Array<[number, WState, string]>
}

const WORKERS: Worker[] = [
  { agent: 'Codex', task: 'Invites API', y: 70, why: 'best on your evals · 9/10', timeline: [[bt(5), 'working', 'src/api/invites.ts'], [bt(11), 'done', '+182 −12 · 4 files'], [bt(13), 'back', 'add a rate limit to /invite'], [bt(14), 'working', 'attempt 2 · rate limit'], [bt(17), 'done', '+201 −12 · 5 files']] },
  { agent: 'Claude Code', task: 'Invite email UI', y: 290, timeline: [[bt(5.5), 'working', 'src/ui/InviteDialog.tsx'], [bt(14), 'done', '+96 −4 · 3 files']] },
  { agent: 'Gemini CLI', task: 'Tests for invites', y: 510, timeline: [[bt(6), 'working', 'test/invites.test.ts'], [bt(15), 'done', '+140 · 2 files']] }
]

const LEAD = { x: 70, y: 210, w: 470, h: 360 }
const WX = 900
const WW = 520
const WH = 168

function stateOf(w: Worker, frame: number): [WState, string] {
  let s: [WState, string] = ['pending', '']
  for (const t of w.timeline) if (frame >= t[0]) s = [t[1], t[2]]
  return s
}

const LINES: Array<[number, string, string?]> = [
  [bt(1.5), 'Plan: 3 tasks, independent'],
  [bt(4), '→ delegated to 3 agents'],
  [bt(13), 'Review: /invite has no rate limit', C.amber],
  [bt(18), 'Merged 3 branches'],
  [bt(19), 'npm test  ✓ 112 passed', C.green]
]

export function LeadScene() {
  const frame = useCurrentFrame()
  const win = pop(frame, 0, 18)
  const merged = progress(frame, bt(18), 14)
  const ready = pop(frame, bt(20))
  return (
    <AbsoluteFill>
      <Camera
        keys={[
          [0, { y: 90, z: 0.84, rx: 18, ry: 12 }],
          [bt(2), { z: 1.02 }],
          [bt(4), focus(180 + 56 + 300, 160 + 46 + 400, 1.22, { ry: 6 })],
          [bt(8), focus(180 + 56 + 900, 160 + 46 + 380, 1.12, { ry: -6 })],
          [bt(12.5), focus(180 + 56 + 1150, 160 + 46 + 180, 1.32, { ry: -6 })],
          [bt(16.5), focus(180 + 56 + 1150, 160 + 46 + 200, 1.3, { ry: -6 })],
          [bt(19), focus(180 + 56 + 420, 160 + 46 + 420, 1.24, { ry: 5 })],
          [bt(24), focus(180 + 56 + 440, 160 + 46 + 420, 1.24, { ry: 5 })]
        ]}
      >
      <div style={{ position: 'absolute', left: 180, top: 160, opacity: win }}>
        <Window width={1560} height={880} active={0} title="Lead · Team invites">
          <svg width={1504} height={834} style={{ position: 'absolute', inset: 0 }}>
            {WORKERS.map((w, i) => {
              const x1 = LEAD.x + LEAD.w
              const y1 = LEAD.y + LEAD.h / 2
              const x2 = WX
              const y2 = w.y + WH / 2
              const d = `M${x1},${y1} C${x1 + 180},${y1} ${x2 - 180},${y2} ${x2},${y2}`
              const draw = progress(frame, bt(4) + i * 4, 14)
              const [s] = stateOf(w, frame)
              const stroke = merged > 0 ? C.green : s === 'back' ? C.amber : s === 'pending' ? C.borderStrong : '#4a4a4a'
              // a packet runs out on delegate, back when the worker reports, and home again on the merge
              const outbound = progress(frame, bt(4) + i * 4, 18)
              const home = w.timeline.filter((t) => t[1] === 'done').map((t) => t[0])
              const backs = [...home, bt(18)].map((t) => progress(frame, t, 16)).find((p) => p > 0 && p < 1)
              return (
                <g key={w.agent}>
                  <path d={d} fill="none" stroke={stroke} strokeWidth={merged > 0 ? 2.5 : 2} pathLength={1} strokeDasharray={s === 'back' ? '0.012 0.01' : 1} strokeDashoffset={s === 'back' ? -frame * 0.004 : 1 - draw} opacity={0.4 + 0.6 * draw} />
                  {outbound > 0 && outbound < 1 && <circle r={6} fill={C.purple} style={{ offsetPath: `path('${d}')`, offsetDistance: `${outbound * 100}%`, filter: `drop-shadow(0 0 8px ${C.purple})` } as CSSProperties} />}
                  {backs !== undefined && <circle r={6} fill={C.green} style={{ offsetPath: `path('${d}')`, offsetDistance: `${(1 - backs) * 100}%`, filter: `drop-shadow(0 0 8px ${C.green})` } as CSSProperties} />}
                </g>
              )
            })}
          </svg>

          {/* the Lead */}
          <div style={{ position: 'absolute', left: LEAD.x, top: LEAD.y, width: LEAD.w, height: LEAD.h, padding: '18px 20px', background: C.elev, border: `1px solid ${C.purple}aa`, boxShadow: `0 0 ${30 + merged * 40}px ${merged ? C.green : C.purple}33`, opacity: pop(frame, 2), display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.purple, fontSize: 14, fontWeight: 700, letterSpacing: '0.06em' }}>
              <Network size={16} /> LEAD · CLAUDE CODE
            </div>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{typed('Team invites', frame, 4, 24) || ' '}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.muted, fontSize: 14, fontFamily: MONO }}>
              <GitBranch size={14} /> feature/team-invites
            </div>
            <div style={{ height: 1, background: C.border, margin: '4px 0' }} />
            {LINES.filter(([at]) => frame >= at).map(([at, text, color]) => (
              <div key={text} style={{ fontFamily: MONO, fontSize: 15, color: color ?? C.fg, opacity: progress(frame, at, 8) }}>
                {text.startsWith('Review') && <RotateCcw size={13} style={{ marginRight: 6, verticalAlign: -1 }} />}
                {typed(text, frame, at, 46)}
              </div>
            ))}
            {frame >= bt(20) && (
              <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 12, opacity: ready, transform: `scale(${0.92 + 0.08 * ready})`, transformOrigin: 'left' }}>
                <Button primary glow={interpolate(frame, [bt(21.5), bt(22), bt(23)], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}>Review the branch</Button>
                <span style={{ color: C.muted, fontSize: 14 }}>nothing pushed</span>
              </div>
            )}
          </div>

          {/* the workers */}
          {WORKERS.map((w, i) => {
            const [s, line] = stateOf(w, frame)
            const appear = pop(frame, bt(4) + i * 4 + 6)
            const flash = w.timeline.some((t) => frame - t[0] >= 0 && frame - t[0] < 10)
            const tone = merged > 0 ? C.green : TONE[s]
            return (
              <div key={w.agent} style={{ position: 'absolute', left: WX, top: w.y, width: WW, height: WH, padding: '16px 18px', background: C.elev, border: `1px solid ${s === 'pending' ? C.border : `${tone}aa`}`, boxShadow: s === 'pending' ? 'none' : `0 0 ${18 + (flash ? 30 : 0)}px ${tone}${flash ? '55' : '22'}`, opacity: appear, transform: `translateX(${(1 - appear) * 40}px)` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, color: C.muted }}>
                  <span style={{ color: C.fg, fontWeight: 700 }}>{w.agent}</span>
                  {w.why && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', border: `1px solid ${C.borderStrong}`, fontSize: 12.5 }}>
                      <Trophy size={12} /> {w.why}
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', color: tone, fontWeight: 700, fontSize: 13, display: 'flex', gap: 5, alignItems: 'center' }}>
                    {(s === 'done' || merged > 0) && <Check size={14} />}
                    {merged > 0 ? 'Merged' : LABEL[s]}
                  </span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 10 }}>{w.task}</div>
                <div style={{ fontSize: 14, color: s === 'back' ? C.amber : C.muted, marginTop: 8, fontFamily: MONO }}>{line || 'worktree ready'}</div>
                {s === 'working' && merged === 0 && (
                  <div style={{ height: 3, marginTop: 12, background: C.border, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: '40%', background: C.blue, transform: `translateX(${((frame * 6 + i * 90) % 400) - 120}%)` }} />
                  </div>
                )}
              </div>
            )
          })}

          {/* the team's progress, like the card's footer */}
          <div style={{ position: 'absolute', left: LEAD.x, right: 70, bottom: 36, display: 'flex', alignItems: 'center', gap: 16, fontSize: 14, color: C.muted, opacity: progress(frame, bt(5), 10) }}>
            <span>{WORKERS.filter((w) => stateOf(w, frame)[0] === 'done').length} of 3 workers done · 3 vendors · 3 worktrees</span>
            <div style={{ flex: 1, height: 4, background: C.border }}>
              <div style={{ height: '100%', width: `${merged ? 100 : (WORKERS.filter((w) => stateOf(w, frame)[0] === 'done').length / 3) * 90}%`, background: BRAND }} />
            </div>
          </div>
          <Spotlight x={WX} y={WORKERS[0].y} w={WW} h={WH} at={bt(13.2)} out={bt(17)} tone={C.amber} label="Reviewed by the Lead and sent back" side="bottom" />
          <Pointer
            path={[
              [0, 1300, 760],
              [bt(19), 1300, 760],
              [bt(21.5), LEAD.x + 110, LEAD.y + LEAD.h - 36]
            ]}
            click={[bt(22)]}
          />
        </Window>
      </div>
      </Camera>
      <Scrim />
      <Headline at={0} out={bt(12)}>{'One agent leads. *The others build.*'}</Headline>
      <Headline at={bt(13)} out={bt(17.5)}>It reviews, and sends work back.</Headline>
      <Headline at={bt(18)}>{'One branch, tested, *for you.*'}</Headline>
    </AbsoluteFill>
  )
}
