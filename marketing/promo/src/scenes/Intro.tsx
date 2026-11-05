import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import site from '../../../../website/src/content/site.json'
import { BAR, BRAND, C, FPS, MONO, SERIF, UI, onBeat, pop, progress, rand, typed } from '../lib'
import { ACCENT_IN_SERIF, Backdrop, Logo, Reveal, WORDMARK } from '../ui'

// One continuous shot over the first 9 bars, so nothing cuts between the problem and the answer:
//   bars 0–5  terminals pile up, each streaming real-looking output, the camera pulls back
//   bar  4    the one that has been waiting all along is lifted out of the pile
//   bars 5–7  the music breaks down; the pile turns into a whirlpool around the turn's two lines
//   bar  7    the drop: everything collapses into the centre and the mark is born from it
export const INTRO_BARS = 9

const SPOT = 4 * BAR
const SWIRL = 5 * BAR
const DROP = 7 * BAR

// ---------------------------------------------------------------- what the terminals print

interface Script {
  /** printed once, in order */
  head: string[]
  /** then repeated forever (logs, watchers); {t} is a clock, {n} a number, {ms} a duration */
  loop?: string[]
  /** or: the agent stops and asks; printed after head, then nothing more */
  ask?: string[]
  /** lines a second */
  rate: number
}

