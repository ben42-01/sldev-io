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
  elev: '#0f0f0f',
  panel: '#0c0c0c',
  hover: '#ffffff0d',
  border: '#1f1f1f',
  borderStrong: '#333333',
  fg: '#ededed',
  muted: '#8f8f8f',
  subtle: '#5a5a5a',
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

const ease = Easing.bezier(0.2, 0.7, 0.2, 1)

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
