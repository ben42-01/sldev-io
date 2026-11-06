import { parse, stringify } from 'yaml'
import { parseRecipe, resolveAgentSpec, type Recipe } from './factory'
import { parseProfileFile, serializeProfile } from './profiles'
import type { AgentProfile } from './types'

/**
 * A recipe to share: its YAML plus the agent profiles it names, as one text that pastes anywhere
 * (chat, an issue, a gist). Built-in profiles are left out, every install has them.
 */
export const BUNDLE_VERSION = 'sldev-recipe/1'

export function makeBundle(recipeText: string, recipe: Recipe, profiles: AgentProfile[], agentIds: string[]): string {
  const used = new Map<string, AgentProfile>()
  for (const spec of recipe.nodes.flatMap((n) => n.agents)) {
    const r = resolveAgentSpec(spec, profiles, agentIds)
    if (!('error' in r) && r.profile && r.profile.scope !== 'builtin') used.set(r.profile.name, r.profile)
  }
  const doc = { sldev: BUNDLE_VERSION, recipe: recipeText.trimEnd() + '\n', agents: [...used.values()].map(serializeProfile) }
  return `# sldev-io recipe "${recipe.name}": in sldev-io, Recipes → Import\n${stringify(doc, { lineWidth: 0, blockQuote: 'literal' })}`
}

export interface ImportedBundle {
  recipeText: string
  recipe: Recipe
  profiles: AgentProfile[]
}

/** A bundle, or a plain recipe YAML (no agents). */
export function readBundle(text: string): ImportedBundle | { error: string } {
  let doc: unknown
  try {
    doc = parse(text)
  } catch (e) {
    return { error: `Not valid YAML: ${(e as Error).message.split('\n')[0]}` }
  }
  const d = (doc ?? {}) as Record<string, unknown>
  const bundled = d.sldev === BUNDLE_VERSION
  if (typeof d.sldev === 'string' && !bundled) return { error: `This bundle (${d.sldev}) is from a newer sldev-io` }
  const recipeText = bundled ? String(d.recipe ?? '') : text
  const r = parseRecipe(recipeText)
  if (!r.recipe) return { error: r.error }
  const profiles: AgentProfile[] = []
  for (const [i, a] of (bundled && Array.isArray(d.agents) ? d.agents : []).entries()) {
    const p = typeof a === 'string' ? parseProfileFile(a, `bundle-${i}`) : null
    if (!p) return { error: `Agent ${i + 1} in the bundle isn't a valid profile` }
    profiles.push(p)
  }
  return { recipeText, recipe: r.recipe, profiles }
}
