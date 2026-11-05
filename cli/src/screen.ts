import { createRequire } from 'module'
import type { Terminal as HeadlessTerminal } from '@xterm/headless'
import type { Screen } from './tracker'

// @xterm/headless is CommonJS with no named ESM exports
const { Terminal } = createRequire(import.meta.url)('@xterm/headless') as typeof import('@xterm/headless')

export type Term = HeadlessTerminal

export interface TermEvents {
  bell: () => void
  /** OSC 9 (iTerm/ConEmu) or OSC 777;notify;title;body */
  notify: (text: string) => void
}

/** A terminal screen with no display: what the agent drew, for status checks, `sldev read` and the TUI. */
export function createTerm(cols: number, rows: number, events?: TermEvents): Term {
  const term = new Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true })
  if (events) {
    term.onBell(events.bell)
    term.parser.registerOscHandler(9, (data) => {
      // ConEmu uses OSC 9;<digit>;… for progress etc.; those aren't notifications
      if (!/^\d;/.test(data)) events.notify(data)
      return true
    })
    term.parser.registerOscHandler(777, (data) => {
      const [kind, title, body] = data.split(';')
      if (kind === 'notify') events.notify([title, body].filter(Boolean).join(': '))
      return true
    })
  }
  return term
}

/** The last `lines` lines that have text: the empty rows below the cursor don't count. */
export function screenText(term: Term, lines: number): string {
  const b = term.buffer.active
  let end = b.length
  while (end > 0 && !b.getLine(end - 1)?.translateToString(true).trim()) end--
  const out: string[] = []
  for (let i = Math.max(0, end - lines); i < end; i++) out.push(b.getLine(i)?.translateToString(true) ?? '')
  return out.join('\n')
}

export function termScreen(term: Term): Screen {
  return {
    tail: (rows, from = 0) => {
      const b = term.buffer.active
      const out: string[] = []
      for (let i = Math.max(from, b.length - rows); i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? '')
      return out.join('\n').trim()
    },
    cursor: () => {
      const b = term.buffer.active
      return { line: b.baseY + b.cursorY, alt: b.type === 'alternate' }
    }
  }
}
