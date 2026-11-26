import { existsSync, promises as fsp } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import { claudeSubagentFile, opencodeAgentFile, parseProfileFile, profileSlug, serializeProfile, TEAM_TEMPLATES, teamFiles } from '@shared/profiles'
import type { TeamTemplate } from '@shared/profiles'
import type { AgentProfile } from '@shared/types'

/** Project agent profiles: `.sldev/agents/*.md` in the project, so they can be committed. */
const agentsDir = (root: string): string => join(root, '.sldev', 'agents')

function assertInside(root: string, p: string): string {
  const abs = resolve(p)
  if (!abs.startsWith(resolve(agentsDir(root)) + sep)) throw new Error('Path is outside .sldev/agents')
  return abs
}

export async function listProfiles(root: string): Promise<AgentProfile[]> {
  const dir = agentsDir(root)
  const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md'))
  const parsed = await Promise.all(files.map(async (f) => parseProfileFile(await fsp.readFile(join(dir, f), 'utf8'), join(dir, f))))
  return parsed.filter((p): p is AgentProfile => !!p).sort((a, b) => a.name.localeCompare(b.name))
}

/** Writes the profile (to its own file when it has one) and returns the path. */
export async function saveProfile(root: string, profile: AgentProfile): Promise<string> {
  const dir = agentsDir(root)
  await fsp.mkdir(dir, { recursive: true })
  let p = profile.path ? assertInside(root, profile.path) : join(dir, `${profileSlug(profile.name)}.md`)
  if (!profile.path) for (let i = 2; existsSync(p); i++) p = join(dir, `${profileSlug(profile.name)}-${i}.md`)
  await fsp.writeFile(p, serializeProfile(profile))
  return p
}

/** Installs a team's profiles; a role whose file already exists is skipped, never overwritten. Returns absolute paths. */
export async function installTeam(root: string, team: TeamTemplate | string): Promise<{ written: string[]; skipped: string[] }> {
  const template = typeof team === 'string' ? TEAM_TEMPLATES.find((t) => t.id === team) : team
  if (!template) throw new Error(`Unknown team template: ${String(team)}`)
  const dir = agentsDir(root)
  await fsp.mkdir(dir, { recursive: true })
  const { write, skipped } = teamFiles(template, await fsp.readdir(dir))
  const written: string[] = []
  const skippedPaths = skipped.map((f) => join(root, f.path))
  for (const f of write) {
    const p = join(root, f.path)
    try {
      // 'wx' fails if the file appeared since the listing, so a hand-made copy still wins
      await fsp.writeFile(p, f.text, { flag: 'wx' })
      written.push(p)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      skippedPaths.push(p)
    }
  }
  return { written, skipped: skippedPaths }
}

/** `trash` moves the file to the OS trash (Electron's shell.trashItem in the app), so a removal can be undone. */
export const removeProfile = (root: string, p: string, trash: (path: string) => Promise<void>): Promise<void> => trash(assertInside(root, p))

export type ExportTarget = 'claude' | 'opencode'

/** Writes the profile in another agent's own format; returns the path. Never overwrites a file it didn't write. */
export async function exportProfile(root: string, profile: AgentProfile, target: ExportTarget): Promise<string> {
  const slug = profileSlug(profile.name)
  const p = target === 'claude' ? join(root, '.claude', 'agents', `${slug}.md`) : join(root, '.opencode', 'agent', `${slug}.md`)
  const text = target === 'claude' ? claudeSubagentFile(profile) : opencodeAgentFile(profile)
  const existing = await fsp.readFile(p, 'utf8').catch(() => null)
  if (existing !== null && !existing.includes(profile.role.trim().slice(0, 80))) throw new Error(`${p} already exists and wasn't exported from this profile`)
  await fsp.mkdir(dirname(p), { recursive: true })
  await fsp.writeFile(p, text)
  return p
}
