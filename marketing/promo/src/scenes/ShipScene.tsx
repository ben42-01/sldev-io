import { Brain, Command, Container, Copy, Gauge, GitBranch, GitPullRequest, KeyRound, NotebookPen, Play, ScrollText, Server, Sparkles, SunMoon, Timer, Workflow } from 'lucide-react'
import type { ReactNode } from 'react'
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, C, MONO, UI, beats, onBeat, pop, progress, typed } from '../lib'
import { Brand, Camera, Headline, Scrim, Window } from '../ui'

// Ship: a fast run of the things around the work, one every couple of beats, then the rest of the
// app as a wall of tiles. Each part is short on purpose: the montage is the selling point.

const PARTS: Array<{ from: number; len: number; Part: () => ReactNode; line: string }> = [
  { from: 0, len: beats(6), Part: GraphPart, line: 'Every branch, PR and merge, *at a glance.*' },
  { from: beats(6), len: beats(6), Part: MapPart, line: 'See how your code *connects.*' },
  { from: beats(12), len: beats(6), Part: RecapPart, line: 'Your standup, *already written.*' },
  { from: beats(18), len: beats(5.5), Part: CliPart, line: 'Prefer a plain terminal? There\'s a *CLI.*' },
  { from: beats(23.5), len: beats(7), Part: WallPart, line: 'And *everything around it.*' }
]

