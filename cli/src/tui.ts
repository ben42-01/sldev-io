import { appendFileSync } from 'fs'
import { homedir } from 'os'
import { allAgents, installedBin, setInstalledBins, type AgentDef } from '@shared/agents'
import type { GhRun } from '@shared/types'
import { findOnPath } from '../../src/main/launch'
import type { Client } from './client'
import { copyToClipboard, osc52 } from './clipboard'
import { openPane, type OpenResult } from './editor'
import { loadRuns, openRun, rerunFailed, runColumns } from './workflows'
import type { DaemonEvent, LoopInfo, PaneInfo } from './protocol'
import { ACCENT, at, box, brandMark, DIM, gradient, isLightBackground, logo, LIFT, onFill, PANE, setLight, stripColor, SUBTLE, SURFACE, vEdge, width, drawTerm, fit, glyph, hints, layout, paneDetails, paneSignal, popup, ruleLine, sidebar, SIDEBAR_W, tabBarLayout, tilde, TONE_SGR, tailFit, selectionText, type Cell, type PopupRow, type Rect, type Selection, type Sidebar, type TabBar } from './render'
import { createTerm, type Term } from './screen'
import { VERSION } from './version'

/**
 * `sldev` with no arguments: every session (an agent or a plain shell) is a tab along the top, numbered
 * 1, 2, 3 with a + for a new one; on wide terminals a sidebar groups them by project with each one's state.
 * One or two are shown, and the keyboard goes to the tab in focus. Ctrl-b is the prefix (n/p, 1-9, </> move,
 * s split, c new tab, t new shell, , rename, x close, w workflows, e editor, v changed files, ? keys,
 * d detach); tabs, sidebar rows and + take clicks too. Detaching leaves every session running, and the
 * daemon keeps the tabs' order, names, the one in front and the split.
 */

const PREFIX = '\x02'
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
/** the hint bar, and what the prefix waits for */
// the most useful first: a narrow terminal shows only the ones that fit
const HINTS: Array<[string, string]> = [['c', 'new tab'], ['t', 'shell'], ['1-9', 'go to'], ['?', 'all keys'], ['d', 'detach'], ['s', 'split'], ['w', 'workflows'], ['n/p', 'next/prev'], ['e', 'editor']]
const RUNS_HINTS: Array<[string, string]> = [['↑↓', 'pick'], ['Enter', 'open in browser'], ['r', 'rerun failed jobs'], ['u', 'refresh'], ['Esc', 'close']]
const MENU_HINTS: Array<[string, string]> = [['↑↓', 'pick'], ['Enter', 'start'], ['Esc', 'cancel']]
/** every key, for Ctrl-b ? */
const HELP_ROWS: PopupRow[] = [
  { head: true, text: 'Tabs' },
  { key: 'c', text: 'new tab: an agent or a shell' },
  { key: 't', text: 'shell in the folder of the tab in focus' },
  { key: '1-9', text: 'go to tab' },
  { key: 'n p', text: 'next, previous tab' },
  { key: '< >', text: 'move the tab left, right' },
  { key: ',', text: 'rename the tab' },
  { key: 'x', text: 'close the tab' },
  { head: true, text: 'View' },
  { key: 's', text: 'split: the next tab beside this one' },
  { key: 'w', text: 'workflows: GitHub Actions runs of this repo' },
  { key: 'e', text: "the tab's folder in your editor" },
  { key: 'v', text: "the tab's changed files in your editor" },
  { head: true, text: 'Session' },
  { key: 'd', text: 'detach: everything keeps running' },
  { key: '^b', text: 'send Ctrl-b to the tab' }
]
/** a spinner frame for working agents; only while one works */
const SPIN_MS = 100
/** how often the workflows view asks GitHub again while it's open */
const RUNS_REFRESH_MS = 15_000

/**
 * Windows Terminal's win32-input-mode sends every key as `ESC [ Vk ; Sc ; Uc ; Kd ; Cs ; Rc _` (virtual key,
 * scan code, the character, down 1 / up 0, modifier state, repeat count) instead of its plain bytes. Typing
 * into a pane works either way (its ConPTY reads both), but sldev's own keys have to be read out of it.
 */
