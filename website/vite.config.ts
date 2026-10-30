import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Connect, type Plugin } from 'vite'
import { GET as download } from './api/download'

/**
 * Publishes the free-beta window as /beta.json. The desktop app reads it at start and every few
 * hours, so editing beta.startsAt / beta.endsAt in pricing.json and redeploying the site opens,
 * extends or ends the beta without shipping a new app build.
 */
function betaJson(): Plugin {
  const read = (): string => {
    const { beta } = JSON.parse(readFileSync(new URL('./src/content/pricing.json', import.meta.url), 'utf8'))
    return JSON.stringify({ startsAt: beta?.startsAt ?? null, endsAt: beta?.endsAt ?? null }, null, 2) + '\n'
  }
  return {
    name: 'beta-json',
    configureServer(server) {
      server.middlewares.use('/beta.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(read())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'beta.json', source: read() })
    }
  }
}

/** Serves /download/<platform> in dev the way the vercel.json rewrite does in production. */
function downloadRedirect(): Plugin {
  return {
    name: 'download-redirect',
    configureServer(server) {
      server.middlewares.use('/download/', (req, res, next) => {
        const os = encodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0])
        // /download itself is the download page
        if (!os || os === 'index.html') return next()
        void download(new Request(`http://localhost/api/download?os=${os}`)).then((r) => {
          res.statusCode = r.status
          res.setHeader('Location', r.headers.get('Location') ?? '/')
          res.end()
        })
      })
    }
  }
}

// /docs/<id> pages are found on disk, so a new guide only needs its docs/<id>/index.html (test/docsPages.test.ts checks there is one)
const docPages = readdirSync(new URL('./docs/', import.meta.url), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(new URL(`./docs/${e.name}/index.html`, import.meta.url)))
  .map((e) => `docs/${e.name}`)

// extra HTML pages next to index.html (each has <name>/index.html)
const pages = ['features', 'pricing', 'download', 'changelog', 'compare', 'docs', ...docPages, 'terms', 'privacy', 'refunds', 'thanks']

/** /terms → /terms/ in dev and preview, like the vercel.json rewrites (Vite would serve the home page). */
function pageRoutes(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const [path, query] = (req.url ?? '').split('?')
    if (pages.includes(path.slice(1))) req.url = `${path}/${query ? `?${query}` : ''}`
    next()
  }
  return {
    name: 'page-routes',
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite)
  }
}

const page = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  plugins: [react(), betaJson(), downloadRedirect(), pageRoutes()],
  build: {
    rollupOptions: {
      input: {
        main: page('./index.html'),
        ...Object.fromEntries(pages.map((p) => [p, page(`./${p}/index.html`)]))
      }
    }
  }
})
