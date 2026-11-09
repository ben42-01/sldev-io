import { promises as fsp } from 'fs'
import { basename, join } from 'path'
import { DRAFTS_DIR, SKILL_DIRS, SLDEV_SKILLS, copyState, draftKind, skillText, type DraftFile, type SkillCopyState, type SkillState } from '@shared/sldevSkills'

/** sldev's skills in a project and the drafts agents leave for the app. No electron imports: the CLI uses this too. */

const read = (p: string): Promise<string | null> => fsp.readFile(p, 'utf8').catch(() => null)
const copies = (root: string, name: string): string[] => SKILL_DIRS.map((d) => join(root, ...d.split('/'), name, 'SKILL.md'))

const RANK: SkillCopyState[] = ['missing', 'outdated', 'edited', 'foreign', 'current']

export async function skillsState(root: string): Promise<SkillState[]> {
  return Promise.all(
    SLDEV_SKILLS.map(async (s) => {
      const all = await Promise.all(copies(root, s.name).map(async (p) => copyState(s, await read(p))))
      // npx skills add writes one folder, so a missing copy only counts when no other copy exists
      const states = all.some((st) => st !== 'missing') ? all.filter((st) => st !== 'missing') : all
      return { name: s.name, label: s.label, state: RANK.find((r) => states.includes(r)) ?? 'current' }
    })
  )
}

/**
 * Writes the missing and outdated copies. A copy edited by hand (or someone else's skill of that name) is
 * kept unless its skill is named in `overwrite`. Returns the files written.
 */
export async function installSkills(root: string, overwrite: string[] = []): Promise<string[]> {
  const wrote: string[] = []
  for (const s of SLDEV_SKILLS) {
    for (const p of copies(root, s.name)) {
      const st = copyState(s, await read(p))
      if (st === 'current' || ((st === 'edited' || st === 'foreign') && !overwrite.includes(s.name))) continue
      await fsp.mkdir(join(p, '..'), { recursive: true })
      await fsp.writeFile(p, skillText(s))
      wrote.push(p)
    }
  }
  await prepareDrafts(root)
  return wrote
}

/** The skills as plain folders (`<dir>/<name>/SKILL.md`), for the public skills repo that `npx skills add` reads. */
export async function exportSkills(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const s of SLDEV_SKILLS) {
    const p = join(dir, s.name, 'SKILL.md')
    await fsp.mkdir(join(dir, s.name), { recursive: true })
    await fsp.writeFile(p, skillText(s))
    out.push(p)
  }
  return out
}

const draftsDir = (root: string): string => join(root, ...DRAFTS_DIR.split('/'))

/** The drafts folder, kept out of git: drafts are an inbox the app empties. */
export async function prepareDrafts(root: string): Promise<void> {
  const dir = draftsDir(root)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'EEXIST') throw e
  })
}

/** Mission and story drafts waiting in the project, oldest first. */
export async function listDrafts(root: string): Promise<DraftFile[]> {
  const dir = draftsDir(root)
  const names = (await fsp.readdir(dir).catch(() => [] as string[])).filter((n) => draftKind(n))
  // skills installed by npx never ran prepareDrafts: keep the inbox out of git before the first draft is taken
  if (names.length) await prepareDrafts(root).catch(() => undefined)
  const files = await Promise.all(
    names.map(async (name) => {
      const st = await fsp.stat(join(dir, name)).catch(() => null)
      // a draft still being written (or something huge) waits for the next look
      if (!st?.isFile() || st.size > 256_000 || Date.now() - st.mtimeMs < 1500) return null
      const text = await read(join(dir, name))
      return text === null ? null : { name, text, at: st.mtimeMs }
    })
  )
  return files.filter((f): f is DraftFile & { at: number } => !!f).sort((a, b) => a.at - b.at).map(({ name, text }) => ({ name, text }))
}

/** Taken into the app: the file goes. One that couldn't be read is renamed to .bad, so it's kept for the user and not read again. */
export async function settleDraft(root: string, name: string, ok: boolean): Promise<void> {
  const p = join(draftsDir(root), basename(name))
  if (!draftKind(basename(name))) throw new Error('Not a draft')
  if (ok) await fsp.rm(p, { force: true })
  else await fsp.rename(p, `${p}.bad`).catch(() => undefined)
}
