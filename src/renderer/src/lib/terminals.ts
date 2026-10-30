import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { workspace } from '../state/workspace'
import { shellQuote, type ShellKind } from './paths'
import { commandText } from './agents'

/**
 * Terminal sessions live here, outside React. A dock panel only *hosts* a session's DOM node,
 * so moving, re-docking or re-rendering a panel never restarts the shell or loses scrollback.
 */

const isMac = window.api.platform === 'darwin'
export const PATH_MIME = 'application/x-sldev-paths'

export const TERMINAL_THEME: ITheme = {
  background: '#0a0a0a',
  foreground: '#d6d6dd',
  cursor: '#e4e4e4',
  cursorAccent: '#0a0a0a',
  selectionBackground: '#ffffff33',
  black: '#2a2a2a',
  red: '#f14c4c',
  green: '#3fb950',
  yellow: '#e5c07b',
  blue: '#4d8dff',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#d6d6dd',
  brightBlack: '#6e6e6e',
  brightRed: '#ff6b6b',
  brightGreen: '#56d364',
  brightYellow: '#f0d58c',
  brightBlue: '#82b8ff',
  brightMagenta: '#d896ec',
  brightCyan: '#76d0db',
  brightWhite: '#ffffff'
}

export interface TerminalOptions {
  cwd?: string
  /** Text typed into the shell once it starts, e.g. `nvim file\r` */
  initialInput?: string
  /**
   * Run this instead of an interactive shell. The panel stays after it exits. A string runs in the
   * shell (runtimes, shell tasks); an argv array is spawned directly (agents).
   */
  command?: string | string[]
  /** false: wait for Enter before running `command` (used when a layout is restored) */
  autostart?: boolean
  env?: Record<string, string>
  /** open a shell on this saved SSH connection instead of a local pty */
  sshConnectionId?: string
  /** what to echo instead of `command` (e.g. without internal flags) */
  displayCommand?: string
}

interface Listeners {
  onTitle?: (title: string) => void
  onStatus?: (status: TerminalStatus) => void
}

export type TerminalStatus = 'idle' | 'starting' | 'running' | 'exited'

export type TerminalEvent =
  | { type: 'status'; id: string; status: TerminalStatus; exitCode?: number }
  | { type: 'port'; id: string; port: number }
  | { type: 'closed'; id: string }
  /** program output that isn't just the echo of a keystroke (throttled) */
  | { type: 'activity'; id: string }
  /** the program rang the bell or sent an OSC 9 / 777 desktop notification */
  | { type: 'attention'; id: string; text?: string }
  /** the user typed into the running program (answered a prompt, sent a message) */
  | { type: 'input'; id: string }

const eventListeners = new Set<(e: TerminalEvent) => void>()

/** Global terminal events (status changes, detected ports) for views like Runtimes and Tasks. */
export function onTerminalEvent(cb: (e: TerminalEvent) => void): () => void {
  eventListeners.add(cb)
  return () => eventListeners.delete(cb)
}

const emit = (e: TerminalEvent): void => eventListeners.forEach((l) => l(e))

interface Session {
  id: string
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  host: HTMLDivElement
  observer: ResizeObserver
  opened: boolean
  status: TerminalStatus
  cwd?: string
  initialInput?: string
  command?: string | string[]
  displayCommand?: string
  env?: Record<string, string>
  ssh?: string
  autostart: boolean
  /** bumped on every (re)start so stale timers/events from an old process are ignored */
  gen: number
  exitCode?: number
  ports: Set<number>
  ptyCols: number
  ptyRows: number
  resizeTimer: ReturnType<typeof setTimeout> | undefined
  raf: number
  listeners: Listeners
  lastInput: number
  lastActivity: number
}

const sessions = new Map<string, Session>()

// A single IPC listener fans out to all terminals.
window.api.pty.onData((id, data) => {
  const s = sessions.get(id)
  if (!s) return window.api.pty.ack(id, data.length)
  s.term.write(data, () => window.api.pty.ack(id, data.length))
  if (s.command && s.ports.size < 4) scanPorts(s, data)
  if (s.command) noteActivity(s)
})

