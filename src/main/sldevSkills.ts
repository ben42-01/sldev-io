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
      const states = await Promise.all(copies(root, s.name).map(async (p) => copyState(s, await read(p))))
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
