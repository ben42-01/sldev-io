import type { CSSProperties } from 'react'
import { Easing, interpolate, spring } from 'remotion'

// Everything is timed in bars of a 120 BPM track, so cuts land on the beat of the music.
// Pick a track near 120 BPM; for another tempo change BPM and every scene follows.
export const FPS = 30
export const BPM = 120
export const BEAT = (60 / BPM) * FPS
export const BAR = BEAT * 4
export const bars = (n: number): number => Math.round(n * BAR)
export const beats = (n: number): number => Math.round(n * BEAT)

// the website's tokens (website/src/styles.css)
export const C = {
  bg: '#0a0a0a',
  // surfaces a step lighter than the website's, so the UI reads on video (and on a phone)
  elev: '#151515',
  panel: '#0f0f0f',
  hover: '#ffffff0d',
  border: '#262626',
  borderStrong: '#3b3b3b',
  fg: '#ededed',
  muted: '#9c9c9c',
  subtle: '#666666',
  blue: '#4d8dff',
  green: '#2ee6a8',
  purple: '#a970ff',
  amber: '#f5a524',
  red: '#ff5c6c'
}
export const BRAND = `linear-gradient(90deg, ${C.blue}, ${C.green}, ${C.purple})`
export const BRAND_D = `linear-gradient(135deg, ${C.blue}, ${C.green}, ${C.purple})`
export const UI = "Inter, -apple-system, 'Segoe UI', Ubuntu, sans-serif"
export const MONO = "'JetBrains Mono', Menlo, Consolas, monospace"
/**
 * The thin face for the story beats (intro captions, the turn, the tagline). Anything in the brand
 * gradient stays Inter bold, like the wordmark: thin story, bold brand.
 */
export const STORY_FONTS = {
  roboto: { family: "Roboto, 'Helvetica Neue', Arial, sans-serif", weight: 100, small: 300, scale: 1, spacing: '-0.02em' },
  mono: { family: "'JetBrains Mono', Menlo, Consolas, monospace", weight: 200, small: 300, scale: 0.88, spacing: '-0.04em' }
} as const
export const STORY = STORY_FONTS.roboto
/** a CSS font shorthand in the story face; below 72px it takes a heavier cut, or a hairline disappears */
export const story = (size: number, lh = 1.1): string => `${size < 72 ? STORY.small : STORY.weight} ${Math.round(size * STORY.scale)}px/${lh} ${STORY.family}`

export const ease = Easing.bezier(0.2, 0.7, 0.2, 1)

/** 0 → 1 between frame `from` and `from + dur`, eased */
export function progress(frame: number, from: number, dur = 12): number {
  return interpolate(frame, [from, from + dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
}

/** fade and rise in at `from` (and out at `out`, if given) */
export function enter(frame: number, from: number, { dur = 12, rise = 24, out, outDur = 8 }: { dur?: number; rise?: number; out?: number; outDur?: number } = {}): CSSProperties {
  const p = progress(frame, from, dur)
  const o = out === undefined ? 1 : 1 - progress(frame, out, outDur)
  return { opacity: p * o, transform: `translateY(${(1 - p) * rise}px)` }
}

/** a springy 0 → 1 that starts at `from` */
export function pop(frame: number, from: number, damping = 14): number {
  return spring({ frame: frame - from, fps: FPS, config: { damping, mass: 0.6, stiffness: 180 } })
}

/** the first characters of `text`, typed from `from` at `cps` characters a second */
export function typed(text: string, frame: number, from: number, cps = 32): string {
  return text.slice(0, Math.max(0, Math.floor(((frame - from) / FPS) * cps)))
}

/** a quick pulse on every beat after `from`: 1 on the beat, decaying to 0 */
export function onBeat(frame: number, from = 0): number {
  if (frame < from) return 0
  const t = ((frame - from) % BEAT) / BEAT
  return Math.max(0, 1 - t * 3)
}

/** deterministic noise for layout and jitter: the same input gives the same frame on every render */
export function rand(seed: number): number {
  let t = (seed * 0x6d2b79f5 + 0x9e3779b9) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
