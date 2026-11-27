import { promises as fsp } from 'fs'
import { basename, dirname, isAbsolute, join } from 'path'
import { NEW_PROJECT_RESULT } from '@shared/sldevSkills'
import { cloneTarget } from './git'

/**
 * New project → Start from scratch: the empty folder an agent sets the project up in. The same checks as a
 * clone's target (cloneTarget), so nothing of the user's is ever written into: a missing or empty folder only.
 */
export async function createProjectFolder(dest: string): Promise<string> {
  if (!isAbsolute(dest)) throw new Error('The new project’s folder must be a full path.')
  const t = await cloneTarget(dirname(dest), basename(dest))
  if (t.problem) throw new Error(t.problem)
  await fsp.mkdir(t.dest, { recursive: true })
  return t.dest
}

/** The result file a New project mission writes (.sldev/runs/new-project.json); null when there is none. */
export async function readNewProjectResult(root: string): Promise<string | null> {
  const st = await fsp.stat(join(root, ...NEW_PROJECT_RESULT.split('/'))).catch(() => null)
  // anything bigger isn't a result an agent wrote by the skill
  if (!st?.isFile() || st.size > 64_000) return null
  return fsp.readFile(join(root, ...NEW_PROJECT_RESULT.split('/')), 'utf8').catch(() => null)
}
