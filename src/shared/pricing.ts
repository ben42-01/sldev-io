/** The plans the app sells, from website/src/content/pricing.json (baked in at build time, like the changelog). */

/** The fields of a pricing.json plan the app uses. */
export interface PricingPlanSource {
  id: string
  name: string
  tagline: string
  price: number
  priceNote: string
  highlight: boolean
  ctaLabelPaid: string
  checkoutUrl: string
  sandboxCheckoutUrl: string
  features: string[]
}

export interface PricingSource {
  currency: string
  plans: PricingPlanSource[]
}

export interface AppPlan {
  id: string
  name: string
  tagline: string
  /** "€10.99" */
  price: string
  priceNote: string
  highlight: boolean
  buyLabel: string
  /** Polar's hosted checkout; it emails the license key */
  checkoutUrl: string
  features: string[]
}

export function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount)
}

/**
 * Plans that can be bought: a price and a checkout link. Release builds link Polar live (the license server
 * they talk to is the live one); a build made with SLDEV_CHECKOUT=sandbox links the sandbox, so testing never takes real money.
 */
export function appPlans(source: PricingSource, sandbox: boolean): AppPlan[] {
  return source.plans.flatMap((p): AppPlan[] => {
    const checkoutUrl = (sandbox ? p.sandboxCheckoutUrl : p.checkoutUrl).trim()
    if (!(p.price > 0) || !/^https:\/\//.test(checkoutUrl)) return []
    return [
      {
        id: p.id,
        name: p.name,
        tagline: p.tagline,
        price: formatPrice(p.price, source.currency),
        priceNote: p.priceNote,
        highlight: p.highlight,
        buyLabel: p.ctaLabelPaid,
        checkoutUrl,
        features: p.features
      }
    ]
  })
}
