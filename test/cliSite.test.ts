import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// cli-site/ is the free CLI's own home page: it builds alone (no imports from the app, website/ or the CLI's
// source) and never calls the CLI open source, since its source is private
const root = join(__dirname, '..', 'cli-site')
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === 'node_modules' || name === 'dist') return []
    return statSync(path).isDirectory() ? files(path) : [path]
  })
const sources = files(root).filter((f) => /\.(tsx?|json|html|css)$/.test(f) && !f.endsWith('package-lock.json'))

describe('cli-site', () => {
  it('imports nothing from website/, src/ or cli/src', () => {
    for (const f of sources.filter((x) => /\.tsx?$/.test(x))) {
      const specs = [...readFileSync(f, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
      for (const s of specs) expect(s, `${f} imports ${s}`).not.toMatch(/^(\.\.\/)+(website|src|cli)\b|^@(shared|renderer)\//)
    }
  })

  it('never says open source or Apache, and links no source code', () => {
    for (const f of sources) {
      const text = readFileSync(f, 'utf8')
      expect(text, f).not.toMatch(/open[ -]source|apache/i)
      expect(text, f).not.toMatch(/github\.com\/ben42-01\/sldev-io/)
    }
  })

  it('loads nothing from other sites (no CDN fonts, scripts or analytics)', () => {
    for (const f of sources.filter((x) => /\.(html|css)$/.test(x))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/(src|href)=["']https?:|url\(\s*['"]?https?:|@import\s+['"]?https?:/)
    }
  })
})
