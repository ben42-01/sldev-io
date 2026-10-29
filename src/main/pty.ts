import * as pty from 'node-pty'
import { existsSync } from 'fs'
import { homedir } from 'os'
import type { WebContents } from 'electron'
import type { PtyCreateOptions, PtyInfo } from '@shared/types'
import { resolveLaunch, windowsShellLaunch } from './launch'

// Output is coalesced and sent to the renderer in frames instead of per chunk.
const FLUSH_MS = 8
const MAX_FRAME = 256 * 1024
// Flow control: pause the pty when the renderer falls this far behind, resume when it catches up.
const HIGH_WATER = 1024 * 1024
const LOW_WATER = 256 * 1024

interface Session {
  proc: pty.IPty
  owner: WebContents
  buffer: string
  timer: NodeJS.Timeout | null
  unacked: number
  paused: boolean
}

let shellOverride: string | null = null

export function setShellOverride(shell: string | null): void {
  shellOverride = shell?.trim() || null
}

export function defaultShell(): { shell: string; args: string[] } {
  if (shellOverride) return { shell: shellOverride, args: process.platform === 'win32' ? [] : ['-l'] }
  if (process.platform === 'win32') {
    return { shell: process.env.COMSPEC?.toLowerCase().includes('pwsh') ? 'pwsh.exe' : 'powershell.exe', args: [] }
  }
  const shell = process.env.SHELL || (existsSync('/bin/zsh') && process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  // Login shell so PATH from ~/.profile, ~/.zprofile etc. is present (important when launched from a GUI).
  return { shell, args: ['-l'] }
}

export class PtyManager {
  private sessions = new Map<string, Session>()

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  create(owner: WebContents, id: string, opts: PtyCreateOptions): PtyInfo {
    this.kill(id)
    const def = defaultShell()
    let shell = opts.shell ?? def.shell
    let args: string[] | string = opts.args ?? (opts.shell ? [] : def.args)
    const env = { ...(process.env as Record<string, string>), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'sldev-io', ...opts.env }
    if (Array.isArray(opts.command)) {
      // each argument reaches the program as-is: no shell parses the prompt
      ;({ file: shell, args } = resolveLaunch(opts.command, env))
    } else if (opts.command) {
      if (process.platform === 'win32') {
        // a .ps1 runs in the same PowerShell the terminals use
        const ps = /(^|[\\/])(pwsh|powershell)(\.exe)?$/i.test(def.shell) ? def.shell : undefined
        ;({ file: shell, args } = windowsShellLaunch(opts.command, env, ps))
      } else {
        // env already comes from the resolved login shell (see shellEnv.ts), so no -l needed
        args = ['-c', opts.command]
      }
    }
    const cwd = opts.cwd && existsSync(opts.cwd) ? opts.cwd : homedir()
    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: clampInt(opts.cols, 80),
      rows: clampInt(opts.rows, 24),
      cwd,
      env
    })
    const s: Session = { proc, owner, buffer: '', timer: null, unacked: 0, paused: false }
    this.sessions.set(id, s)

    proc.onData((chunk) => {
      if (this.sessions.get(id) !== s) return
      s.buffer += chunk
      s.unacked += chunk.length
      if (!s.paused && s.unacked > HIGH_WATER) {
        s.paused = true
        proc.pause()
      }
      if (s.buffer.length >= MAX_FRAME) this.flush(id, s)
      else if (!s.timer) s.timer = setTimeout(() => this.flush(id, s), FLUSH_MS)
    })
    proc.onExit(({ exitCode }) => {
      // A pty replaced via create()/kill() under the same id must not report into the new session.
      if (this.sessions.get(id) !== s) return
      this.flush(id, s)
      this.sessions.delete(id)
      if (!owner.isDestroyed()) owner.send('pty:exit', id, exitCode)
    })
    return { pid: proc.pid, shell, cwd }
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id)
    if (!s) return
    try {
      s.proc.resize(clampInt(cols, s.proc.cols), clampInt(rows, s.proc.rows))
    } catch {
      // resizing a pty that is exiting throws; safe to ignore
    }
  }

  ack(id: string, bytes: number): void {
    const s = this.sessions.get(id)
    if (!s) return
    s.unacked = Math.max(0, s.unacked - bytes)
    if (s.paused && s.unacked < LOW_WATER) {
      s.paused = false
      s.proc.resume()
    }
  }

  kill(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    this.sessions.delete(id)
    if (s.timer) clearTimeout(s.timer)
    try {
      // a paused ConPTY can't drain its output, and closing it then blocks the main thread on Windows
      if (s.paused) s.proc.resume()
      s.proc.kill()
    } catch {
      // already gone
    }
  }

  killOwnedBy(owner: WebContents): void {
    for (const [id, s] of this.sessions) if (s.owner === owner) this.kill(id)
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }

  private flush(id: string, s: Session): void {
    if (s.timer) clearTimeout(s.timer)
    s.timer = null
    if (!s.buffer) return
    const data = s.buffer
    s.buffer = ''
    if (!s.owner.isDestroyed()) s.owner.send('pty:data', id, data)
  }
}

function clampInt(n: number, fallback: number): number {
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 2000) : fallback
}
