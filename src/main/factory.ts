import { exec } from 'child_process'
import { promises as fsp } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import { setupCommand } from '@shared/factory'

/** Recipes: `.sldev/factory/*.yml` in the project. Run outputs: `<worktree>/.sldev/runs/<run>/`, git-ignored. */
const recipesDir = (root: string): string => join(root, '.sldev', 'factory')

export async function listRecipes(root: string): Promise<Array<{ path: string; text: string }>> {
  const dir = recipesDir(root)
  const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => /\.ya?ml$/.test(f)).sort()
  return Promise.all(files.map(async (f) => ({ path: join(dir, f), text: await fsp.readFile(join(dir, f), 'utf8') })))
}

/** Copies a recipe into the project so it can be edited and committed; returns its path. */
export async function saveRecipe(root: string, slug: string, text: string): Promise<string> {
  const dir = recipesDir(root)
  await fsp.mkdir(dir, { recursive: true })
  const safe = slug.replace(/[^a-z0-9-]/g, '') || 'recipe'
  let p = join(dir, `${safe}.yml`)
  for (let i = 2; await fsp.stat(p).then(() => true, () => false); i++) p = join(dir, `${safe}-${i}.yml`)
  await fsp.writeFile(p, text)
  return p
}

function runPath(p: string): string {
  const abs = resolve(p)
  if (!abs.includes(`${sep}.sldev${sep}runs${sep}`)) throw new Error('Not a factory run file')
  return abs
}

/** Creates a run's output folder and keeps .sldev/runs out of git. */
export async function prepareRunDir(dir: string): Promise<void> {
  const abs = runPath(join(dir, 'x'))
  await fsp.mkdir(dirname(abs), { recursive: true })
  await fsp.writeFile(join(dirname(dirname(abs)), '.gitignore'), '*\n')
}

export const readRunFile = (p: string): Promise<string | null> => fsp.readFile(runPath(p), 'utf8').catch(() => null)

export async function writeRunFile(p: string, text: string): Promise<void> {
  const abs = runPath(p)
  await fsp.mkdir(dirname(abs), { recursive: true })
  await fsp.writeFile(abs, text)
}

export async function copyRunFile(from: string, to: string): Promise<boolean> {
  const text = await readRunFile(from)
  if (text === null) return false
  await writeRunFile(to, text)
  return true
}

export interface SetupResult {
  ok: boolean
  log: string
}

const setupMarker = (dir: string): string => join(dir, '.sldev', 'runs', '.setup-done')

/**
 * What a fresh worktree needs before stages run in it, once: a marker in its git-ignored .sldev/runs
 * folder remembers it ran. `command` is the recipe's setup; undefined = detected from the lockfile,
 * false = none. Null when there's nothing to do.
 */
export async function setupPlan(dir: string, command: string | false | undefined): Promise<string | null> {
  if (command === false || (await fsp.stat(setupMarker(dir)).then(() => true, () => false))) return null
  return command ?? setupCommand(await fsp.readdir(dir).catch(() => []))
}

export async function runSetup(dir: string, command: string): Promise<SetupResult> {
  const r = await new Promise<SetupResult>((done) =>
    exec(command, { cwd: dir, timeout: 15 * 60_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, CI: '1' } }, (err, stdout, stderr) =>
      done({ ok: !err, log: `${stdout}${stderr}${err && !stderr ? err.message : ''}` })
    )
  )
  if (r.ok) await writeRunFile(setupMarker(dir), `${command}\n`)
  return r
}