const SCRIPTS: Record<string, Script> = {
  claude: {
    rate: 5,
    head: [
      '╭───────────────────────────────────────────────╮',
      '│ ✻ Claude Code            cwd: ~/acme-shop       │',
      '╰───────────────────────────────────────────────╯',
      '',
      '> add rate limiting to the API',
      '',
      '⏺ I’ll start with how requests reach the API.',
      '⏺ Read(src/api/server.ts)',
      '  ⎿  Read 214 lines',
      '⏺ Search(pattern: "app.use(", path: "src/api")',
      '  ⎿  Found 7 files',
      '⏺ Update(src/api/rateLimit.ts)',
      '  ⎿  Added 38 lines',
      '      1 + import { TokenBucket } from "./bucket"',
      '      2 + const WINDOW_MS = 60_000',
      '      3 + export function rateLimit(max = 100) {',
      '      4 +   const buckets = new Map<string, TokenBucket>()',
      '⏺ Update(src/api/server.ts)',
      '     41 - app.use(router)',
      '     41 + app.use(rateLimit(120), router)',
      '⏺ Bash(npm test -- rateLimit)',
      '  ⎿  ✓ 12 passed (1.4s)',
      '',
      '✶ Cogitating… (34s · ↓ 2.1k tokens · esc to interrupt)'
    ]
  },
  codex: {
    rate: 4,
    head: ['$ codex "fix the flaky checkout test"', '', '• Explored', '  └ Read test/checkout.test.ts', '  └ Search retry in src/', '• Edited test/checkout.test.ts (+6 -2)', ''],
    ask: ['Allow Codex to run `npm test`?', '  › 1. Yes   2. Always   3. No']
  },
  vite: {
    rate: 4,
    head: ['$ npm run dev', '', '  VITE v8.3.5  ready in 412 ms', '', '  ➜  Local:   http://localhost:5173/', '  ➜  Network: use --host to expose', ''],
    loop: ['{t} [vite] hmr update /src/App.tsx', '{t} [vite] hmr update /src/components/Cart.tsx', '{t} [vite] page reload src/main.tsx', '{t} [vite] hmr update /src/styles.css']
  },
  vitest: {
    rate: 7,
    head: ['$ npx vitest', ''],
    loop: [
      ' RERUN  src/cart.ts x{n}',
      ' ✓ src/cart.test.ts (14 tests) {ms}ms',
      ' ✓ src/auth/session.test.ts (9 tests) {ms}ms',
      ' ✗ src/checkout.test.ts > applies a coupon once',
      '   AssertionError: expected 2 to be 1',
      '    ❯ src/checkout.test.ts:48:21',
      ' Test Files  1 failed | 23 passed (24)',
      ''
    ]
  },
  gemini: {
    rate: 4,
    head: ['$ gemini', '', '> move the limits to config', '', '✦ Reading src/api/limits.ts', '✦ Reading src/config/index.ts', '✦ Writing src/config/limits.ts', ''],
    ask: ['Apply this change?', '  ● Yes, allow once', '  ○ No, suggest changes']
  },
  docker: {
    rate: 9,
    head: ['$ docker compose up', ''],
    loop: ['api-1     | {t} GET /api/products 200 {ms}ms', 'db-1      | LOG:  checkpoint complete', 'api-1     | {t} POST /api/cart 201 {ms}ms', 'worker-1  | job 48{n} done', 'redis-1   | 1:M * DB saved on disk', 'api-1     | {t} GET /api/health 200 {ms}ms']
  },
  git: {
    rate: 3,
    head: [
      '$ git log --oneline --graph',
      '* 3f2a9c1 (HEAD -> which-one-was-it) wip',
      '* 9b81d02 wip 2',
      '| * c4e77aa (agent/rate-limit) add token bucket',
      '| * 18ab3f0 tests for limits',
      '|/',
      '* 7d1e2b4 Merge branch fix/checkout',
      '|\\',
      '| * e0f3c99 retry flaky test',
      '* | a5c2d71 bump deps',
      '|/',
      '* 2b12062 release v1.0.2',
      '$ git status',
      'On branch which-one-was-it',
      'Changes not staged for commit:',
      '        modified:   src/api/server.ts',
      '        modified:   test/checkout.test.ts'
    ]
  },
  tsc: {
    rate: 2,
    head: ['$ tsc --watch', '', '[{t}] Starting compilation in watch mode...'],
    loop: [
      "src/api/rateLimit.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/cart/total.ts(31,18): error TS2339: Property 'discount' does not exist on type 'Line'.",
      '[{t}] Found 2 errors. Watching for file changes.',
      '[{t}] File change detected. Starting incremental compilation...'
    ]
  },
  cursor: {
    rate: 4,
    head: ['$ cursor-agent', '', '> dark mode toggle in the header', ''],
    loop: ['⬢ Reading src/theme.ts', '⬢ Editing src/components/Toggle.tsx', '⬢ Editing src/styles.css', '⬢ Running npm run lint', '  ✓ no problems', '⬢ Reading src/components/Header.tsx']
  },
  npm: {
    rate: 12,
    head: ['$ npm install'],
    loop: [
      'npm http fetch GET 200 https://registry.npmjs.org/react {ms}ms (cache miss)',
      'npm http fetch GET 200 https://registry.npmjs.org/esbuild {ms}ms',
      'npm warn deprecated inflight@1.0.6: This module is not supported',
      'npm http fetch GET 200 https://registry.npmjs.org/@types/node {ms}ms',
      'npm http fetch GET 304 https://registry.npmjs.org/vite {ms}ms (cache revalidated)'
    ]
  },
  claude2: {
    rate: 4,
    head: ['$ claude', '', '> clean up the build output', '', '⏺ Read(package.json)', '  ⎿  Read 64 lines', '⏺ Bash(rm -rf dist)', ''],
    ask: ['Do you want to proceed?', '❯ 1. Yes', '  2. No, and tell Claude what to do differently']
  },
  nginx: {
    rate: 8,
    head: ['$ ssh prod tail -f /var/log/nginx/access.log'],
    loop: ['203.0.113.{n} - - [{t}] "GET /api/cart HTTP/2.0" 200 512', '198.51.100.{n} - - [{t}] "POST /api/checkout HTTP/2.0" 502 166', '203.0.113.{n} - - [{t}] "GET /assets/app.js HTTP/2.0" 304 0']
  },
  kubectl: {
    rate: 2,
    head: ['$ kubectl get pods -w', 'NAME                  READY   STATUS             RESTARTS'],
    loop: ['api-7d9f6-x{n}        0/1     CrashLoopBackOff   4', 'api-7d9f6-k{n}        1/1     Running            0', 'worker-55c8-q{n}      0/1     Error              2']
  },
  opencode: {
    rate: 4,
    head: ['$ opencode', '', '> refund flow for partial orders', '', '◇ Read src/orders/refund.ts', '◇ Grep "refund" in src/', ''],
    ask: ['△ Permission required', '  Edit src/orders/refund.ts', '  [a] allow once   [A] always   [d] deny']
  },
  copilot: {
    rate: 3,
    head: ['$ copilot', '', '> why does the coupon apply twice?', ''],
    loop: ['● Searching the codebase', '● Reading src/checkout/coupon.ts', '● Thinking…', '  The coupon is applied in both reducers.']
  }
}

