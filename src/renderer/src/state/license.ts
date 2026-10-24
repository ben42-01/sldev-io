import type { LicenseStatus } from '@shared/license'
import { beta } from './beta'
import { createStore } from './store'

export const license = createStore<{ status: LicenseStatus | null }>({ status: null })

/** "Error invoking remote method 'license:activate': Error: msg" → "msg" */
const message = (e: unknown): string => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export async function initLicense(): Promise<LicenseStatus> {
  window.api.license.onChanged((s) => license.set({ status: s }))
  const status = await window.api.license.status()
  license.set({ status })
  return status
}

/** Activating unlocks right away, also from the "ended" screen. Throws a message for the user. */
export async function activateLicense(key: string): Promise<void> {
  try {
    const status = await window.api.license.activate(key)
    license.set({ status })
    if (status.licensed) beta.set({ locked: false })
  } catch (e) {
    throw new Error(message(e))
  }
}

export async function deactivateLicense(): Promise<void> {
  try {
    license.set({ status: await window.api.license.deactivate() })
  } catch (e) {
    throw new Error(message(e))
  }
}

export async function checkLicense(): Promise<void> {
  try {
    license.set({ status: await window.api.license.refresh() })
  } catch (e) {
    throw new Error(message(e))
  }
}
