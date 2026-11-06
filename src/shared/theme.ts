import type { ThemePref } from './types'

export type ResolvedTheme = 'dark' | 'light'

/** What a theme setting means right now; `system` follows the OS (`systemDark`). Unknown values are dark, the default. */
export function resolveTheme(pref: ThemePref | undefined | null, systemDark: boolean): ResolvedTheme {
  if (pref === 'light') return 'light'
  if (pref === 'system') return systemDark ? 'dark' : 'light'
  return 'dark'
}

/** The native window around the page: its background (shown before the page paints) and the title-bar overlay buttons. */
export const WINDOW_COLORS: Record<ResolvedTheme, { background: string; symbol: string }> = {
  // the same greys as --background in app.css for each theme
  dark: { background: '#0a0a0a', symbol: '#9a9a9a' },
  light: { background: '#fcfcfc', symbol: '#4a4a4a' }
}

/** Settings → Appearance → Interface size. */
export const UI_ZOOMS: Array<{ value: number; label: string }> = [
  { value: 0.9, label: 'Compact (90%)' },
  { value: 1, label: 'Default (100%)' },
  { value: 1.1, label: 'Large (110%)' },
  { value: 1.25, label: 'Larger (125%)' }
]

/** A stored zoom made safe to apply: unknown or broken values are 1, the rest stay within the offered range. */
export function clampZoom(z: unknown): number {
  return typeof z === 'number' && Number.isFinite(z) ? Math.min(1.25, Math.max(0.9, z)) : 1
}

/** The title bar is 36 CSS px; the native overlay buttons are sized in window px, so they scale with the zoom. */
export const titleBarHeight = (zoom: number): number => Math.round(36 * clampZoom(zoom))

/** The command-line switch main passes to the window, so the first paint already has the right theme. */
export const THEME_ARG = '--sldev-theme='

export function themeFromArgv(argv: readonly string[]): ResolvedTheme {
  const arg = argv.find((a) => a.startsWith(THEME_ARG))
  return arg?.slice(THEME_ARG.length) === 'light' ? 'light' : 'dark'
}
