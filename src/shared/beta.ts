/**
 * The free beta window. Dates come from the website (`/beta.json`, generated from
 * website/src/content/pricing.json), so it can be opened, extended or closed without a release.
 */
export interface BetaConfig {
  /** first day of the free beta (YYYY-MM-DD, UTC) or null */
  startsAt: string | null
  /** last free day (YYYY-MM-DD, through 23:59:59 UTC) or null = no end date yet */
  endsAt: string | null
}

export type BetaPhase =
  /** not a beta build: the beta window doesn't apply */
  | 'off'
  /** beta hasn't officially opened yet; the app works normally */
  | 'upcoming'
  /** running, with no end date or more than ENDING_DAYS left */
  | 'active'
  /** ENDING_DAYS or fewer left */
  | 'ending'
  | 'ended'

export interface BetaStatus {
  phase: BetaPhase
  config: BetaConfig
  /** whole days left including today; null without an end date */
  daysLeft: number | null
  /** where the dates came from */
  source: 'remote' | 'cache' | 'none'
  checkedAt: number | null
}

export const ENDING_DAYS = 14
const DAY = 86_400_000
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Accept only well-formed dates; anything else counts as "not set". */
export function parseBetaConfig(raw: unknown): BetaConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const date = (v: unknown): string | null => (typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null)
  return { startsAt: date(r.startsAt), endsAt: date(r.endsAt) }
}

export function betaPhase(config: BetaConfig, now: number, isBetaBuild = true): Pick<BetaStatus, 'phase' | 'daysLeft'> {
  if (!isBetaBuild) return { phase: 'off', daysLeft: null }
  const end = config.endsAt ? Date.parse(`${config.endsAt}T23:59:59.999Z`) : null
  const daysLeft = end === null ? null : Math.max(0, Math.ceil((end - now) / DAY))
  if (end !== null && now > end) return { phase: 'ended', daysLeft: 0 }
  if (config.startsAt && now < Date.parse(`${config.startsAt}T00:00:00Z`)) return { phase: 'upcoming', daysLeft }
  if (daysLeft !== null && daysLeft <= ENDING_DAYS) return { phase: 'ending', daysLeft }
  return { phase: 'active', daysLeft }
}

export function formatBetaDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}