export function ShipScene() {
  return (
    <AbsoluteFill>
      {PARTS.map(({ from, len, Part, line }, i) => (
        <Sequence key={i} from={from} durationInFrames={len + (i < PARTS.length - 1 ? 5 : 0)}>
          <Whip len={len} last={i === PARTS.length - 1}>
            <Part />
          </Whip>
          <Scrim />
          <Headline at={2} out={i < PARTS.length - 1 ? len - 8 : undefined}>
            {line}
          </Headline>
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}

/** a sideways whip between parts: in from the right, out to the left, smeared */
function Whip({ len, last, children }: { len: number; last: boolean; children: ReactNode }) {
  const frame = useCurrentFrame()
  const inP = progress(frame, 0, 7)
  const outP = last ? 0 : interpolate(frame, [len - 2, len + 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const x = (1 - inP) * 420 - outP * 520
  const blur = 18 * (1 - inP) + 18 * outP
  return <AbsoluteFill style={{ transform: `translateX(${x}px)`, opacity: Math.min(1, inP * 1.4) * (1 - outP), filter: blur > 0.4 ? `blur(${blur}px)` : undefined }}>{children}</AbsoluteFill>
}

/** a window in the middle of the stage, smaller than the app's, for the montage */
function Panel({ title, active, width = 1440, height = 760, children, keys }: { title: string; active: number; width?: number; height?: number; children: ReactNode; keys: Parameters<typeof Camera>[0]['keys'] }) {
  return (
    <Camera keys={keys}>
      <div style={{ position: 'absolute', left: (1920 - width) / 2, top: 230 }}>
        <Window width={width} height={height} active={active} title={title}>
          {children}
        </Window>
      </div>
    </Camera>
  )
}

// ---------------------------------------------------------------- the commit graph

const LANE_X = [40, 76, 112, 148]
const LANE_C = [C.blue, C.green, C.purple, C.amber]
const ROW = 58
const COMMITS: Array<{ lane: number; msg: string; who: string; pr?: string; merge?: boolean }> = [
  { lane: 0, msg: 'Merge #143: rate-limit invites', who: 'you', pr: '#143', merge: true },
  { lane: 2, msg: 'Limit invites to 20 an hour', who: 'Claude Code' },
  { lane: 0, msg: 'Merge #142: invite people by email', who: 'you', pr: '#142', merge: true },
  { lane: 1, msg: 'Invite email template', who: 'Codex' },
  { lane: 2, msg: 'Token bucket for /invite', who: 'Claude Code' },
  { lane: 1, msg: 'POST /invites with a 7-day expiry', who: 'Codex' },
  { lane: 3, msg: 'Owners can remove a member', who: 'Gemini CLI', pr: '#144 open' },
  { lane: 0, msg: 'Team settings page', who: 'Cursor Agent', pr: '#131' },
  { lane: 0, msg: 'Release v1.4.0', who: 'you' }
]
/** [lane, fork row, merge row or -1 for an open head] */
const BRANCHES: Array<[number, number, number]> = [
  [1, 7, 2],
  [2, 7, 0],
  [3, 7, -1]
]

function GraphPart() {
  const frame = useCurrentFrame()
  const y = (r: number): number => 30 + r * ROW
  const draw = progress(frame, 4, 40)
  return (
    <Panel title="Git · acme-shop" active={1} keys={[[0, { z: 1.12, rx: 10, ry: 14 }], [beats(6), { z: 1.04, rx: 2, ry: -4 }]]}>
      <div style={{ position: 'absolute', left: 24, top: 18, display: 'flex', gap: 20, fontSize: 15, color: C.muted }}>
        <span style={{ color: C.fg, fontWeight: 600, borderBottom: `2px solid ${C.blue}`, paddingBottom: 6 }}>Graph</span>
        <span>Branches</span>
        <span>Worktrees</span>
        <span>Stats</span>
      </div>
      <div style={{ position: 'absolute', left: 24, top: 64, right: 24 }}>
        <svg width={200} height={COMMITS.length * ROW + 20} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
          <path d={`M${LANE_X[0]},${y(COMMITS.length - 1)} L${LANE_X[0]},${y(0)}`} stroke={LANE_C[0]} strokeWidth={3} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} fill="none" />
          {BRANCHES.map(([lane, fork, merge], i) => {
            const lx = LANE_X[lane]
            const top = merge < 0 ? 6 : merge
            const d = `M${LANE_X[0]},${y(fork)} C${LANE_X[0]},${y(fork) - 30} ${lx},${y(fork) - 26} ${lx},${y(fork) - 50} L${lx},${y(top) + 50}${merge < 0 ? ` L${lx},${y(top)}` : ` C${lx},${y(top) + 26} ${LANE_X[0]},${y(top) + 30} ${LANE_X[0]},${y(top)}`}`
            return <path key={i} d={d} stroke={LANE_C[lane]} strokeWidth={3} fill="none" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress(frame, 10 + i * 6, 40)} />
          })}
          {COMMITS.map((c, r) => {
            const p = pop(frame, 8 + (COMMITS.length - 1 - r) * 4)
            return <circle key={r} cx={LANE_X[c.lane]} cy={y(r)} r={c.merge ? 9 : 7} fill={c.merge ? C.bg : LANE_C[c.lane]} stroke={LANE_C[c.lane]} strokeWidth={3} style={{ transform: `scale(${p})`, transformOrigin: `${LANE_X[c.lane]}px ${y(r)}px` }} />
          })}
        </svg>
        {COMMITS.map((c, r) => {
          const p = progress(frame, 10 + (COMMITS.length - 1 - r) * 4, 10)
          return (
            <div key={r} style={{ position: 'absolute', left: 210, right: 0, top: y(r) - 18, height: 36, display: 'flex', alignItems: 'center', gap: 16, fontSize: 19, opacity: p, transform: `translateX(${(1 - p) * 20}px)` }}>
              <span style={{ fontFamily: MONO, fontSize: 15, color: C.subtle }}>{(0x3f2a9c1 + r * 7919).toString(16).slice(0, 7)}</span>
              <span style={{ fontWeight: c.merge ? 600 : 400 }}>{c.msg}</span>
              {c.pr && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 99, fontSize: 14, border: `1px solid ${c.pr.includes('open') ? C.green : C.purple}88`, color: c.pr.includes('open') ? C.green : C.purple }}>
                  <GitPullRequest size={13} /> {c.pr}
                </span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 15, color: C.muted, padding: '2px 10px', border: `1px solid ${C.border}` }}>{c.who}</span>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------- the code map

const NODES: Array<{ id: string; x: number; y: number; files: number }> = [
  { id: 'src/ui', x: 560, y: 40, files: 48 },
  { id: 'src/api', x: 300, y: 220, files: 31 },
  { id: 'src/email', x: 820, y: 220, files: 9 },
  { id: 'src/auth', x: 120, y: 410, files: 14 },
  { id: 'src/orders', x: 520, y: 410, files: 22 },
  { id: 'src/db', x: 360, y: 580, files: 11 },
  { id: 'src/lib', x: 880, y: 580, files: 17 }
]
const EDGES: Array<[string, string, number]> = [
  ['src/ui', 'src/api', 24],
  ['src/ui', 'src/email', 3],
  ['src/api', 'src/auth', 12],
  ['src/api', 'src/orders', 18],
  ['src/email', 'src/lib', 5],
  ['src/auth', 'src/db', 7],
  ['src/orders', 'src/db', 15],
  ['src/orders', 'src/lib', 6],
  ['src/api', 'src/email', 4]
]
const NW = 230
const NH = 74

function MapPart() {
  const frame = useCurrentFrame()
  const at = (id: string) => NODES.find((n) => n.id === id)!
  const sel = frame >= beats(2.4) ? 'src/orders' : null
  return (
    <Panel title="Diagrams · acme-shop" active={1} keys={[[0, { z: 0.96, rx: 22, ry: -10 }], [beats(2.2), { z: 1.04, rx: 6, ry: 0 }], [beats(6), { z: 1.12, rx: 4, ry: 6 }]]}>
      <div style={{ position: 'absolute', left: 24, top: 18, display: 'flex', gap: 20, fontSize: 15, color: C.muted, alignItems: 'center' }}>
        <span style={{ color: C.fg, fontWeight: 600, borderBottom: `2px solid ${C.green}`, paddingBottom: 6 }}>Code map</span>
        <span>Files</span>
        <span>Schema</span>
        <span style={{ marginLeft: 30, fontSize: 13, color: C.subtle }}>TypeScript · Python · Go · Rust · Java · C# · C/C++ · Ruby · PHP</span>
      </div>
      <div style={{ position: 'absolute', left: 140, top: 70 }}>
        <svg width={1200} height={680} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          {EDGES.map(([a, b, n], i) => {
            const A = at(a)
            const B = at(b)
            const x1 = A.x + NW / 2
            const y1 = A.y + NH
            const x2 = B.x + NW / 2
            const y2 = B.y
            const d = `M${x1},${y1} C${x1},${y1 + 60} ${x2},${y2 - 60} ${x2},${y2}`
            const hot = sel !== null && (a === sel || b === sel)
            return (
              <g key={i}>
                <path d={d} fill="none" stroke={hot ? C.green : '#3a3a3a'} strokeWidth={hot ? 3 : 2} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress(frame, 12 + i * 3, 18)} style={{ filter: hot ? `drop-shadow(0 0 6px ${C.green})` : undefined }} />
                <text x={(x1 + x2) / 2 + 8} y={(y1 + y2) / 2} fill={hot ? C.green : C.subtle} fontSize={14} fontFamily={MONO} opacity={progress(frame, 24 + i * 3, 10)}>
                  {n}
                </text>
              </g>
            )
          })}
        </svg>
        {NODES.map((n, i) => {
          const p = pop(frame, 4 + i * 3)
          const on = n.id === sel
          const near = sel !== null && EDGES.some(([a, b]) => (a === sel && b === n.id) || (b === sel && a === n.id))
          return (
            <div key={n.id} style={{ position: 'absolute', left: n.x, top: n.y, width: NW, height: NH, boxSizing: 'border-box', padding: '12px 16px', background: C.elev, border: `1px solid ${on ? C.green : near ? `${C.green}77` : C.borderStrong}`, boxShadow: on ? `0 0 40px ${C.green}44` : '0 10px 30px #0008', opacity: sel && !on && !near ? 0.45 : p, transform: `scale(${0.85 + 0.15 * p})` }}>
              <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 500 }}>{n.id}</div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{n.files} files</div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------- recap

const RECAP: Array<[string, 'h' | 'b' | 'li' | 'gap']> = [
  ['Standup · Thursday 13 November', 'h'],
  ['', 'gap'],
  ['Done', 'b'],
  ['Invite people by email: merged #142 (Codex, 14 min)', 'li'],
  ['Team settings page: merged #131 (Cursor Agent)', 'li'],
  ['In review', 'b'],
  ['Rate-limit invites: PR #143 (Claude Code), tests pass', 'li'],
  ['Today', 'b'],
  ['Owners can remove a member: in progress (Gemini CLI)', 'li']
]

function RecapPart() {
  const frame = useCurrentFrame()
  let t = 6
  return (
    <Panel title="Recap" active={0} width={1180} height={720} keys={[[0, { z: 1.05, rx: -8, ry: -16 }], [beats(6), { z: 1.14, rx: 0, ry: 6 }]]}>
      <div style={{ position: 'absolute', left: 40, right: 40, top: 26, display: 'flex', gap: 10, alignItems: 'center' }}>
        {['Standup', 'Today', 'This week'].map((l, i) => (
          <span key={l} style={{ padding: '6px 14px', fontSize: 15, border: `1px solid ${i === 0 ? C.borderStrong : C.border}`, background: i === 0 ? C.hover : 'transparent', color: i === 0 ? C.fg : C.muted }}>
            {l}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', background: '#e5e5e5', color: '#0a0a0a', fontWeight: 600, fontSize: 15 }}>
          <Copy size={15} /> Copy Markdown
        </span>
      </div>
      <div style={{ position: 'absolute', left: 40, right: 40, top: 90, bottom: 70, padding: '22px 28px', background: '#0a0a0a', border: `1px solid ${C.border}`, fontSize: 22, lineHeight: 1.65 }}>
        {RECAP.map(([text, kind], i) => {
          const start = t
          t += kind === 'gap' ? 1 : Math.ceil(text.length / 8) + 1
          if (frame < start) return null
          const shown = typed(text, frame, start, 260)
          if (kind === 'gap') return <div key={i} style={{ height: 8 }} />
          if (kind === 'h') return <div key={i} style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em' }}>{shown}</div>
          if (kind === 'b') return <div key={i} style={{ fontWeight: 700, marginTop: 6, color: C.green }}>{shown}</div>
          return (
            <div key={i} style={{ color: '#d6d6d6', paddingLeft: 26, position: 'relative' }}>
              <span style={{ position: 'absolute', left: 4, color: C.subtle }}>•</span>
              {shown}
            </div>
          )
        })}
      </div>
      <div style={{ position: 'absolute', left: 40, bottom: 24, fontSize: 16, color: C.muted, opacity: progress(frame, beats(3), 10) }}>
        From your missions, on your machine · 5 missions · 4 agents · 1h 12m of agent time
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------- the CLI

const CLI_CMD = 'sldev new --agent codex --worktree feat/invites "Invite people by email"'

function CliPart() {
  const frame = useCurrentFrame()
  const tui = frame >= 20
  const tab = pop(frame, 20)
  return (
    <Camera keys={[[0, { z: 1.08, rx: 6, ry: 18 }], [beats(5.5), { z: 1.02, rx: 0, ry: -6 }]]}>
      <div style={{ position: 'absolute', left: 260, top: 240, width: 1400, height: 740, borderRadius: 12, overflow: 'hidden', background: '#0b0b0b', border: '1px solid #2b2b2b', boxShadow: `0 40px 120px #000c, 0 0 80px ${C.green}14`, fontFamily: MONO, fontSize: 19, color: '#cfcfcf' }}>
        <div style={{ height: 38, display: 'flex', alignItems: 'center', padding: '0 16px', background: '#161616', borderBottom: '1px solid #232323', position: 'relative' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {[0, 1, 2].map((d) => (
              <span key={d} style={{ width: 12, height: 12, borderRadius: 99, background: '#3a3a3a' }} />
            ))}
          </div>
          <span style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', font: `500 14px ${UI}`, color: C.muted }}>zsh — ~/acme-shop</span>
          <span style={{ marginLeft: 'auto', font: `600 13px ${UI}`, padding: '3px 10px', border: `1px solid ${C.green}77`, color: C.green }}>open source · Apache-2.0</span>
        </div>
        {!tui ? (
          <div style={{ padding: '18px 22px' }}>
            <span style={{ color: C.green }}>~/acme-shop ❯ </span>
            {typed(CLI_CMD, frame, 1, 200)}
            <span style={{ display: 'inline-block', width: 11, height: 22, background: '#d0d0d0', verticalAlign: -4, marginLeft: 2 }} />
          </div>
        ) : (
          <div style={{ opacity: tab }}>
            <div style={{ display: 'flex', borderBottom: '1px solid #232323', fontSize: 16 }}>
              {[
                ['1 claude · rate-limit', C.blue, '●'],
                ['2 codex · invites', C.amber, '◆'],
                ['3 gemini · members', C.green, '✓'],
                ['4 shell', C.subtle, '']
              ].map(([l, tone, mark], i) => (
                <span key={l} style={{ padding: '9px 18px', borderRight: '1px solid #232323', background: i === 1 ? '#1a1a1a' : 'transparent', color: i === 1 ? C.fg : C.muted, boxShadow: i === 1 ? `inset 0 2px 0 ${C.amber}` : undefined }}>
                  <span style={{ color: tone }}>{mark}</span> {l}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex' }}>
              <div style={{ width: 330, borderRight: '1px solid #232323', padding: '14px 18px', fontSize: 16, lineHeight: 1.9, color: C.muted }}>
                <div style={{ color: C.subtle, fontSize: 13, letterSpacing: '0.1em' }}>NEEDS YOU</div>
                <div style={{ color: C.amber }}>◆ codex · invites</div>
                <div style={{ color: C.subtle, fontSize: 13, letterSpacing: '0.1em', marginTop: 8 }}>WORKING</div>
                <div style={{ color: C.blue }}>● claude · rate-limit</div>
                <div style={{ color: C.subtle, fontSize: 13, letterSpacing: '0.1em', marginTop: 8 }}>READY</div>
                <div style={{ color: C.green }}>✓ gemini · members</div>
              </div>
              <div style={{ flex: 1, padding: '14px 20px', lineHeight: 1.7, fontSize: 18 }}>
                {[
                  ['• Explored', C.fg],
                  ['  └ Read src/api/teams.ts', C.muted],
                  ['• Edited src/api/invites.ts (+84 -0)', C.fg],
                  ['• Edited src/email/invite.tsx (+41 -0)', C.fg],
                  ['', C.fg],
                  ['Allow Codex to run `npm test`?', C.amber],
                  ['  › 1. Yes   2. Always   3. No', C.amber]
                ].map(([l, tone], i) => (frame >= 22 + i * 2 ? <div key={i} style={{ color: tone, whiteSpace: 'pre' }}>{l || ' '}</div> : null))}
              </div>
            </div>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '8px 18px', borderTop: '1px solid #232323', fontSize: 14, color: C.subtle, display: 'flex', gap: 22 }}>
              <span>Ctrl-b n new</span>
              <span>Ctrl-b w workflows</span>
              <span>Ctrl-b v diff</span>
              <span style={{ marginLeft: 'auto', color: C.muted }}>3 agents · 3 worktrees · rules · memory · failover</span>
            </div>
          </div>
        )}
      </div>
    </Camera>
  )
}

// ---------------------------------------------------------------- everything else, as a wall

const TILES: Array<[typeof Server, string]> = [
  [Server, 'SSH & SFTP'],
  [Container, 'Docker'],
  [Gauge, 'Token usage'],
  [Sparkles, 'Skills & MCP'],
  [ScrollText, 'Rules sync'],
  [Brain, 'Project memory'],
  [Workflow, 'GitHub Actions'],
  [GitBranch, 'Worktrees'],
  [KeyRound, 'Credential vault'],
  [Timer, 'Automations'],
  [Play, 'Runtimes & tasks'],
  [NotebookPen, 'Notes'],
  [SunMoon, 'Light & dark'],
  [Command, 'Command palette'],
  [GitPullRequest, 'PRs from the app']
]

function WallPart() {
  const frame = useCurrentFrame()
  const cols = 5
  const W = 330
  const H = 150
  const G = 22
  const pan = progress(frame, 0, beats(7))
  return (
    <AbsoluteFill style={{ perspective: 1600, perspectiveOrigin: '50% 40%' }}>
      <div
        style={{
          position: 'absolute',
          left: 960 - (cols * W + (cols - 1) * G) / 2,
          top: 300,
          width: cols * W + (cols - 1) * G,
          transform: `rotateX(${interpolate(pan, [0, 1], [38, 14])}deg) rotateZ(${interpolate(pan, [0, 1], [-6, -2])}deg) translateZ(${interpolate(pan, [0, 1], [-260, 30])}px)`,
          transformOrigin: '50% 30%',
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, ${W}px)`,
          gap: G
        }}
      >
        {TILES.map(([Icon, label], i) => {
          // they land on eighth notes, in a diagonal wave
          const at = beats(0.25) + ((i % cols) + Math.floor(i / cols)) * beats(0.5)
          const p = pop(frame, at, 12)
          const glow = onBeat(frame, at) * (frame >= at ? 1 : 0)
          return (
            <div
              key={label}
              style={{
                height: H,
                boxSizing: 'border-box',
                padding: '24px 26px',
                background: `linear-gradient(160deg, ${C.elev}, #0b0b0b)`,
                border: `1px solid ${C.borderStrong}`,
                borderTop: '2px solid transparent',
                borderImage: `${BRAND} 1`,
                borderImageSlice: '1 0 0 0',
                boxShadow: `0 30px 60px #000a, 0 0 ${40 * glow}px ${[C.blue, C.green, C.purple][i % 3]}33`,
                opacity: p,
                transform: `translateY(${(1 - p) * 80}px) translateZ(${(1 - p) * 200}px)`,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <Icon size={34} strokeWidth={1.5} color={[C.blue, C.green, C.purple][i % 3]} />
              <div style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-0.02em' }}>{label}</div>
            </div>
          )
        })}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 70, textAlign: 'center', fontSize: 28, color: C.muted, opacity: progress(frame, beats(3.5), 10) }}>
        One app. <Brand style={{ fontWeight: 700 }}>No telemetry.</Brand> Everything runs on your machine.
      </div>
    </AbsoluteFill>
  )
}