const WIN32_KEY = /^\x1b\[(\d*);(\d*);(\d*);(\d*);(\d*);(\d*)_/
/** a Ctrl-b key press in that form, anywhere in a chunk */
const WIN32_PREFIX = /\x1b\[\d*;\d*;2;1;\d*;\d*_/
/** keys with no character of their own, as the bytes the views already read */
const WIN32_VK: Record<number, string> = { 13: '\r', 27: '\x1b', 8: '\x7f', 9: '\t', 37: '\x1b[D', 38: '\x1b[A', 39: '\x1b[C', 40: '\x1b[B' }

/** The key a win32-input-mode event stands for: its bytes on a key press, '' on a release or a lone modifier. */
export function win32Key(s: string): { len: number; text: string } | null {
  const m = WIN32_KEY.exec(s)
  if (!m) return null
  const [vk, uc, down] = [Number(m[1] || 0), Number(m[3] || 0), m[4] === '1']
  if (!down) return { len: m[0].length, text: '' }
  return { len: m[0].length, text: uc ? String.fromCharCode(uc) : (WIN32_VK[vk] ?? '') }
}

interface View {
  info: PaneInfo
  term: Term
  /** size last sent to the daemon */
  size?: string
  /** the program in the tab hid its cursor (CSI ?25l): don't draw ours over its own */
  cursorHidden?: boolean
  /** it asked for SGR mouse reports (CSI ?1006h), the encoding clicks are passed on in */
  sgrMouse?: boolean
}

/** What a tab's program switches with CSI ? Pm h/l that the TUI has to know: its cursor and mouse encoding. */
function trackModes(v: View): void {
  const set = (on: boolean) => (params: (number | number[])[]): boolean => {
    for (const p of params.flat()) {
      if (p === 25) v.cursorHidden = !on
      if (p === 1006) v.sgrMouse = on
    }
    // not handled here: xterm still applies the mode itself
    return false
  }
  v.term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, set(true))
  v.term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, set(false))
}

/** the terminal's answer to "what's your background colour?" (OSC 11), ended by BEL or ST */
const BG_ANSWER = /^\x1b\]11;([^\x07\x1b]*)(?:\x07|\x1b\\)/

/** a mouse report in SGR form: ESC [ < button ; x ; y M (press) or m (release) */
const MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/

/** The New tab popup: a shell, then each agent, installed or not. */
interface Menu {
  rows: PopupRow[]
  pick: Array<() => void>
  sel: number
}

/** The terminal the TUI runs in: process.stdin/stdout, or fakes in tests. */
export interface TuiIo {
  input: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (on: boolean) => unknown }
  output: NodeJS.WritableStream & { columns?: number; rows?: number; on(event: 'resize', fn: () => void): unknown }
}

/** What the TUI asks GitHub and the editor through; tests pass fakes. */
export interface TuiServices {
  runs: (cwd: string) => Promise<GhRun[]>
  rerun: (cwd: string, id: number) => Promise<void>
  openRun: (cwd: string, id: number) => Promise<void>
  open: (pane: PaneInfo, diff: boolean) => Promise<OpenResult>
  /** puts text on the system clipboard; false when there's no tool for it */
  copy?: (text: string) => Promise<boolean>
}

export function defaultServices(preferred: () => string | null): TuiServices {
  return { runs: loadRuns, rerun: rerunFailed, openRun, open: (p, diff) => openPane(p, { diff, preferred: preferred() }), copy: copyToClipboard }
}

/** lines the wheel scrolls a tab's history by */
const WHEEL_LINES = 3

interface RunsView {
  cwd: string
  runs: GhRun[]
  sel: number
  loading: boolean
  error?: string
  timer?: NodeJS.Timeout
}

