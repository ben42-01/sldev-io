import { createRequire } from 'module'
import type { Terminal as HeadlessTerminal } from '@xterm/headless'
import type { Screen } from './tracker'

// @xterm/headless and the serialize addon are CommonJS with no named ESM exports
const require = createRequire(import.meta.url)
const { Terminal } = require('@xterm/headless') as typeof import('@xterm/headless')
const { SerializeAddon } = require('@xterm/addon-serialize') as typeof import('@xterm/addon-serialize')

export type Term = HeadlessTerminal

/** what a TUI that attaches draws a pane from: its screen as it is now, at the size it was drawn */
export interface Snapshot {
  data: string
  cols: number
  rows: number
}

const serializers = new WeakMap<Term, InstanceType<typeof SerializeAddon>>()
/** modes the addon leaves out of its output but a TUI attaching needs: a hidden cursor and SGR mouse reports */
const extraModes = new WeakMap<Term, { cursorHidden: boolean; sgrMouse: boolean }>()

export interface TermEvents {
  bell: () => void
  /** OSC 9 (iTerm/ConEmu) or OSC 777;notify;title;body */
  notify: (text: string) => void
}

/** A terminal screen with no display: what the agent drew, for status checks, `sldev read` and the TUI. */
export function createTerm(cols: number, rows: number, events?: TermEvents): Term {
  const term = new Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true })
  const addon = new SerializeAddon()
  term.loadAddon(addon)
  serializers.set(term, addon)
  const modes = { cursorHidden: false, sgrMouse: false }
  extraModes.set(term, modes)
  const set = (on: boolean) => (params: (number | number[])[]): boolean => {
    for (const p of params.flat()) {
      if (p === 25) modes.cursorHidden = !on
      if (p === 1006) modes.sgrMouse = on
    }
    // not handled here: xterm still applies the mode itself
    return false
  }
  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, set(true))
  term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, set(false))
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

/**
 * The pane's screen and scrollback as escape codes that redraw it, once every write so far is parsed. Replaying the
 * raw output instead drew a full-screen agent wrong: it was written at sizes the pane no longer has, and the cap
 * cut it mid-sequence, so the tab looked broken until a resize made the agent redraw.
 */
export async function snapshot(term: Term): Promise<Snapshot> {
  await new Promise<void>((r) => term.write('', r))
  const modes = extraModes.get(term)
  const data =
    (serializers.get(term)?.serialize({ scrollback: 1000 }) ?? '') + (modes?.cursorHidden ? '\x1b[?25l' : '') + (modes?.sgrMouse ? '\x1b[?1006h' : '')
  return { data, cols: term.cols, rows: term.rows }
}
