import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { workspace } from '../state/workspace'
import { shellQuote } from './paths'

/**
 * Terminal sessions live here, outside React. A dock panel only *hosts* a session's DOM node,
 * so moving, re-docking or re-rendering a panel never restarts the shell or loses scrollback.
 */

const isMac = window.api.platform === 'darwin'
export const PATH_MIME = 'application/x-sldev-paths'

export const TERMINAL_THEME: ITheme = {
  background: '#141414',
  foreground: '#d6d6dd',
  cursor: '#e4e4e4',
  cursorAccent: '#141414',
  selectionBackground: '#3a4a6b99',
  black: '#2a2a2a',
  red: '#f14c4c',
  green: '#3fb950',
  yellow: '#e5c07b',
  blue: '#5ea1ff',
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
  /** Run this command instead of an interactive shell (runtimes, tasks). The panel stays after it exits. */
  command?: string
  /** false: wait for Enter before running `command` (used when a layout is restored) */
  autostart?: boolean
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
  command?: string
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
}

const sessions = new Map<string, Session>()

// A single IPC listener fans out to all terminals.
window.api.pty.onData((id, data) => {
  const s = sessions.get(id)
  if (!s) return window.api.pty.ack(id, data.length)
  s.term.write(data, () => window.api.pty.ack(id, data.length))
  if (s.command && s.ports.size < 4) scanPorts(s, data)
})

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
  const what = s.command ? `${s.command} exited with code ${code}. Press Enter to run again` : `process exited with code ${code}. Press Enter to restart`
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
    autostart: opts.autostart ?? true,
    gen: 0,
    ports: new Set(),
    ptyCols: 0,
    ptyRows: 0,
    resizeTimer: undefined,
    raf: 0,
    listeners: {}
  }
  sessions.set(id, s)
  s.observer.observe(host)

  term.onData((d) => {
    if (s.status === 'running') window.api.pty.write(id, d)
    else if ((s.status === 'exited' || s.status === 'idle') && d === '\r') void startPty(s)
  })
  term.onBinary((d) => s.status === 'running' && window.api.pty.write(id, d))
  term.onTitleChange((t) => s.listeners.onTitle?.(t))
  term.attachCustomKeyEventHandler((e) => handleKey(s, e))
  // OSC 7 (shell reports its cwd) lets "split here" open in the directory you're actually in.
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
    if (s.status === 'running') window.api.pty.write(id, paths.map(shellQuote).join(' ') + ' ')
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
    else s.term.write(`\x1b[2m[${s.command ?? 'shell'}] Press Enter to run\x1b[0m\r\n`)
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

export function terminalStatus(id: string): TerminalStatus | undefined {
  return sessions.get(id)?.status
}

export function terminalInfo(id: string): { status: TerminalStatus; exitCode?: number; ports: number[]; command?: string } | undefined {
  const s = sessions.get(id)
  return s && { status: s.status, exitCode: s.exitCode, ports: [...s.ports], command: s.command }
}

/** Kill whatever is running and start it again in the same panel (optionally with an updated command). */
export function restartTerminal(id: string, command?: string): void {
  const s = sessions.get(id)
  if (!s) return
  if (command !== undefined && s.command !== undefined) s.command = command
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
  if (s.command) s.term.write(`\x1b[2m$ ${s.command}\x1b[0m\r\n`)
  const { cols, rows } = s.term
  try {
    await window.api.pty.create(s.id, { cwd: s.cwd, cols, rows, command: s.command })
    if (s.gen !== gen) return // restarted again while spawning
    if (!sessions.has(s.id)) {
      // panel was closed while the shell was spawning
      window.api.pty.kill(s.id)
      return
    }
    s.ptyCols = cols
    s.ptyRows = rows
    setStatus(s, 'running')
    if (s.initialInput) {
      window.api.pty.write(s.id, s.initialInput)
      s.initialInput = undefined
    }
    fitNow(s) // the panel may have been resized while spawning
  } catch (err) {
    setStatus(s, 'exited')
    s.term.write(`\r\n\x1b[31mFailed to start shell: ${String(err)}\x1b[0m\r\n`)
  }
}

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
  // macOS copy/paste go through the Edit menu roles; elsewhere use Ctrl+Shift+C / Ctrl+Shift+V.
  if (isMac || e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey || e.altKey) return true
  const key = e.key.toLowerCase()
  if (key === 'c') {
    e.preventDefault()
    if (s.term.hasSelection()) void navigator.clipboard.writeText(s.term.getSelection())
    return false
  }
  if (key === 'v') {
    e.preventDefault()
    void navigator.clipboard.readText().then((t) => t && s.term.paste(t))
    return false
  }
  return true
}
