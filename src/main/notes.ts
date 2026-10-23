import { app, shell } from 'electron'
import { createHash } from 'crypto'
import { existsSync, promises as fsp } from 'fs'
import { join, resolve, sep } from 'path'
import type { NoteMeta } from '@shared/types'

/** Notes are plain Markdown files: <userData>/notes/global and <userData>/notes/projects/<hash>. */
function notesRoot(): string {
  return join(app.getPath('userData'), 'notes')
}

export function notesDir(scope: string | null): string {
  if (!scope) return join(notesRoot(), 'global')
  return join(notesRoot(), 'projects', createHash('sha1').update(scope).digest('hex').slice(0, 12))
}

function assertInside(p: string): string {
  const abs = resolve(p)
  if (!abs.startsWith(resolve(notesRoot()) + sep)) throw new Error('Path is outside the notes folder')
  return abs
}

function titleOf(text: string, file: string): string {
  const h = /^#\s+(.+)$/m.exec(text)
  return (h?.[1] ?? file.replace(/\.md$/, '').replace(/[-_]/g, ' ')).trim().slice(0, 120)
}

export async function listNotes(scope: string | null): Promise<NoteMeta[]> {
  const dir = notesDir(scope)
  const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md'))
  const metas = await Promise.all(
    files.map(async (f) => {
      const p = join(dir, f)
      const [stat, text] = await Promise.all([fsp.stat(p), fsp.readFile(p, 'utf8')])
      return { path: p, title: titleOf(text.slice(0, 2000), f), mtime: stat.mtimeMs }
    })
  )
  return metas.sort((a, b) => b.mtime - a.mtime)
}

export async function createNote(scope: string | null, title: string): Promise<string> {
  const dir = notesDir(scope)
  await fsp.mkdir(dir, { recursive: true })
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'note'
  let p = join(dir, `${slug}.md`)
  for (let i = 2; existsSync(p); i++) p = join(dir, `${slug}-${i}.md`)
  await fsp.writeFile(p, `# ${title.trim() || 'Untitled'}\n\n`)
  return p
}

export const readNote = (p: string): Promise<string> => fsp.readFile(assertInside(p), 'utf8')
export const writeNote = (p: string, text: string): Promise<void> => fsp.writeFile(assertInside(p), text)
export const deleteNote = (p: string): Promise<void> => shell.trashItem(assertInside(p))
export const openNotesFolder = async (scope: string | null): Promise<string> => {
  const dir = notesDir(scope)
  await fsp.mkdir(dir, { recursive: true })
  return shell.openPath(dir)
}
