import { Bell, GitBranch } from 'lucide-react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { C, MONO, beats, pop } from '../lib'
import { Button, Headline, Pill, Pointer, Toast, TONE, Window, type State } from '../ui'

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
      [beats(1), 'working', 'Editing src/auth/routes.ts', '+64 −21 · 4 files'],
      [beats(22), 'ready', 'Done. Sessions replace JWTs; 41 tests pass.', '+118 −44 · 9 files']
    ]
  },
  {
    agent: 'Codex',
    title: 'Fix flaky checkout test',
    branch: 'sldev/flaky-checkout',
    timeline: [
      [beats(2), 'working', 'Planning: stabilise the clock in tests', '+3 −1 · 1 file'],
      [beats(14), 'needs', 'Allow command: npm test?', '+12 −4 · 2 files'],
      [beats(20), 'working', 'Running npm test', '+12 −4 · 2 files'],
      [beats(27), 'ready', 'Done. Fake timers fix the race.', '+12 −4 · 2 files']
    ]
  },
  {
    agent: 'Gemini CLI',
    title: 'Add rate limiting',
    branch: 'sldev/rate-limit',
    timeline: [[beats(3), 'working', 'Writing src/api/rateLimit.ts', '+41 −0 · 2 files']]
  },
  {
    agent: 'Cursor Agent',
    title: 'Dark mode toggle',
    branch: 'sldev/dark-mode',
    timeline: [
      [beats(4), 'working', 'Editing src/components/Toggle.tsx', '+20 −2 · 2 files'],
      [beats(17), 'ready', 'Done. Toggle saves to localStorage.', '+33 −5 · 3 files']
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
    <AbsoluteFill style={{ alignItems: 'center' }}>
      <Headline at={0} out={beats(7)}>Every agent. *One window.*</Headline>
      <Headline at={beats(8)} out={beats(13)}>Each one in its own git worktree.</Headline>
      <Headline at={beats(14)} out={beats(21)}>It pings you when one needs you.</Headline>
      <Headline at={beats(22)}>And says when it&apos;s done.</Headline>
      <div style={{ position: 'absolute', top: 180, transform: `translateY(${(1 - win) * 60}px) scale(${0.96 + 0.04 * win})`, opacity: win }}>
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
            const glowBranch = frame >= beats(8) && frame < beats(13)
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
                    <Button primary glow={frame > beats(18) && frame < beats(20) ? 1 : 0} style={{ padding: '5px 12px', fontSize: 13 }}>
                      Allow
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
          <Toast at={beats(14)} out={beats(20)} tone={C.amber} icon={<Bell size={20} />} title="Codex needs you" text="Allow command: npm test?" />
          <Pointer
            path={[
              [0, 1300, 700],
              [beats(15), 1300, 700],
              [beats(18), 432, 222]
            ]}
            click={[beats(19)]}
          />
        </Window>
      </div>
    </AbsoluteFill>
  )
}
