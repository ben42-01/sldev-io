import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

const site = JSON.parse(readFileSync(resolve('website/src/content/site.json'), 'utf8')) as { sourceUrl: string; sponsorUrl: string }

export default defineConfig({
  define: { __SOURCE_URL__: JSON.stringify(site.sourceUrl), __SPONSOR_URL__: JSON.stringify(site.sponsorUrl) },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'cli/test/**/*.test.ts'],
    setupFiles: ['test/setup.ts']
  }
})
