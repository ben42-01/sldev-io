import pricingJson from '../content/pricing.json'
import siteJson from '../content/site.json'

export interface Plan {
  id: string
  name: string
  tagline: string
  /** What it costs today. 0 renders as "Free". */
  price: number
  /** Regular price once paid licenses launch; shown struck through while price is lower. */
  listPrice: number
  priceNote: string
  highlight: boolean
  ctaLabel: string
  ctaLabelPaid: string
  /** Stripe payment link. While empty (or price is 0) the plan's button downloads the app. */
  checkoutUrl: string
  features: string[]
}

export interface Faq {
  q: string
  a: string
}

export const site = siteJson
export const pricing = pricingJson as {
  currency: string
  billing: string
  announcement: string
  /** endsAt: last day of the free beta (YYYY-MM-DD, end of that day UTC) or null while undecided */
  beta: { endsAt: string | null; label: string }
  plans: Plan[]
  faq: Faq[]
}

export interface BetaStatus {
  /** a plan is free today but has a list price, i.e. the free beta offer is running */
  active: boolean
  ended: boolean
  /** whole days left including today; null without an end date */
  daysLeft: number | null
  endsOn: string | null
}

export function betaStatus(now = new Date()): BetaStatus {
  const free = pricing.plans.some((p) => p.price === 0 && p.listPrice > 0)
  const { endsAt } = pricing.beta
  if (!endsAt) return { active: free, ended: false, daysLeft: null, endsOn: null }
  const end = new Date(`${endsAt}T23:59:59Z`)
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86_400_000)
  const endsOn = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  return { active: free && daysLeft > 0, ended: daysLeft <= 0, daysLeft: Math.max(0, daysLeft), endsOn }
}

/** "Limited time", "Free beta ends in 12 days", "Last day of the free beta", … */
export function betaMessage(b = betaStatus()): string {
  if (b.ended) return 'The free beta has ended'
  if (b.daysLeft === null) return `${pricing.beta.label} only`
  if (b.daysLeft <= 1) return 'Last day of the free beta'
  return `Free beta ends in ${b.daysLeft} days`
}

export function formatPrice(amount: number, currency = pricing.currency): string {
  if (amount === 0) return 'Free'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2
  }).format(amount)
}

export function planCta(plan: Plan): { label: string; href: string; external: boolean } {
  const paid = plan.price > 0 && plan.checkoutUrl !== ''
  return paid
    ? { label: plan.ctaLabelPaid, href: plan.checkoutUrl, external: true }
    : { label: plan.ctaLabel, href: site.downloadUrl, external: true }
}
