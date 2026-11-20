import { Bot, Factory, FolderTree, LayoutGrid, Play, Search, Server } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, C, MONO, UI, enter, onBeat, pop, progress } from './lib'

/** The sldev-io mark (website/src/components/Logo.tsx); `draw` 0 → 1 traces its strokes. */
export function Logo({ size = 22, draw = 1 }: { size?: number; draw?: number }) {
  const dash = (len: number): CSSProperties => ({ strokeDasharray: len, strokeDashoffset: len * (1 - draw) })
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="logo-g" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={C.blue} />
          <stop offset="0.5" stopColor={C.green} />
          <stop offset="1" stopColor={C.purple} />
        </linearGradient>
      </defs>
      <g stroke="url(#logo-g)" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter">
        <path d="M4 4H16.5L20 7.5V20H4Z" style={dash(60)} />
        <path d="M8 9L11 12L8 15" style={dash(9)} />
        <path d="M13 15.5H16.5" style={dash(4)} />
      </g>
    </svg>
  )
}

export function Brand({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={{ background: BRAND, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', ...style }}>{children}</span>
}

/** The website hero's grid and glow behind every scene. */
export function Backdrop({ glow = 1 }: { glow?: number }) {
  const frame = useCurrentFrame()
  const drift = interpolate(frame, [0, 3000], [0, 60])
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${C.border} 1px, transparent 1px), linear-gradient(90deg, ${C.border} 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
          backgroundPosition: `0 ${drift}px`,
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 30%, #000 15%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 30%, #000 15%, transparent 75%)',
          opacity: 0.7
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: -260,
          width: 1400,
          height: 700,
          transform: 'translateX(-50%)',
          background: `radial-gradient(closest-side, ${C.blue}33, ${C.green}1f 50%, transparent)`,
          filter: 'blur(40px)',
          opacity: glow * (0.8 + 0.3 * onBeat(frame))
        }}
      />
      {/* a second, purple light low on the right, so the frame isn't lit from one side only */}
      <div style={{ position: 'absolute', right: -300, bottom: -360, width: 1100, height: 700, background: `radial-gradient(closest-side, ${C.purple}26, transparent)`, filter: 'blur(50px)', opacity: glow, transform: `translateX(${Math.sin(frame / 90) * 60}px)` }} />
    </AbsoluteFill>
  )
}

/** coloured words are set like the wordmark (the website's .brand-text): Inter, bold, tight, upright */
export const WORDMARK: CSSProperties = { fontFamily: UI, fontStyle: 'normal', fontWeight: 700, letterSpacing: '-0.04em' }

/** the accent for *starred* words: the wordmark's type in the brand gradient */
export const ACCENT: CSSProperties = { ...WORDMARK, background: BRAND, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }

/** the same inside a thin story line: a touch smaller, so the bold weight doesn't shout */
export const ACCENT_IN_STORY: CSSProperties = { ...ACCENT, fontSize: '0.94em' }

/** A big headline line, centred above the content. A string resolves word by word, *starred* words in the accent. */
export function Headline({ children, at, out, top = 70, size = 64 }: { children: ReactNode; at: number; out?: number; top?: number; size?: number }) {
  const frame = useCurrentFrame()
  const box: CSSProperties = { position: 'absolute', left: 0, right: 0, top, zIndex: 30, textAlign: 'center', font: `600 ${size}px/1.15 ${UI}`, letterSpacing: '-0.035em', color: C.fg }
  if (typeof children === 'string') return <Reveal text={children} at={at} out={out} stagger={2} accent={ACCENT} style={{ ...box, alignItems: 'baseline' }} />
  return <div style={{ ...box, ...enter(frame, at, { out }) }}>{children}</div>
}

const ACTIVITY = [Bot, FolderTree, Play, Factory, Server, LayoutGrid]