export async function runTui(client: Client, cwd: string, io: TuiIo = { input: process.stdin, output: process.stdout }, services: TuiServices = defaultServices(() => null)): Promise<void> {
  const out = io.output
  const input = io.input
  const views = new Map<string, View>()
  /** tab order, as the daemon keeps it */
  let order: string[] = []
  /** the tab in focus */
  let active: string | null = null
  let split = false
  let prefix = false
  let prompt: { label: string; text: string; done: (text: string) => void } | null = null
  let message = ''
  let runsView: RunsView | null = null
  let menu: Menu | null = null
  let help = false
  let loops = new Map<string, LoopInfo>()
  let frame: NodeJS.Timeout | null = null
  let restored = false
  /** the spinner's frame, and its timer while an agent works */
  let spin = 0
  let spinTimer: NodeJS.Timeout | null = null
  /** the clock on the status bar moves on even when nothing else does */
  const clock = setInterval(() => schedule(), 30_000)
  clock.unref?.()
  /** what the last frame drew where, for clicks */
  let bar: TabBar = { text: '', spans: [], plus: null }
  /** text being selected (or just copied) in a tab by dragging the mouse */
  let sel: { pane: string; s: Selection; dragging: boolean } | null = null
  let side: Sidebar = { lines: [], hits: [] }
  const home = homedir()

  const activeIndex = (): number => Math.max(0, active === null ? 0 : order.indexOf(active))

  /** the tab in focus, and in a split the one after it */
  const visible = (): string[] => {
    if (!order.length) return []
    const i = activeIndex()
    if (!split || order.length < 2) return [order[i]]
    return [order[i], order[(i + 1) % order.length]]
  }

  /** the daemon keeps the tabs, so the next attach finds them as they are now */
  const saveTabs = (patch: { order?: string[]; active?: string | null; split?: boolean }): void => void client.request('tabs', patch).catch(() => undefined)

  const addView = async (info: PaneInfo): Promise<void> => {
    if (views.has(info.id)) return
    const view: View = { info, term: createTerm(120, 40) }
    trackModes(view)
    views.set(info.id, view)
    if (!order.includes(info.id)) order.push(info.id)
    active ??= info.id
    const { data } = await client.request('screen', { pane: info.id }, 10_000).catch(() => ({ data: '' }))
    // xterm parses a write later: wait for it, or a quiet pane (a shell at its prompt) stays blank until it prints again
    await new Promise<void>((r) => view.term.write(data, r))
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

  /** the brand, the tab bar, the rule under it and the sidebar: everything but the panes */
  function chrome(): string {
    const cols = out.columns || 80
    const rows = out.rows || 24
    const l = layout(cols, rows, split)
    const shown = visible()
    let s = ''
    // the brand on the frame's surface, and the column over the divider with it
    if (l.brand) s += at(0, 0) + onFill(SURFACE, ' ' + brandMark() + `${SUBTLE} ${fit(VERSION, SIDEBAR_W - 7)}${RESET}`) + onFill(SURFACE, ' ')
    bar = tabBarLayout(
      order.flatMap((id) => {
        const v = views.get(id)
        return v ? [{ title: v.info.title, tone: paneSignal(v.info).tone, glyph: glyph(v.info, spin), active: id === shown[0], shown: shown.includes(id) }] : []
      }),
      l.tabs.w
    )
    s += at(l.tabs.x, l.tabs.y) + bar.text
    // the rule row: under the sidebar, the junction, then each pane's rule
    // a slim brand gradient under the name, as in the app
    if (l.sidebar) s += at(0, 1) + onFill(SURFACE, gradient('─'.repeat(SIDEBAR_W)))
    l.panes.forEach((r, i) => {
      const v = shown[i] ? views.get(shown[i]) : undefined
      if (l.panes.length > 1) {
        const n = order.indexOf(shown[i]) + 1
        const info = v ? `${n} ${v.info.title} · ${paneDetails(v.info, home, false)}` : ''
        s += at(r.x, r.y) + ruleLine(r.w, i === 0 ? { from: -1, to: r.w + 1 } : null, info)
      } else {
        const span = bar.spans.find((x) => order[x.index] === shown[0])
        const back = v ? scrolledBack(v) : 0
        s += at(r.x, r.y) + ruleLine(r.w, span ?? null, v ? `${back ? `↑ ${back} lines back · ` : ''}${paneDetails(v.info, home)}` : '')
      }
    })
    if (l.sidebar) {
      side = sidebar({ panes: [...views.values()].map((v) => v.info), order, active: shown[0] ?? null, shown, loops: [...loops.values()], frame: spin, home }, l.sidebar.w, l.sidebar.h)
      side.lines.forEach((line, i) => (s += at(l.sidebar!.x, l.sidebar!.y + i) + line))
      // the sidebar's edge: the brand top to bottom, softened, from the junction with the rule down
      s += vEdge(SIDEBAR_W, 1, l.sidebar.h + 1, '┬')
    }
    return stripColor(s)
  }

  /** where the terminal's cursor goes: the prompt, else the tab's own cursor if it shows one */
  function cursor(): string {
    const l = layout(out.columns || 80, out.rows || 24, split)
    if (prompt) return at(3 + prompt.label.length + prompt.text.length, l.status.y) + '\x1b[?25h'
    const main = visible()[0] && views.get(visible()[0])
    if (!main || menu || help || runsView || main.cursorHidden || scrolledBack(main)) return ''
    const b = main.term.buffer.active
    return at(l.panes[0].x + Math.min(b.cursorX, l.panes[0].w - 1), l.panes[0].y + 1 + b.cursorY) + '\x1b[?25h'
  }

  function draw(): void {
    frame = null
    if (restored) return
    const cols = out.columns || 80
    const rows = out.rows || 24
    const l = layout(cols, rows, split)
    let s = '\x1b[?2026h\x1b[?25l' + chrome()
    const shown = visible()
    const area: Rect = { x: l.panes[0].x, y: l.panes[0].y + 1, w: l.panes[l.panes.length - 1].x + l.panes[l.panes.length - 1].w - l.panes[0].x, h: l.panes[0].h - 1 }
    if (runsView) s += stripColor(drawRuns(runsView, area))
    else if (!shown.length) s += stripColor(welcome(area))
    else
      shown.forEach((id, i) => {
        const v = views.get(id)
        const r = l.panes[i]
        if (!v || !r) return
        s += drawTerm(v.term, { x: r.x, y: r.y + 1, w: r.w, h: r.h - 1 }, sel?.pane === id ? sel.s : null, i > 0)
        // the split's edge, from the junction on the rule row down between the panes
        if (i === 0 && l.panes[1]) s += stripColor(vEdge(r.x + r.w, r.y, r.h, '┬', PANE, SURFACE))
      })
    if (menu) s += stripColor(popup(area, 'New tab', menu.rows, menu.sel, `in ${tailFit(tilde(newTabCwd(), home), 50).trimEnd()}`))
    else if (help) s += stripColor(popup(area, 'Keys · after Ctrl-b', HELP_ROWS, -1, 'Drag copies, the wheel scrolls back, tabs and + take clicks.'))
    s += at(0, l.status.y) + stripColor(statusLine(cols))
    // every frame ends on a reset, so nothing between frames (a clear, the shell after exit) takes a fill
    out.write(s + RESET + cursor() + '\x1b[?2026l')
    spinning()
  }

  /** nothing open yet: what to do, in the pane area, as a card framed in the brand gradient */
  function welcome(r: Rect): string {
    const lines = [
      ...logo(),
      '',
      `${DIM}coding agents side by side, in your terminal${RESET}`,
      '',
      `${ACCENT}^b c${RESET}  new tab: an agent or a shell`,
      `${ACCENT}^b t${RESET}  a shell here`,
      `${ACCENT}^b ?${RESET}  every key`,
      '',
      `${DIM}or from another terminal:${RESET}`,
      `  sldev new --agent claude "fix the failing test"`
    ]
    let s = ''
    for (let i = 0; i < r.h; i++) s += at(r.x, r.y + i) + onFill(PANE, ' '.repeat(r.w))
    const textW = Math.max(...lines.map((l) => width(l.replace(/\x1b\[[0-9;]*m/g, ''))))
    // a row of air above and below, three columns either side
    const w = textW + 8
    const h = lines.length + 4
    if (w + 2 <= r.w && h <= r.h) {
      const x = r.x + Math.floor((r.w - w) / 2)
      const y = r.y + Math.max(0, Math.floor((r.h - h) / 3))
      return s + box(x, y, w, h, ['', ...lines.map((l) => '   ' + l), ''], { fill: SURFACE, soft: 0.2 })
    }
    // too small for the card: the lines on their own
    const top = r.y + Math.max(0, Math.floor((r.h - lines.length) / 3))
    lines.slice(0, r.h).forEach((line, i) => (s += at(r.x + 2, top + i) + onFill(PANE, ` ${line}`)))
    return s
  }

  /** the spinner runs while an agent works, and redraws only the chrome */
  function spinning(): void {
    // a spinner while an agent works, a slow breath while one needs you
    const busy = [...views.values()].some((v) => {
      const sig = paneSignal(v.info)
      return (sig.tone === 'working' && sig.pulse) || (!v.info.shell && sig.tone === 'attention')
    })
    if (busy && !spinTimer && !restored)
      spinTimer = setInterval(() => {
        spin++
        if (!frame && !restored) out.write('\x1b[?2026h\x1b[?25l' + chrome() + RESET + cursor() + '\x1b[?2026l')
      }, SPIN_MS)
    else if (!busy && spinTimer) {
      clearInterval(spinTimer)
      spinTimer = null
    }
  }

  function drawRuns(v: RunsView, r: Rect): string {
    // a toolbar row on the frame's surface, the runs on the pane's background, the picked one lifted
    let s = at(r.x, r.y) + onFill(SURFACE, BOLD + fit(` Workflows · ${tilde(v.cwd, home)}${v.loading ? ' · loading…' : ''}`, r.w) + RESET)
    const lines: string[] = []
    if (v.error) lines.push(`\x1b[31m ${fit(v.error, r.w - 1)}${RESET}`)
    else if (!v.runs.length) lines.push(DIM + fit(v.loading ? ' Asking GitHub…' : ' No workflow runs yet in this repository.', r.w) + RESET)
    const now = Date.now()
    const rows = r.h - 2
    const start = Math.max(0, Math.min(v.sel - Math.floor(rows / 2), v.runs.length - rows))
    if (!v.error)
      v.runs.slice(start, start + rows).forEach((run, i) => {
        const c = runColumns(run, now)
        const focus = start + i === v.sel
        const line = `${focus ? `${ACCENT}▌${RESET}` : ' '}\x1b[${TONE_SGR[c.tone]}m●${RESET} ${focus ? BOLD : ''}${fit(`${c.label.padEnd(9)} ${c.text}`, r.w - 3)}${RESET}`
        lines.push(focus ? onFill(LIFT, line) : line)
      })
    for (let i = 0; i < r.h - 1; i++) s += at(r.x, r.y + 1 + i) + onFill(PANE, lines[i] ?? ' '.repeat(r.w))
    return s
  }

  const refreshRuns = (): void => {
    const v = runsView
    if (!v) return
    v.loading = true
    schedule()
    services
      .runs(v.cwd)
      .then((runs) => {
        if (runsView !== v) return
        v.runs = runs
        v.error = undefined
        v.sel = Math.min(v.sel, Math.max(0, runs.length - 1))
      })
      .catch((err: Error) => runsView === v && (v.error = err.message))
      .finally(() => {
        if (runsView !== v) return
        v.loading = false
        clearTimeout(v.timer)
        // while it's open it follows the runs; a gh that isn't there or signed in isn't asked again
        if (!v.error) v.timer = setTimeout(refreshRuns, RUNS_REFRESH_MS)
        schedule()
      })
  }

  const openRuns = (): void => {
    const id = visible()[0]
    runsView = { cwd: (id && views.get(id)?.info.root) || cwd, runs: [], sel: 0, loading: true }
    message = ''
    refreshRuns()
  }

  const closeRuns = (): void => {
    if (runsView) clearTimeout(runsView.timer)
    runsView = null
    message = ''
    schedule()
  }

  /** Keys while the workflows view is open; returns what is left. */
  function runsKey(s: string): string {
    const v = runsView!
    const arrow = /^\x1b\[([AB])/.exec(s) ?? /^\x1bO([AB])/.exec(s)
    if (arrow || s[0] === 'j' || s[0] === 'k') {
      const up = arrow ? arrow[1] === 'A' : s[0] === 'k'
      v.sel = Math.max(0, Math.min(v.runs.length - 1, v.sel + (up ? -1 : 1)))
      return s.slice(arrow ? arrow[0].length : 1)
    }
    const c = s[0]
    const run = v.runs[v.sel]
    if (c === '\x1b' || c === 'q' || c === '\x03') {
      closeRuns()
      // a lone Esc, or the rest of a sequence that isn't an arrow
      return ''
    }
    if (c === 'u') refreshRuns()
    else if ((c === '\r' || c === 'o') && run)
      services
        .openRun(v.cwd, run.databaseId)
        .then(() => (message = `Opened run ${run.databaseId} in the browser`))
        .catch((err: Error) => (message = err.message))
        .finally(schedule)
    else if (c === 'r' && run) {
      if (run.status !== 'completed' || run.conclusion === 'success') message = 'Only a finished run that failed can be rerun'
      else
        ask(`Rerun the failed jobs of ${run.workflowName} #${run.number}? (y/N) `, (text) => {
          if (!/^y/i.test(text.trim())) return
          services
            .rerun(v.cwd, run.databaseId)
            .then(() => ((message = `Rerunning the failed jobs of #${run.number}`), refreshRuns()))
            .catch((err: Error) => (message = err.message))
            .finally(schedule)
        })
    } else if (c === PREFIX) {
      // Ctrl-b goes on working: Ctrl-b w closes the view, any other key closes it and does its thing
      prefix = true
    }
    return s.slice(1)
  }

  const openEditor = (diff: boolean): void => {
    const id = visible()[0]
    const info = id ? views.get(id)?.info : undefined
    if (!info) return void (message = 'No pane to open')
    message = diff ? 'Opening the changes in your editor…' : 'Opening the folder in your editor…'
    services
      .open(info, diff)
      .then((r) => (message = r.terminal ? `Only a terminal editor was found: run sldev open ${info.id} from another terminal` : r.note))
      .catch((err: Error) => (message = err.message))
      .finally(schedule)
  }

  /** the bottom row, on the frame's surface: a prompt, a message, or the keys as chips */
  function statusLine(cols: number): string {
    return onFill(SURFACE, statusText(cols))
  }

  function statusText(cols: number): string {
    if (prompt) return ` ${ACCENT}›${RESET} ` + BOLD + fit(prompt.label, Math.min(prompt.label.length, cols - 3)) + RESET + fit(prompt.text, Math.max(0, cols - 3 - prompt.label.length))
    // waiting for the key after the prefix: amber, as anything that waits for you
    if (prefix) return hints(HINTS, cols, ` \x1b[1;${TONE_SGR.attention}m^b${RESET} `)
    if (message) return ` ${DIM}•${RESET} ` + fit(message, cols - 3)
    if (menu) return hints(MENU_HINTS, cols, ' ')
    if (help) return hints([['any key', 'close']], cols, ' ')
    if (runsView) return hints(RUNS_HINTS, cols, ' ')
    const right = rightStatus()
    const rw = cols >= 90 ? right.length : 0
    return hints(HINTS, cols - rw, ` ${ACCENT}^b${RESET} `) + (rw ? `${DIM}${right}${RESET}` : '')
  }

  /** the bottom right: the focused tab's project and the time */
  function rightStatus(): string {
    const id = visible()[0]
    const info = id ? views.get(id)?.info : undefined
    const project = info ? (info.root || info.cwd).replace(/[\\/]+$/, '').split(/[\\/]/).pop() : ''
    const d = new Date()
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    return `${project ? `${project} · ` : ''}${time} `
  }

  /** a new tab works where the tab in focus works (its worktree), else where sldev was attached */
  const newTabCwd = (): string => {
    const id = visible()[0]
    return (id && views.get(id)?.info.cwd) || cwd
  }

  const newShell = (): void => {
    client
      .request('new', { shell: true, brief: '', cwd: newTabCwd(), ...paneSize() })
      .then((p) => started(p, 'shell'))
      .catch((err: Error) => ((message = err.message), schedule()))
  }

  const newAgent = (a: AgentDef): void => {
    const where = newTabCwd()
    ask(`${a.name}, brief (Enter alone starts it without one): `, (text) => {
      client
        .request('new', { agent: a.id, brief: text.trim(), cwd: where, worktree: false, ...paneSize() })
        .then((p) => started(p, a.name))
        .catch((err: Error) => ((message = err.message), schedule()))
    })
  }

  /** Ctrl-b c or a click on +: a shell, or one of the agents (the ones not installed say how to get them) */
  const openMenu = (): void => {
    const agents = allAgents()
    setInstalledBins(agents.flatMap((a) => [a.bin, ...(a.aliases ?? [])]).filter((b) => findOnPath(b, process.env)))
    const rows: PopupRow[] = [{ key: 't', text: 'Shell', note: process.platform === 'win32' ? '' : (process.env.SHELL ?? '').split('/').pop() }]
    const pick: Array<() => void> = [newShell]
    agents.forEach((a, i) => {
      const ok = !!installedBin(a)
      rows.push({ key: i < 9 ? String(i + 1) : '', text: a.name, note: ok ? '' : 'not installed', off: !ok })
      pick.push(() => (ok ? newAgent(a) : void (message = a.install ? `${a.name} isn't installed: ${a.install}` : `${a.name} isn't installed`)))
    })
    menu = { rows, pick, sel: Math.max(0, rows.findIndex((r, i) => i > 0 && !r.off)) }
    help = false
    message = ''
  }

  /** Keys while the New tab popup is open; returns what is left. */
  function menuKey(s: string): string {
    const m = menu!
    const arrow = /^\x1b\[([AB])/.exec(s) ?? /^\x1bO([AB])/.exec(s)
    if (arrow || s[0] === 'j' || s[0] === 'k') {
      const up = arrow ? arrow[1] === 'A' : s[0] === 'k'
      m.sel = Math.max(0, Math.min(m.rows.length - 1, m.sel + (up ? -1 : 1)))
      return s.slice(arrow ? arrow[0].length : 1)
    }
    const c = s[0]
    if (c === '\x1b' || c === 'q' || c === '\x03') {
      menu = null
      return ''
    }
    const i = c === '\r' ? m.sel : m.rows.findIndex((r) => r.key === c)
    if (i >= 0) {
      menu = null
      m.pick[i]()
    }
    return s.slice(1)
  }

  /** lines a tab is scrolled back from its newest output */
  const scrolledBack = (v: View): number => v.term.buffer.active.baseY - v.term.buffer.active.viewportY

  const scroll = (v: View, by: number): void => {
    v.term.scrollLines(by)
    sel = null
  }

  /** the selection to the clipboard: the system's tool, and OSC 52 for terminals that take it (over SSH too) */
  const copySelection = (v: View, s: Selection): void => {
    const text = selectionText(v.term, s)
    if (!text.trim()) return void (sel = null)
    out.write(osc52(text))
    const n = [...text].length
    void (services.copy ?? copyToClipboard)(text)
      .catch(() => false)
      .then((ok) => {
        message = ok ? `Copied ${n} character${n === 1 ? '' : 's'}` : `Sent ${n} characters to the terminal's clipboard (OSC 52); if nothing arrived, install wl-clipboard or xclip`
        schedule()
      })
  }

  /** A click: on a tab or + in the bar, a row of the sidebar, or inside a tab whose program reads the mouse. */
  function mouse(button: number, x: number, y: number, down: boolean): void {
    const l = layout(out.columns || 80, out.rows || 24, split)
    const wheel = (button & 64) !== 0
    const motion = (button & 32) !== 0
    const shown = visible()
    /** the cell under the mouse in pane i, held inside it (a drag can leave the pane) */
    const cellIn = (i: number): Cell => {
      const r = l.panes[i]
      return { x: Math.max(0, Math.min(r.w - 1, x - r.x)), y: Math.max(0, Math.min(r.h - 2, y - r.y - 1)) }
    }
    // a selection being dragged follows the mouse anywhere, and the release copies it
    if (sel?.dragging) {
      const i = shown.indexOf(sel.pane)
      const v = views.get(sel.pane)
      if (i < 0 || !v) return void (sel = null)
      sel.s.b = cellIn(i)
      if (!down) {
        sel.dragging = false
        if (sel.s.a.x === sel.s.b.x && sel.s.a.y === sel.s.b.y) sel = null
        else copySelection(v, sel.s)
      }
      return
    }
    if (!menu && !help && !runsView) {
      for (let i = 0; i < l.panes.length; i++) {
        const r = l.panes[i]
        const v = shown[i] ? views.get(shown[i]) : undefined
        if (!v || x < r.x || x >= r.x + r.w || y <= r.y || y >= r.y + r.h) continue
        const mode = v.term.modes.mouseTrackingMode
        // a program that doesn't read the mouse: the wheel scrolls its history, a drag selects and copies
        if (mode === 'none') {
          if (wheel) return scroll(v, (button & 1) === 0 ? -WHEEL_LINES : WHEEL_LINES)
          if (down && !motion && (button & 3) === 0) sel = { pane: v.info.id, s: { a: cellIn(i), b: cellIn(i) }, dragging: true }
          return
        }
        // one that does gets the clicks it asked for: motion only in drag/any mode, x10 presses only
        if ((mode === 'x10' && (!down || wheel || motion)) || (motion && mode === 'vt200')) return
        const [px, py] = [x - r.x + 1, y - r.y]
        const data = v.sgrMouse ? `\x1b[<${button};${px};${py}${down ? 'M' : 'm'}` : px < 223 && py < 223 ? `\x1b[M${String.fromCharCode(32 + (down ? button : 3), 32 + px, 32 + py)}` : ''
        if (data) void client.request('input', { pane: v.info.id, data }).catch(() => undefined)
        return
      }
    }
    if (!down || wheel || motion || (button & 3) !== 0) return
    sel = null
    if (help) return void (help = false)
    if (menu) return void (menu = null)
    if (y === l.tabs.y && x >= l.tabs.x) {
      const bx = x - l.tabs.x
      if (bar.plus && bx >= bar.plus.from && bx < bar.plus.to) return openMenu()
      const hit = bar.spans.find((t) => bx >= t.from && bx < t.to)
      if (hit && order[hit.index]) {
        if (runsView) closeRuns()
        focusTab(order[hit.index])
      }
      return
    }
    if (l.sidebar && x < l.sidebar.x + l.sidebar.w && y >= l.sidebar.y) {
      const id = side.hits[y - l.sidebar.y]
      if (id) {
        if (runsView) closeRuns()
        focusTab(id)
      }
    }
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
      const at = order.indexOf(e.pane)
      order = order.filter((id) => id !== e.pane)
      // the tab that takes the closed one's place comes to the front, as the daemon does
      if (active === e.pane) active = order[Math.min(Math.max(0, at), order.length - 1)] ?? null
      sizeViews()
      schedule()
    } else if (e.event === 'loop') {
      loops.set(e.loop.id, e.loop)
      schedule()
    } else if (e.event === 'notify' && !visible().includes(e.pane)) {
      message = `${e.title}: ${e.body}`
      schedule()
    }
  }

  const select = (i: number): void => {
    if (!order.length) return
    focusTab(order[((i % order.length) + order.length) % order.length])
  }

  const focusTab = (id: string): void => {
    active = id
    sel = null
    message = ''
    saveTabs({ active })
    sizeViews()
    schedule()
  }

  /** the tab in focus one place left or right */
  const move = (by: number): void => {
    const i = activeIndex()
    const j = i + by
    if (!order.length || j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    saveTabs({ order })
    sizeViews()
  }

  /** a pane this TUI started comes to the front */
  const started = (p: PaneInfo, what: string): void => {
    if (!order.includes(p.id)) order.push(p.id)
    message = `Started ${what} ${p.id}`
    focusTab(p.id)
  }

  const ask = (label: string, done: (text: string) => void, text = ''): void => {
    prompt = { label, text, done }
    schedule()
  }

  let resolveExit: () => void = () => undefined
  const finished = new Promise<void>((r) => (resolveExit = r))

  /** Keys can arrive several to a chunk (fast typing, a paste), so the input is taken apart here. */
  // SLDEV_DEBUG_KEYS=<file> logs what the terminal sends, to tell why a key isn't taken
  const keyLog = process.env.SLDEV_DEBUG_KEYS
  const onKey = (d: Buffer | string): void => {
    let rest = d.toString()
    if (keyLog) {
      try {
        appendFileSync(keyLog, `${JSON.stringify({ at: Date.now(), tab: visible()[0] ?? null, prefix, data: rest })}\n`)
      } catch {
        // a log that can't be written doesn't stop the keys
      }
    }
    while (rest && !restored) rest = key(rest)
    schedule()
  }

  /** Handles the start of `s` and returns what is left. */
  function key(s: string): string {
    const bg = BG_ANSWER.exec(s)
    if (bg) {
      const light = isLightBackground(bg[1])
      if (light !== null) setLight(light)
      return s.slice(bg[0].length)
    }
    const m = MOUSE.exec(s)
    if (m) {
      mouse(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1, m[4] === 'M')
      return s.slice(m[0].length)
    }
    // a prompt, the prefix's next key and the popups read keys themselves: decode an encoded one first
    const w = (prompt || prefix || runsView || menu || help) && win32Key(s)
    if (w) {
      // a release, or a modifier on its own, leaves the prefix waiting for its key
      let k = w.text
      while (k && !restored) k = key(k)
      return s.slice(w.len)
    }
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
    if (menu && !prefix) return menuKey(s)
    if (help && !prefix) {
      help = false
      // the key that closes it does nothing else, and a sequence (an arrow) goes with it
      return s[0] === '\x1b' ? '' : s.slice(1)
    }
    if (runsView && !prefix) return runsKey(s)
    if (prefix) {
      prefix = false
      const c = s[0]
      const id = visible()[0]
      if (c === 'w') {
        if (runsView) closeRuns()
        else openRuns()
        return s.slice(1)
      }
      if (runsView) closeRuns()
      menu = null
      help = false
      if (c === '?') {
        help = true
        return s.slice(1)
      }
      if (c === 'e' || c === 'v') {
        openEditor(c === 'v')
        return s.slice(1)
      }
      if (c === 'n' || c === '\t' || c === 'o') select(activeIndex() + 1)
      else if (c === 'p') select(activeIndex() - 1)
      else if (/^[1-9]$/.test(c)) {
        if (Number(c) <= order.length) select(Number(c) - 1)
      } else if (c === '<') move(-1)
      else if (c === '>') move(1)
      else if (c === 's') {
        split = !split
        saveTabs({ split })
        sizeViews()
      } else if (c === 'd') {
        detach()
        return ''
      } else if (c === 'c' || c === '+') openMenu()
      else if (c === 't') newShell()
      else if (c === ',' && id) {
        const info = views.get(id)?.info
        ask(
          `Rename tab ${id}: `,
          (text) => {
            if (text.trim()) void client.request('rename', { pane: id, title: text }).catch((err: Error) => ((message = err.message), schedule()))
          },
          info?.title ?? ''
        )
      } else if (c === 'x' && id) {
        const info = views.get(id)?.info
        const kill = (): void => void client.request('kill', { pane: id }).catch((err: Error) => ((message = err.message), schedule()))
        // nothing runs in it any more: close it without asking
        if (info?.pid === undefined) kill()
        else
          ask(info.shell ? `Close tab ${id}? Its shell and anything running in it stop. (y/N) ` : `Close tab ${id}? Its agent stops; files stay. (y/N) `, (text) => {
            if (/^y/i.test(text.trim())) kill()
          })
      }
      else if (c === PREFIX && id) void client.request('input', { pane: id, data: PREFIX })
      return s.slice(1)
    }
    // Ctrl-b as a byte, or as a win32-input-mode key press; everything before it goes to the pane as it came
    const plain = s.indexOf(PREFIX)
    const enc = WIN32_PREFIX.exec(s)
    const useEnc = !!enc && (plain < 0 || enc.index < plain)
    const at = useEnc ? enc!.index : plain
    // a mouse report before the prefix: what comes before it goes to the tab, the report is read next
    // the background answer is read the same way: never typed into the tab
    const answer = s.indexOf('\x1b]11;')
    const clickAt = s.indexOf('\x1b[<')
    const click = answer >= 0 && (clickAt < 0 || answer < clickAt) ? answer : clickAt
    const cut = click >= 0 && (at < 0 || click < at) ? click : at
    const typed = cut < 0 ? s : s.slice(0, cut)
    const id = visible()[0]
    if (typed && id) {
      // typing goes back to the newest output, and ends a selection
      const v = views.get(id)
      if (v && scrolledBack(v)) v.term.scrollToBottom()
      sel = null
      void client.request('input', { pane: id, data: typed }).catch(() => undefined)
    }
    if (cut < 0) return ''
    if (cut === click) return s.slice(click)
    prefix = true
    return s.slice(at + (useEnc ? enc![0].length : 1))
  }

  const restore = (): void => {
    if (restored) return
    restored = true
    if (frame) clearTimeout(frame)
    if (spinTimer) clearInterval(spinTimer)
    clearInterval(clock)
    if (runsView) clearTimeout(runsView.timer)
    input.off('data', onKey)
    if (input.isTTY) input.setRawMode?.(false)
    input.pause()
    // colours reset before and after leaving the alternate screen, so the shell isn't left on sldev's fills
    out.write('\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[0m\x1b[?25h\x1b[?1049l\x1b[0m')
  }

  function detach(): void {
    restore()
    out.write('Detached. The agents keep running; `sldev` attaches again.\n')
    client.close()
    resolveExit()
  }

  /** the size a new pane starts at, so it doesn't redraw as soon as it's shown */
  function paneSize(): { cols: number; rows: number } {
    const r = layout(out.columns || 80, out.rows || 24, split).panes[0]
    return { cols: Math.max(20, r.w), rows: Math.max(5, r.h - 1) }
  }

  // a daemon that doesn't answer is an error, never a blank screen that waits forever
  const panes = await client.request('attach', { cols: out.columns || 80, rows: out.rows || 24 }, 10_000)
  const saved = await client.request('tabs', {}, 10_000).catch(() => null)
  for (const l of await client.request('loops', {}, 10_000).catch(() => [])) loops.set(l.id, l)
  if (saved) {
    order = saved.order.filter((id) => panes.some((p) => p.id === id))
    active = saved.active
    split = saved.split
  }
  for (const p of panes) await addView(p)
  if (active === null || !order.includes(active)) active = order[0] ?? null
  client.onEvent(onEvent)
  client.onClose(() => {
    if (restored) return
    restore()
    out.write('The sldev daemon stopped.\n')
    resolveExit()
  })
  // the alternate screen, and the mouse reported (presses, drags, releases, SGR form): sldev selects and copies itself
  // and the background colour asked for (OSC 11), so lines and popups suit a light terminal too
  out.write('\x1b[?1049h\x1b[2J\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b]11;?\x07')
  if (input.isTTY) input.setRawMode?.(true)
  input.resume()
  input.on('data', onKey)
  out.on('resize', () => {
    out.write(RESET + '\x1b[2J')
    sizeViews()
    schedule()
  })
  sizeViews()
  draw()
  return finished
}
