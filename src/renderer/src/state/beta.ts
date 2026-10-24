import type { BetaStatus } from '@shared/beta'
import { createStore } from './store'

interface BetaState {
  status: BetaStatus | null
  /** the beta had ended when the app started: show the "ended" screen instead of the workspace */
  locked: boolean
  /** banner dismissed for this session */
  dismissed: boolean
}

export const beta = createStore<BetaState>({ status: null, locked: false, dismissed: false })

export const pricingUrl = (): string => `${__SITE_URL__}/#pricing`

/** Called once at startup, before the workspace renders. */
export async function initBeta(): Promise<void> {
  const status = await window.api.beta.status()
  beta.set({ status, locked: status.phase === 'ended' })
  // Later checks update the chip and banner, but never lock a running session:
  // agents may be mid-task. An ended beta locks at the next launch.
  window.api.beta.onChanged((s) => beta.set({ status: s }))
}

/** "Check again" on the ended screen, e.g. after the beta was extended. */
export async function recheckBeta(): Promise<void> {
  const status = await window.api.beta.refresh()
  beta.set({ status, locked: status.phase === 'ended' })
}