/** The app's window: title bar with the mark and search, the activity bar, then whatever's inside. */
export function Window({ children, width = 1560, height = 800, active = 0, title = 'acme-shop', style }: { children: ReactNode; width?: number; height?: number; active?: number; title?: string; style?: CSSProperties }) {
  return (
    <div
      style={{
        width,
        height,
        position: 'relative',
        background: C.panel,
        border: `1px solid ${C.borderStrong}`,
        boxShadow: `0 40px 120px #000c, 0 0 0 1px #ffffff08, 0 0 80px ${C.blue}14`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: UI,
        color: C.fg,
        ...style
      }}
    >
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 2, background: BRAND }} />
      <div style={{ height: 46, display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', borderBottom: `1px solid ${C.border}`, background: C.elev }}>
        <Logo size={20} />
        <span style={{ fontWeight: 600, fontSize: 15 }}>sldev-io</span>
        <div style={{ marginLeft: 120, width: 420, height: 28, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', color: C.subtle, fontSize: 13 }}>
          <Search size={14} strokeWidth={1.5} /> {title}
          <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 11 }}>Ctrl+Shift+P</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 11, height: 11, borderRadius: 99, background: C.borderStrong }} />
          ))}
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ width: 56, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, paddingTop: 10 }}>
          {ACTIVITY.map((Icon, i) => (
            <div key={i} style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', color: i === active ? C.fg : C.subtle, background: i === active ? C.hover : 'transparent', boxShadow: i === active ? `inset 2px 0 0 ${C.blue}` : 'none' }}>
              <Icon size={20} strokeWidth={1.5} />
            </div>
          ))}
        </div>
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>{children}</div>
      </div>
    </div>
  )
}

export type State = 'working' | 'needs' | 'ready' | 'shipped' | 'failed' | 'limit'
export const TONE: Record<State, string> = { working: C.blue, needs: C.amber, ready: C.green, shipped: C.purple, failed: C.red, limit: C.amber }
const LABEL: Record<State, string> = { working: 'Working', needs: 'Needs you', ready: 'Ready for you', shipped: 'PR open', failed: 'Failed', limit: 'Usage limit' }

export function Pill({ state, size = 13 }: { state: State; size?: number }) {
  const frame = useCurrentFrame()
  const live = state === 'working' || state === 'needs'
  const halo = live ? (frame % 45) / 45 : 0
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '3px 9px', border: `1px solid ${TONE[state]}55`, color: TONE[state], fontSize: size, fontWeight: 600, background: `${TONE[state]}12` }}>
      <span style={{ position: 'relative', width: 7, height: 7 }}>
        <span style={{ position: 'absolute', inset: 0, borderRadius: 99, background: TONE[state] }} />
        {live && <span style={{ position: 'absolute', inset: 0, borderRadius: 99, background: TONE[state], opacity: 1 - halo, transform: `scale(${1 + halo * 1.8})` }} />}
      </span>
      {LABEL[state]}
    </span>
  )
}