const ECHO_MS = 250
const ACTIVITY_THROTTLE_MS = 1000

function noteActivity(s: Session): void {
  const now = Date.now()
  if (now - s.lastInput < ECHO_MS || now - s.lastActivity < ACTIVITY_THROTTLE_MS) return
  s.lastActivity = now
  emit({ type: 'activity', id: s.id })
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g
const PORT = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})\b/g

function scanPorts(s: Session, data: string): void {
  for (const m of data.replace(ANSI, '').matchAll(PORT)) {
    const port = Number(m[1])
    if (port > 0 && port < 65536 && !s.ports.has(port)) {
      s.ports.add(port)
      emit({ type: 'port', id: s.id, port })
    }
  }
}

window.api.pty.onExit((id, code) => {
  const s = sessions.get(id)
  if (!s) return
  s.exitCode = code
  setStatus(s, 'exited')
  const what = s.command ? `${shownCommand(s)} exited with code ${code}. Press Enter to run again` : `process exited with code ${code}. Press Enter to restart`
  s.term.write(`\r\n\x1b[${code === 0 ? '2' : '31'}m[${what}]\x1b[0m\r\n`)
})

export function ensureTerminal(id: string, opts: TerminalOptions = {}): void {
  if (sessions.has(id)) return
  const { terminalFontFamily, terminalFontSize } = workspace.get()
  const term = new Terminal({
    fontFamily: terminalFontFamily,
    fontSize: terminalFontSize,
    lineHeight: 1.15,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10000,
    allowProposedApi: true,
    macOptionIsMeta: true,
    // agent TUIs capture the mouse; Option-drag (Shift-drag elsewhere) still selects text to copy
    macOptionClickForcesSelection: true,
    theme: TERMINAL_THEME
  })
  const fit = new FitAddon()
  const search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.loadAddon(new WebLinksAddon((_e, uri) => void window.api.shell.openExternal(uri)))

  const host = document.createElement('div')
  host.className = 'xterm-host'

  const s: Session = {
    id,
    term,
    fit,
    search,
    host,
    observer: new ResizeObserver(() => scheduleFit(s)),
    opened: false,
    status: 'idle',
    cwd: opts.cwd,
    initialInput: opts.initialInput,
    command: opts.command,
    displayCommand: opts.displayCommand,
    env: opts.env,
    ssh: opts.sshConnectionId,
    autostart: opts.autostart ?? true,
    gen: 0,
    ports: new Set(),
    ptyCols: 0,
    ptyRows: 0,
    resizeTimer: undefined,
    raf: 0,
    listeners: {},
    lastInput: 0,
    lastActivity: 0
  }
  sessions.set(id, s)
  s.observer.observe(host)

  term.onData((d) => {
    s.lastInput = Date.now()
    if (s.status === 'running') emit({ type: 'input', id })
    if (s.status === 'running' && broadcast.has(id)) {
      for (const bid of broadcast) if (sessions.get(bid)?.status === 'running') window.api.pty.write(bid, d)
    } else if (s.status === 'running') window.api.pty.write(id, d)
    else if ((s.status === 'exited' || s.status === 'idle') && d === '\r') void startPty(s)
  })
  term.onBinary((d) => s.status === 'running' && window.api.pty.write(id, d))
  term.onTitleChange((t) => s.listeners.onTitle?.(t))
  term.registerLinkProvider(fileLinkProvider(s))
  term.attachCustomKeyEventHandler((e) => handleKey(s, e))
  // OSC 7 (shell reports its cwd) lets "split here" open in the directory you're actually in.
  term.onBell(() => emit({ type: 'attention', id }))
  // OSC 9 (iTerm/ConEmu style) and OSC 777;notify;title;body: desktop notifications from TUIs
  term.parser.registerOscHandler(9, (data) => {
    // ConEmu uses OSC 9;<digit>;… for progress etc.; those aren't notifications
    if (!/^\d;/.test(data)) emit({ type: 'attention', id, text: data })
    return true
  })
  term.parser.registerOscHandler(777, (data) => {
    const [kind, title, body] = data.split(';')
    if (kind === 'notify') emit({ type: 'attention', id, text: [title, body].filter(Boolean).join(': ') })
    return true
  })
  term.parser.registerOscHandler(7, (data) => {
    try {
      s.cwd = decodeURIComponent(new URL(data).pathname)
    } catch {
      // malformed: ignore
    }
    return true
  })

  host.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes(PATH_MIME) || e.dataTransfer?.types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  })
  host.addEventListener('drop', (e) => {
    const dt = e.dataTransfer
    if (!dt) return
    let paths: string[] = []
    const internal = dt.getData(PATH_MIME)
    if (internal) paths = JSON.parse(internal)
    else paths = [...dt.files].map((f) => window.api.fs.pathForFile(f)).filter(Boolean)
    if (!paths.length) return
    e.preventDefault()
    e.stopPropagation()
    if (s.status === 'running') window.api.pty.write(id, paths.map((p) => shellQuote(p, shellKind(id))).join(' ') + ' ')
    term.focus()
  })

  workspace.set((w) => ({ terminalCount: w.terminalCount + 1 }))
  void document.fonts.ready.then(() => scheduleFit(s))
}

