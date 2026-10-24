import type { BetaStatus } from '@shared/beta'
import { isLocked } from '@shared/license'
import { initLicense, license } from './license'
import { createStore } from './store'

interface BetaState {
  status: BetaStatus | null
  /** the beta (or a stable build's trial) had ended at start without a license: show the "ended" screen */
  locked: boolean
  /** banner dismissed for this session */
  dismissed: boolean
}

export const beta = createStore<BetaState>({ status: null, locked: false, dismissed: false })

export const pricingUrl = (): string => `${__SITE_URL__}/pricing`

/** Called once at startup, before the workspace renders. */
export async function initBeta(): Promise<void> {
  const [status, lic] = await Promise.all([window.api.beta.status(), initLicense()])
  beta.set({ status, locked: isLocked(status, lic) })
  // Later checks update the chip and banner, but never lock a running session:
  // agents may be mid-task. An ended beta locks at the next launch.
  window.api.beta.onChanged((s) => beta.set({ status: s }))
}

/** "Check again" on the ended screen, e.g. after the beta was extended. */
export async function recheckBeta(): Promise<void> {
  const status = await window.api.beta.refresh()
  beta.set({ status, locked: isLocked(status, license.get().status) })
}