/** A pointer that glides to (x, y) by frame `at`, then clicks (a ring) at `click`. */
export function Pointer({ path, click = [] }: { path: Array<[number, number, number]>; click?: number[] }) {
  const frame = useCurrentFrame()
  let x = path[0][1]
  let y = path[0][2]
  for (let i = 1; i < path.length; i++) {
    const p = progress(frame, path[i - 1][0], Math.max(1, path[i][0] - path[i - 1][0]))
    if (frame >= path[i - 1][0]) {
      x = interpolate(p, [0, 1], [path[i - 1][1], path[i][1]])
      y = interpolate(p, [0, 1], [path[i - 1][2], path[i][2]])
    }
  }
  const ring = click.map((c) => frame - c).find((d) => d >= 0 && d < 14)
  return (
    <div style={{ position: 'absolute', left: x, top: y, zIndex: 50, pointerEvents: 'none' }}>
      {ring !== undefined && (
        <div style={{ position: 'absolute', left: -18, top: -18, width: 36, height: 36, borderRadius: 99, border: '2px solid #fff', opacity: 1 - ring / 14, transform: `scale(${0.4 + ring / 10})` }} />
      )}
      <svg width="28" height="28" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 3px 6px #000a)', transform: ring !== undefined && ring < 5 ? 'scale(0.9)' : undefined }}>
        <path d="M4 2 L4 20 L9 15.5 L12.5 22 L15.5 20.5 L12 14 L19 14 Z" fill="#fff" stroke="#111" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/** A notification sliding in from the right edge of its container. */
export function Toast({ at, out, tone, icon, title, text }: { at: number; out?: number; tone: string; icon: ReactNode; title: string; text: string }) {
  const frame = useCurrentFrame()
  const p = pop(frame, at)
  const o = out === undefined ? 1 : 1 - progress(frame, out, 8)
  if (frame < at) return null
  return (
    <div
      style={{
        position: 'absolute',
        right: 24,
        bottom: 24,
        width: 400,
        padding: '14px 16px',
        display: 'flex',
        gap: 12,
        background: C.elev,
        border: `1px solid ${C.borderStrong}`,
        borderLeft: `3px solid ${tone}`,
        boxShadow: '0 20px 60px #000a',
        transform: `translateX(${(1 - p) * 460}px)`,
        opacity: o,
        zIndex: 40
      }}
    >
      <div style={{ color: tone, paddingTop: 2 }}>{icon}</div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 16 }}>{title}</div>
        <div style={{ color: C.muted, fontSize: 14, marginTop: 2 }}>{text}</div>
      </div>
    </div>
  )
}

export function Button({ children, primary, glow = 0, style }: { children: ReactNode; primary?: boolean; glow?: number; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        fontSize: 14,
        fontWeight: 600,
        border: `1px solid ${primary ? '#d4d4d4' : C.borderStrong}`,
        background: primary ? '#e5e5e5' : C.elev,
        color: primary ? '#0a0a0a' : C.fg,
        boxShadow: glow ? `0 0 0 ${3 * glow}px ${C.blue}55` : 'none',
        ...style
      }}
    >
      {children}
    </span>
  )
}

/**
 * A line that resolves word by word: each word rises out of a blur. Words wrapped in *stars* get
 * `accent`, e.g. "Keeping track of them *didn't.*".
 */
export function Reveal({ text, at, out, stagger = 3, accent, style }: { text: string; at: number; out?: number; stagger?: number; accent?: CSSProperties; style?: CSSProperties }) {
  const frame = useCurrentFrame()
  const gone = out === undefined ? 0 : progress(frame, out, 10)
  // "*a PR out.*" accents all three words
  let inside = false
  const words = text.split(' ').map((w) => {
    const em = inside || w.startsWith('*')
    inside = em && !w.endsWith('*')
    return { word: w.replace(/\*/g, ''), em }
  })
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '0.24em', ...style }}>
      {words.map(({ word, em }, i) => {
        const p = progress(frame, at + i * stagger, 16)
        const blur = 14 * (1 - p) + 10 * gone
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              opacity: p * (1 - gone),
              filter: blur > 0.2 ? `blur(${blur}px)` : undefined,
              transform: `translateY(${(1 - p) * 0.35 - gone * 0.15}em)`,
              // keep the glyphs' overhang inside the clip of a gradient fill
              padding: em ? '0 0.08em' : undefined,
              margin: em ? '0 -0.08em' : undefined,
              ...(em ? accent : null)
            }}
          >
            {word}
          </span>
        )
      })}
    </div>
  )
}

/** Fine film grain and a soft vignette over everything, so flat fills don't look like a screenshot. */
export function Grain() {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 200 }}>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse 80% 75% at 50% 50%, transparent 60%, #0008 100%)' }} />
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.07, mixBlendMode: 'overlay' }}>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={frame % 12} stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.4 0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------- camera, chapters, moving cards

export interface Shot {
  /** offset of the stage in px */
  x?: number
  y?: number
  /** zoom */
  z?: number
  /** tilt in degrees */
  rx?: number
  ry?: number
}