export function attachTerminal(id: string, container: HTMLElement): void {
  const s = sessions.get(id)
  if (!s) return
  if (s.host.parentElement !== container) container.appendChild(s.host)
  if (!s.opened) {
    s.opened = true
    s.term.open(s.host)
    loadWebgl(s)
    fitNow(s)
    if (s.autostart) void startPty(s)
    else s.term.write(`\x1b[2m[${s.command ? shownCommand(s) : 'shell'}] Press Enter to run\x1b[0m\r\n`)
  } else {
    scheduleFit(s)
  }
}

export function detachTerminal(id: string): void {
  sessions.get(id)?.host.remove()
}

export function disposeTerminal(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  s.observer.disconnect()
  clearTimeout(s.resizeTimer)
  cancelAnimationFrame(s.raf)
  window.api.pty.kill(id)
  broadcast.delete(id)
  s.term.dispose()
  s.host.remove()
  emit({ type: 'closed', id })
  workspace.set((w) => ({ terminalCount: Math.max(0, w.terminalCount - 1) }))
}

export function setTerminalListeners(id: string, listeners: Listeners): void {
  const s = sessions.get(id)
  if (s) s.listeners = listeners
}

export function focusTerminal(id: string): void {
  sessions.get(id)?.term.focus()
}

export function terminalCwd(id: string): string | undefined {
  return sessions.get(id)?.cwd
}

/** Terminals with a live process that started in `dir` or below it. */
export function runningTerminalsIn(dir: string): string[] {
  const inside = (p: string | undefined): boolean => !!p && (p === dir || p.startsWith(dir + '/') || p.startsWith(dir + '\\'))
  return [...sessions.values()].filter((s) => (s.status === 'running' || s.status === 'starting') && !s.ssh && inside(s.cwd)).map((s) => s.id)
}

/** The last lines a terminal printed, as plain text (a failing check's output, for the agent that fixes it). */
/** The last lines of the screen and scrollback; with fromLine, nothing above that row (see terminalCursor). */
export function terminalTail(id: string, maxLines = 120, fromLine = 0): string {
  const s = sessions.get(id)
  if (!s) return ''
  const b = s.term.buffer.active
  const out: string[] = []
  for (let i = Math.max(fromLine, b.length - maxLines); i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? '')
  return out.join('\n').trim()
}

/** The row the cursor is on, counted from the top of the scrollback, and whether a full-screen program owns the screen. */
export function terminalCursor(id: string): { line: number; alt: boolean } | undefined {
  const b = sessions.get(id)?.term.buffer.active
  return b && { line: b.baseY + b.cursorY, alt: b.type === 'alternate' }
}

