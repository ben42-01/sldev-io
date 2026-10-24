import type { BetaStatus } from './beta'

/** same as LicensePlan in website/api/_licenseToken.ts (the token format, shared with the server) */
export type LicensePlan = 'personal' | 'team'

/** Stable builds without a license run this long from first start. */
export const TRIAL_DAYS = 14
const DAY = 86_400_000

export interface LicenseStatus {
  licensed: boolean
  plan: LicensePlan | null
  email: string | null
  /** e.g. SLDEV-…-4F2A, for display */
  maskedKey: string | null
  /** the license works offline until then (ms); the app renews it every couple of weeks */
  validUntil: number | null
  /** stable builds without a license only */
  trial: { daysLeft: number; ended: boolean } | null
  /** something the user should know, e.g. the key was revoked */
  message: string | null
  /** licenses can be entered: stable builds with a license public key (beta builds are free) */
  available: boolean
}

export function trialState(startedAt: number, now: number): { daysLeft: number; ended: boolean } {
  const left = Math.ceil((startedAt + TRIAL_DAYS * DAY - now) / DAY)
  return { daysLeft: Math.max(0, Math.min(TRIAL_DAYS, left)), ended: left <= 0 }
}

/** Decided at launch only: an ended beta or trial never locks a running session. */
export function isLocked(beta: BetaStatus | null, license: LicenseStatus | null): boolean {
  if (license?.licensed) return false
  if (beta?.phase === 'ended') return true
  return !!license?.trial?.ended
}

export function maskKey(key: string): string {
  return key.length <= 10 ? key : `${key.slice(0, 6)}…${key.slice(-4)}`
}
