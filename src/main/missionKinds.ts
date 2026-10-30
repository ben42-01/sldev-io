import { app } from 'electron'
import { existsSync, promises as fsp } from 'fs'
import { join } from 'path'
import { kindSlug, parseKindFile, type MissionKind } from '@shared/missionKinds'

/** Custom mission kinds: `.sldev/missions/*.md` in the project, or `<userData>/missions/*.md` for every project. */
const kindsDir = (scope: 'project' | 'user', root: string | null): string => (scope === 'project' && root ? join(root, '.sldev', 'missions') : join(app.getPath('userData'), 'missions'))

async function kindsIn(dir: string, scope: 'project' | 'user'): Promise<MissionKind[]> {
  const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md')).sort()
  const parsed = await Promise.all(files.map(async (f) => parseKindFile(await fsp.readFile(join(dir, f), 'utf8'), join(dir, f), scope)))
  return parsed.filter((k): k is MissionKind => !!k)
}

export async function listKinds(root: string | null): Promise<MissionKind[]> {
  const [project, user] = await Promise.all([root ? kindsIn(kindsDir('project', root), 'project') : [], kindsIn(kindsDir('user', null), 'user')])
  return [...project, ...user]
}

/** Writes a new kind file (never over an existing one) and returns its path, to open in the editor. */
export async function createKind(scope: 'project' | 'user', root: string | null, name: string, text: string): Promise<string> {
  const dir = kindsDir(scope, root)
  await fsp.mkdir(dir, { recursive: true })
  let p = join(dir, `${kindSlug(name)}.md`)
  for (let i = 2; existsSync(p); i++) p = join(dir, `${kindSlug(name)}-${i}.md`)
  await fsp.writeFile(p, text)
  return p
}