export function terminalStatus(id: string): TerminalStatus | undefined {
  return sessions.get(id)?.status
}

export function terminalInfo(id: string): { status: TerminalStatus; exitCode?: number; ports: number[]; command?: string | string[] } | undefined {
  const s = sessions.get(id)
  return s && { status: s.status, exitCode: s.exitCode, ports: [...s.ports], command: s.command }
}

/** Kill whatever is running and start it again in the same panel (optionally with an updated command). */
export function restartTerminal(id: string, command?: string | string[]): void {
  const s = sessions.get(id)
  if (!s) return
  if (command !== undefined && s.command !== undefined) {
    s.command = command
    s.displayCommand = undefined
  }
  if (s.status === 'running' || s.status === 'starting') {
    window.api.pty.kill(id)
    s.term.write('\r\n\x1b[2m[restarting]\x1b[0m\r\n')
  }
  void startPty(s)
}

/** Ctrl+C first; force-kill if the process hasn't exited after a grace period. */
export function stopTerminal(id: string, graceMs = 3000): void {
  const s = sessions.get(id)
  if (!s || (s.status !== 'running' && s.status !== 'starting')) return
  const gen = s.gen
  window.api.pty.write(id, '\x03')
  setTimeout(() => {
    if (s.gen !== gen || (s.status !== 'running' && s.status !== 'starting') || !sessions.has(id)) return
    window.api.pty.kill(id) // a killed pty reports no exit event, so mark it here
    s.exitCode = undefined
    setStatus(s, 'exited')
    s.term.write('\r\n\x1b[2m[stopped. Press Enter to run again]\x1b[0m\r\n')
  }, graceMs)
}

/** The shell a terminal types into: SSH sessions get POSIX quoting, local ones the user's shell. */
export function shellKind(id?: string): ShellKind {
  if (id && sessions.get(id)?.ssh) return 'posix'
  if (window.api.platform !== 'win32') return 'posix'
  return /(^|[\\/])cmd(\.exe)?$/i.test(workspace.get().shell ?? '') ? 'cmd' : 'powershell'
}

export function writeToTerminal(id: string, text: string): void {
  const s = sessions.get(id)
  if (s?.status === 'running') window.api.pty.write(id, text)
}

export function findInTerminal(id: string, query: string, backwards = false): boolean {
  const s = sessions.get(id)
  if (!s || !query) return false
  return backwards ? s.search.findPrevious(query) : s.search.findNext(query)
}

export function clearSearch(id: string): void {
  sessions.get(id)?.search.clearDecorations()
}

export function applyTerminalFont(fontFamily: string, fontSize: number): void {
  for (const s of sessions.values()) {
    s.term.options.fontFamily = fontFamily
    s.term.options.fontSize = fontSize
    scheduleFit(s)
  }
}

async function startPty(s: Session): Promise<void> {
  const gen = ++s.gen
  s.exitCode = undefined
  s.ports.clear()
  setStatus(s, 'starting')
  if (s.command) s.term.write(`\x1b[2m$ ${shownCommand(s)}\x1b[0m\r\n`)
  const { cols, rows } = s.term
  try {
    if (s.ssh) await window.api.ssh.openShell(s.id, s.ssh, cols, rows)
    else await window.api.pty.create(s.id, { cwd: s.cwd, cols, rows, command: s.command, env: s.env })
    if (s.gen !== gen) return // restarted again while spawning
    if (!sessions.has(s.id)) {
      // panel was closed while the shell was spawning
      window.api.pty.kill(s.id)
      return
    }
    s.ptyCols = cols
    s.ptyRows = rows
    setStatus(s, 'running')
    if (document.activeElement === document.body && s.host.isConnected) s.term.focus()
    if (s.initialInput) {
      window.api.pty.write(s.id, s.initialInput)
      s.initialInput = undefined
    }
    fitNow(s) // the panel may have been resized while spawning
  } catch (err) {
    setStatus(s, 'exited')
    const msg = String(err).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')
    s.term.write(`\r\n\x1b[31m${s.ssh ? 'Connection failed' : 'Failed to start shell'}: ${msg}\x1b[0m\r\n\x1b[2m[Press Enter to retry]\x1b[0m\r\n`)
  }
}

