import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseHelp, usageFromSource } from '../website/src/cli/cliHelp'
import data from '../website/src/cli/cliHelp.json'
import { FEATURES } from '../website/src/cli/features'

// the sldev CLI's pages on the sldev site (/cli, /cli/commands). The site builds from website/ alone, so the
// CLI's help is a generated file, website/src/cli/cliHelp.json; these keep it in step with the CLI.
const cliDir = join(__dirname, '..', 'cli')
const usage = (version = '9.9.9'): string => usageFromSource(readFileSync(join(cliDir, 'src', 'main.ts'), 'utf8'), version)

describe('website /cli', () => {
  it('has the help and version of the CLI on master (run `npm run cli-help` in website/ when this fails)', () => {
    const version = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8')).version
    expect(data.version).toBe(version)
    expect(data.help).toEqual(parseHelp(usage(version)))
  })
})

// the commands page is the CLI's own help, parsed; these run the parser on the help text in cli/src/main.ts so a
// layout the parser can't read fails here, not on the site
describe('website /cli/commands', () => {
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

  it('reads a changed help without any edit to the site', () => {
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

})
