import { existsSync, promises as fsp } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join, relative, sep } from 'path'
import { parse as parseYaml } from 'yaml'
import type { ClaudeAsset, McpServer } from '@shared/types'
import { run } from './git'

const claudeHome = (): string => join(homedir(), '.claude')

function frontmatter(text: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return {}
  try {
    return (parseYaml(m[1]) as Record<string, unknown>) ?? {}
  } catch {
    return {}
  }
}

async function readAsset(path: string, kind: ClaudeAsset['kind'], source: ClaudeAsset['source'], fallbackName: string, plugin?: string): Promise<ClaudeAsset | null> {
  const text = await fsp.readFile(path, 'utf8').catch(() => null)
  if (text === null) return null
  const fm = frontmatter(text)
  const name = typeof fm.name === 'string' && fm.name ? fm.name : fallbackName
  let description = typeof fm.description === 'string' ? fm.description : ''
  if (!description) description = text.replace(/^---[\s\S]*?---/, '').trim().split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim() ?? ''
  const invocation = kind === 'agent' ? `@${name}` : `/${plugin ? `${plugin}:` : ''}${name}`
  return { kind, name, description: description.slice(0, 400), source, plugin, path, invocation }
}

async function subdirs(dir: string): Promise<string[]> {
  return (await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => join(dir, d.name))
}

async function skillsIn(dir: string, source: ClaudeAsset['source'], plugin?: string): Promise<ClaudeAsset[]> {
  const out = await Promise.all((await subdirs(dir)).map((d) => readAsset(join(d, 'SKILL.md'), 'skill', source, basename(d), plugin)))
  return out.filter((a): a is ClaudeAsset => !!a)
}

/** commands/**.md; subfolders become `ns:name` */
async function commandsIn(dir: string, source: ClaudeAsset['source'], plugin?: string): Promise<ClaudeAsset[]> {
  const out: ClaudeAsset[] = []
  const walk = async (d: string, depth: number): Promise<void> => {
    for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name)
      if (e.isDirectory() && depth < 3) await walk(p, depth + 1)
      else if (e.isFile() && e.name.endsWith('.md')) {
        const name = relative(dir, p).slice(0, -3).split(sep).join(':')
        const a = await readAsset(p, 'command', source, name, plugin)
        if (a) out.push({ ...a, name, invocation: `/${plugin ? `${plugin}:` : ''}${name}` })
      }
    }
  }
  await walk(dir, 0)
  return out
}

async function agentsIn(dir: string, source: ClaudeAsset['source'], plugin?: string): Promise<ClaudeAsset[]> {
  const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md'))
  const out = await Promise.all(files.map((f) => readAsset(join(dir, f), 'agent', source, f.slice(0, -3), plugin)))
  return out.filter((a): a is ClaudeAsset => !!a)
}

async function installedPlugins(): Promise<Array<{ name: string; path: string }>> {
  try {
    const data = JSON.parse(await fsp.readFile(join(claudeHome(), 'plugins', 'installed_plugins.json'), 'utf8'))
    return Object.entries(data.plugins ?? {}).flatMap(([key, entries]) => {
      const e = (entries as Array<{ installPath?: string }>)[0]
      return e?.installPath && existsSync(e.installPath) ? [{ name: key.split('@')[0], path: e.installPath }] : []
    })
  } catch {
    return []
  }
}

export async function listClaudeAssets(root: string | null): Promise<ClaudeAsset[]> {
  const home = claudeHome()
  const jobs: Array<Promise<ClaudeAsset[]>> = [
    skillsIn(join(home, 'skills'), 'user'),
    commandsIn(join(home, 'commands'), 'user'),
    agentsIn(join(home, 'agents'), 'user'),
    // skills synced from claude.ai live one level deeper
    subdirs(join(home, 'skills', 'synced')).then((ds) => Promise.all(ds.map((d) => skillsIn(d, 'synced')))).then((x) => x.flat())
  ]
  if (root) {
    const pc = join(root, '.claude')
    jobs.push(skillsIn(join(pc, 'skills'), 'project'), commandsIn(join(pc, 'commands'), 'project'), agentsIn(join(pc, 'agents'), 'project'))
    // agent-neutral skill folders: sldev's own and the shared .agents convention
    jobs.push(skillsIn(join(root, '.sldev', 'skills'), 'project'), skillsIn(join(root, '.agents', 'skills'), 'project'))
  }
  for (const p of await installedPlugins()) {
    jobs.push(skillsIn(join(p.path, 'skills'), 'plugin', p.name), commandsIn(join(p.path, 'commands'), 'plugin', p.name), agentsIn(join(p.path, 'agents'), 'plugin', p.name))
  }
  const all = (await Promise.all(jobs)).flat()
  // one skill in several project folders (sldev's own skills go in .claude/skills and .agents/skills) is listed once
  const seen = new Set<string>()
  return all.filter((a) => {
    if (a.kind === 'skill' && basename(dirname(a.path)) === 'synced') return false
    if (a.kind !== 'skill' || a.source !== 'project') return true
    if (seen.has(a.name)) return false
    seen.add(a.name)
    return true
  })
}

export async function createSkill(scope: 'user' | 'project', root: string | null, name: string, description: string, body: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('Use lowercase letters, digits and dashes for the skill name')
  const base = scope === 'project' && root ? join(root, '.claude', 'skills') : join(claudeHome(), 'skills')
  const dir = join(base, name)
  if (existsSync(dir)) throw new Error(`A skill named "${name}" already exists`)
  await fsp.mkdir(dir, { recursive: true })
  const file = join(dir, 'SKILL.md')
  const desc = description.replace(/\n/g, ' ').trim()
  await fsp.writeFile(file, `---\nname: ${name}\ndescription: ${JSON.stringify(desc)}\n---\n\n${body.trim() || `# ${name}\n\nDescribe what Claude should do when this skill is used.`}\n`)
  return file
}

export async function listMcpServers(cwd: string): Promise<{ servers: McpServer[]; raw: string }> {
  const r = await run('claude', ['mcp', 'list'], cwd, 60000)
  const raw = (r.stdout + r.stderr).trim()
  const servers: McpServer[] = []
  for (const line of r.stdout.split('\n')) {
    const m = /^([^\s:][^:]*):\s+(.+?)\s+-\s+(.+)$/.exec(line.trim())
    if (m) servers.push({ name: m[1], detail: m[2], status: m[3] })
  }
  return { servers, raw }
}
