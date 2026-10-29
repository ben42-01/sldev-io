import { app, type BrowserWindow } from 'electron'
import { promises as fsp } from 'fs'
import { join } from 'path'

/**
 * Freezes are hard to reproduce, so they leave a note: main-process event-loop stalls and the window
 * going unresponsive go to <userData>/stalls.log (local only) and into About → Copy diagnostics.
 */

const CHECK_MS = 500
const STALL_MS = 1500
const recent: string[] = []

function note(what: string): void {
  const line = `${new Date().toISOString()} ${what}`
  recent.push(line)
  if (recent.length > 10) recent.shift()
  void fsp.appendFile(join(app.getPath('userData'), 'stalls.log'), line + '\n').catch(() => undefined)
}

/** This session's stalls, newest last. */
export const recentStalls = (): string[] => [...recent]

export function watchMainLoop(): void {
  let last = Date.now()
  setInterval(() => {
    const now = Date.now()
    const late = now - last - CHECK_MS
    last = now
    // a suspended laptop also looks like a stall: anything over a minute is sleep, not a freeze
    if (late > STALL_MS && late < 60000) note(`main process blocked for ${(late / 1000).toFixed(1)} s`)
  }, CHECK_MS).unref()
}

export function watchWindow(win: BrowserWindow): void {
  let since = 0
  win.on('unresponsive', () => {
    since = Date.now()
    note('window unresponsive')
  })
  win.on('responsive', () => {
    if (since) note(`window responsive again after ${((Date.now() - since) / 1000).toFixed(1)} s`)
    since = 0
  })
}
