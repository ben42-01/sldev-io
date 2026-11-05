declare module '*.css'
/** marketing site, from website/src/content/site.json (or SLDEV_SITE_URL at build time) */
declare const __SITE_URL__: string
/** website/src/content/changelog.json, baked in at build time */
declare const __CHANGELOG__: import('@shared/changelog').ChangelogEntry[]
/** website/src/content/pricing.json, baked in at build time */
declare const __PRICING__: import('@shared/pricing').PricingSource
/** built with SLDEV_CHECKOUT=sandbox: buy buttons open Polar's sandbox checkout */
declare const __SANDBOX_CHECKOUT__: boolean
