import { missionSignal } from '@shared/status'
import type { Client } from './client'
import type { DaemonEvent, PaneInfo } from './protocol'
import { at, drawTerm, fit, layout, TONE_SGR, type Rect } from './render'
import { createTerm, type Term } from './screen'

/**
 * `sldev` with no arguments: the agents in a sidebar with their status, one or two panes beside it, and
 * the keyboard going to the pane in focus. Ctrl-b is the prefix (n/p, 1-9, s split, Tab, c new, x kill,
 * d detach). Detaching leaves every agent running in the daemon.
 */

const PREFIX = '\x02'
const HELP = 'Ctrl-b then: n/p next/prev · 1-9 pick · s split · Tab other pane · c new · x kill · d detach'

interface View {
  info: PaneInfo
  term: Term
  /** size last sent to the daemon */
  size?: string
}

/** The terminal the TUI runs in: process.stdin/stdout, or fakes in tests. */
export interface TuiIo {
  input: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (on: boolean) => unknown }
  output: NodeJS.WritableStream & { columns?: number; rows?: number; on(event: 'resize', fn: () => void): unknown }
}

export async function runTui(client: Client, cwd: string, io: TuiIo = { input: process.stdin, output: process.stdout }): Promise<void> {
  const out = io.output
  const input = io.input
  const views = new Map<string, View>()
  let order: string[] = []
  let focus = 0
  let split = false
  let prefix = false
  let prompt: { label: string; text: string; done: (text: string) => void } | null = null
  let message = ''
  let frame: NodeJS.Timeout | null = null
  let restored = false

  const visible = (): string[] => {
    if (!order.length) return []
    const first = order[Math.min(focus, order.length - 1)]
    if (!split || order.length < 2) return [first]
    return [first, order[(Math.min(focus, order.length - 1) + 1) % order.length]]
  }

  const addView = async (info: PaneInfo): Promise<void> => {
    if (views.has(info.id)) return
    const view: View = { info, term: createTerm(120, 40) }
    views.set(info.id, view)
    order.push(info.id)
    const { data } = await client.request('screen', { pane: info.id }).catch(() => ({ data: '' }))
    view.term.write(data)
  }

  const sizeViews = (): void => {
    const l = layout(out.columns || 80, out.rows || 24, split)
    visible().forEach((id, i) => {
      const v = views.get(id)
      const r = l.panes[i]
      if (!v || !r) return
      const cols = Math.max(20, r.w)
      const rows = Math.max(5, r.h - 1)
      if (v.term.cols !== cols || v.term.rows !== rows) v.term.resize(cols, rows)
      const size = `${cols}x${rows}`
      if (v.size !== size) {
        v.size = size
        void client.request('resize', { pane: id, cols, rows }).catch(() => undefined)
      }
    })
    void client.request('focus', { pane: visible()[0] ?? null }).catch(() => undefined)
  }

  const schedule = (): void => {
    if (!frame && !restored) frame = setTimeout(draw, 33)
  }

  function draw(): void {
    frame = null
    if (restored) return
    const cols = out.columns || 80
    const rows = out.rows || 24
    const l = layout(cols, rows, split)
    let s = '\x1b[?2026h\x1b[?25l'
    if (l.sidebar) s += drawSidebar(l.sidebar)
    const shown = visible()
    if (!shown.length) {
      const r = l.panes[0]
      const lines = ['No agents yet.', '', 'Ctrl-b c starts one here, or from another terminal:', '  sldev new --agent claude "fix the failing test"']
      for (let i = 0; i < r.h; i++) s += at(r.x, r.y + i) + fit(lines[i - 2] ?? '', r.w)
    }
    shown.forEach((id, i) => {
      const v = views.get(id)
      const r = l.panes[i]
      if (!v || !r) return
      s += at(r.x, r.y) + paneHeader(v.info, r.w, i === 0)
      s += drawTerm(v.term, { x: r.x, y: r.y + 1, w: r.w, h: r.h - 1 })
      if (i === 0 && l.panes[1]) for (let y = 0; y < r.h; y++) s += at(r.x + r.w, y) + '\x1b[90m│\x1b[0m'
    })
    s += at(0, l.status.y) + statusLine(cols)
    const main = shown[0] && views.get(shown[0])
    if (prompt) s += at(prompt.label.length + prompt.text.length + 1, l.status.y) + '\x1b[?25h'
    else if (main) {
      const b = main.term.buffer.active
      s += at(l.panes[0].x + Math.min(b.cursorX, l.panes[0].w - 1), l.panes[0].y + 1 + b.cursorY) + '\x1b[?25h'
    }
    out.write(s + '\x1b[?2026l')
  }

  function drawSidebar(r: Rect): string {
    let s = at(r.x, r.y) + '\x1b[1m' + fit(' sldev', r.w) + '\x1b[0m'
    const shown = visible()
    let y = 2
    order.forEach((id, i) => {
      const v = views.get(id)
      if (!v || y + 1 >= r.h) return
      const sig = missionSignal(v.info.status)
      const mark = shown.includes(id) ? '\x1b[7m' : ''
      s += at(r.x, r.y + y) + mark + ` \x1b[${TONE_SGR[sig.tone]}m●\x1b[0m${mark} ` + fit(`${i + 1} ${v.info.title}`, r.w - 3) + '\x1b[0m'
      s += at(r.x, r.y + y + 1) + '\x1b[90m' + fit(`   ${v.info.agentName} · ${sig.label}`, r.w) + '\x1b[0m'
      y += 2
    })
    for (; y < r.h; y++) s += at(r.x, r.y + y) + ' '.repeat(r.w)
    for (let i = 0; i < r.h; i++) s += at(r.x + r.w, r.y + i) + '\x1b[90m│\x1b[0m'
    return s
  }

  function paneHeader(p: PaneInfo, w: number, focused: boolean): string {
    const sig = missionSignal(p.status)
    const where = p.worktree ? p.worktree.branch : 'in place'
    const stats = p.stats ? ` · ${p.stats.files} files +${p.stats.insertions} -${p.stats.deletions}` : ''
    const note = p.notification ? ` · ${p.notification}` : ''
    const text = ` ${p.id} ${p.title} · ${p.agentName} · ${where}${stats}${note}`
    return `\x1b[${TONE_SGR[sig.tone]}m●\x1b[0m${focused ? '\x1b[1m' : '\x1b[90m'}${fit(text, w - 1)}\x1b[0m`
  }

  function statusLine(cols: number): string {
    if (prompt) return '\x1b[7m' + fit(`${prompt.label}${prompt.text}`, cols) + '\x1b[0m'
    const text = prefix ? 'Ctrl-b …' : message || HELP
    return '\x1b[90m' + fit(` ${text}`, cols) + '\x1b[0m'
  }

  const onEvent = (e: DaemonEvent): void => {
    if (e.event === 'output') {
      const v = views.get(e.pane)
      if (v) {
        v.term.write(e.data)
        if (visible().includes(e.pane)) schedule()
      }
    } else if (e.event === 'pane') {
      const v = views.get(e.pane.id)
      if (v) v.info = e.pane
      else void addView(e.pane).then(() => (sizeViews(), schedule()))
      schedule()
    } else if (e.event === 'closed') {
      views.delete(e.pane)
      order = order.filter((id) => id !== e.pane)
      focus = Math.min(focus, Math.max(0, order.length - 1))
      sizeViews()
      schedule()
    } else if (e.event === 'notify' && !visible().includes(e.pane)) {
      message = `${e.title}: ${e.body}`
      schedule()
    }
  }

  const select = (i: number): void => {
    if (!order.length) return
    focus = ((i % order.length) + order.length) % order.length
    message = ''
    sizeViews()
    schedule()
  }

  const ask = (label: string, done: (text: string) => void): void => {
    prompt = { label, text: '', done }
    schedule()
  }

  let resolveExit: () => void = () => undefined
  const finished = new Promise<void>((r) => (resolveExit = r))

  /** Keys can arrive several to a chunk (fast typing, a paste), so the input is taken apart here. */
  const onKey = (d: Buffer | string): void => {
    let rest = d.toString()
    while (rest && !restored) rest = key(rest)
    schedule()
  }

  /** Handles the start of `s` and returns what is left. */
  function key(s: string): string {
    if (prompt) {
      const p = prompt
      const ch = String.fromCodePoint(s.codePointAt(0)!)
      if (ch === '\r') {
        prompt = null
        p.done(p.text)
      } else if (ch === '\x1b' || ch === '\x03') {
        prompt = null
        // the rest of an escape sequence (an arrow key) goes with it
        return ''
      } else if (ch === '\x7f' || ch === '\b') p.text = p.text.slice(0, -1)
      else if (!/[\x00-\x1f]/.test(ch)) p.text += ch
      return s.slice(ch.length)
    }
    if (prefix) {
      prefix = false
      const c = s[0]
      const id = visible()[0]
      if (c === 'n' || c === '\t' || c === 'o') select(focus + 1)
      else if (c === 'p') select(focus - 1)
      else if (/^[1-9]$/.test(c)) select(Number(c) - 1)
      else if (c === 's') {
        split = !split
        sizeViews()
      } else if (c === 'd') {
        detach()
        return ''
      } else if (c === 'c')
        ask('New pane (agent, then the brief): ', (text) => {
          const [agent, ...words] = text.trim().split(/\s+/)
          if (!agent) return
          client
            .request('new', { agent, brief: words.join(' '), cwd, worktree: false })
            .then((p) => ((message = `Started pane ${p.id}`), schedule()))
            .catch((err: Error) => ((message = err.message), schedule()))
        })
      else if (c === 'x' && id)
        ask(`Kill pane ${id}? Its agent stops; files stay. (y/N) `, (text) => {
          if (/^y/i.test(text.trim())) void client.request('kill', { pane: id }).catch((err: Error) => (message = err.message))
        })
      else if (c === PREFIX && id) void client.request('input', { pane: id, data: PREFIX })
      return s.slice(1)
    }
    const at = s.indexOf(PREFIX)
    const typed = at < 0 ? s : s.slice(0, at)
    const id = visible()[0]
    if (typed && id) void client.request('input', { pane: id, data: typed }).catch(() => undefined)
    if (at < 0) return ''
    prefix = true
    return s.slice(at + 1)
  }

  const restore = (): void => {
    if (restored) return
    restored = true
    if (frame) clearTimeout(frame)
    input.off('data', onKey)
    if (input.isTTY) input.setRawMode?.(false)
    input.pause()
    out.write('\x1b[0m\x1b[?25h\x1b[?1049l')
  }

  function detach(): void {
    restore()
    out.write('Detached. The agents keep running; `sldev` attaches again.\n')
    client.close()
    resolveExit()
  }

  const panes = await client.request('attach', { cols: out.columns || 80, rows: out.rows || 24 })
  for (const p of panes) await addView(p)
  client.onEvent(onEvent)
  client.onClose(() => {
    if (restored) return
    restore()
    out.write('The sldev daemon stopped.\n')
    resolveExit()
  })
  out.write('\x1b[?1049h\x1b[2J')
  if (input.isTTY) input.setRawMode?.(true)
  input.resume()
  input.on('data', onKey)
  out.on('resize', () => {
    out.write('\x1b[2J')
    sizeViews()
    schedule()
  })
  sizeViews()
  draw()
  return finished
}
