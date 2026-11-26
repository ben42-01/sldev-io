import { appendFileSync } from 'fs'
import { homedir } from 'os'
import { allAgents, installedBin, setInstalledBins, type AgentDef } from '@shared/agents'
import type { GhRun } from '@shared/types'
import { findOnPath } from '../../src/main/launch'
import type { Client } from './client'
import { copyToClipboard, osc52 } from './clipboard'
import { completePath, expandPath, isFolder, parentFolder, projectList, readRecent, rememberProject, subfolders } from './folders'
import { editInTerminal, openPane, type OpenResult } from './editor'
import { briefNote, briefsDir, briefTitle, cliKinds, cliRoot, launchBrief, listBriefs, newBriefFile, shownDir, takeEditedBrief } from './briefs'
import { loadRuns, openRun, rerunFailed, runColumns } from './workflows'
import type { DaemonEvent, LoopInfo, PaneInfo, TabState } from './protocol'
import { addRuntime, checkName, listRuntimes, nameFrom, removeRuntime, runtimesFile, type Runtime } from './runtimes'
import { ACCENT, at, box, brandMark, DIM, edgeColor, ellipsis, gradient, MUTED, isLightBackground, logo, LIFT, onFill, PANE, setLight, stripColor, SUBTLE, SURFACE, vEdge, width, drawTerm, fit, glyph, hints, layout, paneDetails, paneSignal, popup, popupHit, ruleLine, sidebar, SIDEBAR_W, sidebarWidth, tabBarLayout, tilde, TONE_SGR, tailFit, selectionText, type Cell, type PopupRow, type Rect, type Selection, type Sidebar, type TabBar } from './render'
import { createTerm, type Term } from './screen'
import { readConfig } from './config'
import { INSTALL_COMMAND, markAnnounced, updateCheckOff, updateToAnnounce } from './updates'
import { VERSION } from './version'

/**
 * `sldev` with no arguments: every session (an agent or a plain shell) is a tab along the top, numbered
 * 1, 2, 3 with a + for a new one; on wide terminals a sidebar groups them by project with each one's state.
 * One or two are shown, and the keyboard goes to the tab in focus. Ctrl-b is the prefix (n/p, 1-9, </> move,
 * s split, c new tab, t new shell, r runtimes, b briefs, , rename, x close, w workflows, e editor, v changed files, ? keys,
 * d detach); tabs, sidebar rows and + take clicks too. Detaching leaves every session running, and the
 * daemon keeps the tabs' order, names, the one in front and the split.
 */

const PREFIX = '\x02'
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
/** the hint bar, and what the prefix waits for */
// the most useful first: a narrow terminal shows only the ones that fit
const HINTS: Array<[string, string]> = [['c', 'new tab'], ['t', 'shell'], ['r', 'runtimes'], ['1-9', 'go to'], ['?', 'all keys'], ['d', 'detach'], ['b', 'briefs'], ['s', 'split'], ['w', 'workflows'], ['n/p', 'next/prev'], ['e', 'editor']]
const RUNS_HINTS: Array<[string, string]> = [['↑↓', 'pick'], ['Enter', 'open in browser'], ['r', 'rerun failed jobs'], ['u', 'refresh'], ['Esc', 'close']]
const MENU_HINTS: Array<[string, string]> = [['↑↓', 'pick'], ['Enter', 'start'], ['Esc', 'cancel']]
const BRIEF_HINTS: Array<[string, string]> = [['↑↓', 'pick'], ['Enter', 'launch'], ['Esc', 'cancel']]
const RUNTIME_HINTS: Array<[string, string]> = [['↑↓', 'pick'], ['Enter', 'run'], ['+', 'new'], ['x', 'remove'], ['Esc', 'cancel']]
const FOLDER_HINTS: Array<[string, string]> = [['↑↓', 'pick'], ['Enter', 'open'], ['⌫', 'up'], ['Esc', 'back']]

/** the next row up or down that isn't a heading, held at the ends */
function stepRow(rows: PopupRow[], sel: number, by: number): number {
  for (let i = sel + by; i >= 0 && i < rows.length; i += by) if (!rows[i].head) return i
  return sel
}
/** every key, for Ctrl-b ? */
const HELP_ROWS: PopupRow[] = [
  { head: true, text: 'Tabs' },
  { key: 'c', text: 'new tab: a project, then an agent or a shell' },
  { key: 't', text: 'shell in the folder of the tab in focus' },
  { key: 'r', text: 'runtimes: run a saved command or a project script' },
  { key: 'b', text: 'briefs: launch one waiting in .sldev-cli/briefs' },
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
  { key: 'u', text: 'update sldev: npm install in a new tab' },
  { key: 'd', text: 'detach: everything keeps running' },
  { key: '^b', text: 'send Ctrl-b to the tab' }
]
/** a spinner frame for working agents; only while one works */
const SPIN_MS = 100
/** how long a message from the person's own action holds the status line against other tabs' notifications */
const MESSAGE_HOLD_MS = 5000
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