// ---------------------------------------------------------------- where the windows open

interface Win {
  script: keyof typeof SCRIPTS
  title: string
  /** frame it opens */
  at: number
  /** centre on the stage (stage origin = screen centre at camera scale 1) */
  x: number
  y: number
  w: number
  h: number
  font?: number
}

// The order they open in is the order they stack. They open faster and faster: one, two, five, then too many.
const WINS: Win[] = [
  { script: 'claude', title: 'claude — ~/acme-shop', at: 0, x: 0, y: -30, w: 1060, h: 610, font: 17 },
  { script: 'codex', title: 'codex — ~/acme-shop', at: 60, x: -560, y: -250, w: 720, h: 420 },
  { script: 'vite', title: 'npm run dev', at: 84, x: 560, y: 230, w: 720, h: 400 },
  { script: 'vitest', title: 'vitest — watch', at: 120, x: 540, y: -300, w: 680, h: 440 },
  { script: 'gemini', title: 'gemini — ~/acme-shop', at: 136, x: -600, y: 290, w: 680, h: 400 },
  { script: 'docker', title: 'docker compose', at: 150, x: 0, y: -440, w: 780, h: 360 },
  { script: 'git', title: 'zsh — ~/acme-shop', at: 164, x: 60, y: 410, w: 660, h: 380 },
  { script: 'tsc', title: 'tsc --watch', at: 178, x: -1000, y: -40, w: 640, h: 380 },
  { script: 'cursor', title: 'cursor-agent', at: 185, x: 1000, y: -60, w: 660, h: 400 },
  { script: 'npm', title: 'npm install', at: 191, x: -300, y: -580, w: 720, h: 340 },
  { script: 'claude2', title: 'claude — ~/acme-shop (2)', at: 197, x: 380, y: 590, w: 680, h: 380 },
  { script: 'nginx', title: 'ssh prod', at: 202, x: -840, y: 540, w: 720, h: 360 },
  { script: 'kubectl', title: 'kubectl', at: 207, x: 880, y: -560, w: 640, h: 340 },
  { script: 'vitest', title: 'vitest — watch (2)', at: 212, x: -60, y: 130, w: 620, h: 360 },
  { script: 'opencode', title: 'opencode', at: 216, x: 1080, y: 430, w: 640, h: 380 },
  { script: 'copilot', title: 'copilot', at: 220, x: -1080, y: -500, w: 640, h: 360 },
  { script: 'docker', title: 'docker compose (2)', at: 224, x: 320, y: -120, w: 640, h: 340 },
  { script: 'vite', title: 'npm run dev (2)', at: 228, x: -400, y: 20, w: 620, h: 340 },
  { script: 'npm', title: 'npm install (2)', at: 232, x: 720, y: 680, w: 620, h: 320 },
  { script: 'nginx', title: 'ssh staging', at: 236, x: -720, y: -680, w: 620, h: 320 }
]

/** the one that has been waiting since lunch */
const WAITING = 1

// the first window types its command before anything prints
const PROMPT = '~/acme-shop ❯ '
const COMMAND = 'claude "add rate limiting to the API"'
const TYPE_AT = 8
const ENTER_AT = TYPE_AT + Math.ceil((COMMAND.length / 34) * FPS) + 4

const pad = (n: number): string => String(Math.floor(n)).padStart(2, '0')

function fill(line: string, i: number, seed: number): string {
  const sec = 3600 * 14 + 7 * 60 + i * 0.7 + seed * 13
  return line
    .replace(/\{t\}/g, `${pad(sec / 3600)}:${pad((sec / 60) % 60)}:${pad(sec % 60)}`)
    .replace(/\{n\}/g, String(10 + Math.floor(rand(i * 31 + seed) * 89)))
    .replace(/\{ms\}/g, String(4 + Math.floor(rand(i * 17 + seed * 7) * 120)))
}

/** every line the window has printed by `frame` */
function printed(win: Win, index: number, frame: number): { lines: string[]; asking: boolean } {
  const s = SCRIPTS[win.script]
  const start = index === 0 ? ENTER_AT : win.at + 3
  if (frame < start) return { lines: [], asking: false }
  const n = Math.floor(((frame - start) / FPS) * s.rate) + 1
  const lines: string[] = []
  for (let i = 0; i < n; i++) {
    if (i < s.head.length) lines.push(fill(s.head[i], i, index))
    else if (s.ask) {
      lines.push(...s.ask)
      return { lines, asking: true }
    } else if (s.loop) lines.push(fill(s.loop[(i - s.head.length) % s.loop.length], i, index))
    else break
  }
  return { lines, asking: false }
}