const shownCommand = (s: Session): string => s.displayCommand ?? commandText(s.command)

function setStatus(s: Session, status: TerminalStatus): void {
  s.status = status
  s.listeners.onStatus?.(status)
  emit({ type: 'status', id: s.id, status, exitCode: s.exitCode })
}

function loadWebgl(s: Session): void {
  try {
    const webgl = new WebglAddon()
    // Chromium caps live WebGL contexts; on loss fall back to the DOM renderer instead of going blank.
    webgl.onContextLoss(() => webgl.dispose())
    s.term.loadAddon(webgl)
  } catch {
    // no WebGL: the DOM renderer is used
  }
}

function scheduleFit(s: Session): void {
  if (s.raf) return
  s.raf = requestAnimationFrame(() => {
    s.raf = 0
    fitNow(s)
  })
}

/**
 * Resize the xterm grid to its container immediately (so it looks right while dragging),
 * but tell the pty only after resizing settles: shells and TUIs redraw on every SIGWINCH,
 * and a storm of them garbles output.
 */
function fitNow(s: Session): void {
  const el = s.host
  if (!s.opened || !el.isConnected || el.clientWidth < 20 || el.clientHeight < 20) return
  const dims = s.fit.proposeDimensions()
  if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return
  const cols = Math.max(2, dims.cols)
  const rows = Math.max(1, dims.rows)
  if (cols !== s.term.cols || rows !== s.term.rows) s.term.resize(cols, rows)
  if (s.status === 'running' && (cols !== s.ptyCols || rows !== s.ptyRows)) {
    clearTimeout(s.resizeTimer)
    s.resizeTimer = setTimeout(() => {
      if (s.status !== 'running') return
      s.ptyCols = s.term.cols
      s.ptyRows = s.term.rows
      window.api.pty.resize(s.id, s.ptyCols, s.ptyRows)
    }, 60)
  }
}

function handleKey(s: Session, e: KeyboardEvent): boolean {
  // macOS copy/paste go through the Edit menu roles; elsewhere Ctrl+Shift+C / Ctrl+Shift+V, plus the
  // Windows Terminal habits: Ctrl+C copies when text is selected (else it interrupts), Ctrl+V pastes on Windows
  if (isMac || e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return true
  const key = e.key.toLowerCase()
  if (key === 'c' && (e.shiftKey || s.term.hasSelection())) {
    e.preventDefault()
    copyFrom(s)
    if (!e.shiftKey) s.term.clearSelection()
    return false
  }
  if (key === 'v' && (e.shiftKey || window.api.platform === 'win32')) {
    e.preventDefault()
    pasteInto(s)
    return false
  }
  return true
}

function copyFrom(s: Session): boolean {
  const text = s.term.getSelection()
  if (text) void window.api.clipboard.writeText(text)
  return !!text
}

function pasteInto(s: Session): void {
  void window.api.clipboard.readText().then((t) => t && s.term.paste(t))
}

export function terminalHasSelection(id: string): boolean {
  return !!sessions.get(id)?.term.hasSelection()
}

/** Copy the selection; false when nothing is selected. */
export function copyTerminalSelection(id: string): boolean {
  const s = sessions.get(id)
  return !!s && copyFrom(s)
}

export function pasteIntoTerminal(id: string): void {
  const s = sessions.get(id)
  if (s) pasteInto(s)
}

export function selectAllInTerminal(id: string): void {
  sessions.get(id)?.term.selectAll()
}

/** Copy the whole scrollback as plain text (for when a TUI makes selecting awkward). */
export function copyTerminalBuffer(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  const b = s.term.buffer.active
  const lines: string[] = []
  for (let i = 0; i < b.length; i++) {
    const line = b.getLine(i)
    if (!line) continue
    const text = line.translateToString(true)
    // wrapped rows continue the previous line
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text
    else lines.push(text)
  }
  void window.api.clipboard.writeText(lines.join('\n').replace(/\s+$/, '') + '\n')
}

export function clearTerminal(id: string): void {
  sessions.get(id)?.term.clear()
}

// ── broadcast input ──────────────────────────────────────────────

const broadcast = new Set<string>()

/** Toggle typing into all of `ids` at once. Returns whether broadcast is now on for them. */
export function toggleBroadcast(ids: string[]): boolean {
  const on = !ids.every((id) => broadcast.has(id))
  for (const id of ids) {
    if (on) broadcast.add(id)
    else broadcast.delete(id)
  }
  workspace.set({ broadcastCount: broadcast.size })
  return on
}

// ── clickable file paths (path:line:col) ─────────────────────────

let openFileAt: (path: string, line?: number, col?: number) => void = () => {}
let home = ''
void window.api.fs.home().then((h) => (home = h))

export function setFileLinkOpener(fn: typeof openFileAt): void {
  openFileAt = fn
}

const FILE_RE = /(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w.@+-]+[\\/])*[\w@+-][\w.@+-]*\.[A-Za-z][A-Za-z0-9]{0,9}(?::(\d+)(?::(\d+))?)?/g
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi
const existsCache = new Map<string, { ok: boolean; t: number }>()

