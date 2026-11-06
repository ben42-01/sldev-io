import { parseDocument, stringify } from 'yaml'
import { parseRecipe, type Recipe, type RecipeNode } from './factory'

/**
 * The recipe builder edits a draft, a flat form of a recipe, and writes it back as YAML. Parsing the
 * YAML again is the one validation: the builder never accepts something a recipe file couldn't say.
 */

export type StageKind = RecipeNode['kind']

export interface DraftStage {
  /** stable key for React lists; not saved */
  key: string
  id: string
  kind: StageKind
  /** agent: profile name, CLI id or "Profile@cli"; several = bake-off */
  agents: string[]
  skill: string
  prompt: string
  interactive: boolean
  model: string
  effort: string
  mode: string
  /** run: commands; "name?" = a project script, skipped when missing */
  run: string[]
  /** run: stages to send back to when the commands fail; empty = stop the run */
  retry: string[]
  retryMax: number
  approve: boolean
  /** null = after the stage above (what a recipe without `needs` does) */
  needs: string[] | null
  prTitle: string
  prBody: string
  maxDiff?: number
}

export interface RecipeDraft {
  name: string
  description: string
  intake: 'prompt' | 'issue'
  /** '' = detect from the lockfile, 'none' = nothing, else a command */
  setup: string
  stages: DraftStage[]
}

let keys = 0
const key = (): string => `s${++keys}`

export function emptyStage(kind: StageKind, id: string): DraftStage {
  return {
    key: key(),
    id,
    kind,
    agents: [],
    skill: '',
    prompt: '',
    interactive: false,
    model: '',
    effort: '',
    mode: '',
    run: kind === 'run' ? ['typecheck?', 'test?'] : [],
    retry: [],
    retryMax: 2,
    approve: false,
    needs: null,
    prTitle: kind === 'pr' ? '{intent}' : '',
    prBody: ''
  }
}

export function emptyDraft(): RecipeDraft {
  return { name: '', description: '', intake: 'prompt', setup: '', stages: [] }
}

