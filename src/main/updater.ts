import { app, dialog, type BrowserWindow } from 'electron'
import { accessSync, constants, existsSync, readFileSync } from 'fs'
import { delimiter, dirname, join } from 'path'
import { autoUpdater } from 'electron-updater'
import type { InstallKind, UpdateStatus } from '@shared/types'
import { installKind, restartDetail } from '@shared/updates'

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
/** let startup (shell env, hook server, layout restore) settle before the first check */
const FIRST_CHECK_DELAY_MS = 15_000

let status: UpdateStatus = { state: 'unsupported', version: null, percent: null, manual: false, install: 'dev', error: null, checkedAt: null }
let notify: (s: UpdateStatus) => void = () => undefined

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  notify(status)
}

function packageType(): string | null {
  try {
    return readFileSync(join(process.resourcesPath, 'package-type'), 'utf8')
  } catch {
    return null
  }
}

function detectInstall(): InstallKind {
  if (process.env.SLDEV_DISABLE_UPDATES) return 'dev'
  return installKind({ packaged: app.isPackaged, platform: process.platform, appImage: process.env.APPIMAGE, packageType: packageType() })
}

function writable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function onPath(cmd: string): boolean {
  return (process.env.PATH ?? '').split(delimiter).some((d) => d && existsSync(join(d, cmd)))
}

/**
 * Whether the user has to fetch the new version from the website. The AppImage replaces its own file,
 * so its folder must be writable. The .deb is installed by electron-updater through gksudo, kdesudo,
 * pkexec or beesu; without one of those it falls back to sudo, which has no terminal to ask in and
 * fails with permission errors, so the user installs it instead.
 */
function needsManual(install: InstallKind): boolean {
  if (install === 'mac') return true // unsigned: Squirrel.Mac refuses
  if (install === 'appimage') return !process.env.APPIMAGE || !writable(dirname(process.env.APPIMAGE))
  if (install === 'deb') return process.getuid?.() !== 0 && !['gksudo', 'kdesudo', 'pkexec', 'beesu'].some(onPath)
  return false
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
    detail: restartDetail(status.install, __SITE_URL__)
  }
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  if (response === 0) autoUpdater.quitAndInstall()
}

/**
 * Check shortly after start, then every few hours. Beta builds follow pre-releases on their own.
 * Linux: the AppImage replaces itself with no password (recommended); the .deb is installed by dpkg
 * system-wide, so installing it asks for the admin password, and the restart dialog says so first.
 */
export function startUpdateChecks(onChange: (s: UpdateStatus) => void): void {
  notify = onChange
  const install = detectInstall()
  status = { ...status, install }
  if (install === 'dev' || install === 'linux') return
  const manual = needsManual(install)
  status = { ...status, state: 'idle', manual }
  autoUpdater.autoDownload = !manual
  // the .deb needs a password prompt, so it installs only on request, never as the app quits
  autoUpdater.autoInstallOnAppQuit = install === 'windows' || install === 'appimage'
  autoUpdater.on('update-available', (info) => set({ state: manual ? 'available' : 'downloading', version: info.version, percent: manual ? null : 0, checkedAt: Date.now() }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version, percent: 100 }))
  autoUpdater.on('error', (err) => set({ state: 'error', error: err.message }))
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_DELAY_MS)
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS).unref()
}
