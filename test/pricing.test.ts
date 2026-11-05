import { describe, expect, it } from 'vitest'
import { appPlans, formatPrice, type PricingSource } from '@shared/pricing'
import pricingJson from '../website/src/content/pricing.json'

const pricing = pricingJson as PricingSource

describe('in-app plans', () => {
  it('sells every paid plan in pricing.json through Polar live', () => {
    const plans = appPlans(pricing, false)
    expect(plans.map((p) => p.id)).toEqual(pricing.plans.filter((p) => p.price > 0).map((p) => p.id))
    for (const p of plans) expect(p.checkoutUrl).toMatch(/^https:\/\/buy\.polar\.sh\//)
  })

  it('links the sandbox when built for testing', () => {
    for (const p of appPlans(pricing, true)) expect(p.checkoutUrl).toMatch(/^https:\/\/sandbox-api\.polar\.sh\//)
  })

  it('leaves out free plans and plans without a checkout link', () => {
    const plan = pricing.plans[0]
    const source: PricingSource = {
      currency: 'EUR',
      plans: [
        { ...plan, id: 'free', price: 0 },
        { ...plan, id: 'nolink', checkoutUrl: '' },
        { ...plan, id: 'paid', checkoutUrl: 'https://buy.polar.sh/x' }
      ]
    }
    expect(appPlans(source, false).map((p) => p.id)).toEqual(['paid'])
  })

  it('formats prices like the website', () => {
    expect(formatPrice(10.99, 'EUR')).toBe('€10.99')
    expect(formatPrice(50, 'EUR')).toBe('€50')
  })
})
