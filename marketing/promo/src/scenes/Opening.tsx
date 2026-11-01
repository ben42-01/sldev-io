import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BAR, BEAT, C, MONO, UI, beats, enter, onBeat, pop, progress } from '../lib'
import { Brand, Logo } from '../ui'

interface Term {
  name: string
  lines: string[]
  /** stuck on a question */
  waiting?: string
}

const TERMS: Term[] = [
  { name: 'claude', lines: ['● Reading src/auth/session.ts', '● Editing src/auth/routes.ts', '● Running npm test', '  ✓ 41 passed'] },
  { name: 'codex', lines: ['› Exploring the repo', '› Planning: fix flaky test', '› Editing test/checkout.test.ts'], waiting: 'Allow command: npm test? [y/N]' },
  { name: 'npm run dev', lines: ['VITE v8.3.5 ready in 412 ms', '➜ Local: http://localhost:5173/', 'hmr update /src/App.tsx', 'hmr update /src/App.tsx'] },
  { name: 'gemini', lines: ['✦ Reading src/api/limits.ts', '✦ Writing src/api/rateLimit.ts'], waiting: 'Do you want to edit 3 files? (y/n)' },
  { name: 'git', lines: ['$ git status', 'On branch which-one-was-it', 'Changes not staged for commit:', '  modified: src/auth/routes.ts'] },
  { name: 'cursor-agent', lines: ['Reading src/theme.ts', 'Editing src/components/Toggle.tsx', 'Editing src/styles.css'] },
  { name: 'claude (2)', lines: ['● Reading package.json', '● Thinking…'], waiting: 'Allow Bash: rm -rf dist? (y/n)' },
  { name: 'docker logs', lines: ['postgres  | ready to accept connections', 'api       | listening on :8080', 'api       | GET /health 200'] },
  { name: 'opencode', lines: ['Permission required', '  Edit src/orders/refund.ts', '  Allow once  Always allow'] }
]

const CAPTIONS = ['Claude Code in one terminal.', 'Codex in another.', 'A dev server in a third.', 'Nine tabs later…']

/** Nine terminals pile up, one per beat, while the problem is spelled out. */
export function Chaos() {
  const frame = useCurrentFrame()
  const zoom = interpolate(frame, [0, 5 * BAR], [0.96, 1.04])
  const shake = frame > 4 * BAR ? Math.sin(frame * 1.7) * 3 * onBeat(frame, 4 * BAR) : 0
  // one caption per bar; the last bar is the punchline
  const bar = Math.floor(frame / BAR)
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ transform: `scale(${zoom}) translateX(${shake}px)`, padding: 40, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)', gap: 18 }}>
        {TERMS.map((t, i) => {
          const at = beats(i)
          const p = pop(frame, at)
          const shown = Math.min(t.lines.length, Math.floor((frame - at) / 10))
          const waiting = t.waiting && frame > at + t.lines.length * 10 + 6
          const blink = waiting && Math.floor(frame / 15) % 2 === 0
          return (
            <div key={t.name} style={{ opacity: frame < at ? 0 : 1, transform: `scale(${0.85 + 0.15 * p})`, border: `1px solid ${waiting ? `${C.amber}88` : C.borderStrong}`, background: C.panel, fontFamily: MONO, fontSize: 19, overflow: 'hidden', filter: `brightness(${interpolate(frame, [4 * BAR, 5 * BAR], [1, 0.45], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })})` }}>
              <div style={{ padding: '8px 14px', borderBottom: `1px solid ${C.border}`, background: C.elev, color: C.muted, fontFamily: UI, fontSize: 15, display: 'flex', gap: 8 }}>
                <span style={{ color: C.subtle }}>zsh —</span> {t.name}
              </div>
              <div style={{ padding: '10px 14px', lineHeight: 1.55, color: '#cfcfcf' }}>
                {t.lines.slice(0, Math.max(0, shown)).map((l, j) => (
                  <div key={j}>{l}</div>
                ))}
                {waiting && <div style={{ color: C.amber, opacity: blink ? 1 : 0.55 }}>{t.waiting}</div>}
              </div>
            </div>
          )
        })}
      </AbsoluteFill>
      {bar < CAPTIONS.length && <Caption key={bar} text={CAPTIONS[bar]} at={bar * BAR} out={(bar + 1) * BAR - 6} />}
      {bar >= CAPTIONS.length && <Caption text="…and one has been waiting since lunch." at={CAPTIONS.length * BAR} tone={C.amber} />}
    </AbsoluteFill>
  )
}

function Caption({ text, at, out, tone = C.fg }: { text: string; at: number; out?: number; tone?: string }) {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ padding: '22px 44px', background: '#0a0a0ae6', border: `1px solid ${C.borderStrong}`, font: `700 72px/1.1 ${UI}`, letterSpacing: '-0.03em', color: tone, boxShadow: '0 30px 80px #000', ...enter(frame, at, { dur: 8, rise: 16, out }) }}>
        {text}
      </div>
    </AbsoluteFill>
  )
}

/** "Coding agents got good. Keeping track of them didn't." */
export function Turn() {
  const frame = useCurrentFrame()
  const second = BAR
  return (
    <AbsoluteFill style={{ background: C.bg, alignItems: 'center', justifyContent: 'center', fontFamily: UI, textAlign: 'center' }}>
      <div style={{ font: `700 92px/1.1 ${UI}`, letterSpacing: '-0.04em', color: C.fg, ...enter(frame, 0, { dur: 10, out: second - 8 }) }}>Coding agents got good.</div>
      <div style={{ position: 'absolute', font: `700 92px/1.1 ${UI}`, letterSpacing: '-0.04em', color: C.fg, ...enter(frame, second, { dur: 10 }) }}>
        Keeping track of them <Brand>didn&apos;t.</Brand>
        <div style={{ height: 4, marginTop: 18, background: `linear-gradient(90deg, ${C.blue}, ${C.green}, ${C.purple})`, transform: `scaleX(${progress(frame, second + 12, 24)})`, transformOrigin: 'left' }} />
      </div>
    </AbsoluteFill>
  )
}

/** The mark draws itself, then the name and tagline. */
export function LogoReveal() {
  const frame = useCurrentFrame()
  const draw = progress(frame, 0, BEAT * 2)
  const s = pop(frame, BEAT * 2, 10)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: UI }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 34, transform: `scale(${0.9 + 0.1 * s})` }}>
        <div style={{ filter: `drop-shadow(0 0 ${30 * draw}px ${C.green}55)` }}>
          <Logo size={170} draw={draw} />
        </div>
        <div style={{ font: `700 150px/1 ${UI}`, letterSpacing: '-0.05em', ...enter(frame, BEAT * 2, { dur: 10, rise: 0 }) }}>
          <Brand>sldev-io</Brand>
        </div>
      </div>
      <div style={{ marginTop: 40, fontSize: 40, color: C.muted, letterSpacing: '-0.01em', ...enter(frame, BEAT * 4, { dur: 12 }) }}>The terminal-first workspace for agentic coding.</div>
    </AbsoluteFill>
  )
}
