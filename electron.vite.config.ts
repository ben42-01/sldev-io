import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// The website is the source of truth for links and the beta window (it publishes /beta.json).
const site = JSON.parse(readFileSync(resolve('website/src/content/site.json'), 'utf8')) as { url: string }
const siteUrl = process.env.SLDEV_SITE_URL || site.url
// What's new after an update; the website renders the same file as /changelog.
const changelog = readFileSync(resolve('website/src/content/changelog.json'), 'utf8')
// Plans and checkout links for Settings → License; the website renders the same file as /pricing.
const pricing = readFileSync(resolve('website/src/content/pricing.json'), 'utf8')
const sandboxCheckout = process.env.SLDEV_CHECKOUT === 'sandbox'
const betaConfigUrl = process.env.SLDEV_BETA_CONFIG_URL || `${siteUrl}/beta.json`

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    define: { __BETA_CONFIG_URL__: JSON.stringify(betaConfigUrl), __SITE_URL__: JSON.stringify(siteUrl) }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    define: { __SITE_URL__: JSON.stringify(siteUrl), __CHANGELOG__: changelog, __PRICING__: pricing, __SANDBOX_CHECKOUT__: JSON.stringify(sandboxCheckout) }
  }
})
