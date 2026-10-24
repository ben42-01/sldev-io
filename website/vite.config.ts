import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
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
      server.middlewares.use('/download/', (req, res) => {
        const os = encodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0])
        void download(new Request(`http://localhost/api/download?os=${os}`)).then((r) => {
          res.statusCode = r.status
          res.setHeader('Location', r.headers.get('Location') ?? '/')
          res.end()
        })
      })
    }
  }
}

export default defineConfig({ plugins: [react(), betaJson(), downloadRedirect()] })