/** a shot that puts stage point (px, py) in the centre of the frame at zoom z */
export function focus(px: number, py: number, z: number, tilt: Pick<Shot, 'rx' | 'ry'> = {}): Shot {
  return { x: -z * (px - 960), y: -z * (py - 540), z, ...tilt }
}

const lerpShot = (a: Shot, b: Shot, p: number): Required<Shot> => {
  const f = (k: keyof Shot, d: number): number => (a[k] ?? d) + ((b[k] ?? d) - (a[k] ?? d)) * p
  return { x: f('x', 0), y: f('y', 0), z: f('z', 1), rx: f('rx', 0), ry: f('ry', 0) }
}

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/**
 * A camera over the stage: keyframes [frame, shot], eased in and out between them, in perspective,
 * with a slow handheld drift so no shot is ever quite still.
 */
export function Camera({ keys, children }: { keys: Array<[number, Shot]>; children: ReactNode }) {
  const frame = useCurrentFrame()
  let s = lerpShot(keys[0][1], keys[0][1], 0)
  for (let i = 1; i < keys.length; i++) {
    const [f0, a] = keys[i - 1]
    const [f1, b] = keys[i]
    if (frame >= f0) s = lerpShot(a, b, easeInOut(Math.min(1, Math.max(0, (frame - f0) / Math.max(1, f1 - f0)))))
  }
  const rx = s.rx + 0.5 * Math.sin(frame / 37)
  const ry = s.ry + 0.6 * Math.sin(frame / 53 + 1)
  return (
    <AbsoluteFill style={{ perspective: 2200, perspectiveOrigin: '50% 45%' }}>
      <AbsoluteFill style={{ transform: `translate(${s.x}px, ${s.y}px) scale(${s.z}) rotateX(${rx}deg) rotateY(${ry}deg)`, transformOrigin: '960px 540px' }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  )
}

/** fades the top of the frame to the background, so a zoomed window slides under the headline */
export function Scrim({ height = 230 }: { height?: number }) {
  return <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height, background: `linear-gradient(${C.bg} 30%, ${C.bg}d0 60%, transparent)`, zIndex: 20 }} />
}

/**
 * Cards that walk between columns. Each card has a timeline of [frame, column]; the position is the
 * first layout plus every later change, each sprung in from its own frame, so two changes close
 * together never jump.
 */
export function walk(timelines: Array<Array<[number, number]>>, frame: number, slot: (col: number, row: number) => [number, number]): Array<{ x: number; y: number; appear: number; col: number } | null> {
  const changes = [...new Set(timelines.flatMap((t) => t.map((e) => e[0])))].sort((a, b) => a - b)
  const layout = (f: number): Array<[number, number] | null> => {
    const rows: Record<number, number> = {}
    return timelines.map((t) => {
      let col = -1
      for (const [at, c] of t) if (f >= at) col = c
      if (col < 0) return null
      const row = rows[col] ?? 0
      rows[col] = row + 1
      return slot(col, row)
    })
  }
  const layouts = changes.map(layout)
  return timelines.map((t, i) => {
    if (frame < t[0][0]) return null
    let x = 0
    let y = 0
    let prev: [number, number] | null = null
    changes.forEach((c, k) => {
      const here = layouts[k][i]
      if (!here) return
      if (!prev) {
        x = here[0]
        y = here[1]
      } else {
        const p = pop(frame, c, 16)
        x += (here[0] - prev[0]) * p
        y += (here[1] - prev[1]) * p
      }
      prev = here
    })
    let col = -1
    for (const [at, c] of t) if (frame >= at) col = c
    return { x, y, appear: pop(frame, t[0][0]), col }
  })
}

/**
 * A chapter title that lands on the downbeat: the word slams in out of a flash, holds for a beat,
 * then the camera flies through it into the scene.
 */
