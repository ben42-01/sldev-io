import type { IBufferCell } from '@xterm/headless'
import type { Tone } from '@shared/status'
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
  /** one rect per visible pane; each starts with its header row */
  panes: Rect[]
  status: Rect
}

export const SIDEBAR_W = 28

/** The sidebar goes away on narrow terminals; a split needs room for two usable panes. */
export function layout(cols: number, rows: number, split: boolean): Layout {
  const status: Rect = { x: 0, y: rows - 1, w: cols, h: 1 }
  const sidebar = cols >= 80 ? { x: 0, y: 0, w: SIDEBAR_W, h: rows - 1 } : null
  const x = sidebar ? SIDEBAR_W + 1 : 0
  const w = cols - x
  const h = rows - 1
  if (split && w >= 60) {
    const left = Math.floor((w - 1) / 2)
    return { sidebar, panes: [{ x, y: 0, w: left, h }, { x: x + left + 1, y: 0, w: w - left - 1, h }], status }
  }
  return { sidebar, panes: [{ x, y: 0, w, h }], status }
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