/** A free stage id: "build", then "build-2", … */
export function freeId(stages: Array<{ id: string }>, base: string): string {
  const taken = new Set(stages.map((s) => s.id))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`
}

/** A parsed recipe as a draft. `needs` that only say "after the stage above" stay implicit. */
export function draftFromRecipe(r: Recipe): RecipeDraft {
  return {
    name: r.name,
    description: r.description,
    intake: r.intake,
    setup: r.setup === false ? 'none' : (r.setup ?? ''),
    stages: r.nodes.map((n, i) => {
      const above = i ? [r.nodes[i - 1].id] : []
      const implicit = n.needs.length === above.length && n.needs.every((x, j) => x === above[j])
      return {
        key: key(),
        id: n.id,
        kind: n.kind,
        agents: [...n.agents],
        skill: n.skill ?? '',
        prompt: n.skill && n.prompt === '{intent}' ? '' : n.prompt,
        interactive: n.interactive,
        model: n.model ?? '',
        effort: n.effort ?? '',
        mode: n.mode ?? '',
        run: [...n.run],
        retry: n.onFail?.retry ?? [],
        retryMax: n.onFail?.max ?? 2,
        approve: n.approve,
        needs: implicit ? null : [...n.needs],
        prTitle: n.pr?.title ?? '',
        prBody: n.pr?.body ?? '',
        maxDiff: n.maxDiff
      }
    })
  }
}

const one = (xs: string[]): string | string[] => (xs.length === 1 ? xs[0] : xs)

/** The draft as recipe YAML, in the order and style the built-in recipes use. */
export function draftToYaml(d: RecipeDraft): string {
  const stages = d.stages.map((s) => {
    const o: Record<string, unknown> = { id: s.id.trim() }
    if (s.needs !== null) o.needs = s.needs
    if (s.kind === 'agent') {
      const agents = s.agents.map((a) => a.trim()).filter(Boolean)
      if (agents.length) o.agent = one(agents)
      if (s.skill.trim()) o.skill = s.skill.trim()
      if (s.prompt.trim()) o.prompt = s.prompt.trim() + (s.prompt.includes('\n') ? '\n' : '')
      if (s.interactive) o.interactive = true
      if (s.model.trim()) o.model = s.model.trim()
      if (s.effort.trim()) o.effort = s.effort.trim()
      if (s.mode.trim()) o.mode = s.mode.trim()
    } else if (s.kind === 'run') {
      o.run = s.run.map((c) => c.trim()).filter(Boolean)
      const retry = s.retry.filter(Boolean)
      if (retry.length) o.onFail = { retry: one(retry), max: s.retryMax }
    } else {
      o.pr = { title: s.prTitle.trim() || '{intent}', ...(s.prBody.trim() ? { body: s.prBody.trim() } : {}) }
    }
    if (s.approve) o.gate = 'approve'
    if (s.maxDiff) o.maxDiff = s.maxDiff
    return o
  })
  const doc: Record<string, unknown> = { name: d.name.trim() }
  if (d.description.trim()) doc.description = d.description.trim()
  if (d.intake === 'issue') doc.intake = 'issue'
  if (d.setup.trim()) doc.setup = d.setup.trim() === 'none' ? false : d.setup.trim()
  doc.stages = stages
  // flow style for short lists (run: [typecheck?, test?]) like the built-ins; block strings for prompts
  const yaml = parseDocument(stringify(doc, { lineWidth: 0, blockQuote: 'literal' }))
  for (const item of (yaml.get('stages', true) as { items: Array<{ get(k: string, keep: true): unknown }> }).items) {
    for (const k of ['run', 'needs', 'agent']) {
      const node = item.get(k, true) as { flow?: boolean; items?: unknown[] } | undefined
      if (node?.items) node.flow = true
    }
    const onFail = item.get('onFail', true) as { flow?: boolean; get?(k: string, keep: true): unknown } | undefined
    if (onFail) {
      onFail.flow = true
      const r = onFail.get?.('retry', true) as { flow?: boolean } | undefined
      if (r && typeof r === 'object') r.flow = true
    }
  }
  return yaml.toString({ lineWidth: 0 })
}

export interface DraftCheck {
  /** the parsed recipe when the draft is valid */
  recipe?: Recipe
  /** first error from the parser, plus the stage it names */
  error?: string
  stage?: string
  /** things that work but are probably not meant */
  warnings: string[]
}

/** Validates the draft the way the factory will read it, and points at the stage that's wrong. */
export function checkDraft(d: RecipeDraft): DraftCheck {
  const warnings: string[] = []
  if (!d.stages.length) return { error: 'Add at least one stage', warnings }
  // the builder's own words for what's missing; the parser's would talk about YAML keys
  for (const s of d.stages) {
    const id = s.id.trim()
    if (!id) return { error: 'Every stage needs a name', stage: s.id, warnings }
    if (s.kind === 'agent' && !s.prompt.trim() && !s.skill.trim()) return { error: `Stage "${id}" needs a prompt: tell the agent what to do`, stage: id, warnings }
    if (s.kind === 'run' && !s.run.some((c) => c.trim())) return { error: `Stage "${id}" needs a command to run`, stage: id, warnings }
  }
  const r = parseRecipe(draftToYaml(d))
  if (!r.recipe) {
    const m = /Stage(?: id)? "([^"]+)"/.exec(r.error)
    return { error: r.error.replace(/^YAML: /, ''), stage: m?.[1], warnings }
  }
  const nodes = r.recipe.nodes
  if (!nodes.some((n) => n.kind === 'pr')) warnings.push('No pull request stage: the run ends with a branch you merge yourself.')
  const pr = nodes.findIndex((n) => n.kind === 'pr')
  if (pr >= 0 && pr < nodes.length - 1) warnings.push('The pull request stage is not the last one.')
  for (const n of nodes) {
    if (n.kind === 'agent' && n.prompt && /\{([A-Za-z0-9_-]+)\.out\}/.test(n.prompt)) {
      for (const [, ref] of n.prompt.matchAll(/\{([A-Za-z0-9_-]+)\.out\}/g))
        if (!nodes.some((x) => x.id === ref)) warnings.push(`Stage "${n.id}" reads {${ref}.out}, but there is no stage "${ref}".`)
    }
  }
  return { recipe: r.recipe, warnings }
}

/** Placeholders a stage can use: the run's, then the outputs of the stages it comes after. */
export function placeholdersFor(d: RecipeDraft, index: number): Array<{ text: string; hint: string }> {
  const out = [
    { text: '{intent}', hint: 'What you asked the factory to build' },
    { text: '{out}', hint: "This stage's output file (agents write their result there)" },
    { text: '{base}', hint: 'The branch the run started from' },
    { text: '{diff}', hint: "A file with the run's changes so far" },
    { text: '{log}', hint: 'The output of the check that failed (when a check sends work back)' },
    { text: '{issue}', hint: 'The GitHub issue, when the run came from one' }
  ]
  for (const s of d.stages.slice(0, index)) if (s.kind === 'agent') out.push({ text: `{${s.id}.out}`, hint: `What "${s.id}" wrote` })
  return out
}

/** A recipe name as a file name: "Bug fix" → "bug-fix". */
export const recipeSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'recipe'

/** A name not used by another recipe: "Feature", then "Feature 2", … */
export function freeName(name: string, taken: string[]): string {
  const t = new Set(taken.map((x) => x.toLowerCase()))
  if (!t.has(name.toLowerCase())) return name
  for (let i = 2; ; i++) if (!t.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`
}

/** The recipe text under another name, comments kept (for imports and duplicates). */
export function renameRecipeText(text: string, name: string): string {
  const doc = parseDocument(text)
  doc.set('name', name)
  return doc.toString({ lineWidth: 0 })
}
