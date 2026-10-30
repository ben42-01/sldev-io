import { promises as fsp } from 'fs'
import { dirname, join } from 'path'
import { MEMORY_FILE, MEMORY_HEADER, memoryEntry } from '@shared/memory'

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

export async function remember(root: string, note: string, source: string): Promise<void> {
  if (!note.trim()) throw new Error('The note is empty')
  const path = await ensureMemory(root)
  const text = await fsp.readFile(path, 'utf8')
  await fsp.appendFile(path, `${text.endsWith('\n') ? '' : '\n'}${memoryEntry(note, source, new Date())}\n`)
}
