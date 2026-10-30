import { existsSync, readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

// every guide in docs.tsx needs website/docs/<id>/index.html, or /docs/<id> serves the home page
const source = readFileSync('website/src/content/docs.tsx', 'utf8')
const ids = [...source.matchAll(/^const \w+: DocPage = \{\n {2}id: '([\w-]+)'/gm)].map((m) => m[1])

describe('docs pages', () => {
  it('finds the guides', () => {
    expect(ids).toContain('recipes')
    expect(ids).toContain('missions')
  })

  it.each(ids)('%s has its HTML entry', (id) => {
    const file = `website/docs/${id}/index.html`
    expect(existsSync(file), file).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain(`data-page="docs-${id}"`)
  })

  it.each(ids)('%s is in the docs list', (id) => {
    const list = /export const docs: DocPage\[\] = \[([^\]]*)\]/.exec(source)?.[1] ?? ''
    const name = new RegExp(`^const (\\w+): DocPage = \\{\\n {2}id: '${id}'`, 'm').exec(source)?.[1]
    expect(list.split(',').map((s) => s.trim())).toContain(name)
  })
})
