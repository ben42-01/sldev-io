import { existsSync, promises as fsp } from 'fs'
import { dirname, join } from 'path'
import { EMPTY_CONFIG, hashText, importRules, planTarget, RULE_TARGETS, RULES_CONFIG, RULES_SOURCE, type RulesConfig } from '@shared/rules'
import type { RulesState } from '@shared/types'

const read = (p: string): Promise<string | null> => fsp.readFile(p, 'utf8').catch(() => null)

async function readConfig(root: string): Promise<RulesConfig> {
  try {
    const c = JSON.parse((await read(join(root, RULES_CONFIG))) ?? '{}') as Partial<RulesConfig>
    return { targets: c.targets ?? {}, written: c.written ?? {} }
  } catch {
    return { ...EMPTY_CONFIG }
  }
}

const writeConfig = async (root: string, c: RulesConfig): Promise<void> => {
  await fsp.mkdir(join(root, '.sldev'), { recursive: true })
  await fsp.writeFile(join(root, RULES_CONFIG), JSON.stringify(c, null, 2) + '\n')
}

export async function rulesState(root: string): Promise<RulesState> {
  const [source, config, files] = await Promise.all([
    read(join(root, RULES_SOURCE)),
    readConfig(root),
    Promise.all(RULE_TARGETS.map((t) => read(join(root, t.path))))
  ])
  return {
    sourcePath: join(root, RULES_SOURCE),
    source,
    config,
    targets: RULE_TARGETS.map((t, i) => {
      const plan = source === null ? null : planTarget(t, source, files[i], config)
      return { id: t.id, path: t.path, readers: t.readers, exists: files[i] !== null, status: plan?.status ?? null, added: plan?.added ?? 0, removed: plan?.removed ?? 0 }
    })
  }
}

/** Starts .sldev/rules.md from the agent files already in the project. Never replaces an existing one. */
export async function createRules(root: string): Promise<string> {
  const p = join(root, RULES_SOURCE)
  if (existsSync(p)) return p
  const files = await Promise.all(RULE_TARGETS.map(async (t) => ({ path: t.path, text: await read(join(root, t.path)) })))
  await fsp.mkdir(dirname(p), { recursive: true })
  await fsp.writeFile(p, importRules(files))
  return p
}

export async function setRuleTarget(root: string, id: string, on: boolean): Promise<void> {
  const c = await readConfig(root)
  await writeConfig(root, { ...c, targets: { ...c.targets, [id]: on } })
}

/** Writes every target that is new or was last written by us, plus the hand-edited ones listed in `overwrite`. */
export async function syncRules(root: string, overwrite: string[] = []): Promise<RulesState> {
  const source = await read(join(root, RULES_SOURCE))
  if (source === null) throw new Error('No .sldev/rules.md yet')
  const config = await readConfig(root)
  const written = { ...config.written }
  for (const t of RULE_TARGETS) {
    const plan = planTarget(t, source, await read(join(root, t.path)), config)
    const go = plan.status === 'create' || plan.status === 'update' || (plan.status === 'hand-edited' && overwrite.includes(t.id))
    if (go) {
      await fsp.mkdir(dirname(join(root, t.path)), { recursive: true })
      await fsp.writeFile(join(root, t.path), plan.next)
    }
    if (go || plan.status === 'in-sync') written[t.path] = hashText(plan.next)
  }
  await writeConfig(root, { ...config, written })
  return rulesState(root)
}
