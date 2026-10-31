import { promises as fsp } from 'fs'
import { dirname, join } from 'path'
import { MEMORY_FILE, MEMORY_HEADER, memoryEntry } from '@shared/memory'
import { normalizePath } from '@shared/context'

export const memoryPath = (root: string): string => join(root, ...MEMORY_FILE.split('/'))

export async function memoryInfo(root: string): Promise<{ path: string; exists: boolean; entries: number }> {
  const path = memoryPath(root)
  const text = await fsp.readFile(path, 'utf8').catch(() => null)
  return { path, exists: text !== null, entries: text ? text.split('\n').filter((l) => l.startsWith('- ')).length : 0 }
}

/** Creates the file with its header when it doesn't exist; returns its path (to open in the editor). */
export async function ensureMemory(root: string): Promise<string> {
  const path = memoryPath(root)
  await fsp.mkdir(dirname(path), { recursive: true })
  await fsp.writeFile(path, `${MEMORY_HEADER}\n`, { flag: 'wx' }).catch(() => undefined)
  return path
}

export async function remember(root: string, note: string, source: string, paths: string[] = []): Promise<void> {
  if (!note.trim()) throw new Error('The note is empty')
  const path = await ensureMemory(root)
  const text = await fsp.readFile(path, 'utf8')
  const files = paths.map((p) => normalizePath(p, root)).filter((p): p is string => !!p)
  await fsp.appendFile(path, `${text.endsWith('\n') ? '' : '\n'}${memoryEntry(note, source, new Date(), files)}\n`)
}

/** Removes one entry, only if line `line` still says `expect` (the file may have changed since it was shown). */
export async function forget(root: string, line: number, expect: string): Promise<void> {
  const path = memoryPath(root)
  const lines = (await fsp.readFile(path, 'utf8')).split('\n')
  if (lines[line - 1] === undefined || !lines[line - 1].includes(expect)) throw new Error('The memory file changed; reopen the list and try again')
  lines.splice(line - 1, 1)
  await fsp.writeFile(path, lines.join('\n'))
}
