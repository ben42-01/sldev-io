import { promises as fsp } from 'fs'
import { resolve } from 'path'
import { recallText } from '@shared/context'
import { APP_SKILLS, checkSkillFile, checkText, type SkillFileCheck, type SkillSet, type SkillState } from '@shared/sldevSkills'
import { createRules, rulesState, syncRules } from '../../src/main/rules'
import { memoryInfo, remember } from '../../src/main/memory'
import { initContext, recall } from '../../src/main/context'
import { run } from '../../src/main/git'
import { exportSkills, installSkills, skillsState } from '../../src/main/sldevSkills'
import { CLI_SKILLS } from './skills'

/**
 * The repo features, without the daemon: they read and write the same `.sldev/` files as the app,
 * so a project moves between the two with nothing lost.
 */

/** The project a folder belongs to: its git top level, else the folder itself. */
export async function projectRoot(cwd: string): Promise<string> {
  const r = await run('git', ['rev-parse', '--show-toplevel'], cwd)
  // git prints C:/forward/slashes on Windows: resolve() gives the platform's own form
  return r.code === 0 && r.stdout.trim() ? resolve(r.stdout.trim()) : cwd
}

const STATUS: Record<string, string> = {
  off: 'off',
  'in-sync': 'in sync',
  create: 'will be created',
  update: 'will be updated',
  'hand-edited': 'edited by hand (sync --overwrite to replace)'
}

export async function rulesStatus(root: string): Promise<string> {
  const s = await rulesState(root)
  if (s.source === null) return `No ${s.sourcePath} yet. Run \`sldev rules init\` to start it from the agent files already here.`
  const width = Math.max(...s.targets.map((t) => t.path.length))
  return [
    `Rules: ${s.sourcePath}`,
    ...s.targets.map((t) => `  ${t.path.padEnd(width)}  ${STATUS[t.status ?? 'off'] ?? t.status}${t.added || t.removed ? ` (+${t.added} -${t.removed})` : ''}  · ${t.readers}`)
  ].join('\n')
}

export async function rulesInit(root: string): Promise<string> {
  const p = await createRules(root)
  return `Rules source: ${p}\nEdit it, then run \`sldev rules sync\`.`
}

export async function rulesSync(root: string, overwrite: string[]): Promise<string> {
  const before = await rulesState(root)
  if (before.source === null) throw new Error('No .sldev/rules.md yet. Run `sldev rules init` first.')
  const after = await syncRules(root, overwrite)
  const lines = after.targets.map((t, i) => {
    const was = before.targets[i].status
    const wrote = (was === 'create' || was === 'update' || (was === 'hand-edited' && overwrite.includes(t.id))) && t.status === 'in-sync'
    return `  ${wrote ? 'wrote  ' : 'skipped'} ${t.path}  ${wrote ? '' : STATUS[t.status ?? 'off']}`
  })
  return ['Synced .sldev/rules.md:', ...lines].join('\n')
}

export async function rememberNote(root: string, note: string, files: string[]): Promise<string> {
  await remember(root, note, 'sldev CLI', files)
  return `Saved to ${(await memoryInfo(root)).path}`
}

export async function memorySummary(root: string): Promise<string> {
  const m = await memoryInfo(root)
  return m.exists ? `${m.path}: ${m.entries} ${m.entries === 1 ? 'entry' : 'entries'}` : `No project memory yet (${m.path}). Add to it with \`sldev remember "…"\`.`
}

export async function recallNotes(dataDir: string, root: string, query: string, path?: string): Promise<string> {
  if (!query.trim() && !path?.trim()) throw new Error('Give a topic, --path <file>, or both')
  initContext(dataDir)
  const { hits, related } = await recall(root, { query, path })
  return recallText(hits, root, related)
}

const SKILL_STATE: Record<string, string> = {
  missing: 'not installed',
  current: 'installed',
  outdated: 'older version (sldev skills install updates it)',
  edited: 'edited by hand (install --overwrite <name> to replace)',
  foreign: 'another skill with this name (install --overwrite <name> to replace)'
}

/**
 * sldev's own skills: the app's (agents draft missions, board stories, recipes and evals as files the app picks up)
 * and the CLI's (cli/src/skills.ts: an agent that runs other agents through sldev).
 */
const SETS: SkillSet[] = [APP_SKILLS, CLI_SKILLS]

const allStates = async (root: string): Promise<SkillState[]> => (await Promise.all(SETS.map((set) => skillsState(root, set)))).flat()

export async function skillsStatus(root: string): Promise<string> {
  const s = await allStates(root)
  const width = Math.max(...s.map((x) => x.name.length))
  return [`sldev skills in ${root}:`, ...s.map((x) => `  /${x.name.padEnd(width)}  ${x.label.padEnd(24)} ${SKILL_STATE[x.state]}`)].join('\n')
}

export async function skillsInstall(root: string, overwrite: string[]): Promise<string> {
  const wrote: string[] = []
  for (const set of SETS) wrote.push(...(await installSkills(root, overwrite, set)))
  const after = await allStates(root)
  const kept = after.filter((x) => x.state === 'edited' || x.state === 'foreign').map((x) => x.name)
  return [
    wrote.length ? `Wrote ${wrote.length} files:` : 'Already up to date.',
    ...wrote.map((p) => `  ${p}`),
    ...(kept.length ? [`Kept (edited by hand): ${kept.join(', ')}. Use --overwrite ${kept.join(',')} to replace them.`] : []),
    'Agents now draft missions and stories into .sldev/drafts; sldev-io takes them in when it is open.',
    '/sldev-conductor splits a task between other agents; it runs in a pane started with sldev new --allow-spawn <n>.'
  ].join('\n')
}

export async function skillsExport(dir: string): Promise<string> {
  const wrote: string[] = []
  for (const set of SETS) wrote.push(...(await exportSkills(resolve(dir), set)))
  return [`Wrote ${wrote.length} skills:`, ...wrote.map((p) => `  ${p}`)].join('\n')
}

/** `sldev skills check <file…>`: each file read the way the app will; false when one wouldn't be taken. */
export async function skillsCheck(files: string[]): Promise<{ ok: boolean; text: string }> {
  const out: string[] = []
  let ok = true
  for (const f of files) {
    const src = await fsp.readFile(resolve(f), 'utf8').catch(() => null)
    const c: SkillFileCheck = src === null ? { ok: false, kind: null, error: `Could not read ${f}` } : checkSkillFile(resolve(f), src)
    ok &&= c.ok
    out.push(checkText(f, c))
  }
  return { ok, text: out.join('\n\n') }
}
