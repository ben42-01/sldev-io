import { unseenChanges, type ChangelogEntry } from '@shared/changelog'
import { openPanel } from '../dock/dockApi'
import { createStore } from './store'
import { updateSettings, workspace } from './workspace'

/** The releases the What's new panel lists; empty means the whole changelog. */
export const whatsNew = createStore<{ entries: ChangelogEntry[] }>({ entries: [] })

export function openWhatsNew(entries: ChangelogEntry[] = []): void {
  whatsNew.set({ entries })
  openPanel('whats-new', 'whats-new', "What's new")
}

/** Run after the dock has restored its layout: shows what changed since the last version that ran. */
export async function startupWhatsNew(): Promise<void> {
  const { version } = await window.api.app.info()
  const { lastSeenVersion, setupSeen } = workspace.get()
  if (lastSeenVersion === version) return
  // Versions before this feature never recorded one; setupSeen tells an update from a fresh install.
  const entries =
    lastSeenVersion === null && setupSeen
      ? __CHANGELOG__.filter((e) => e.version === version)
      : unseenChanges(__CHANGELOG__, version, lastSeenVersion)
  updateSettings({ lastSeenVersion: version })
  if (entries.length) openWhatsNew(entries)
}
