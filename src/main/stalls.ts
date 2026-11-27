import { app, type BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { sizeOf, Trail } from '@shared/stalls'

/**
 * Freezes are hard to reproduce, so they leave a note: main-process event-loop stalls and the window
 * going unresponsive go to <userData>/stalls.log (local only) and into About → Copy diagnostics. Under each one go
 * the IPC calls and pty spawns main handled just before it (names, durations, sizes: never arguments or output).
 */

const CHECK_MS = 500
const STALL_MS = 1500
const recent: string[][] = []
const trail = new Trail(20)

function note(what: string, withTrail = false): void {
  const lines = [`${new Date().toISOString()} ${what}`, ...(withTrail ? trail.take().map((l) => `  ${l}`) : [])]
  recent.push(lines)
  if (recent.length > 10) recent.shift()
  void fsp.appendFile(join(app.getPath('userData'), 'stalls.log'), lines.join('\n') + '\n').catch(() => undefined)
}

/** This session's stalls, newest last, each followed by what main did just before it. */
export const recentStalls = (): string[] => recent.flat()

/**
 * Every ipcMain.handle registered from now on (the app's and an e2e scenario's) goes on the trail when it
 * finishes, with its result's size when that is big. `label` names a channel's entry from its arguments
 * (pty:create → `pty:spawn copilot`); it must return names only.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = any[]
export function traceIpc(ipc: IpcMain, label: Record<string, (...args: Args) => string> = {}): void {
  const handle = ipc.handle.bind(ipc)
  ipc.handle = (channel: string, listener: (e: IpcMainInvokeEvent, ...args: Args) => unknown): void =>
    handle(channel, (e: IpcMainInvokeEvent, ...args: Args) => {
      const id = trail.start(label[channel]?.(...args) ?? channel)
      const done = (v: unknown): unknown => (trail.end(id, sizeOf(v)), v)
      try {
        const r = listener(e, ...args)
        return r instanceof Promise ? r.then(done, (err) => (trail.end(id), Promise.reject(err))) : done(r)
      } catch (err) {
        trail.end(id)
        throw err
      }
    })
}

export function watchMainLoop(): void {
  let last = Date.now()
  setInterval(() => {
    const now = Date.now()
    const late = now - last - CHECK_MS
    last = now
    // a suspended laptop also looks like a stall: anything over a minute is sleep, not a freeze
    if (late > STALL_MS && late < 60000) note(`main process blocked for ${(late / 1000).toFixed(1)} s`, true)
  }, CHECK_MS).unref()
}

export function watchWindow(win: BrowserWindow): void {
  let since = 0
  win.on('unresponsive', () => {
    since = Date.now()
    note('window unresponsive', true)
  })
  win.on('responsive', () => {
    if (since) note(`window responsive again after ${((Date.now() - since) / 1000).toFixed(1)} s`)
    since = 0
  })
}
