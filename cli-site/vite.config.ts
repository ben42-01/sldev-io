import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { readCliHelp } from './scripts/cliHelp.ts'

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

/**
 * `virtual:cli-help`: the built CLI's `sldev help`, parsed (scripts/cliHelp.ts). The CLI is built once per
 * build or dev server start, so the /commands page always lists what that build of the CLI says.
 */
function cliHelp(): Plugin {
  const id = 'virtual:cli-help'
  let code: string | undefined
  return {
    name: 'cli-help',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(resolved) {
      if (resolved !== `\0${id}`) return undefined
      code ??= `export default ${JSON.stringify(readCliHelp())}`
      return code
    }
  }
}

export default defineConfig(({ command }) => {
  // a shell with NODE_ENV=development (one opened from a dev copy of sldev-io) would otherwise ship React's dev build
  if (command === 'build') process.env.NODE_ENV = 'production'
  return {
    base: base(),
    // two real pages, not a single-page app: /commands/ serves commands/index.html in dev and preview too
    appType: 'mpa',
    define: { __CLI_VERSION__: JSON.stringify(cliVersion) },
    plugins: [react(), cliHelp()],
    build: {
      rollupOptions: {
        // one HTML page per route, so /commands/ is a real file on any static host
        input: {
          home: fileURLToPath(new URL('index.html', import.meta.url)),
          commands: fileURLToPath(new URL('commands/index.html', import.meta.url))
        }
      }
    }
  }
})
