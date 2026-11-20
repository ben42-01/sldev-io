import { Bell, GitBranch } from 'lucide-react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { C, MONO, beats, pop } from '../lib'
import { Button, Camera, Headline, Pill, Pointer, Scrim, Spotlight, Toast, TONE, Window, focus, type State } from '../ui'

/** the scene's beats, stretched to the bars it has in src/timeline.json */
const bt = (n: number): number => beats(n * 1.18)

interface Card {
  agent: string
  title: string
  branch: string
  /** [frame, state, last line, diff] from that frame on */
  timeline: Array<[number, State, string, string]>
}

const CARDS: Card[] = [
  {
    agent: 'Claude Code',
    title: 'Migrate auth to sessions',
    branch: 'sldev/auth-sessions',
    timeline: [
      [bt(0.5), 'working', 'Editing src/auth/routes.ts', '+64 −21 · 4 files'],
      [bt(13.5), 'ready', 'Done. Sessions replace JWTs; 41 tests pass.', '+118 −44 · 9 files']
    ]
  },
  {
    agent: 'Codex',
    title: 'Fix flaky checkout test',
    branch: 'sldev/flaky-checkout',
    timeline: [
      [bt(1), 'working', 'Planning: stabilise the clock in tests', '+3 −1 · 1 file'],
      [bt(7.5), 'needs', 'Allow command: npm test?', '+12 −4 · 2 files'],
      [bt(10.2), 'working', 'Running npm test', '+12 −4 · 2 files'],
      [bt(15), 'ready', 'Done. Fake timers fix the race.', '+12 −4 · 2 files']
    ]
  },
  {
    agent: 'Gemini CLI',
    title: 'Add rate limiting',
    branch: 'sldev/rate-limit',
    timeline: [[bt(1.5), 'working', 'Writing src/api/rateLimit.ts', '+41 −0 · 2 files']]
  },
  {
    agent: 'Cursor Agent',
    title: 'Dark mode toggle',
    branch: 'sldev/dark-mode',
    timeline: [
      [bt(2), 'working', 'Editing src/components/Toggle.tsx', '+20 −2 · 2 files'],
      [bt(11.5), 'ready', 'Done. Toggle saves to localStorage.', '+33 −5 · 3 files']
    ]
  }
]

const COLUMNS: Array<{ id: string; label: string; states: State[] }> = [
  { id: 'needs', label: 'Needs you', states: ['needs'] },
  { id: 'working', label: 'Working', states: ['working'] },
  { id: 'ready', label: 'Ready', states: ['ready'] }
]
const COL_W = 470
const COL_GAP = 22
const CARD_H = 148
const BOARD_X = 24
const BOARD_Y = 118
/** the window's content origin on the stage */
const OX = 180 + 56
const OY = 160 + 46

function stateAt(card: Card, frame: number) {
  let s: Card['timeline'][number] | null = null
  for (const t of card.timeline) if (frame >= t[0]) s = t
  return s
}

/** where each visible card sits (column, row) at a frame */
function layoutAt(frame: number): Array<[number, number] | null> {
  const rows = [0, 0, 0]
  return CARDS.map((c) => {
    const s = stateAt(c, frame)
    if (!s) return null
    const col = COLUMNS.findIndex((k) => k.states.includes(s[1]))
    return [col, rows[col]++]
  })
}
const CHANGES = [...new Set(CARDS.flatMap((c) => c.timeline.map((t) => t[0])))].sort((a, b) => a - b)
const xy = ([col, row]: [number, number]): [number, number] => [BOARD_X + col * (COL_W + COL_GAP), BOARD_Y + 46 + row * (CARD_H + 12)]