/** the colour a line of terminal output would have */
function tone(line: string): string {
  if (/✗|error|Error|FAIL|failed|CrashLoop| 502 |warn/.test(line)) return C.red
  if (/^\s+\d+ \+/.test(line)) return C.green
  if (/^\s+\d+ -/.test(line)) return C.red
  if (/Allow|proceed\?|Apply this|Permission|❯ 1\.|› 1\.|● Yes|\[a\]/.test(line)) return C.amber
  if (/✓|ready in|passed|done|Running/.test(line)) return '#7fdcb5'
  if (/^\s+(⎿|└|➜)/.test(line) || /^\[/.test(line)) return C.muted
  if (/^[⏺•✦⬢◇●>$]/.test(line)) return C.fg
  return '#bdbdbd'
}

function Terminal({ win, index, frame, lit, spot }: { win: Win; index: number; frame: number; lit: number; spot: number }) {
  const font = win.font ?? 14
  const lh = font * 1.5
  const rows = Math.floor((win.h - 34 - 20) / lh)
  const { lines, asking } = printed(win, index, frame)
  const first = index === 0
  if (first) lines.unshift(PROMPT + typed(COMMAND, frame, TYPE_AT, 34), '')
  const shown = lines.slice(-rows)
  const cursorOn = Math.floor(frame / 16) % 2 === 0
  const amber = asking ? 0.45 + 0.55 * spot : 0
  return (
    <div
      style={{
        width: win.w,
        height: win.h,
        borderRadius: 10,
        overflow: 'hidden',
        background: '#0d0d0d',
        border: `1px solid ${asking ? `${C.amber}${amber > 0.6 ? 'cc' : '66'}` : '#2b2b2b'}`,
        boxShadow: `0 30px 80px #000d, 0 0 0 1px #00000080${spot ? `, 0 0 ${90 * spot}px ${C.amber}55` : ''}`,
        filter: lit < 0.999 ? `brightness(${lit})` : undefined
      }}
    >
      <div style={{ height: 34, display: 'flex', alignItems: 'center', padding: '0 14px', background: '#171717', borderBottom: '1px solid #232323', position: 'relative' }}>
        <div style={{ display: 'flex', gap: 7 }}>
          {[0, 1, 2].map((d) => (
            <span key={d} style={{ width: 11, height: 11, borderRadius: 99, background: '#3a3a3a' }} />
          ))}
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', font: `500 13px ${UI}`, color: asking ? C.amber : C.muted }}>
          {asking && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 99, background: C.amber, marginRight: 8, opacity: 0.5 + 0.5 * Math.sin(frame / 5) ** 2 }} />}
          {spot > 0.5 ? 'codex — waiting for you · 4h 12m' : win.title}
        </div>
      </div>
      <div style={{ padding: '10px 16px', font: `400 ${font}px/${lh}px ${MONO}`, whiteSpace: 'pre', color: '#bdbdbd' }}>
        {shown.map((l, i) => (
          <div key={i} style={{ color: tone(l), height: lh }}>
            {l || ' '}
            {i === shown.length - 1 && (first || asking) && cursorOn && <span style={{ display: 'inline-block', width: font * 0.6, height: font * 1.1, marginLeft: 2, verticalAlign: 'text-bottom', background: '#d0d0d0' }} />}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- the shot

const CAPTIONS: Array<{ text: string; at: number; out: number; accent?: string }> = [
  { text: 'One agent feels like *magic.*', at: 16, out: 50 },
  { text: 'Two feel *productive.*', at: 64, out: 110 },
  { text: 'Five is a *juggling act.*', at: 124, out: 170 },
  { text: 'Then you *lose count.*', at: 184, out: 232 },
  { text: 'And one has been waiting *since lunch.*', at: SPOT + 6, out: SWIRL - 10, accent: C.amber }
]

const GLYPHS = '{}<>/;$#*+=✓●›⏺_[]()~|'.split('')
const PARTICLES = Array.from({ length: 110 }, (_, i) => ({
  angle: rand(i * 3 + 1) * Math.PI * 2,
  radius: 650 + rand(i * 3 + 2) * 900,
  start: SWIRL + 20 + rand(i * 3 + 3) * 50,
  size: 14 + rand(i * 5) * 16,
  glyph: GLYPHS[i % GLYPHS.length],
  color: [C.blue, C.green, C.purple, '#ffffff'][i % 4]
}))

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

export function Intro() {
  const frame = useCurrentFrame()

  // the camera pulls back as the pile grows, then holds while it turns
  const camera =
    frame < 60
      ? interpolate(frame, [0, 60], [1.12, 1])
      : interpolate(progress(frame, 60, SPOT - 60 + 10), [0, 1], [1, 0.7]) - 0.04 * progress(frame, SPOT, BAR * 3)
  const shake = frame >= 3 * BAR && frame < SPOT ? Math.sin(frame * 1.9) * 3 * onBeat(frame, 3 * BAR) : 0

  // the whirlpool: slow at first, then everything accelerates into the centre on the drop
  const s = clamp01((frame - SWIRL) / (DROP - SWIRL))
  const pull = s ** 2.6
  const turn = 0.35 * s + Math.PI * 2.2 * pull
  const rush = progress(frame, DROP - 26, 26)

  const spot = progress(frame, SPOT, 10) * (1 - progress(frame, SWIRL - 6, 14))
  const born = frame >= DROP

  return (
    <AbsoluteFill style={{ background: '#070707', overflow: 'hidden' }}>
      {born && (
        <div style={{ position: 'absolute', inset: 0, opacity: progress(frame, DROP, 30) }}>
          <Backdrop />
        </div>
      )}

      {/* the pile */}
      {!born && (
        <AbsoluteFill style={{ transform: `translateX(${shake}px) scale(${camera})` }}>
          {WINS.map((win, i) => {
            if (frame < win.at) return null
            const open = progress(frame, win.at, 7)
            const isSpot = i === WAITING
            const r0 = Math.hypot(win.x, win.y)
            const a0 = Math.atan2(win.y, win.x)
            // windows nearer the centre turn a little faster, like water
            const a = a0 + turn * (1 + 0.5 * (1 - Math.min(1, r0 / 1300)))
            const r = r0 * (1 - pull)
            const x = Math.cos(a) * r
            const y = Math.sin(a) * r
            const size = (0.94 + 0.06 * open) * (1 - pull) ** 0.7 * (1 + (isSpot ? 0.12 * spot : 0))
            const tilt = (turn * 180) / Math.PI * 0.55
            const lit = isSpot ? 1 : interpolate(spot, [0, 1], [1, 0.32]) * interpolate(s, [0, 0.12, 0.8, 1], [1, 0.55, 0.6, 1.3])
            const blur = 2.5 * Math.min(1, s * 6) + 18 * rush
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  zIndex: isSpot && spot > 0 ? 50 : i,
                  opacity: open * (1 - clamp01((s - 0.94) / 0.06)),
                  transform: `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${tilt}deg) scale(${size})`,
                  filter: blur > 0.3 ? `blur(${blur}px)` : undefined
                }}
              >
                <Terminal win={win} index={i} frame={frame} lit={lit} spot={isSpot ? spot : 0} />
                {/* as they fall in they burn in the brand colours */}
                {rush > 0 && <div style={{ position: 'absolute', inset: 0, borderRadius: 10, background: [C.blue, C.green, C.purple][i % 3], opacity: 0.45 * rush, mixBlendMode: 'screen' }} />}
              </div>
            )
          })}
        </AbsoluteFill>
      )}

      {/* code glyphs caught in the current */}
      {!born &&
        PARTICLES.map((p, i) => {
          const t = clamp01((frame - p.start) / (DROP - p.start))
          if (t <= 0) return null
          const k = t ** 2
          const r = p.radius * (1 - k)
          const a = p.angle + Math.PI * 3 * k
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: 960 + Math.cos(a) * r,
                top: 540 + Math.sin(a) * r * 0.62,
                font: `500 ${p.size * (0.4 + 0.6 * (1 - k))}px ${MONO}`,
                color: p.color,
                opacity: Math.min(1, t * 5) * (r > 8 ? 0.85 : 0),
                textShadow: `0 0 12px ${p.color}`,
                transform: `translate(-50%, -50%) rotate(${(a * 180) / Math.PI}deg)`
              }}
            >
              {p.glyph}
            </div>
          )
        })}

      {/* captions: a cinema scrim at the bottom while the pile grows */}
      {frame < SWIRL && (
        <>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 440, background: 'linear-gradient(transparent, #000000d9 60%, #000000f2)', opacity: progress(frame, 10, 16) }} />
          {CAPTIONS.map((c) =>
            frame >= c.at - 2 && frame < c.out + 14 ? (
              <Reveal key={c.text} text={c.text} at={c.at} out={c.out} style={{ position: 'absolute', left: 0, right: 0, bottom: 110, font: `400 96px/1.05 ${SERIF}`, letterSpacing: '-0.01em', color: C.fg }} accent={c.accent ? { ...WORDMARK, fontSize: '0.8em', color: c.accent } : { fontStyle: 'italic' }} />
            ) : null
          )}
        </>
      )}

      {/* the turn, in the eye of the whirlpool */}
      {frame >= SWIRL && !born && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', width: 1700, height: 520, background: 'radial-gradient(closest-side, #070707e6, #070707a0 55%, transparent)', opacity: progress(frame, SWIRL, 14) * (1 - rush) }} />
          <Reveal text="Coding agents got good." at={SWIRL + 6} out={SWIRL + 52} style={{ position: 'absolute', left: 0, right: 0, font: `400 132px/1.05 ${SERIF}`, letterSpacing: '-0.015em', color: C.fg }} />
          <Reveal
            text="Keeping track of them *didn't.*"
            at={SWIRL + 62}
            out={DROP - 16}
            stagger={4}
            style={{ position: 'absolute', left: 0, right: 0, font: `400 132px/1.05 ${SERIF}`, letterSpacing: '-0.015em', color: C.fg }}
            accent={ACCENT_IN_SERIF}
          />
        </AbsoluteFill>
      )}

      {/* the singularity: a hot core just before the drop */}
      {!born && rush > 0 && <div style={{ position: 'absolute', left: 960, top: 540, width: 600, height: 600, transform: `translate(-50%, -50%) scale(${0.2 + rush})`, background: `radial-gradient(closest-side, #ffffff, ${C.green}aa 25%, ${C.blue}55 50%, transparent)`, opacity: rush, filter: 'blur(6px)' }} />}

      {born && <Birth frame={frame - DROP} />}
    </AbsoluteFill>
  )
}

