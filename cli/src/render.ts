import type { IBufferCell } from '@xterm/headless'
import { missionSignal, type Tone } from '@shared/status'
import type { LoopInfo, PaneInfo } from './protocol'
import type { Term } from './screen'

/**
 * Drawing for the TUI: layout rectangles, the chrome (top tabs, the grouped sidebar, the hint bar, popups)
 * and a headless screen turned back into escape sequences. Everything here is pure, so it's unit-tested.
 *
 * The look is the app's dark mode (or its light one on a light terminal): sldev paints its own surfaces from the
 * app's grey ladder (panes on --background, the frame on --surface, popups and what's in focus on
 * --surface-raised), container edges carry the brand gradient (softened along long edges, full on popups and
 * what's in focus), plain rules stay a quiet grey, and colour otherwise means state only (the same tones as
 * the app). Nothing is drawn in reverse video; the tab or row in focus is lifted and bold with an accent bar.
 * SLDEV_THEME=terminal draws on the terminal's own background instead, and NO_COLOR takes every colour out.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Layout {
  /** the brand, top left above the sidebar (null without a sidebar) */
  brand: Rect | null
  sidebar: Rect | null
  /** the tab bar: the first row, right of the brand */
  tabs: Rect
  /** one rect per visible pane; each starts with its rule row (the line under the tabs) */
  panes: Rect[]
  status: Rect
}

export const SIDEBAR_W = 28
/** the sidebar is worth its 29 columns only when the pane keeps a usable 70-plus beside it */
export const SIDEBAR_MIN_COLS = 100

/** The sidebar goes away on narrow terminals; a split needs room for two usable panes. */
export function layout(cols: number, rows: number, split: boolean): Layout {
  cols = Math.max(1, cols)
  rows = Math.max(3, rows)
  const status: Rect = { x: 0, y: rows - 1, w: cols, h: 1 }
  const side = cols >= SIDEBAR_MIN_COLS
  const sidebar = side ? { x: 0, y: 2, w: SIDEBAR_W, h: Math.max(0, rows - 3) } : null
  const brand = side ? { x: 0, y: 0, w: SIDEBAR_W, h: 1 } : null
  const x = side ? SIDEBAR_W + 1 : 0
  const w = cols - x
  const tabs: Rect = { x, y: 0, w, h: 1 }
  const h = rows - 2
  if (split && w >= 60) {
    const left = Math.floor((w - 1) / 2)
    return { brand, sidebar, tabs, panes: [{ x, y: 1, w: left, h }, { x: x + left + 1, y: 1, w: w - left - 1, h }], status }
  }
  return { brand, sidebar, tabs, panes: [{ x, y: 1, w, h }], status }
}

// ── colours ────────────────────────────────────────────────────────────────────────────────────────────

export const TONE_SGR: Record<Tone, string> = { working: '32', attention: '33', error: '31', review: '34', done: '36', neutral: '90' }
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'

/**
 * How the TUI is coloured; set once from the environment and switched by tests:
 * - truecolor: 24-bit colour where the terminal says it has it, the nearest of the 256 otherwise
 * - paint: sldev paints its own surfaces (the app's dark or light ladder); SLDEV_THEME=terminal turns it off
 *   and draws on the terminal's own background, as before
 * - noColor: NO_COLOR (https://no-color.org): no colours at all, plain rules; bold and faint stay
 * - light: the terminal's background is light (its OSC 11 answer), so the light ladder is used
 */
const env = process.env
const mode = {
  truecolor: /truecolor|24bit/i.test(env.COLORTERM ?? ''),
  paint: env.SLDEV_THEME !== 'terminal' && !env.NO_COLOR,
  noColor: !!env.NO_COLOR,
  light: false
}

/** bumped on every theme change, so strings built once per size know they're stale */
export let themeGen = 0

/** the nearest xterm-256 colour: the grey ramp (or black, white) for greys, the 6×6×6 cube for the rest */
export function to256(r: number, g: number, b: number): number {
  if (Math.max(r, g, b) - Math.min(r, g, b) < 12) {
    const v = (r + g + b) / 3
    // the ramp runs 8…238 in steps of 10; past its ends, black (16) or white (231) is nearer
    if (v < 4) return 16
    if (v > 246.5) return 231
    return 232 + Math.max(0, Math.min(23, Math.round((v - 8) / 10)))
  }
  const c = (v: number): number => (v < 48 ? 0 : v < 115 ? 1 : Math.floor((v - 35) / 40))
  return 16 + 36 * c(r) + 6 * c(g) + c(b)
}

type RGB = [number, number, number]

/** the SGR parameters of a colour (no ESC [ … m), as the terminal can show it */
const rgbParams = (r: number, g: number, b: number, bg = false): string => (mode.truecolor ? `${bg ? 48 : 38};2;${r};${g};${b}` : `${bg ? 48 : 38};5;${to256(r, g, b)}`)

export const rgb = (r: number, g: number, b: number, bg = false): string => (mode.noColor ? '' : `\x1b[${rgbParams(r, g, b, bg)}m`)

