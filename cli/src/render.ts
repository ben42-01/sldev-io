import type { IBufferCell } from '@xterm/headless'
import { missionSignal, type Tone } from '@shared/status'
import type { LoopInfo, PaneInfo } from './protocol'
import type { Term } from './screen'

/**
 * Drawing for the TUI: layout rectangles, the chrome (top tabs, the grouped sidebar, the hint bar, popups)
 * and a headless screen turned back into escape sequences. Everything here is pure, so it's unit-tested.
 *
 * The look: monochrome chrome with thin rules, colour only for state (the same tones as the app) and the
 * brand mark. Nothing is drawn in reverse video; the tab or row in focus is bold with an accent bar.
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
const DIM = '\x1b[90m'
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
/** the accent: the bar beside the row in focus, the line under the active tab, key names */
export const ACCENT = '\x1b[38;5;75m'
/** the brand gradient, blue → green → purple, in 256 colours (truecolor isn't everywhere) */
const BRAND = [75, 79, 114, 141, 177]

/** "sldev" in the brand gradient */
export function brandMark(): string {
  return [...'sldev'].map((ch, i) => `\x1b[1;38;5;${BRAND[i]}m${ch}`).join('') + RESET
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

/** a pane's marker in its colour; one that needs you is bold, so it stands out from across the screen */
export function marker(p: Pick<PaneInfo, 'status' | 'shell' | 'pid'>, frame = 0): string {
  const s = paneSignal(p)
  return `\x1b[${s.tone === 'attention' || s.tone === 'error' ? '1;' : ''}${TONE_SGR[s.tone]}m${glyph(p, frame)}${RESET}`
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
    return { text: lead + (plusW ? `${ACCENT}${PLUS}${RESET}` : ''), spans: [], plus: plusW ? { from: w - plusW, to: w } : null }
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
    out += style + text[0] + RESET + color + text.slice(1, 2) + RESET + style + text.slice(2) + RESET
    spans.push({ index: i, from: used, to: used + width(text) })
    used += width(text)
  }
  out += ' '.repeat(Math.max(0, room - used - (clipped ? 1 : 0)))
  if (clipped) out += DIM + (end < tabs.length ? '›' : ' ') + RESET
  if (plusW) out += `${DIM}${PLUS}${RESET}`
  return { text: out, spans, plus: plusW ? { from: room, to: w } : null }
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
    out += (on ? ACCENT + '━'.repeat(n) : DIM + '─'.repeat(n)) + RESET
    x += n
  }
  return lw ? out + DIM + label + '──' + RESET : out
}

