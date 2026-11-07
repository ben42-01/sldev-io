import { promises as fsp } from 'fs'
import { join } from 'path'

/** The work board shared through git: `<root>/.sldev/board.json`. Merging is in src/shared/board.ts. */

const file = (root: string): string => join(root, '.sldev', 'board.json')

export const readBoardFile = (root: string): Promise<string | null> => fsp.readFile(file(root), 'utf8').catch(() => null)

export async function writeBoardFile(root: string, text: string): Promise<void> {
  await fsp.mkdir(join(root, '.sldev'), { recursive: true })
  // write then rename, so a teammate's git pull never sees half a file
  const tmp = `${file(root)}.${process.pid}.tmp`
  await fsp.writeFile(tmp, text)
  await fsp.rename(tmp, file(root))
}
