import { app, dialog, type BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
/** let startup (shell env, hook server, layout restore) settle before the first check */
const FIRST_CHECK_DELAY_MS = 15_000

let status: UpdateStatus = { state: 'unsupported', version: null, percent: null, manual: false, error: null, checkedAt: null }
let notify: (s: UpdateStatus) => void = () => undefined

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  notify(status)
}

// Only installed builds can update themselves. On Linux that's the .deb: electron-builder writes
// resources/package-type for it, and the unpacked dev/e2e build has none.
function supported(): boolean {
  if (!app.isPackaged || process.env.SLDEV_DISABLE_UPDATES) return false
  if (process.platform === 'linux') return existsSync(join(process.resourcesPath, 'package-type'))
  return true
}

export function updateStatus(): UpdateStatus {
  return status
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (status.state === 'unsupported' || status.state === 'downloading' || status.state === 'ready') return status
  set({ state: 'checking', error: null })
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result?.isUpdateAvailable) set({ state: 'none', checkedAt: Date.now() })
  } catch (err) {
    set({ state: 'error', error: err instanceof Error ? err.message : String(err), checkedAt: Date.now() })
  }
  return status
}

/** Asks first: restarting stops every terminal and agent the app is running. */
export async function installUpdate(win: BrowserWindow | null): Promise<void> {
  if (status.state !== 'ready') return
  const opts = {
    type: 'question' as const,
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: `Restart to update to ${status.version}?`,
    detail: 'Running terminals and agents will be stopped. Your layout and missions come back after the restart.'
  }
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  if (response === 0) autoUpdater.quitAndInstall()
}

/** Check shortly after start, then every few hours. Beta builds follow pre-releases on their own. */
export function startUpdateChecks(onChange: (s: UpdateStatus) => void): void {
  notify = onChange
  if (!supported()) return
  const manual = process.platform === 'darwin'
  status = { ...status, state: 'idle', manual }
  autoUpdater.autoDownload = !manual
  // Windows installs a downloaded update on quit; the .deb needs a password prompt, so only on request
  autoUpdater.autoInstallOnAppQuit = process.platform === 'win32'
  autoUpdater.on('update-available', (info) => set({ state: manual ? 'available' : 'downloading', version: info.version, percent: manual ? null : 0, checkedAt: Date.now() }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version, percent: 100 }))
  autoUpdater.on('error', (err) => set({ state: 'error', error: err.message }))
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_DELAY_MS)
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS).unref()
}
