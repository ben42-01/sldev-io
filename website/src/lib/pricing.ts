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
  plans: Plan[]
  faq: Faq[]
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