/** The drop: a flash and a shockwave, then the mark draws itself and the name slides out of it. */
function Birth({ frame }: { frame: number }) {
  const mark = pop(frame, 0, 9)
  const draw = progress(frame, 0, 20)
  const name = progress(frame, 12, 24)
  const push = 1 + 0.035 * progress(frame, 0, 2 * BAR)
  const ring = progress(frame, 0, 32)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: UI }}>
      <div style={{ position: 'absolute', left: 960, top: 540, width: 2800 * ring, height: 2800 * ring, transform: 'translate(-50%, -50%)', borderRadius: '50%', border: `2px solid #ffffffcc`, boxShadow: `0 0 80px ${C.green}, inset 0 0 120px ${C.blue}88`, opacity: 1 - ring }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', transform: `scale(${push})` }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ transform: `scale(${mark})`, filter: `drop-shadow(0 0 ${40 * (1 - draw * 0.6)}px ${C.green}88)` }}>
            <Logo size={180} draw={draw} />
          </div>
          <div style={{ maxWidth: 720 * name, overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <div style={{ paddingLeft: 36, font: `700 156px/1.15 ${UI}`, letterSpacing: '-0.05em', transform: `translateX(${(1 - name) * -60}px)`, opacity: name }}>
              <span style={{ background: BRAND, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', paddingRight: 8 }}>{site.name}</span>
            </div>
          </div>
        </div>
        <Reveal text={site.tagline} at={DROP + 40} stagger={2} style={{ marginTop: 34, font: `italic 400 54px/1.2 ${SERIF}`, color: '#a8a8a8' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 50%, #ffffff, ${C.green}66 30%, transparent 70%)`, opacity: interpolate(frame, [0, 2, 16], [0.95, 0.8, 0], { extrapolateRight: 'clamp' }), pointerEvents: 'none' }} />
    </AbsoluteFill>
  )
}
