import type { AppInfo, UpdateStatus } from '@shared/types'
import { createStore } from './store'

export const updates = createStore<{ status: UpdateStatus | null; info: AppInfo | null }>({ status: null, info: null })

// Public: the code repo is private, and the downloads repo is where users already get the app.
const ISSUES_URL = 'https://github.com/ben42-01/downloads.sldev.io/issues/new'

export const siteLink = (path: string): string => `${__SITE_URL__}${path}`

export async function initUpdates(): Promise<void> {
  window.api.update.onChanged((s) => updates.set({ status: s }))
  const [status, info] = await Promise.all([window.api.update.status(), window.api.app.info()])
  updates.set({ status, info })
}

export async function checkForUpdates(): Promise<void> {
  updates.set({ status: await window.api.update.check() })
}

/** Unsigned macOS builds can't install updates themselves: send the user to the new dmg. */
export function downloadUpdate(): void {
  const mac = updates.get().info?.arch === 'arm64' ? 'mac' : 'mac-intel'
  void window.api.shell.openExternal(siteLink(`/download/${mac}`))
}

/** Plain-text block for support emails and bug reports. */
export function diagnostics(info: AppInfo, status: UpdateStatus | null): string {
  return [
    `${info.name} ${info.version} (${info.channel})`,
    `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`,
    `${info.os} (${info.platform} ${info.arch})`,
    `Updates: ${status?.state ?? 'unknown'}${status?.version ? ` ${status.version}` : ''}${status?.error ? ` (${status.error})` : ''}`
  ].join('\n')
}

/** A new GitHub issue with a short template and the diagnostics filled in. */
export function feedbackUrl(info: AppInfo | null, status: UpdateStatus | null): string {
  const body = [
    '**What happened, or what would you like?**',
    '',
    '',
    '**Steps to reproduce (for a bug)**',
    '1. ',
    '',
    ...(info ? ['```text', diagnostics(info, status), '```'] : [])
  ].join('\n')
  return `${ISSUES_URL}?${new URLSearchParams({ body })}`
}

export function reportBug(): void {
  const { info, status } = updates.get()
  void window.api.shell.openExternal(feedbackUrl(info, status))
}
