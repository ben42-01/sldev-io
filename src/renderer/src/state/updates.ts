import type { AppInfo, UpdateStatus } from '@shared/types'
import { createStore } from './store'

export const updates = createStore<{ status: UpdateStatus | null; info: AppInfo | null }>({ status: null, info: null })

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
