import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// The website is the source of truth for links.
const site = JSON.parse(readFileSync(resolve('website/src/content/site.json'), 'utf8')) as { url: string; sourceUrl: string; sponsorUrl: string }
const siteUrl = process.env.SLDEV_SITE_URL || site.url
// What's new after an update; the website renders the same file as /changelog.
const changelog = readFileSync(resolve('website/src/content/changelog.json'), 'utf8')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    define: { __SITE_URL__: JSON.stringify(siteUrl) }
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
    define: { __SITE_URL__: JSON.stringify(siteUrl), __SOURCE_URL__: JSON.stringify(site.sourceUrl), __SPONSOR_URL__: JSON.stringify(site.sponsorUrl), __CHANGELOG__: changelog }
  }
})