/** A pane's details for the rule: who runs it and where, shortest first so a narrow pane keeps the useful part. */
export function paneDetails(p: PaneInfo, home = '', id = true): string {
  if (p.shell) return `${id ? `#${p.id} · ` : ''}${tailFit(tilde(p.cwd, home), 40).trimEnd()}`
  const parts = [...(id ? [`#${p.id}`] : []), p.agentName, paneSignal(p).label.toLowerCase()]
  if (p.worktree) parts.push(p.worktree.branch)
  if (p.stats && (p.stats.insertions || p.stats.deletions)) parts.push(`+${p.stats.insertions} -${p.stats.deletions}`)
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
  const rows: Array<{ text: string; hit: string | null }> = []
  const push = (text: string, hit: string | null = null): void => void rows.push({ text, hit })

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
    const name = fit(` ${basename(root)}`, w - count.length - 3)
    push(`${BOLD}${name}${RESET} \x1b[${TONE_SGR[tone]}m${tone === 'neutral' ? ' ' : '●'}${RESET} ${DIM}${count}${RESET}`)
    // agents first, then shells, each in tab order
    for (const p of [...list.filter((x) => !x.shell), ...list.filter((x) => x.shell)]) {
      const n = order.indexOf(p.id) + 1
      const focus = p.id === active
      const bar = focus ? `${ACCENT}▌${RESET}` : shown.includes(p.id) ? `${DIM}│${RESET}` : ' '
      const num = `${n}`
      const title = fit(p.title, w - 5 - num.length)
      push(`${bar} ${marker(p, frame)} ${DIM}${num}${RESET} ${focus ? BOLD : ''}${title}${RESET}`, p.id)
      const sig = paneSignal(p)
      const sub = p.shell ? tilde(p.cwd, home) : [p.agentName, sig.label.toLowerCase(), p.worktree?.branch].filter(Boolean).join(' · ')
      const stat = !p.shell && p.stats && (p.stats.insertions || p.stats.deletions) ? `+${p.stats.insertions} -${p.stats.deletions}` : ''
      const subW = w - 4 - (stat ? stat.length + 1 : 0)
      push(`${bar}   ${DIM}${p.shell ? tailFit(sub, subW) : fit(sub, subW)}${RESET}${stat ? ` \x1b[2;32m+${p.stats!.insertions}${RESET}\x1b[2;31m -${p.stats!.deletions}${RESET}` : ''}`, p.id)
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
  if (foot.length) foot.unshift(DIM + '─'.repeat(w) + RESET)

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
      lines.push(pad(footer[fromFoot], w))
      hits.push(null)
    } else {
      lines.push(pad(body[i]?.text ?? '', w))
      hits.push(body[i]?.hit ?? null)
    }
  }
  return { lines, hits }
}

/** pads a styled string with spaces to `w` visible columns (it's built not to be longer) */
function pad(s: string, w: number): string {
  return s + ' '.repeat(Math.max(0, w - width(plain(s))))
}

export const plain = (s: string): string => s.replace(/\x1b\[[0-9;?<>]*[A-Za-z]/g, '')

// ── hint bar and popups ────────────────────────────────────────────────────────────────────────────────

/** `keys` as chips: each key in the accent, what it does in grey, as many as fit in `w`. */
export function hints(pairs: Array<[string, string]>, w: number, lead = ''): string {
  let out = lead
  let used = width(plain(lead))
  for (const [k, what] of pairs) {
    const n = width(k) + 1 + width(what) + 2
    if (used + n > w) break
    out += `${BOLD}${k}${RESET} ${DIM}${what}${RESET}  `
    used += n
  }
  return out + ' '.repeat(Math.max(0, w - used))
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

/** A box with rounded corners and a title, `w` wide, centred in `r`; returns its rows positioned with at(). */
export function popup(r: Rect, title: string, rows: PopupRow[], sel: number, footer = ''): string {
  const w = Math.min(r.w - 2, 64, Math.max(36, ...rows.map((x) => width(x.text) + width(x.key ?? '') + width(x.note ?? '') + 10), width(title) + 6, width(footer) + 4))
  const h = Math.min(r.h - 1, rows.length + 2 + (footer ? 2 : 0))
  if (w < 10 || h < 3) return ''
  const x = r.x + Math.floor((r.w - w) / 2)
  const y = r.y + Math.max(1, Math.floor((r.h - h) / 3))
  const keyW = Math.max(0, ...rows.map((x) => width(x.key ?? '')))
  let s = at(x, y) + DIM + '╭─ ' + RESET + BOLD + fit(title, Math.min(width(title), w - 6)) + RESET + DIM + ' ' + '─'.repeat(Math.max(0, w - width(title) - 5)) + '╮' + RESET
  const inner = w - 2
  const body = rows.slice(0, h - 2 - (footer ? 2 : 0))
  body.forEach((row, i) => {
    let line: string
    if (row.head) line = ' ' + BOLD + fit(row.text, inner - 1) + RESET
    else {
      const focus = i === sel
      const key = row.key ? `${row.off ? DIM : ACCENT}${fit(row.key, keyW)}${RESET}` : ' '.repeat(keyW)
      const noteW = row.note ? width(row.note) + 1 : 0
      const text = fit(row.text, Math.max(0, inner - keyW - 5 - noteW))
      line = `${focus ? `${ACCENT}▌${RESET}` : ' '} ${key}  ${row.off ? DIM : focus ? BOLD : ''}${text}${RESET}${row.note ? `${DIM} ${row.note}${RESET}` : ''} `
    }
    s += at(x, y + 1 + i) + DIM + '│' + RESET + pad(line, inner) + DIM + '│' + RESET
  })
  if (footer) {
    s += at(x, y + 1 + body.length) + DIM + '│' + ' '.repeat(inner) + '│' + RESET
    s += at(x, y + 2 + body.length) + DIM + '│' + RESET + ' ' + DIM + fit(footer, inner - 1) + RESET + DIM + '│' + RESET
  }
  s += at(x, y + h - 1) + DIM + '╰' + '─'.repeat(w - 2) + '╯' + RESET
  return s
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
  if (fg ? cell.isFgDefault() : cell.isBgDefault()) return fg ? '39' : '49'
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

/** The visible screen of `term`, drawn into `r` (rows past the screen are cleared). */
export function drawTerm(term: Term, r: Rect): string {
  const b = term.buffer.active
  const cell = b.getNullCell()
  let out = ''
  for (let row = 0; row < r.h; row++) {
    out += at(r.x, r.y + row) + '\x1b[0m'
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
        const style = sgr(c)
        if (style !== last) {
          out += `\x1b[${style}m`
          last = style
        }
        out += c.getChars() || ' '
        used += w
      }
    }
    out += '\x1b[0m' + ' '.repeat(Math.max(0, r.w - used))
  }
  return out
}