/** Mission Control: four agents, each card walks the columns as its status changes. */
export function Missions() {
  const frame = useCurrentFrame()
  const last = [...CHANGES].reverse().find((c) => c <= frame) ?? 0
  const from = layoutAt(last - 1)
  const to = layoutAt(frame)
  const move = pop(frame, last, 16)
  const needs = to.filter((p) => p && p[0] === 0).length
  const win = pop(frame, 0, 18)
  return (
    <AbsoluteFill>
      <Camera
        keys={[
          [0, { y: 100, z: 0.84, rx: 16, ry: -10 }],
          [bt(1.5), { z: 1 }],
          [bt(3.6), { z: 1 }],
          [bt(5), focus(OX + 760, OY + 420, 1.18, { ry: 4 })],
          [bt(6.8), focus(OX + 760, OY + 420, 1.18, { ry: 4 })],
          [bt(8.2), focus(OX + 300, OY + 330, 1.34, { ry: 6 })],
          [bt(11.6), focus(OX + 330, OY + 330, 1.34, { ry: 6 })],
          [bt(13.4), focus(OX + 1100, OY + 400, 1.16, { ry: -6 })],
          [bt(18.5), focus(OX + 1060, OY + 400, 1.12, { ry: -4 })]
        ]}
      >
      <div style={{ position: 'absolute', left: 180, top: 160, opacity: win }}>
        <Window width={1560} height={880} active={0}>
          <div style={{ position: 'absolute', left: BOARD_X, top: 24, right: 24, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>Mission Control</div>
              <div style={{ fontSize: 15, color: C.muted }}>
                acme-shop · 4 live missions{needs ? <span style={{ color: C.amber }}> · {needs} needs you</span> : null}
              </div>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <Button primary>New mission</Button>
            </div>
          </div>
          {COLUMNS.map((col, i) => (
            <div key={col.id} style={{ position: 'absolute', left: BOARD_X + i * (COL_W + COL_GAP), top: BOARD_Y, width: COL_W, bottom: 24, border: `1px solid ${C.border}`, background: '#0b0b0b' }}>
              <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: C.muted, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: TONE[col.states[0]] }} />
                {col.label.toUpperCase()}
                <span style={{ marginLeft: 'auto', color: C.subtle }}>{to.filter((p) => p && p[0] === i).length}</span>
              </div>
            </div>
          ))}
          {CARDS.map((c, i) => {
            const target = to[i]
            if (!target) return null
            const s = stateAt(c, frame)!
            const start = from[i] ?? [target[0], target[1] + 1]
            const [x0, y0] = xy(start as [number, number])
            const [x1, y1] = xy(target)
            const appear = pop(frame, c.timeline[0][0])
            const x = interpolate(move, [0, 1], [x0, x1])
            const y = interpolate(move, [0, 1], [y0, y1])
            const glowBranch = frame >= bt(4.4) && frame < bt(7.4)
            return (
              <div key={c.title} style={{ position: 'absolute', left: x + 12, top: y, width: COL_W - 24, height: CARD_H, padding: '14px 16px', background: C.elev, border: `1px solid ${C.borderStrong}`, borderLeft: `3px solid ${TONE[s[1]]}`, opacity: appear, transform: `scale(${0.9 + 0.1 * appear})`, boxShadow: s[1] === 'needs' ? `0 0 40px ${C.amber}33` : 'none' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Pill state={s[1]} />
                  <span style={{ fontSize: 13, color: C.muted, border: `1px solid ${C.border}`, padding: '2px 8px' }}>{c.agent}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: C.subtle }}>just now</span>
                </div>
                <div style={{ fontSize: 19, fontWeight: 600, marginTop: 10 }}>{c.title}</div>
                <div style={{ fontSize: 14, color: s[1] === 'needs' ? C.amber : C.muted, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s[2]}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontFamily: MONO, fontSize: 13, color: glowBranch ? C.green : C.subtle, textShadow: glowBranch ? `0 0 12px ${C.green}88` : 'none' }}>
                  <GitBranch size={13} strokeWidth={1.5} /> {c.branch}
                  <span style={{ marginLeft: 'auto', color: C.subtle }}>
                    <span style={{ color: C.green }}>{s[3].split(' ')[0]}</span> <span style={{ color: C.red }}>{s[3].split(' ')[1]}</span> {s[3].split('·')[1]}
                  </span>
                </div>
                {s[1] === 'needs' && (
                  <div style={{ position: 'absolute', right: 14, top: 50, display: 'flex', gap: 8 }}>
                    <Button primary glow={frame > bt(9) && frame < bt(10.2) ? 1 : 0} style={{ padding: '5px 12px', fontSize: 13 }}>
                      Allow
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
          <Spotlight x={BOARD_X + 12} y={BOARD_Y + 46} w={COL_W - 24} h={CARD_H} at={bt(7.8)} out={bt(10.6)} tone={C.amber} label="Codex is asking. One click, it carries on." side="bottom" />
          <Toast at={bt(7.5)} out={bt(10.4)} tone={C.amber} icon={<Bell size={20} />} title="Codex needs you" text="Allow command: npm test?" />
          <Pointer
            path={[
              [0, 1300, 700],
              [bt(7.8), 1300, 700],
              [bt(9.4), 432, 222]
            ]}
            click={[bt(9.9)]}
          />
        </Window>
      </div>
      </Camera>
      <Scrim />
      <Headline at={0} out={bt(7.2)}>{'Every agent, each in its own *git worktree.*'}</Headline>
      <Headline at={bt(7.5)} out={bt(12.8)}>{'It pings you when one *needs you.*'}</Headline>
      <Headline at={bt(13.2)}>{'And tells you when it\'s *done.*'}</Headline>
    </AbsoluteFill>
  )
}
