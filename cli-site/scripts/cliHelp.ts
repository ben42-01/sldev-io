import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * The /commands page is `sldev help`, parsed at build time: nothing about a command is written by hand here,
 * so a change to the help shows up on the next build. The help is laid out in columns (usage, then its
 * description), options indented under their command, wrapped lines indented further, and prose at column 0.
 */

export interface HelpOption {
  flag: string
  text: string
  /** 0 for an option of the command, 1 for one that belongs to the option above (--gap under --repeat) */
  depth: number
}

export interface HelpCommand {
  /** an anchor: "new", "loops-stop", "attach" for plain `sldev` */
  id: string
  /** the command's words without its arguments: "loops stop", "" for plain `sldev` */
  name: string
  usage: string
  text: string
  options: HelpOption[]
}

export type SectionId = 'attach' | 'panes' | 'loops' | 'repo'

export interface HelpSection {
  id: SectionId
  commands: HelpCommand[]
}

export interface CliHelp {
  /** the first line: "sldev 0.6.0: run coding agents …" */
  title: string
  sections: HelpSection[]
  /** the prose paragraphs, in order */
  notes: string[]
  /** the help exactly as printed */
  raw: string
}

const ORDER: SectionId[] = ['attach', 'panes', 'loops', 'repo']
const LOOP_COMMANDS = new Set(['loops', 'accept'])

const indentOf = (line: string): number => line.length - line.trimStart().length

/** where descriptions start in a block: the most common column after a gap of two or more spaces */
function blockColumn(lines: string[]): number {
  const counts = new Map<number, number>()
  for (const line of lines) {
    const m = /^(\s*\S.*?\S)\s{2,}\S/.exec(line)
    if (m && indentOf(line) <= 2 && line.trimStart().startsWith('sldev')) {
      const col = m[0].length - 1
      counts.set(col, (counts.get(col) ?? 0) + 1)
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1
}

/**
 * Splits "usage  description". Most lines have a gap of two spaces or more; a usage that runs up to the column
 * leaves only one, so then a word break near the block's column counts, if what's before it ends like syntax
 * (`]`, `>`, `"`) and what's after doesn't start like it.
 */
function split(line: string, col: number): [string, string] {
  const m = /^\s*(\S.*?\S|\S)\s{2,}(\S.*)$/.exec(line)
  if (m) return [m[1], m[2]]
  if (col > 0) {
    const tries = [col, col - 1, col - 2, col - 3, col + 1]
    for (const c of tries) {
      if (c <= 0 || c >= line.length || line[c - 1] !== ' ' || line[c] === ' ') continue
      const head = line.slice(0, c).trim()
      const tail = line.slice(c).trim()
      if (/[\]>"]$/.test(head) && !/^[[<"'|-]/.test(tail) && !/^\S*\|/.test(tail)) return [head, tail]
    }
  }
  return [line.trim(), '']
}

function commandName(usage: string): string {
  const words: string[] = []
  for (const w of usage.split(/\s+/).slice(1)) {
    if (/^[[<"'|-]/.test(w) || w.includes('|')) break
    words.push(w)
  }
  return words.join(' ')
}

const join = (a: string, b: string): string => (a ? (b ? `${a} ${b}` : a) : b)

export function parseHelp(raw: string): CliHelp {
  const text = raw.replace(/\r\n/g, '\n').trimEnd()
  const lines = text.split('\n')
  const title = lines.shift()?.trim() ?? ''

  // blocks are separated by blank lines; each has its own description column
  const blocks: string[][] = [[]]
  for (const line of lines) {
    if (line.trim() === '') {
      if (blocks[blocks.length - 1].length) blocks.push([])
    } else blocks[blocks.length - 1].push(line)
  }

  const sections = new Map<SectionId, HelpCommand[]>(ORDER.map((id) => [id, []]))
  const notes: string[] = []
  const ids = new Set<string>()
  const columns = blocks.map(blockColumn)
  // the block with the widest column is the repo commands' (rules, skills, memory…), laid out apart
  const widest = Math.max(...columns)
  const repoCol = widest > Math.min(...columns.filter((c) => c > 0)) ? widest : Infinity

  blocks.forEach((block, b) => {
    const col = columns[b]
    let cmd: HelpCommand | undefined
    let opt: HelpOption | undefined
    let note: string | undefined
    const endNote = (): void => {
      if (note !== undefined) notes.push(note)
      note = undefined
    }
    for (const line of block) {
      const indent = indentOf(line)
      const body = line.trim()
      if (indent === 0) {
        // prose: a line carries on the paragraph above unless that one ended a sentence
        if (note !== undefined && /[.:]$/.test(note)) endNote()
        note = note === undefined ? body : join(note, body)
        continue
      }
      endNote()
      if (indent <= 2 && body.startsWith('sldev')) {
        const [usage, desc] = split(line, col)
        const name = commandName(usage)
        let id = (name || 'attach').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'command'
        for (let n = 2; ids.has(id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`
        ids.add(id)
        cmd = { id, name, usage, text: desc, options: [] }
        opt = undefined
        const first = name.split(' ')[0]
        const section: SectionId = name === '' ? 'attach' : LOOP_COMMANDS.has(first) ? 'loops' : col === repoCol ? 'repo' : 'panes'
        sections.get(section)!.push(cmd)
      } else if (cmd && body.startsWith('-') && indent < (col > 0 ? col : Infinity)) {
        const [flag, desc] = split(line, col)
        opt = { flag, text: desc, depth: indent > 6 ? 1 : 0 }
        cmd.options.push(opt)
      } else if (opt) opt.text = join(opt.text, body)
      else if (cmd) cmd.text = join(cmd.text, body)
      else note = body
    }
    endNote()
  })

  return {
    title,
    sections: ORDER.map((id) => ({ id, commands: sections.get(id)! })).filter((s) => s.commands.length),
    notes,
    raw: text
  }
}

/** Builds the CLI from the repo root and reads its help. Throws if either fails, so a build never ships a stale list. */
export function readCliHelp(): CliHelp {
  const repo = fileURLToPath(new URL('../../', import.meta.url))
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  execFileSync(npm, ['run', 'cli:build'], { cwd: repo, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' })
  const out = execFileSync(process.execPath, ['cli/dist/sldev.mjs', 'help'], { cwd: repo, encoding: 'utf8' })
  const help = parseHelp(out)
  const count = help.sections.reduce((n, s) => n + s.commands.length, 0)
  if (count === 0) throw new Error(`sldev help printed no commands:\n${out}`)
  return help
}
