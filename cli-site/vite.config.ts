import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Where the site is served from: `/` on a domain of its own, `/downloads.sldev.io/` on GitHub Pages.
 * Vite wants it with a slash at both ends.
 */
function base(): string {
  const raw = (process.env.CLI_SITE_BASE ?? '/').trim()
  if (raw === '' || raw === '/') return '/'
  return `/${raw.replace(/^\/+|\/+$/g, '')}/`
}

// the CLI's version, read from its package.json at build time (data only: nothing from cli/src is imported)
const cliVersion: string = JSON.parse(readFileSync(new URL('../cli/package.json', import.meta.url), 'utf8')).version

export default defineConfig(({ command }) => {
  // a shell with NODE_ENV=development (one opened from a dev copy of sldev-io) would otherwise ship React's dev build
  if (command === 'build') process.env.NODE_ENV = 'production'
  return {
    base: base(),
    define: { __CLI_VERSION__: JSON.stringify(cliVersion) },
    plugins: [react()]
  }
})