/** A popup to pick from: New tab (a shell, then each agent, installed or not) or the waiting briefs. */
interface Menu {
  title: string
  /** the line under the rows */
  footer: string
  hints: Array<[string, string]>
  rows: PopupRow[]
  /** `click`: picked with the mouse, which acts at once (no brief to ask for) */
  pick: Array<(click?: boolean) => void>
  sel: number
  /** only Enter picks: no row has a key of its own */
  enterOnly?: boolean
  /** keys of the popup's own that act on the row in focus (x removes a saved runtime) */
  keys?: Record<string, (sel: number) => void>
  /** Backspace or ←: the folder browser goes up */
  back?: () => void
  /** Esc: the folder browser goes back to New tab instead of closing */
  cancel?: () => void
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
  /** edits a file in the terminal ($VISUAL, $EDITOR, else vi) until the editor exits; the TUI steps aside meanwhile */
  edit?: (file: string) => Promise<void>
  /** a newer sldev (updates.ts), `first` when it wasn't told about yet; missing in tests, so they never ask the registry */
  update?: () => Promise<{ version: string; first: boolean } | null>
  /** what updating runs in a new tab (npm install -g sldev-cli@latest); without it the command is copied instead */
  updateCommand?: string
}

export function defaultServices(preferred: () => string | null, dataDir = ''): TuiServices {
  const update = async (): Promise<{ version: string; first: boolean } | null> => {
    if (!dataDir || updateCheckOff(process.env, readConfig(dataDir).updateCheck)) return null
    const v = await updateToAnnounce(dataDir)
    if (v?.first) markAnnounced(dataDir, v.version)
    return v
  }
  return { runs: loadRuns, rerun: rerunFailed, openRun, open: (p, diff) => openPane(p, { diff, preferred: preferred() }), copy: copyToClipboard, edit: editInTerminal, update, updateCommand: INSTALL_COMMAND }
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

export async function runTui(client: Client, cwd: string, io: TuiIo = { input: process.stdin, output: process.stdout }, services: TuiServices = defaultServices(() => null), dataDir = ''): Promise<void> {
  const out = io.output
  const input = io.input
  const views = new Map<string, View>()
  /** tab order, as the daemon keeps it */
  let order: string[] = []
  /** the tab in focus */
  let active: string | null = null
  let split = false
  let prefix = false
  /** `alt`: Ctrl-e in the prompt does that instead */
  let prompt: { label: string; text: string; done: (text: string) => void; alt?: () => void; complete?: (text: string) => string; cancel?: () => void } | null = null
  /** an editor has the terminal (Ctrl-b c, Ctrl-e): nothing is drawn until it exits */
  let suspended = false
  let message = ''
  // when the message line last changed, so another tab's notification doesn't wipe what the person just did
  let messageSeen = ''
  let messageSince = 0
  let notice = ''
  let runsView: RunsView | null = null
  let menu: Menu | null = null
  let help = false
  /** a newer sldev is out: a card in the sidebar and a chip on the status bar say so, and a click updates */
  let update: string | null = null
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
  let side: Sidebar = { lines: [], hits: [], projects: [], plus: null, update: null, rule: null }
  /** where the status bar's update chip was drawn, for clicks */
  let statusUpdate: { from: number; to: number } | null = null
  /** the sidebar's width, as its edge was last dragged to (the daemon keeps it), and whether it's being dragged */
  let sideW = SIDEBAR_W
  let sideDrag = false
  const home = homedir()
  const lay = (): ReturnType<typeof layout> => layout(out.columns || 80, out.rows || 24, split, sideW)

  const activeIndex = (): number => Math.max(0, active === null ? 0 : order.indexOf(active))

  /** the tab in focus, and in a split the one after it */
  const visible = (): string[] => {
    if (!order.length) return []
    const i = activeIndex()
    if (!split || order.length < 2) return [order[i]]
    return [order[i], order[(i + 1) % order.length]]
  }

  /** the daemon keeps the tabs, so the next attach finds them as they are now */
  const saveTabs = (patch: Partial<TabState>): void => void client.request('tabs', patch).catch(() => undefined)

  const addView = async (info: PaneInfo): Promise<void> => {
    if (views.has(info.id)) return
    const snap = await client.request('screen', { pane: info.id }, 10_000).catch(() => ({ data: '', cols: undefined, rows: undefined }))
    if (views.has(info.id)) return
    // the snapshot is drawn at the pane's own size; sizeViews then fits it to this terminal
    const view: View = { info, term: createTerm(snap.cols ?? 120, snap.rows ?? 40) }
    trackModes(view)
    views.set(info.id, view)
    if (!order.includes(info.id)) order.push(info.id)
    active ??= info.id
    const { data } = snap
    // xterm parses a write later: wait for it, or a quiet pane (a shell at its prompt) stays blank until it prints again
    await new Promise<void>((r) => view.term.write(data, r))
  }

  const sizeViews = (): void => {
    const l = lay()
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
    if (!frame && !restored && !suspended) frame = setTimeout(draw, 33)
  }

  /** the brand, the tab bar, the rule under it and the sidebar: everything but the panes */
  function chrome(): string {
    const cols = out.columns || 80
    const rows = out.rows || 24
    const l = lay()
    const shown = visible()
    let s = ''
    // the brand on the frame's surface, and the column over the divider with it
    if (l.brand) s += at(0, 0) + onFill(SURFACE, ' ' + brandMark() + `${SUBTLE} ${fit(VERSION, l.brand.w - 7)}${RESET}`) + onFill(SURFACE, ' ')
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
    if (l.sidebar) s += at(0, 1) + onFill(SURFACE, gradient('─'.repeat(l.sidebar.w)))
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
      side = sidebar({ panes: [...views.values()].map((v) => v.info), order, active: shown[0] ?? null, shown, loops: [...loops.values()], frame: spin, home, update: update ?? undefined }, l.sidebar.w, l.sidebar.h)
      side.lines.forEach((line, i) => (s += at(l.sidebar!.x, l.sidebar!.y + i) + line))
      // the sidebar's edge: the brand top to bottom, softened, from the junction with the rule down
      s += vEdge(l.sidebar.w, 1, l.sidebar.h + 1, '┬')
      // the footer's rule meets the edge
      if (side.rule !== null) s += at(l.sidebar.w, l.sidebar.y + side.rule) + SURFACE + edgeColor((side.rule + 1) / Math.max(1, l.sidebar.h)) + '┤' + RESET
    }
    return stripColor(s)
  }

  /** where the terminal's cursor goes: the prompt, else the tab's own cursor if it shows one */
  function cursor(): string {
    const l = lay()
    if (prompt) return at(3 + prompt.label.length + prompt.text.length, l.status.y) + '\x1b[?25h'
    const main = visible()[0] && views.get(visible()[0])
    if (!main || menu || help || runsView || main.cursorHidden || scrolledBack(main)) return ''
    const b = main.term.buffer.active
    return at(l.panes[0].x + Math.min(b.cursorX, l.panes[0].w - 1), l.panes[0].y + 1 + b.cursorY) + '\x1b[?25h'
  }

  /** the panes' room under their rules, where the welcome card, the workflows view and the popups go */
  const paneArea = (l: ReturnType<typeof layout>): Rect => ({ x: l.panes[0].x, y: l.panes[0].y + 1, w: l.panes[l.panes.length - 1].x + l.panes[l.panes.length - 1].w - l.panes[0].x, h: l.panes[0].h - 1 })

  function draw(): void {
    frame = null
    if (restored || suspended) return
    const cols = out.columns || 80
    const rows = out.rows || 24
    const l = lay()
    let s = '\x1b[?2026h\x1b[?25l' + chrome()
    const shown = visible()
    const area = paneArea(l)
    if (runsView) s += stripColor(drawRuns(runsView, area))
    // a popup over an empty screen stands alone: the welcome card under it would be a box in a box
    else if (!shown.length) s += stripColor(welcome(area, !menu && !help))
    else
      shown.forEach((id, i) => {
        const v = views.get(id)
        const r = l.panes[i]
        if (!v || !r) return
        s += drawTerm(v.term, { x: r.x, y: r.y + 1, w: r.w, h: r.h - 1 }, sel?.pane === id ? sel.s : null, i > 0)
        // the split's edge, from the junction on the rule row down between the panes
        if (i === 0 && l.panes[1]) s += stripColor(vEdge(r.x + r.w, r.y, r.h, '┬', PANE, SURFACE))
      })
    if (menu) s += stripColor(popup(area, menu.title, menu.rows, menu.sel, menu.footer))
    else if (help) s += stripColor(popup(area, 'Keys · after Ctrl-b', HELP_ROWS, -1, 'Mouse: × closes a tab, a right click renames it, drag copies.'))
    s += at(0, l.status.y) + stripColor(statusLine(cols))
    // every frame ends on a reset, so nothing between frames (a clear, the shell after exit) takes a fill
    out.write(s + RESET + cursor() + '\x1b[?2026l')
    spinning()
  }

  /** nothing open yet: what to do, in the pane area, as a card framed in the brand gradient */
  function welcome(r: Rect, card = true): string {
    const lines = [
      ...logo(),
      '',
      `${DIM}coding agents side by side, in your terminal${RESET}`,
      '',
      `${ACCENT}^b c${RESET}  new tab: an agent or a shell, in any project`,
      `${ACCENT}^b t${RESET}  a shell here`,
      `${ACCENT}^b r${RESET}  run a command: ls -lrt, npm run dev…`,
      `${ACCENT}^b ?${RESET}  every key`,
      '',
      `${DIM}or from another terminal:${RESET}`,
      `  sldev new --agent claude "fix the failing test"`
    ]
    let s = ''
    for (let i = 0; i < r.h; i++) s += at(r.x, r.y + i) + onFill(PANE, ' '.repeat(r.w))
    if (!card) return s
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
    statusUpdate = null
    if (prompt) return ` ${ACCENT}›${RESET} ` + BOLD + fit(prompt.label, Math.min(prompt.label.length, cols - 3)) + RESET + fit(prompt.text, Math.max(0, cols - 3 - prompt.label.length))
    // waiting for the key after the prefix: amber, as anything that waits for you
    if (prefix) return hints(HINTS, cols, ` \x1b[1;${TONE_SGR.attention}m^b${RESET} `)
    if (message) {
      if (message !== messageSeen) {
        messageSeen = message
        messageSince = Date.now()
      }
      return ` ${DIM}•${RESET} ` + fit(message, cols - 3)
    }
    if (menu) return hints(menu.hints, cols, ' ')
    if (help) return hints([['any key', 'close']], cols, ' ')
    if (runsView) return hints(RUNS_HINTS, cols, ' ')
    const id = visible()[0]
    const info = id ? views.get(id)?.info : undefined
    const project = info ? (info.root || info.cwd).replace(/[\\/]+$/, '').split(/[\\/]/).pop() : ''
    const d = new Date()
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    // the bottom right: the focused tab's project and the time, and a newer sldev as a chip a click updates
    // (also where there's no sidebar to say so); on a narrow terminal only the chip
    const chip = update ? ` ↑ ${update} ` : ''
    const rest = `${project ? `${project} · ` : ''}${time} `
    const rw = (cols >= 90 ? rest.length : 0) + (chip ? chip.length + 1 : 0)
    if (chip) statusUpdate = { from: cols - rw, to: cols - rw + chip.length }
    const right = (chip ? `${MUTED}${BOLD}${chip}${RESET} ` : '') + (cols >= 90 ? `${DIM}${rest}${RESET}` : '')
    return hints(HINTS, cols - rw, ` ${ACCENT}^b${RESET} `) + right
  }

  /**
   * ^b u, the sidebar's Update now or the status bar's ↑ chip: npm installs the new sldev in a tab of its own,
   * so its output is there to read. The daemon (and so every open tab) keeps this version until sldev stop.
   */
  function runUpdate(): void {
    if (!update) return void ((message = `This is sldev ${VERSION}, the newest`), schedule())
    const cmd = services.updateCommand
    if (!cmd) return copyUpdate()
    const version = update
    client
      .request('new', { shell: true, run: cmd, title: `update sldev`, brief: '', cwd: newTabCwd(), ...paneSize() })
      .then((p) => {
        started(p, 'update')
        message = `Installing sldev ${version} in tab ${order.indexOf(p.id) + 1}. Open tabs keep ${VERSION}: once they're done, sldev stop, then sldev`
        schedule()
      })
      .catch(fail)
  }

  /** the update command to the clipboard (when the TUI wasn't given one to run), since the TUI holds the mouse */
  function copyUpdate(): void {
    out.write(osc52(INSTALL_COMMAND))
    void (services.copy ?? copyToClipboard)(INSTALL_COMMAND)
      .catch(() => false)
      .then((ok) => {
        message = `${ok ? 'Copied' : 'Sent to the clipboard (OSC 52)'}: ${INSTALL_COMMAND} · run it in a shell; open tabs keep ${VERSION} until sldev stop`
        schedule()
      })
  }

  /** A runtime in a tab of its own: a shell in its folder with the command typed in, so it ends at a prompt. */
  const startRuntime = (r: Runtime): void => {
    client
      .request('new', { shell: true, run: r.command, title: r.name, brief: '', cwd: r.cwd, ...paneSize() })
      .then((p) => {
        started(p, 'runtime')
        message = `Running ${r.name} in tab ${order.indexOf(p.id) + 1}: ${r.command}`
        schedule()
      })
      .catch(fail)
  }

  /**
   * Ctrl-b r, or Runtime… in New tab: the project's runtimes (the ones added here, then its scripts); Enter or a
   * click runs one, + adds one (a command, then a name) and runs it, x removes a saved one.
   */
  async function openRuntimes(where = newTabCwd(), focus?: string): Promise<void> {
    try {
      const root = await cliRoot(where)
      const list = await listRuntimes(root)
      const rows: PopupRow[] = [{ key: '+', text: 'New runtime…', note: 'any command, kept for this project' }]
      const pick: Menu['pick'] = [() => newRuntime(root, where)]
      // the runtime on each row, for x
      const of: Array<Runtime | null> = [null]
      const saved = list.filter((r) => r.saved)
      const found = list.filter((r) => !r.saved)
      const head = (text: string): void => void (rows.push({ head: true, text }), pick.push(() => undefined), of.push(null))
      const add = (r: Runtime, key: string, note: string): void => {
        rows.push({ key, text: r.name, note: ellipsis(note, 30).trimEnd() })
        pick.push(() => startRuntime(r))
        of.push(r)
      }
      if (saved.length) head('Added')
      saved.forEach((r, i) => add(r, i < 9 ? String(i + 1) : '', r.command))
      if (found.length) head('In the project')
      found.forEach((r) => add(r, '', r.group ?? r.command))
      const keys: Menu['keys'] = {}
      keys.x = (i) => {
        const r = of[i]
        if (!r?.saved) return void ((message = 'Only a runtime added here can be removed; the project\'s scripts come from its files'), schedule())
        ask(`Remove runtime ${r.name} (${r.command})? Tabs running it stay. (y/N) `, (text) => {
          if (!/^y/i.test(text.trim())) return void openRuntimes(where, r.name)
          removeRuntime(root, r.name)
            .then(() => ((message = `Removed runtime ${r.name}`), openRuntimes(where)))
            .catch(fail)
        })
      }
      const at = focus ? rows.findIndex((r) => !r.head && r.text === focus) : -1
      menu = {
        title: 'Runtimes',
        footer: saved.length ? `added ones in ${tailFit(tilde(runtimesFile(root), home), 46).trimEnd()}` : `in ${tailFit(tilde(root, home), 50).trimEnd()}`,
        hints: RUNTIME_HINTS,
        rows,
        pick,
        keys,
        sel: at >= 0 ? at : list.length ? rows.findIndex((r, i) => i > 0 && !r.head) : 0
      }
      help = false
      schedule()
    } catch (err) {
      fail(err as Error)
    }
  }

  /** + in Runtimes: the command, then its name (Enter takes one from the command); saved, then run at once. */
  function newRuntime(root: string, where: string): void {
    ask('New runtime, command: ', (command) => {
      if (!command.trim()) return void openRuntimes(where)
      const suggested = nameFrom(command)
      ask(`Name (Enter: ${suggested}): `, (typed) => {
        const name = typed.trim() || suggested
        const problem = checkName(name)
        if (problem) return fail(new Error(problem))
        // kept relative to the project when the tab in focus works in a folder inside it, else at its top
        const inside = where === root || where.startsWith(root.replace(/[\\/]+$/, '') + (process.platform === 'win32' ? '\\' : '/'))
        addRuntime(root, { name, command, cwd: inside ? where : root })
          .then(({ replaced, runtime }) => {
            startRuntime({ name: runtime.name, command: runtime.command, cwd: inside ? where : root, saved: true })
            if (replaced) message = `Replaced runtime ${name}; running it`
          })
          .catch(fail)
      })
    })
  }

  /** a new tab works where the tab in focus works (its worktree), else where sldev was attached */
  const newTabCwd = (): string => {
    const id = visible()[0]
    return (id && views.get(id)?.info.cwd) || cwd
  }

  const newShell = (where = newTabCwd()): void => {
    client
      .request('new', { shell: true, brief: '', cwd: where, ...paneSize() })
      .then((p) => started(p, 'shell'))
      .catch((err: Error) => ((message = err.message), schedule()))
  }

  /** From the keyboard it asks for a brief first; a click starts the agent at once, without one. */
  const newAgent = (a: AgentDef, click = false, where = newTabCwd()): void => {
    const start = (brief: string): void =>
      void client
        .request('new', { agent: a.id, brief: brief.trim(), cwd: where, worktree: false, ...paneSize() })
        .then((p) => started(p, a.name))
        .catch((err: Error) => ((message = err.message), schedule()))
    if (click) return start('')
    ask(`${a.name}, brief (Enter alone starts it without one; Ctrl-e writes a longer one in $EDITOR): `, start, '', () => void writeBrief(a, where))
  }

  /** Ctrl-b , or a right click on a tab: the prompt starts with its current name */
  const renameTab = (id: string): void => {
    const info = views.get(id)?.info
    ask(
      `Rename tab ${id}: `,
      (text) => {
        if (text.trim()) void client.request('rename', { pane: id, title: text }).catch((err: Error) => ((message = err.message), schedule()))
      },
      info?.title ?? ''
    )
  }

  const fail = (err: Error): void => {
    message = err.message
    schedule()
  }

  /** The terminal goes to `fn` (an editor): sldev's screen, mouse and keys step aside until it's done. */
  async function suspend(fn: () => Promise<void>): Promise<void> {
    suspended = true
    if (frame) clearTimeout(frame)
    frame = null
    input.off('data', onKey)
    input.pause()
    if (input.isTTY) input.setRawMode?.(false)
    out.write('\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[0m\x1b[?25h\x1b[?1049l')
    try {
      await fn()
    } finally {
      suspended = false
      if (!restored) {
        out.write('\x1b[?1049h\x1b[2J\x1b[?1000h\x1b[?1002h\x1b[?1006h')
        if (input.isTTY) input.setRawMode?.(true)
        input.on('data', onKey)
        input.resume()
        schedule()
      }
    }
  }

  /** A brief for `a` written in the editor, from a template: launched when saved with a brief, dropped when left empty. */
  async function writeBrief(a: AgentDef, where: string): Promise<void> {
    try {
      const root = await cliRoot(where)
      const file = await newBriefFile(root, a.id)
      await suspend(() => (services.edit ?? editInTerminal)(file))
      const saved = await takeEditedBrief(root, file)
      if (!saved) return void ((message = 'The brief was empty, so nothing started'), schedule())
      await launch(root, saved, where)
    } catch (err) {
      fail(err as Error)
    }
  }

  /** A brief started in a tab of its own; one that can't start stays in the briefs folder and says why. */
  async function launch(root: string, file: string, where: string): Promise<void> {
    const r = await launchBrief(client, root, file, await cliKinds(root, dataDir), { cwd: where, ...paneSize() })
    started(r.pane, 'brief')
    message = `Started brief ${r.pane.id}: ${r.pane.title}${r.warning ? ` (${r.warning})` : ''}`
    schedule()
  }

  /** Ctrl-b b: the briefs waiting in the project's .sldev-cli/briefs; Enter launches the one in focus. */
  async function openBriefs(): Promise<void> {
    const where = newTabCwd()
    try {
      const root = await cliRoot(where)
      const briefs = await listBriefs(root, await cliKinds(root, dataDir))
      if (!briefs.length) return void ((message = `No briefs waiting in ${shownDir(root, where)}`), schedule())
      menu = {
        title: 'Briefs',
        footer: `in ${tailFit(tilde(briefsDir(root), home), 50).trimEnd()}`,
        hints: BRIEF_HINTS,
        enterOnly: true,
        // the reason is long: Enter on it says why
        rows: briefs.map((b) => ({ key: '', text: briefTitle(b), note: b.draft ? briefNote(b) : "can't launch, Enter says why", off: !b.draft })),
        pick: briefs.map((b) => () => {
          if (!b.draft) return fail(new Error(`${b.slug} can't launch: ${b.error}`))
          launch(root, b.file, where).catch(fail)
        }),
        sel: Math.max(0, briefs.findIndex((b) => !!b.draft))
      }
      help = false
      message = ''
      schedule()
    } catch (err) {
      fail(err as Error)
    }
  }

  /**
   * Ctrl-b c, a click on + or on a project in the sidebar: where it opens (the projects tabs work in, recent ones,
   * any other folder), then a shell or one of the agents (the ones not installed say how to get them).
   */
  function openMenu(where = newTabCwd(), sel?: number): void {
    const agents = allAgents()
    setInstalledBins(agents.flatMap((a) => [a.bin, ...(a.aliases ?? [])]).filter((b) => findOnPath(b, process.env)))
    const open = [...views.values()].map((v) => v.info.root || v.info.cwd)
    const projects = projectList([where, ...open], readRecent(dataDir))
    const rows: PopupRow[] = [{ head: true, text: 'Project' }]
    const pick: Menu['pick'] = [() => undefined]
    projects.forEach((dir) => {
      rows.push({ key: dir === where ? '✓' : '', text: dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir, note: tailFit(tilde(dir, home), 34).trimEnd() })
      // picking a project keeps the popup open on it: what to open there comes next
      const at = rows.length - 1
      pick.push(() => openMenu(dir, at))
    })
    rows.push({ text: 'Other folder…', note: 'browse' })
    pick.push(() => openBrowser(where, where))
    rows.push({ head: true, text: 'Open' })
    pick.push(() => undefined)
    rows.push({ key: 't', text: 'Shell', note: process.platform === 'win32' ? '' : (process.env.SHELL ?? '').split('/').pop() })
    pick.push(() => newShell(where))
    rows.push({ key: 'r', text: 'Runtime…', note: 'a command or a project script' })
    pick.push(() => void openRuntimes(where))
    const first = rows.length
    agents.forEach((a, i) => {
      const ok = !!installedBin(a)
      rows.push({ key: i < 9 ? String(i + 1) : '', text: a.name, note: ok ? '' : 'not installed', off: !ok })
      pick.push((click) => (ok ? newAgent(a, click, where) : notInstalled(a)))
    })
    const firstAgent = rows.findIndex((r, i) => i >= first && !r.off)
    menu = { title: 'New tab', footer: `in ${tailFit(tilde(where, home), 50).trimEnd()}`, hints: MENU_HINTS, rows, pick, sel: sel ?? (firstAgent >= 0 ? firstAgent : first - 1) }
    help = false
    message = ''
    schedule()
  }

  /** Other folder…: the folders in `dir`; Enter goes in, Backspace up, "Open here" takes it back to New tab. */
  function openBrowser(dir: string, back: string, from?: string): void {
    const up = parentFolder(dir)
    const folders = subfolders(dir)
    const rows: PopupRow[] = [{ text: 'Open here', note: dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir }, { text: 'Type a path…', note: 'Tab completes' }]
    const pick: Menu['pick'] = [() => openMenu(dir), () => typePath(dir, back)]
    if (up) {
      rows.push({ text: '..', note: 'up' })
      pick.push(() => openBrowser(up, back, dir))
    }
    for (const f of folders) {
      rows.push({ text: f.name + '/', note: f.git ? 'git' : '' })
      pick.push(() => openBrowser(f.path, back))
    }
    if (!folders.length) rows.push({ text: 'no folders here', off: true })
    if (!folders.length) pick.push(() => undefined)
    const came = from ? folders.findIndex((f) => f.path === from) : -1
    menu = {
      title: 'Folder',
      footer: tailFit(tilde(dir, home), 50).trimEnd(),
      hints: FOLDER_HINTS,
      rows,
      pick,
      enterOnly: true,
      sel: came >= 0 ? rows.length - folders.length + came : 0,
      back: up ? () => openBrowser(up, back, dir) : undefined,
      cancel: () => openMenu(back)
    }
    schedule()
  }

  /** a folder typed with Tab completing it, from the browser's folder */
  function typePath(dir: string, back: string): void {
    const start = dir === home ? '~/' : tilde(dir, home).replace(/[\\/]*$/, '/')
    ask(
      'Folder: ',
      (text) => {
        const target = expandPath(text || '.', dir)
        if (!isFolder(target)) {
          message = `${tilde(target, home)} isn't a folder`
          return openBrowser(dir, back)
        }
        openMenu(target)
      },
      start,
      undefined,
      { complete: (text) => completePath(text, dir), cancel: () => openBrowser(dir, back) }
    )
  }

  /**
   * Ctrl-b x asks first while something runs in the tab; a click (its ×, a middle click) closes it at once, and
   * the tabs of agents it started stay open, as answering no to the keyboard's second question.
   */
  function closeTab(id: string, click = false): void {
    const info = views.get(id)?.info
    const kill = (children?: boolean): void => void client.request('kill', { pane: id, children }).catch((err: Error) => ((message = err.message), schedule()))
    if (click) return kill()
    // the tabs of agents this one started: closing them too (and stopping the ones still running) is a second question
    const kids = [...views.values()].filter((v) => v.info.spawnedBy === id).map((v) => v.info.id)
    const close = (): void => {
      if (!kids.length) return kill()
      ask(`Also close the ${kids.length === 1 ? 'tab' : `${kids.length} tabs`} of agents it started (${kids.join(', ')})? Running ones stop; files stay. (y/N) `, (text) => kill(/^y/i.test(text.trim()) || undefined))
    }
    // nothing runs in it any more: close it without asking
    if (info?.pid === undefined) close()
    else
      ask(info.shell ? `Close tab ${id}? Its shell and anything running in it stop. (y/N) ` : `Close tab ${id}? Its agent stops; files stay. (y/N) `, (text) => {
        if (/^y/i.test(text.trim())) close()
      })
  }

  /** An agent that isn't installed: its install command goes to the clipboard, since the TUI holds the mouse. */
  function notInstalled(a: AgentDef): void {
    if (!a.install) return void ((message = `${a.name} isn't installed`), schedule())
    const cmd = a.install
    out.write(osc52(cmd))
    void (services.copy ?? copyToClipboard)(cmd)
      .catch(() => false)
      .then((ok) => {
        message = `${a.name} isn't installed. ${ok ? 'Copied' : 'Sent to the clipboard (OSC 52)'}: ${cmd} · run it in a shell tab (^b t), then pick ${a.name} again`
        schedule()
      })
  }

  /** Keys while the New tab popup is open; returns what is left. */
  function menuKey(s: string): string {
    const m = menu!
    const arrow = /^\x1b\[([AB])/.exec(s) ?? /^\x1bO([AB])/.exec(s)
    if (arrow || s[0] === 'j' || s[0] === 'k') {
      const up = arrow ? arrow[1] === 'A' : s[0] === 'k'
      m.sel = stepRow(m.rows, m.sel, up ? -1 : 1)
      return s.slice(arrow ? arrow[0].length : 1)
    }
    const left = /^\x1b\[D/.exec(s) ?? /^\x1bO[D]/.exec(s)
    if (m.back && (left || s[0] === '\x7f' || s[0] === '\b')) {
      m.back()
      return s.slice(left ? left[0].length : 1)
    }
    const c = s[0]
    if (c === '\x1b' || c === 'q' || c === '\x03') {
      menu = null
      // a lone Esc (not an arrow's start) from the folder browser goes back to New tab
      if (m.cancel && (s === '\x1b' || c === 'q')) m.cancel()
      return ''
    }
    const own = m.keys?.[c]
    if (own) {
      menu = null
      own(m.sel)
      return s.slice(1)
    }
    const i = c === '\r' ? m.sel : m.enterOnly ? -1 : m.rows.findIndex((r) => r.key === c)
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
    const l = lay()
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
    // the sidebar's edge being dragged follows the mouse; the panes are resized once, on the release, since
    // every resize makes the programs in them redraw
    if (sideDrag) {
      if (motion || !down) sideW = sidebarWidth(out.columns || 80, x)
      if (!down) {
        sideDrag = false
        sizeViews()
        saveTabs({ sidebar: sideW })
      }
      return
    }
    if (l.sidebar && down && !motion && !wheel && (button & 3) === 0 && x === l.sidebar.x + l.sidebar.w && y >= 1 && y < l.status.y && !menu && !help) {
      sideDrag = true
      sel = null
      return
    }
    // the wheel over a popup moves its pick
    if (menu && wheel && down) {
      menu.sel = stepRow(menu.rows, menu.sel, (button & 1) === 0 ? -1 : 1)
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
    if (!down || wheel || motion) return
    // the left button; the middle one closes a tab, as in a browser; the right one renames it
    const middle = (button & 3) === 1
    const right = (button & 3) === 2
    sel = null
    if (help) return void (help = false)
    if (menu) {
      const m = menu
      // a row picks it (one that can't start says why), outside the box closes it
      const hit = popupHit(paneArea(l), m.title, m.rows, m.footer, x, y, m.sel)
      if (hit === null) return void (menu = null)
      if (hit >= 0 && m.pick[hit] && !middle && !right) {
        menu = null
        m.pick[hit](true)
      }
      return
    }
    if (y === l.status.y && statusUpdate && x >= statusUpdate.from && x < statusUpdate.to && !prompt) return runUpdate()
    if (y === l.tabs.y && x >= l.tabs.x) {
      const bx = x - l.tabs.x
      if (bar.plus && bx >= bar.plus.from && bx < bar.plus.to) return middle || right ? undefined : openMenu()
      const hit = bar.spans.find((t) => bx >= t.from && bx < t.to)
      const id = hit && order[hit.index]
      if (!hit || !id) return
      if (right) return renameTab(id)
      if (middle || (hit.close && bx >= hit.close.from && bx < hit.close.to)) return closeTab(id, true)
      if (runsView) closeRuns()
      focusTab(id)
      return
    }
    if (l.sidebar && x < l.sidebar.x + l.sidebar.w && y >= l.sidebar.y && !middle) {
      const id = side.hits[y - l.sidebar.y]
      if (right) return id ? renameTab(id) : undefined
      if (side.plus !== null && y - l.sidebar.y === side.plus) return openMenu()
      if (side.update && y - l.sidebar.y >= side.update.from && y - l.sidebar.y < side.update.to) return runUpdate()
      const project = side.projects[y - l.sidebar.y]
      if (project) return openMenu(project)
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
      // a message from the person's own action stays a while; the tab's tone still shows it needs you
      const fresh = message && message !== notice && (message !== messageSeen || Date.now() - messageSince < MESSAGE_HOLD_MS)
      if (fresh) return
      message = notice = `${e.title}: ${e.body}`
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
    rememberProject(dataDir, p.root || p.cwd)
    // after focusTab, which clears the message line
    focusTab(p.id)
    message = `Started ${what} ${p.id}`
  }

  const ask = (label: string, done: (text: string) => void, text = '', alt?: () => void, more: { complete?: (text: string) => string; cancel?: () => void } = {}): void => {
    prompt = { label, text, done, alt, ...more }
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
      } else if (ch === '\x05' && p.alt) {
        prompt = null
        p.alt()
      } else if (ch === '\x1b' || ch === '\x03') {
        prompt = null
        p.cancel?.()
        // the rest of an escape sequence (an arrow key) goes with it
        return ''
      } else if (ch === '\t' && p.complete) p.text = p.complete(p.text)
      else if (ch === '\x7f' || ch === '\b') p.text = p.text.slice(0, -1)
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
      if (c === 'u') {
        runUpdate()
        return s.slice(1)
      }
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
      else if (c === 'r') void openRuntimes()
      else if (c === 'b') void openBriefs()
      else if (c === ',' && id) renameTab(id)
      else if (c === 'x' && id) closeTab(id)
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
    const r = lay().panes[0]
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
    if (typeof saved.sidebar === 'number') sideW = saved.sidebar
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
  // after the first frame, so a slow registry never holds up attaching; an open popup or prompt goes first
  void services.update?.().then((v) => {
    if (!v || restored) return
    update = v.version
    // the message once per version; the sidebar row and the status bar keep it while this sldev is older
    if (v.first && !prompt && !message) message = `sldev ${v.version} is out (this is ${VERSION}): click Update now or ^b u to install it`
    schedule()
  }).catch(() => undefined)
  return finished
}
