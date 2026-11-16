import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { SKILL_DIRS, copyState, skillText, skillVersionOf } from '@shared/sldevSkills'
import { CHILD_ONLY, OPEN } from '../src/daemon'
import { MAX_SPAWN, type Command } from '../src/protocol'
import { skillsInstall, skillsStatus } from '../src/repo'
import { CLI_SKILLS, CLI_SKILLS_VERSION } from '../src/skills'

const tmp = mkdtempSync(join(tmpdir(), 'sldev-cli-skills-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }))

const conductor = CLI_SKILLS.skills.find((s) => s.name === 'sldev-conductor')!
const main = readFileSync(resolve(__dirname, '../src/main.ts'), 'utf8')

/** the options `sldev <cmd>` parses, read from its case in main.ts */
function cmdBlock(cmd: string): string | null {
  const at = main.indexOf(`    case '${cmd}':`)
  if (at < 0) return null
  const next = main.indexOf("\n    case '", at + 10)
  return main.slice(at, next < 0 ? undefined : next)
}

/** every `sldev <cmd> …` the skill names, with its --flags: in code blocks (`block: true`) and in inline code */
function sldevCalls(body: string): { cmd: string; flags: string[]; line: string; block: boolean }[] {
  const out: { cmd: string; flags: string[]; line: string; block: boolean }[] = []
  const scan = (text: string, block: boolean): void => {
    // a quoted brief is not flags; shell separators end one command
    const plain = text.replace(/\\\n\s*/g, ' ').replace(/"[^"]*"/g, '""')
    for (const line of plain.split('\n'))
      for (const seg of line.split(/[;|&#]|\$\(|\)/)) {
        const m = /\bsldev\s+([a-z]+)\b(.*)$/.exec(seg)
        if (m) out.push({ cmd: m[1], flags: m[2].match(/--[a-z-]+/g) ?? [], line: seg.trim(), block })
      }
  }
  for (const m of body.matchAll(/```bash\n([\s\S]*?)```/g)) scan(m[1], true)
  for (const m of body.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]*\bsldev [^`\n]*)`/g)) scan(m[1], false)
  return out
}

describe('the CLI skills', () => {
  it('have names, descriptions agents can trigger on, and their version in the front matter', () => {
    for (const s of CLI_SKILLS.skills) {
      expect(s.name).toMatch(/^sldev-[a-z]+$/)
      expect(s.description.length).toBeGreaterThan(80)
      // the Agent Skills format caps a description at 1024 characters
      expect(s.description.length).toBeLessThanOrEqual(1024)
      const text = skillText(s, CLI_SKILLS_VERSION)
      expect(text).toMatch(new RegExp(`^---\\nname: ${s.name}\\n`))
      expect(skillVersionOf(text)).toBe(CLI_SKILLS_VERSION)
      expect(copyState(s, text, CLI_SKILLS_VERSION)).toBe('current')
      expect(copyState(s, skillText(s, CLI_SKILLS_VERSION - 1), CLI_SKILLS_VERSION)).toBe('outdated')
    }
  })

  it('the conductor names only commands and flags the CLI has', () => {
    const calls = sldevCalls(conductor.body)
    expect(calls.map((c) => c.cmd)).toEqual(expect.arrayContaining(['new', 'wait', 'read', 'ls', 'review']))
    for (const c of calls) {
      const block = cmdBlock(c.cmd)
      expect(block, `sldev ${c.cmd} (${c.line})`).not.toBeNull()
      for (const f of c.flags) expect(block, `${f} in: ${c.line}`).toMatch(new RegExp(`['\\s{]${f.slice(2)}'?\\s*:`))
    }
  })

  it('runs from its pane only what the guard lets a pane do, and starts workers the way the guard allows', () => {
    const local = new Set(['agents', 'kinds'])
    const calls = sldevCalls(conductor.body).filter((c) => c.block)
    for (const c of calls) expect(OPEN.has(c.cmd as Command) || CHILD_ONLY.has(c.cmd as Command) || c.cmd === 'new' || local.has(c.cmd), c.line).toBe(true)
    const workers = calls.filter((c) => c.cmd === 'new' && !c.flags.includes('--allow-spawn'))
    expect(workers.length).toBeGreaterThanOrEqual(3)
    for (const w of workers) {
      expect(w.flags, w.line).toEqual(expect.arrayContaining(['--print', '--worktree']))
      for (const refused of ['--here', '--repeat', '--failover']) expect(w.flags, w.line).not.toContain(refused)
      // acceptance criteria only go into a kind's prompt
      if (w.flags.includes('--criteria')) expect(w.flags).toContain('--kind')
    }
    // the one --allow-spawn is the command it gives the person, never one it runs
    const restart = calls.filter((c) => c.flags.includes('--allow-spawn'))
    expect(restart).toHaveLength(1)
    expect(conductor.body).toMatch(/from their own terminal, not yours[^\n]*\n\n```bash\nsldev new --allow-spawn/)
  })

  it('states the guard’s limits, never pushes, and stops on a conflict it can’t resolve', () => {
    const b = conductor.body
    expect(b).toContain(`1 to ${MAX_SPAWN}`)
    for (const s of ['`--here`', '`--repeat`', '`--allow-spawn`', 'git push fails for them', '`sldev review`', 'sldev refuses', 'SLDEV_MISSION_ID', 'SLDEV_CLI_DAEMON', 'spawnedBy'])
      expect(b).toContain(s)
    expect(b).toMatch(/Never `git push`, never open a pull request/)
    expect(b).toMatch(/git merge --abort`?, merge nothing more[\s\S]{0,80}stop to ask the person/)
    expect(b).not.toMatch(/^\s*git push/m)
    expect(b).not.toMatch(/^\s*gh pr create/m)
  })
})

describe('sldev skills install', () => {
  it('installs the CLI skills next to the app’s, and updates an older copy', async () => {
    const repo = join(tmp, 'repo')
    execFileSync('git', ['init', '-q', repo])
    expect(await skillsStatus(repo)).toMatch(/\/sldev-conductor\s+Run other agents\s+not installed/)
    const out = await skillsInstall(repo, [])
    for (const d of SKILL_DIRS) {
      expect(out).toContain(join(repo, ...d.split('/'), 'sldev-conductor', 'SKILL.md'))
      expect(out).toContain(join(repo, ...d.split('/'), 'sldev-mission', 'SKILL.md'))
      expect(readFileSync(join(repo, ...d.split('/'), 'sldev-conductor', 'SKILL.md'), 'utf8')).toBe(skillText(conductor, CLI_SKILLS_VERSION))
    }
    expect(await skillsStatus(repo)).toMatch(/\/sldev-conductor\s+Run other agents\s+installed/)
    expect(await skillsInstall(repo, [])).toMatch(/^Already up to date\./)

    const copy = join(repo, '.claude', 'skills', 'sldev-conductor', 'SKILL.md')
    writeFileSync(copy, skillText(conductor, CLI_SKILLS_VERSION - 1))
    expect(await skillsStatus(repo)).toMatch(/\/sldev-conductor\s+Run other agents\s+older version/)
    expect(await skillsInstall(repo, [])).toContain(copy)
    expect(readFileSync(copy, 'utf8')).toBe(skillText(conductor, CLI_SKILLS_VERSION))
  })
})
