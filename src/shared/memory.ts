/**
 * Project memory: `.sldev/memory.md` in the project, a dated list of things agents and people learned
 * about the project (a gotcha, a command, a convention). Every mission is pointed at it, so the next
 * agent doesn't start from zero; agents with the sldev tools add to it with sldev_remember.
 */

export const MEMORY_FILE = '.sldev/memory.md'

export const MEMORY_HEADER = [
  '# Project memory',
  '',
  'Things agents and people learned about this project. sldev-io points every mission here.',
  'Edit freely: remove what is no longer true. Commit it to share it with your team.',
  ''
].join('\n')

/**
 * One line per entry: notes are flattened and capped, so the file stays a quick read. The files a note
 * is about go at the end (` · files: a, b`); the project context links the note to them and flags it
 * when they change.
 */
export function memoryEntry(note: string, source: string, at: Date, paths: string[] = []): string {
  const text = note.replace(/\s+/g, ' ').replace(/ · files: /g, ' - files: ').trim().slice(0, 500)
  const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
  const files = [...new Set(paths.map((p) => p.trim().replace(/\\/g, '/').replace(/,/g, '')).filter(Boolean))].slice(0, 12)
  return `- ${day}: ${text}${source.trim() ? ` (${source.trim()})` : ''}${files.length ? ` · files: ${files.join(', ')}` : ''}`
}

/** What a mission's prompt gets: where the memory is (once it exists), and how to add to it (agents with the sldev tools). */
export function memoryPointer(path: string, exists: boolean, canRemember: boolean): string {
  return [
    exists ? `Project memory: earlier agents and the team recorded what they learned about this project in ${path}. Read it before you start; it may save you time.` : '',
    canRemember ? 'If you learn something a future agent here should know (a gotcha, a command, a convention), record it in one line with the sldev_remember tool.' : ''
  ]
    .filter(Boolean)
    .join(' ')
}

/** The mission prompt with the memory pointer, if there is anything to point at. */
export function withMemory(prompt: string, pointer: string): string {
  return pointer ? `${prompt.trimEnd()}\n\n${pointer}` : prompt
}