function resolvePath(p: string, cwd: string | undefined): string | null {
  if (p.startsWith('~')) return home ? home + p.slice(1) : null
  if (/^([A-Za-z]:)?[\\/]/.test(p)) return p
  if (!cwd) return null
  const sep = cwd.includes('\\') && !cwd.includes('/') ? '\\' : '/'
  const parts = [...cwd.split(/[\\/]/), ...p.split(/[\\/]/)]
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else if (part !== '.') out.push(part)
  }
  return out.join(sep) || sep
}

async function existing(paths: string[]): Promise<Set<string>> {
  const now = Date.now()
  const unknown = paths.filter((p) => {
    const c = existsCache.get(p)
    return !c || now - c.t > 5000
  })
  if (unknown.length) {
    const found = new Set(await window.api.fs.existingFiles(unknown))
    for (const p of unknown) existsCache.set(p, { ok: found.has(p), t: now })
  }
  return new Set(paths.filter((p) => existsCache.get(p)?.ok))
}

function fileLinkProvider(s: Session): Parameters<Terminal['registerLinkProvider']>[0] {
  return {
    provideLinks(y, callback) {
      const line = s.term.buffer.active.getLine(y - 1)?.translateToString(true)
      if (!line || s.ssh) return callback(undefined)
      const urls = [...line.matchAll(URL_RE)].map((m) => [m.index!, m.index! + m[0].length])
      const cands: Array<{ start: number; text: string; path: string; line?: number; col?: number }> = []
      for (const m of line.matchAll(FILE_RE)) {
        const start = m.index!
        if (urls.some(([a, b]) => start >= a && start < b) || cands.length > 20) continue
        const raw = m[0].replace(/:\d+(:\d+)?$/, '')
        const path = resolvePath(raw, s.cwd)
        if (path) cands.push({ start, text: m[0], path, line: m[1] ? Number(m[1]) : undefined, col: m[2] ? Number(m[2]) : undefined })
      }
      if (!cands.length) return callback(undefined)
      void existing(cands.map((c) => c.path)).then((ok) => {
        const links = cands
          .filter((c) => ok.has(c.path))
          .map((c) => ({
            range: { start: { x: c.start + 1, y }, end: { x: c.start + c.text.length, y } },
            text: c.text,
            decorations: { underline: true, pointerCursor: true },
            activate: () => openFileAt(c.path, c.line, c.col)
          }))
        callback(links.length ? links : undefined)
      })
    }
  }
}
