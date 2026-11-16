import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseHelp } from '../cli-site/scripts/cliHelp'
import { FEATURES } from '../cli-site/src/content/features'

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

// the /commands page is the CLI's own help, parsed at build time; these run the parser on the help text in
// cli/src/main.ts (as the built CLI prints it) so a layout the parser can't read fails here, not on the site
const usage = (): string => {
  const src = readFileSync(join(__dirname, '..', 'cli', 'src', 'main.ts'), 'utf8')
  const m = /const USAGE = `([\s\S]*?)`\n/.exec(src)
  if (!m) throw new Error('USAGE not found in cli/src/main.ts')
  return m[1].replace(/\$\{VERSION\}/g, '9.9.9')
}

describe('cli-site /commands', () => {
  const help = parseHelp(usage())
  const commands = help.sections.flatMap((s) => s.commands)

  it('lists every command and option sldev help prints', () => {
    expect(help.title).toMatch(/^sldev 9\.9\.9: /)
    const lines = usage().split('\n')
    for (const line of lines.filter((l) => /^ {1,2}sldev\b/.test(l))) {
      expect(commands.some((c) => line.trim().startsWith(c.usage)), line).toBe(true)
    }
    const flags = commands.flatMap((c) => c.options.map((o) => o.flag))
    for (const line of lines.filter((l) => /^ {3,}-/.test(l))) expect(flags.some((f) => line.trim().startsWith(f)), line).toBe(true)
    expect(new Set(commands.map((c) => c.id)).size).toBe(commands.length)
  })

  it('splits usage from description, even with one space between them', () => {
    const byId = Object.fromEntries(commands.map((c) => [c.id, c]))
    expect(byId.read.usage).toBe('sldev read <pane> [--lines n]')
    expect(byId.read.text).toBe("the pane's screen as text")
    expect(byId.skills.usage).toBe('sldev skills [status|install [--overwrite <names>]]')
    expect(byId.wait.text).toBe('')
    expect(byId.attach.usage).toBe('sldev')
    expect(byId.attach.text).toMatch(/Ctrl-b c new tab/)
  })

  it('groups commands into attach, panes, loops and repo commands', () => {
    const section = (id: string): string | undefined => help.sections.find((s) => s.commands.some((c) => c.id === id))?.id
    expect(help.sections.map((s) => s.id)).toEqual(['attach', 'panes', 'loops', 'repo'])
    expect([section('attach'), section('new'), section('loops-stop'), section('accept'), section('usage')]).toEqual(['attach', 'panes', 'loops', 'loops', 'repo'])
  })

  it('reads a changed help without any edit to cli-site', () => {
    const changed = usage().replace('  sldev ls [--json]', '  sldev frob <pane>             frobs a pane\n  sldev ls [--json]')
    const c = parseHelp(changed).sections.flatMap((s) => s.commands).find((x) => x.id === 'frob')
    expect(c).toMatchObject({ usage: 'sldev frob <pane>', text: 'frobs a pane' })
  })

  it('links each feature card to commands that exist', () => {
    const ids = new Set(commands.map((c) => c.id))
    for (const f of FEATURES) {
      expect(f.uses.length, f.title).toBeGreaterThan(0)
      for (const u of f.uses) if (u.command) expect(ids.has(u.command), `${f.title}: ${u.command}`).toBe(true)
    }
  })

  it('uses no root-absolute links, so it works under any base path', () => {
    for (const f of sources.filter((x) => /\.tsx$/.test(x))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/href=(\{\s*)?["'`]\/(?!\/)/)
    }
  })
})
