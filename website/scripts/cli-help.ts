// Writes src/cli/cliHelp.json: the sldev CLI's version and its `sldev help`, parsed, for /cli and /cli/commands.
// The site builds from website/ alone (Vercel), so it can't build the CLI; run this after changing the CLI's
// help or version (npm run cli-help in website/). test/cliSite.test.ts fails while the file is out of date.
import { readFileSync, writeFileSync } from 'node:fs'
import { parseHelp, usageFromSource } from '../src/cli/cliHelp.ts'

const repo = new URL('../../', import.meta.url)
const version: string = JSON.parse(readFileSync(new URL('cli/package.json', repo), 'utf8')).version
const help = parseHelp(usageFromSource(readFileSync(new URL('cli/src/main.ts', repo), 'utf8'), version))
if (!help.sections.some((s) => s.commands.length)) throw new Error('sldev help has no commands')
writeFileSync(new URL('../src/cli/cliHelp.json', import.meta.url), JSON.stringify({ version, help }, null, 2) + '\n')
console.log(`cliHelp.json: sldev ${version}, ${help.sections.reduce((n, s) => n + s.commands.length, 0)} commands`)
