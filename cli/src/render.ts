import type { IBufferCell } from '@xterm/headless'
import { missionSignal, type Tone } from '@shared/status'
import type { PaneInfo } from './protocol'
import type { Term } from './screen'

/** Drawing for the TUI: layout rectangles and a headless screen turned back into escape sequences. */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Layout {
  sidebar: Rect | null
  /** the tab bar: one row across the main area */
  tabs: Rect
  /** one rect per visible pane; each starts with its header row */
  panes: Rect[]
  status: Rect
}

export const SIDEBAR_W = 28
/**
 * The tab bar names every session; the sidebar adds each one's agent and status in words, which is worth
 * its 29 columns only when the pane keeps a full 80-plus beside it.
 */
export const SIDEBAR_MIN_COLS = 110

/** The sidebar goes away on narrow terminals; a split needs room for two usable panes. */
export function layout(cols: number, rows: number, split: boolean): Layout {
  cols = Math.max(1, cols)
  rows = Math.max(3, rows)
  const status: Rect = { x: 0, y: rows - 1, w: cols, h: 1 }
  const sidebar = cols >= SIDEBAR_MIN_COLS ? { x: 0, y: 0, w: SIDEBAR_W, h: rows - 1 } : null
  const x = sidebar ? SIDEBAR_W + 1 : 0
  const w = cols - x
  const tabs: Rect = { x, y: 0, w, h: 1 }
  const h = rows - 2
  if (split && w >= 60) {
    const left = Math.floor((w - 1) / 2)
    return { sidebar, tabs, panes: [{ x, y: 1, w: left, h }, { x: x + left + 1, y: 1, w: w - left - 1, h }], status }
  }
  return { sidebar, tabs, panes: [{ x, y: 1, w, h }], status }
}

/** A pane's marker: an agent's mission status, or neutral for a shell tab (it has no status of its own). */
export function paneSignal(p: Pick<PaneInfo, 'status' | 'shell' | 'pid'>): { tone: Tone; label: string } {
  if (p.shell) return { tone: 'neutral', label: p.pid === undefined ? 'Exited' : 'Shell' }
  return missionSignal(p.status)
}

export interface Tab {
  title: string
  tone: Tone
  /** the tab in focus */
  active: boolean
  /** shown in the split beside the active one */
  shown?: boolean
}

const TAB_TITLE_MAX = 20

/** The plain text of tab `i` (1-based number, its title cut to `max` columns); the marker is the first character after the space. */
function tabText(t: Tab, i: number, max: number): string {
  const title = width(t.title) > max ? fit(t.title, Math.max(1, max - 1)).trimEnd() + '…' : t.title
  return ` ● ${i + 1} ${title} `
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

/** The tab bar, exactly `w` columns: each tab's status marker in its tone, the active tab inverted. */
export function tabBar(tabs: Tab[], w: number): string {
  if (w <= 0) return ''
  if (!tabs.length) return '\x1b[90m' + fit(' no sessions', w) + '\x1b[0m'
  const max = Math.max(4, Math.min(TAB_TITLE_MAX, w - 10))
  const texts = tabs.map((t, i) => tabText(t, i, max))
  const active = Math.max(0, tabs.findIndex((t) => t.active))
  const { start, end } = tabWindow(texts.map(width), active, w)
  const clipped = start > 0 || end < tabs.length
  let out = clipped ? '\x1b[90m' + (start > 0 ? '‹' : ' ') + '\x1b[0m' : ''
  let used = clipped ? 1 : 0
  const room = w - (clipped ? 2 : 0)
  for (let i = start; i < end; i++) {
    const t = tabs[i]
    // a lone tab wider than the bar (a very narrow terminal) is cut to fit
    const text = fit(texts[i], Math.min(width(texts[i]), room - (used - (clipped ? 1 : 0))))
    const style = t.active ? '\x1b[1;7m' : t.shown ? '\x1b[1m' : '\x1b[90m'
    // the marker keeps its colour on every tab, so a background tab that needs you stands out
    out += style + text[0] + '\x1b[22;27;39m' + `\x1b[${TONE_SGR[t.tone]}m` + (t.tone === 'attention' || t.tone === 'error' ? '\x1b[1m' : '') + text.slice(1, 2) + '\x1b[0m' + style + text.slice(2) + '\x1b[0m'
    used += width(text)
  }
  const pad = w - used - (clipped ? 1 : 0)
  out += ' '.repeat(Math.max(0, pad))
  if (clipped) out += '\x1b[90m' + (end < tabs.length ? '›' : ' ') + '\x1b[0m'
  return out
}

export const TONE_SGR: Record<Tone, string> = { working: '32', attention: '33', error: '31', review: '34', done: '36', neutral: '90' }

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