export function Chapter({ n, of, word, dur }: { n: number; of: number; word: string; dur: number }) {
  const frame = useCurrentFrame()
  if (frame > dur) return null
  const slam = pop(frame, 0, 11)
  const through = progress(frame, dur - 14, 14)
  const veil = 1 - progress(frame, dur - 10, 10)
  const sweep = progress(frame, 0, 12)
  return (
    <AbsoluteFill style={{ zIndex: 150, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <AbsoluteFill style={{ background: C.bg, opacity: veil }} />
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 50%, #ffffff, ${C.green}55 30%, transparent 65%)`, opacity: interpolate(frame, [0, 2, 12], [0.7, 0.5, 0], { extrapolateRight: 'clamp' }) }} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', width: 1500 * sweep, height: 2, transform: 'translate(-50%, 120px)', background: BRAND, opacity: veil, boxShadow: `0 0 24px ${C.green}` }} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${(1.35 - 0.35 * slam) * (1 + 5 * through ** 2)})`, opacity: 1 - through, filter: through > 0.05 ? `blur(${through * 16}px)` : undefined }}>
        <div style={{ font: `500 30px ${MONO}`, color: C.muted, letterSpacing: '0.3em', opacity: slam }}>
          {String(n).padStart(2, '0')} <span style={{ color: C.subtle }}>/ {String(of).padStart(2, '0')}</span>
        </div>
        <div style={{ font: `700 300px/1 ${UI}`, letterSpacing: '-0.06em', padding: '0 0.06em 0.08em', background: BRAND, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: `drop-shadow(0 0 ${60 * (1 - slam) + 20}px ${C.green}40)` }}>
          {word}.
        </div>
      </div>
    </AbsoluteFill>
  )
}

/**
 * Lights one thing and dims the rest of its window: a cut-out with a soft edge and a label. Placed in
 * the window's content coordinates, so it moves with the camera.
 */
export function Spotlight({ x, y, w, h, at, out, label, tone = C.fg, side = 'top' }: { x: number; y: number; w: number; h: number; at: number; out?: number; label?: string; tone?: string; side?: 'top' | 'bottom' }) {
  const frame = useCurrentFrame()
  const p = progress(frame, at, 12) * (out === undefined ? 1 : 1 - progress(frame, out, 10))
  if (p <= 0) return null
  const grow = 1 + 0.04 * (1 - p)
  return (
    <>
      <div style={{ position: 'absolute', left: x - 8, top: y - 8, width: w + 16, height: h + 16, borderRadius: 10, boxShadow: `0 0 0 4000px rgba(0, 0, 0, ${0.58 * p}), 0 0 60px rgba(0, 0, 0, ${0.5 * p}) inset`, border: `1px solid ${tone}`, opacity: p, transform: `scale(${grow})`, zIndex: 35, pointerEvents: 'none' }} />
      {label && (
        <div style={{ position: 'absolute', left: x - 8, top: side === 'top' ? y - 52 : y + h + 18, zIndex: 36, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 99, background: '#0a0a0aee', border: `1px solid ${tone}88`, color: C.fg, fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', opacity: p, transform: `translateY(${(1 - p) * 8}px)` }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: tone, boxShadow: `0 0 10px ${tone}` }} />
          {label}
        </div>
      )}
    </>
  )
}

/** where you are in the story, top left, like a broadcast bug: "02 BUILD · MISSION CONTROL" */
export function SceneTag({ chapter, n, name }: { chapter: string; n: number; name: string }) {
  const frame = useCurrentFrame()
  const p = progress(frame, 0, 14)
  return (
    <div style={{ position: 'absolute', left: 56, top: 40, zIndex: 120, display: 'flex', alignItems: 'center', gap: 12, font: `500 15px ${MONO}`, letterSpacing: '0.16em', color: C.muted, opacity: p, transform: `translateX(${(1 - p) * -16}px)` }}>
      <span style={{ width: 18, height: 2, background: BRAND }} />
      <span style={{ color: C.fg }}>{String(n).padStart(2, '0')}</span>
      <span>{chapter.toUpperCase()}</span>
      <span style={{ color: C.subtle }}>·</span>
      <span>{name.toUpperCase()}</span>
    </div>
  )
}