/** the app's brand gradient (--brand-blue, --brand-green, --brand-purple in app.css) */
const STOPS: RGB[] = [
  [49, 156, 252],
  [0, 208, 151],
  [177, 103, 247]
]

/** the brand colour at `t` (0 blue, 0.5 green, 1 purple) */
export function brandAt(t: number): RGB {
  t = Math.max(0, Math.min(1, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(t))
  const f = t - i
  return STOPS[i].map((v, k) => Math.round(v + (STOPS[i + 1][k] - v) * f)) as RGB
}

const mix = (a: RGB, b: RGB, f: number): RGB => a.map((v, k) => Math.round(v + (b[k] - v) * f)) as RGB

/**
 * The app's grey ladder: sRGB of the OKLCH tokens in src/renderer/src/styles/app.css (`:root` for dark,
 * `:root[data-theme='light']` for light). oklch(L 0 0) is a grey of L³ linear light, gamma-encoded.
 * `rule` is --border-strong: a 1-px box glyph in --border all but vanishes on --surface.
 */
interface Ladder {
  background: RGB
  surface: RGB
  raised: RGB
  muted: RGB
  border: RGB
  rule: RGB
  fg: RGB
  fgMuted: RGB
  fgSubtle: RGB
}
const grey = (v: number): RGB => [v, v, v]
export const DARK: Ladder = { background: grey(10), surface: grey(17), raised: grey(25), muted: grey(32), border: grey(37), rule: grey(53), fg: grey(232), fgMuted: grey(146), fgSubtle: grey(99) }
export const LIGHT: Ladder = { background: grey(252), surface: grey(246), raised: grey(238), muted: grey(230), border: grey(219), rule: grey(190), fg: grey(27), fgMuted: grey(85), fgSubtle: grey(122) }
/** the tones of the terminal theme (SLDEV_THEME=terminal): lines only, on whatever the terminal has */
const TERMINAL_RULE: Record<'dark' | 'light', RGB> = { dark: [68, 68, 72], light: [200, 200, 205] }
/** a long edge's gradient is blended this far toward the rule tone, so the frame doesn't shout */
const SOFT = 0.45

/** the ladder in use (dark or light); the terminal theme still uses its text tones for nothing */
export let ladder: Ladder = DARK

/** the accent: the bar beside the row in focus, key names; the brand's blue */
export let ACCENT = ''
/** lines and borders: quieter than text */
export let RULE = ''
/** quiet text: details, counts, what a key does */
export let DIM = ''
/** the quietest text: the version */
export let SUBTLE = ''
/**
 * Fills, each a background with the ladder's text colour (so text stays readable even on a terminal whose
 * own colours we guessed wrong); '' in the terminal theme. Pane = --background, the frame (sidebar, tab bar,
 * rule row, status bar) = --surface, popups and what's in focus = --surface-raised, key chips = --muted.
 */
export let PANE = ''
export let SURFACE = ''
export let RAISED = ''
export let MUTED = ''
/** what's in focus (the tab in front, the sidebar row): the raised tone, nothing in the terminal theme */
export let LIFT = ''
/** the parameters for a pane's default colours (`;`-led, appended to a cell's SGR), '' when not painted */
let PANE_FG = ''
let PANE_BG = ''
/** the selection's colour: a background, so the text keeps its own colours */
let SELECTED_BG = ''

function applyTheme(): void {
  themeGen++
  const light = mode.light
  ladder = light ? LIGHT : DARK
  const paint = mode.paint && !mode.noColor
  const fill = (c: RGB): string => (paint ? rgb(...c, true) + rgb(...ladder.fg) : '')
  ACCENT = rgb(...STOPS[0])
  RULE = rgb(...(paint ? ladder.rule : TERMINAL_RULE[light ? 'light' : 'dark']))
  DIM = mode.noColor ? '' : paint ? rgb(...ladder.fgMuted) : '\x1b[90m'
  SUBTLE = mode.noColor ? '' : paint ? rgb(...ladder.fgSubtle) : '\x1b[90m'
  PANE = fill(ladder.background)
  SURFACE = fill(ladder.surface)
  RAISED = paint ? fill(ladder.raised) : mode.noColor ? '' : rgb(...(light ? [244, 244, 247] as RGB : [30, 30, 34] as RGB), true)
  MUTED = fill(ladder.muted)
  LIFT = fill(ladder.raised)
  PANE_FG = paint ? ';' + rgbParams(...ladder.fg) : ''
  PANE_BG = paint ? ';' + rgbParams(...ladder.background, true) : ''
  SELECTED_BG = mode.noColor ? ';7' : light ? (mode.truecolor ? ';48;2;190;215;250' : ';48;5;153') : mode.truecolor ? ';48;2;38;79;120' : ';48;5;24'
  edgeCache.clear()
}

/** The terminal's background is light: the light ladder (or, in the terminal theme, lines and popups that sit on it). */
export function setLight(light: boolean): void {
  if (light === mode.light) return
  mode.light = light
  applyTheme()
}

/** For tests (and nothing else): switch truecolor, painting or NO_COLOR, and get the mode back. */
export function setColorMode(over: Partial<typeof mode>): typeof mode {
  const before = { ...mode }
  Object.assign(mode, over)
  applyTheme()
  return before
}

/** Does sldev paint its own surfaces? (not with SLDEV_THEME=terminal or NO_COLOR) */
export const painted = (): boolean => mode.paint && !mode.noColor

/** Keeps a fill through the resets inside a styled line: every reset sets the fill again. */
export function onFill(fill: string, s: string): string {
  return fill ? fill + s.split(RESET).join(RESET + fill) + RESET : s
}

/** Takes the colours out of a string's SGR sequences (bold, faint and the rest stay), for NO_COLOR. */
export function stripColor(s: string): string {
  if (!mode.noColor) return s
  return s.replace(/\x1b\[([0-9;]*)m/g, (all, p: string) => {
    if (!p) return all
    const n = p.split(';')
    const keep: string[] = []
    for (let i = 0; i < n.length; i++) {
      const v = Number(n[i])
      if (v === 38 || v === 48 || v === 58) i += n[i + 1] === '5' ? 2 : n[i + 1] === '2' ? 4 : 0
      else if (!((v >= 30 && v <= 49) || (v >= 90 && v <= 107))) keep.push(n[i])
    }
    return keep.length ? `\x1b[${keep.join(';')}m` : ''
  })
}

/** `text` with the brand gradient running across it, from `t0` to `t1` of the way along */
export function gradient(text: string, t0 = 0, t1 = 1, bold = false): string {
  const chars = [...text]
  return chars.map((ch, i) => (bold ? BOLD : '') + rgb(...brandAt(t0 + ((t1 - t0) * i) / Math.max(1, chars.length - 1))) + ch).join('') + RESET
}

/**
 * The colour of an edge at `t` of the way along: the brand gradient, `soft` blended toward the rule tone
 * (a long container edge), or the plain rule where sldev doesn't paint (the terminal theme, NO_COLOR).
 */
export function edgeColor(t: number, soft = SOFT): string {
  if (!painted()) return RULE
  return rgb(...mix(brandAt(t), ladder.rule, soft))
}

const edgeCache = new Map<string, string>()

/**
 * A vertical container edge: `glyph` (│) from row `y` down `h` rows in column `x`, the brand running top to
 * bottom, softened, on `fill`; `top` replaces the first glyph (the ┬ where it meets a rule). Built once per
 * size and theme: the chrome is redrawn on every spinner frame.
 */
export function vEdge(x: number, y: number, h: number, top = '│', fill = SURFACE, topFill = fill): string {
  const key = `${x}:${y}:${h}:${top}:${fill}:${topFill}`
  let s = edgeCache.get(key)
  if (s === undefined) {
    s = ''
    for (let i = 0; i < h; i++) s += at(x, y + i) + (i === 0 ? topFill : fill) + edgeColor(i / Math.max(1, h - 1)) + (i === 0 ? top : '│') + RESET
    edgeCache.set(key, s)
  }
  return s
}

applyTheme()

/** Is an OSC 11 answer (`rgb:RRRR/GGGG/BBBB`) a light background? */
export function isLightBackground(answer: string): boolean | null {
  const m = /rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i.exec(answer)
  if (!m) return null
  const [r, g, b] = m.slice(1, 4).map((h) => parseInt(h, 16) / (16 ** h.length - 1))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5
}

/** "sldev" in the brand gradient */
export function brandMark(): string {
  return gradient('sldev', 0, 1, true)
}

/** the welcome screen's logo: block letters with the gradient across them */
const LOGO = ['█▀▀ █   █▀▄ █▀▀ █ █', '▀▀█ █   █ █ █▀▀ ▐ ▌', '▀▀▀ ▀▀▀ ▀▀  ▀▀▀  ▀ ']
export function logo(): string[] {
  return LOGO.map((row) => gradient(row))
}

// ── status ─────────────────────────────────────────────────────────────────────────────────────────────

/** A pane's state: an agent's mission status, or neutral for a shell tab (it has no status of its own). */
export function paneSignal(p: Pick<PaneInfo, 'status' | 'shell' | 'pid'>): { tone: Tone; label: string; pulse: boolean } {
  if (p.shell) return { tone: 'neutral', label: p.pid === undefined ? 'Exited' : 'Shell', pulse: false }
  return missionSignal(p.status)
}

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** The one-column marker for a pane: a spinner while it works, a dot when it waits, ✓/✕ when it's over. */
export function glyph(p: Pick<PaneInfo, 'status' | 'shell' | 'pid'>, frame = 0): string {
  const s = paneSignal(p)
  if (p.shell) return p.pid === undefined ? '·' : '›'
  if (s.tone === 'working') return s.pulse ? SPINNER[frame % SPINNER.length] : '●'
  if (s.tone === 'error') return '✕'
  if (s.tone === 'done') return '✓'
  if (s.tone === 'neutral') return '○'
  return '●'
}

/** spinner frames per breath of a marker that needs you: bright, then soft (a slow pulse, never a blink) */
const BREATH = 16

/** a pane's marker in its colour; one that needs you is bold and breathes, so it stands out from across the screen */
export function marker(p: Pick<PaneInfo, 'status' | 'shell' | 'pid'>, frame = 0): string {
  const s = paneSignal(p)
  const soft = s.tone === 'attention' && frame % BREATH >= BREATH / 2
  return `\x1b[${soft ? '2;' : s.tone === 'attention' || s.tone === 'error' ? '1;' : ''}${TONE_SGR[s.tone]}m${glyph(p, frame)}${RESET}`
}

/** which tone wins when a group of panes is summed up: what needs the human first */
const URGENCY: Tone[] = ['attention', 'error', 'working', 'review', 'done', 'neutral']

export function rollup(panes: Array<Pick<PaneInfo, 'status' | 'shell' | 'pid'>>): Tone {
  const tones = panes.map((p) => paneSignal(p).tone)
  return URGENCY.find((t) => tones.includes(t)) ?? 'neutral'
}

// ── tabs ───────────────────────────────────────────────────────────────────────────────────────────────

export interface Tab {
  title: string
  tone: Tone
  /** the marker: a glyph from glyph() */
  glyph?: string
  /** the tab in focus */
  active: boolean
  /** shown in the split beside the active one */
  shown?: boolean
}

const TAB_TITLE_MAX = 22

/** The plain text of tab `i` (1-based number, its title cut to `max` columns); the marker is its second character. */
function tabText(t: Tab, i: number, max: number): string {
  const title = width(t.title) > max ? fit(t.title, Math.max(1, max - 1)).trimEnd() + '…' : t.title
  return ` ${t.glyph ?? '●'} ${i + 1} ${title} `
}

/**
 * Which tabs fit in `w` columns, the active one always among them: [start, end). Tabs scroll so the active
 * one is in view; `‹` and `›` take a column each when tabs are hidden on that side.
 */
export function tabWindow(widths: number[], active: number, w: number): { start: number; end: number } {
  const total = widths.reduce((a, b) => a + b, 0)
  if (total <= w) return { start: 0, end: widths.length }
  const avail = w - 2
  active = Math.max(0, Math.min(active, widths.length - 1))
  let start = active
  let end = active + 1
  let used = widths[active]
  // the tabs after the active one first, so moving right shows what comes next; then the ones before it
  while (end < widths.length && used + widths[end] <= avail) used += widths[end++]
  while (start > 0 && used + widths[start - 1] <= avail) used += widths[--start]
  return { start, end }
}

/** where a tab sits on the bar, for mouse clicks: columns [from, to) relative to the bar */
export interface TabSpan {
  index: number
  from: number
  to: number
}

export interface TabBar {
  text: string
  spans: TabSpan[]
  /** the "+ new tab" button, if it fit */
  plus: { from: number; to: number } | null
}

const PLUS = ' + '

/**
 * The tab bar, exactly `w` columns: `⠹ 1 fix the parser   ● 2 review   › 3 zsh   +`. Each marker keeps its
 * colour, so a background tab that needs you stands out; the active tab is bold, the rest grey.
 */
export function tabBarLayout(tabs: Tab[], w: number): TabBar {
  if (w <= 0) return { text: '', spans: [], plus: null }
  const plusW = w >= 12 ? PLUS.length : 0
  if (!tabs.length) {
    const lead = DIM + fit(' no tabs', w - plusW) + RESET
    return { text: onFill(SURFACE, lead + (plusW ? `${ACCENT}${PLUS}${RESET}` : '')), spans: [], plus: plusW ? { from: w - plusW, to: w } : null }
  }
  const room = w - plusW
  const max = Math.max(4, Math.min(TAB_TITLE_MAX, room - 10))
  const texts = tabs.map((t, i) => tabText(t, i, max))
  const active = Math.max(0, tabs.findIndex((t) => t.active))
  const { start, end } = tabWindow(texts.map(width), active, room)
  const clipped = start > 0 || end < tabs.length
  const spans: TabSpan[] = []
  let out = clipped ? DIM + (start > 0 ? '‹' : ' ') + RESET : ''
  let used = clipped ? 1 : 0
  // the columns between the arrows
  const inner = room - (clipped ? 2 : 0)
  for (let i = start; i < end; i++) {
    const t = tabs[i]
    // a lone tab wider than the bar (a very narrow terminal) is cut to fit
    const text = fit(texts[i], Math.min(width(texts[i]), inner - (used - (clipped ? 1 : 0))))
    if (!text.trim()) break
    const style = t.active ? BOLD : t.shown ? '' : DIM
    const color = `\x1b[${t.tone === 'attention' || t.tone === 'error' ? '1;' : ''}${TONE_SGR[t.tone]}m`
    const tabText = style + text[0] + RESET + color + text.slice(1, 2) + RESET + style + text.slice(2) + RESET
    // the tab in front is lifted onto the raised tone, like the app's active tab
    out += t.active ? onFill(LIFT, tabText) : tabText
    spans.push({ index: i, from: used, to: used + width(text) })
    used += width(text)
  }
  out += ' '.repeat(Math.max(0, room - used - (clipped ? 1 : 0)))
  if (clipped) out += DIM + (end < tabs.length ? '›' : ' ') + RESET
  if (plusW) out += `${DIM}${PLUS}${RESET}`
  return { text: onFill(SURFACE, out), spans, plus: plusW ? { from: room, to: w } : null }
}

export function tabBar(tabs: Tab[], w: number): string {
  return tabBarLayout(tabs, w).text
}

/**
 * The rule under the tab bar, `w` columns: a thin line, heavy and in the accent under the active tab, and
 * on its right the focused pane's details (agent, branch, diff stat), so the tab itself stays short.
 */
export function ruleLine(w: number, under: { from: number; to: number } | null, info = ''): string {
  if (w <= 0) return ''
  const label = info ? fit(` ${info} `, Math.min(width(info) + 2, Math.max(0, w - 8))) : ''
  const lw = width(label)
  const lineW = w - lw - (lw ? 2 : 0)
  const heavy = (x: number): boolean => !!under && x > under.from && x < under.to - 1
  let out = ''
  for (let x = 0; x < lineW; ) {
    const on = heavy(x)
    let n = 1
    while (x + n < lineW && heavy(x + n) === on) n++
    // the active tab is underlined in the brand gradient
    out += on ? gradient('━'.repeat(n)) : RULE + '─'.repeat(n) + RESET
    x += n
  }
  return onFill(SURFACE, lw ? out + DIM + label + RULE + '──' + RESET : out)
}

/** A pane's details for the rule: who runs it and where, shortest first so a narrow pane keeps the useful part. */
export function paneDetails(p: PaneInfo, home = '', id = true): string {
  if (p.shell) return `${id ? `#${p.id} · ` : ''}${tailFit(tilde(p.cwd, home), 40).trimEnd()}`
  const parts = [...(id ? [`#${p.id}`] : []), p.agentName, paneSignal(p).label.toLowerCase()]
  if (p.worktree) parts.push(p.worktree.branch)
  const stat = [p.stats?.insertions ? `+${p.stats.insertions}` : '', p.stats?.deletions ? `-${p.stats.deletions}` : ''].filter(Boolean).join(' ')
  if (stat) parts.push(stat)
  if (p.notification) parts.push(p.notification)
  return parts.join(' · ')
}

export const tilde = (path: string, home: string): string => (home && (path === home || path.startsWith(home + '/')) ? '~' + path.slice(home.length) : path)

const basename = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

// ── sidebar ────────────────────────────────────────────────────────────────────────────────────────────

export interface Sidebar {
  /** one string per row, each exactly `w` columns */
  lines: string[]
  /** the pane a row belongs to, for clicks */
  hits: Array<string | null>
}

export interface SidebarInput {
  panes: PaneInfo[]
  /** pane ids in tab order */
  order: string[]
  active: string | null
  /** shown in the split */
  shown: string[]
  loops?: LoopInfo[]
  frame?: number
  home?: string
}

/**
 * The sidebar: sessions grouped by project (the repo they work in), each group with its most urgent state;
 * a session is a marker, its tab number and title, and under it the agent and its state, or a shell's folder.
 * Below them, anchored to the bottom: a count per state and the repeat loops. The row in focus gets an
 * accent bar and bold, never reverse video.
 */
export function sidebar(input: SidebarInput, w: number, h: number): Sidebar {
  const { order, active, shown, frame = 0, home = '' } = input
  const byId = new Map(input.panes.map((p) => [p.id, p]))
  const panes = order.flatMap((id) => byId.get(id) ?? [])
  const rows: Array<{ text: string; hit: string | null; focus?: boolean }> = []
  const push = (text: string, hit: string | null = null, focus = false): void => void rows.push({ text, hit, focus })

  // a row of air under the brand line
  push('')
  // groups in the order their first tab comes
  const groups = new Map<string, PaneInfo[]>()
  for (const p of panes) {
    const key = p.root || p.cwd
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  if (!panes.length) push(DIM + fit('  No tabs yet', w) + RESET)
  let first = true
  for (const [root, list] of groups) {
    if (!first) push('')
    first = false
    const tone = rollup(list)
    const count = String(list.length)
    // like the app's labels: the project in capitals, quiet, with its most urgent state and its count
    const name = fit(` ${basename(root).toUpperCase()}`, w - count.length - 3)
    push(`${BOLD}${DIM}${name}${RESET} \x1b[${TONE_SGR[tone]}m${tone === 'neutral' ? ' ' : '●'}${RESET} ${DIM}${count}${RESET}`)
    // agents first, then shells, each in tab order
    for (const p of [...list.filter((x) => !x.shell), ...list.filter((x) => x.shell)]) {
      const n = order.indexOf(p.id) + 1
      const focus = p.id === active
      const bar = focus ? `${ACCENT}▌${RESET}` : shown.includes(p.id) ? `${DIM}│${RESET}` : ' '
      const num = `${n}`
      const title = ellipsis(p.title, w - 5 - num.length)
      push(`${bar} ${marker(p, frame)} ${DIM}${num}${RESET} ${focus ? BOLD : ''}${title}${RESET}`, p.id, focus)
      const sub = p.shell ? tilde(p.cwd, home) : [p.agentName, shortState(p), p.worktree?.branch].filter(Boolean).join(' · ')
      // the diff stat, only the parts that aren't zero
      const ins = !p.shell && p.stats?.insertions ? `+${p.stats.insertions}` : ''
      const del = !p.shell && p.stats?.deletions ? `-${p.stats.deletions}` : ''
      const stat = [ins, del].filter(Boolean).join(' ')
      const subW = w - 4 - (stat ? stat.length + 1 : 0)
      const statText = stat ? ' ' + [ins && `\x1b[32m${ins}${RESET}`, del && `\x1b[31m${del}${RESET}`].filter(Boolean).join(' ') : ''
      push(`${bar}   ${DIM}${p.shell ? tailFit(sub, subW) : ellipsis(sub, subW)}${RESET}${statText}`, p.id, focus)
    }
  }

  // the footer: what's going on at a glance, and the loops
  const foot: string[] = []
  const counts = URGENCY.filter((t) => t !== 'neutral')
    .map((t) => ({ t, n: panes.filter((p) => !p.shell && paneSignal(p).tone === t).length }))
    .filter((c) => c.n)
  const NAMES: Record<Tone, string> = { attention: 'need you', error: 'failed', working: 'working', review: 'ready', done: 'done', neutral: '' }
  if (counts.length) {
    let line = ' '
    for (const c of counts) {
      const part = ` ${c.n} ${NAMES[c.t]}`
      if (width(plain(line)) + 1 + part.length > w) break
      line += `\x1b[${TONE_SGR[c.t]}m●${RESET}${DIM}${part}${RESET}  `
    }
    foot.push(line)
  }
  for (const l of (input.loops ?? []).filter((x) => x.progress.state !== 'finished').slice(0, 2)) {
    foot.push(` ${ACCENT}↻${RESET} ${fit(l.name, w - 3)}`)
    foot.push(`   ${DIM}${fit(l.label, w - 3)}${RESET}`)
  }
  if (foot.length) foot.unshift(RULE + '─'.repeat(w) + RESET)

  // rows that don't fit scroll so the one in focus stays in view; the footer goes first when it's tight
  const footer = foot.length && h - foot.length >= 6 ? foot : []
  const room = Math.max(0, h - footer.length - (footer.length ? 1 : 0))
  const focusRow = rows.findIndex((r) => r.hit === active)
  const start = rows.length <= room ? 0 : Math.max(0, Math.min(focusRow - Math.floor(room / 2), rows.length - room))
  const body = rows.slice(start, start + room)
  const lines: string[] = []
  const hits: Array<string | null> = []
  for (let i = 0; i < h; i++) {
    const fromFoot = i - (h - footer.length)
    if (fromFoot >= 0) {
      lines.push(onFill(SURFACE, pad(footer[fromFoot], w)))
      hits.push(null)
    } else {
      // the tab in focus: both its rows on the raised tone, beside the accent bar
      lines.push(onFill(body[i]?.focus ? LIFT : SURFACE, pad(body[i]?.text ?? '', w)))
      hits.push(body[i]?.hit ?? null)
    }
  }
  return { lines, hits }
}

/** a pane's state in a word or two, for the sidebar's narrow second line */
function shortState(p: Pick<PaneInfo, 'status' | 'shell' | 'pid'>): string {
  const label = paneSignal(p).label
  return label === 'Ready for you' ? 'ready' : label.toLowerCase()
}

/** cut to `w` columns with an ellipsis when it doesn't fit */
export function ellipsis(s: string, w: number): string {
  return width(s) <= w ? fit(s, w) : fit(fit(s, Math.max(0, w - 1)).trimEnd() + '…', w)
}

/** pads a styled string with spaces to `w` visible columns (it's built not to be longer) */
function pad(s: string, w: number): string {
  return s + ' '.repeat(Math.max(0, w - width(plain(s))))
}

export const plain = (s: string): string => s.replace(/\x1b\[[0-9;?<>]*[A-Za-z]/g, '')

// ── hint bar and popups ────────────────────────────────────────────────────────────────────────────────

/** `keys` as chips: each key in the accent, what it does in grey, as many as fit in `w`. */
export function hints(pairs: Array<[string, string]>, w: number, lead = ''): string {
  // painted, each key is a chip on the muted tone like the app's kbd: the chip takes the spaces either side of
  // the key, so the text (and how many fit) is the same as without it
  const chips = painted()
  if (chips && lead.endsWith(' ')) lead = lead.slice(0, -1)
  let out = lead
  let used = width(plain(lead))
  for (const [k, what] of pairs) {
    const n = width(k) + 1 + width(what) + 2
    if (used + n > w) break
    out += chips ? `${MUTED} ${BOLD}${k}${RESET}${MUTED} ${RESET}${DIM}${what}${RESET} ` : `${BOLD}${k}${RESET} ${DIM}${what}${RESET}  `
    used += n
  }
  return onFill(SURFACE, out + ' '.repeat(Math.max(0, w - used)))
}

export interface PopupRow {
  key?: string
  text: string
  note?: string
  /** a row that can't be picked (an agent that isn't installed) */
  off?: boolean
  /** a heading inside the popup */
  head?: boolean
}

/**
 * A frame with rounded corners at (x, y), `w`×`h`: its edge in the brand gradient running from the top left
 * (blue) to the bottom right (purple) at full strength (`soft` blends it toward the rule tone), `title` set
 * into the top edge, and `body` the inner rows (styled, each padded to w - 2), all on `fill`.
 */
export function box(x: number, y: number, w: number, h: number, body: string[], opts: { title?: string; fill?: string; soft?: number } = {}): string {
  const { title = '', fill = RAISED, soft = 0 } = opts
  const c = (cx: number, cy: number): string => edgeColor((cx / Math.max(1, w - 1) + cy / Math.max(1, h - 1)) / 2, soft)
  const edge = (cy: number, from: number, text: string): string => [...text].map((ch, i) => c(from + i, cy) + ch).join('')
  const t = title ? fit(title, Math.min(width(title), w - 6)) : ''
  const top = t ? edge(0, 0, '╭─ ') + RESET + BOLD + t + RESET + edge(0, width(t) + 3, ' ' + '─'.repeat(Math.max(0, w - width(t) - 5)) + '╮') : edge(0, 0, '╭' + '─'.repeat(w - 2) + '╮')
  let s = at(x, y) + onFill(fill, top + RESET)
  for (let i = 1; i < h - 1; i++) s += at(x, y + i) + onFill(fill, c(0, i) + '│' + RESET + pad(body[i - 1] ?? '', w - 2) + c(w - 1, i) + '│' + RESET)
  s += at(x, y + h - 1) + onFill(fill, edge(h - 1, 0, '╰' + '─'.repeat(w - 2) + '╯') + RESET)
  return s
}

/** A box with rounded corners and a title, `w` wide, centred in `r`; returns its rows positioned with at(). */
export function popup(r: Rect, title: string, rows: PopupRow[], sel: number, footer = ''): string {
  const w = Math.min(r.w - 2, 64, Math.max(36, ...rows.map((x) => width(x.text) + width(x.key ?? '') + width(x.note ?? '') + 10), width(title) + 6, width(footer) + 4))
  const h = Math.min(r.h - 1, rows.length + 2 + (footer ? 2 : 0))
  if (w < 10 || h < 3) return ''
  const x = r.x + Math.floor((r.w - w) / 2)
  const y = r.y + Math.max(1, Math.floor((r.h - h) / 3))
  const keyW = Math.max(0, ...rows.map((x) => width(x.key ?? '')))
  const inner = w - 2
  const lines: string[] = []
  rows.slice(0, h - 2 - (footer ? 2 : 0)).forEach((row, i) => {
    // a heading like the app's field labels: capitals, quiet
    if (row.head) return void lines.push(' ' + BOLD + DIM + fit(painted() ? row.text.toUpperCase() : row.text, inner - 1) + RESET)
    const focus = i === sel
    const key = row.key ? `${row.off ? DIM : ACCENT}${fit(row.key, keyW)}${RESET}` : ' '.repeat(keyW)
    const noteW = row.note ? width(row.note) + 1 : 0
    const text = fit(row.text, Math.max(0, inner - keyW - 5 - noteW))
    const line = `${focus ? `${ACCENT}▌${RESET}` : ' '} ${key}  ${row.off ? DIM : focus ? BOLD : ''}${text}${RESET}${row.note ? `${DIM} ${row.note}${RESET}` : ''} `
    // the row picked sits a step up again, on the muted tone
    lines.push(focus ? onFill(MUTED, pad(line, inner)) : line)
  })
  if (footer) lines.push('', ' ' + DIM + fit(footer, inner - 1) + RESET)
  return box(x, y, w, h, lines, { title })
}

// ── text ───────────────────────────────────────────────────────────────────────────────────────────────

export const at = (x: number, y: number): string => `\x1b[${y + 1};${x + 1}H`

/** A string cut or padded to exactly `w` columns (wide characters count as two). */
export function fit(s: string, w: number): string {
  let out = ''
  let used = 0
  for (const ch of s.replace(/[\x00-\x1f\x7f]/g, ' ')) {
    const cw = wide(ch) ? 2 : 1
    if (used + cw > w) break
    out += ch
    used += cw
  }
  return out + ' '.repeat(Math.max(0, w - used))
}

/** A path cut from the left to `w` columns, so the folder name (the end) stays: `…/scratchpad/repo`. */
export function tailFit(s: string, w: number): string {
  if (width(s) <= w) return fit(s, w)
  if (w <= 1) return fit('…', w)
  const chars = [...s]
  let out = ''
  let used = 1
  for (let i = chars.length - 1; i >= 0; i--) {
    const cw = wide(chars[i]) ? 2 : 1
    if (used + cw > w) break
    out = chars[i] + out
    used += cw
  }
  return fit('…' + out, w)
}

/** Columns `s` takes (wide characters count as two). */
export function width(s: string): number {
  let n = 0
  for (const ch of s) n += wide(ch) ? 2 : 1
  return n
}

function wide(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)
}

// ── a pane's screen ────────────────────────────────────────────────────────────────────────────────────

function color(cell: IBufferCell, fg: boolean): string {
  const v = fg ? cell.getFgColor() : cell.getBgColor()
  if (fg ? cell.isFgDefault() : cell.isBgDefault()) {
    // painted, the default colours are the pane's (text and --background), so a pane looks like the app's
    // terminal whatever the user's terminal has; an inverted cell keeps the terminal's, as the program meant
    const pane = cell.isInverse() ? '' : fg ? PANE_FG : PANE_BG
    return pane ? pane.slice(1) : fg ? '39' : '49'
  }
  if (fg ? cell.isFgRGB() : cell.isBgRGB()) return `${fg ? 38 : 48};2;${(v >> 16) & 255};${(v >> 8) & 255};${v & 255}`
  if (v < 8) return String((fg ? 30 : 40) + v)
  if (v < 16) return String((fg ? 90 : 100) + v - 8)
  return `${fg ? 38 : 48};5;${v}`
}

function sgr(cell: IBufferCell): string {
  const parts = ['0']
  if (cell.isBold()) parts.push('1')
  if (cell.isDim()) parts.push('2')
  if (cell.isItalic()) parts.push('3')
  if (cell.isUnderline()) parts.push('4')
  if (cell.isInverse()) parts.push('7')
  if (cell.isInvisible()) parts.push('8')
  if (cell.isStrikethrough()) parts.push('9')
  parts.push(color(cell, true), color(cell, false))
  return parts.join(';')
}

/** A cell of a pane's visible screen: column and row from its top left. */
export interface Cell {
  x: number
  y: number
}

/** A selection in a pane, from where the drag started to where it is: either way round. */
export interface Selection {
  a: Cell
  b: Cell
}

/** start and end in reading order */
function ordered(s: Selection): [Cell, Cell] {
  return s.a.y < s.b.y || (s.a.y === s.b.y && s.a.x <= s.b.x) ? [s.a, s.b] : [s.b, s.a]
}

/** Is the cell selected? Like a terminal: from the start to the end of the line, whole lines, then to the end cell. */
export function inSelection(s: Selection, x: number, y: number): boolean {
  const [from, to] = ordered(s)
  if (y < from.y || y > to.y) return false
  if (y === from.y && x < from.x) return false
  if (y === to.y && x > to.x) return false
  return true
}

/**
 * The selected text of the screen as it's shown (scrolled back or not): trailing blanks dropped per line, and
 * a line the terminal wrapped joined to the next, so a long command copies as one line.
 */
export function selectionText(term: Term, s: Selection): string {
  const [from, to] = ordered(s)
  const b = term.buffer.active
  let out = ''
  for (let y = from.y; y <= to.y; y++) {
    const line = b.getLine(b.viewportY + y)
    if (!line) break
    const start = y === from.y ? from.x : 0
    const end = y === to.y ? to.x + 1 : term.cols
    out += line.translateToString(y !== to.y ? false : true, start, end)
    if (y < to.y) {
      const wrapped = b.getLine(b.viewportY + y + 1)?.isWrapped
      if (!wrapped) out = out.replace(/ +$/, '') + '\n'
    }
  }
  return out.replace(/ +$/, '')
}


/** The visible screen of `term`, drawn into `r` (rows past the screen are cleared); `sel` is highlighted. */
export function drawTerm(term: Term, r: Rect, sel?: Selection | null, dim = false): string {
  const b = term.buffer.active
  const cell = b.getNullCell()
  let out = ''
  for (let row = 0; row < r.h; row++) {
    out += at(r.x, r.y + row) + RESET + PANE
    const line = row < term.rows ? b.getLine(b.viewportY + row) : undefined
    let used = 0
    let last = ''
    if (line) {
      for (let col = 0; col < Math.min(term.cols, r.w); col++) {
        const c = line.getCell(col, cell)
        if (!c) break
        const w = c.getWidth()
        if (w === 0) continue
        if (used + w > r.w) break
        // the pane not in focus (a split) is drawn faint, so the eye goes to the one that takes the keys
        const style = sgr(c) + (dim ? ';2' : '') + (sel && inSelection(sel, col, row) ? SELECTED_BG : '')
        if (style !== last) {
          out += `\x1b[${style}m`
          last = style
        }
        out += c.getChars() || ' '
        used += w
      }
    }
    out += RESET + PANE + ' '.repeat(Math.max(0, r.w - used)) + RESET
  }
  return out
}
