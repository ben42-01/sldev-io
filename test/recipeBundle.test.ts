import { describe, expect, it } from 'vitest'
import { parseRecipe } from '@shared/factory'
import { STARTER_PROFILES } from '@shared/profiles'
import { makeBundle, readBundle } from '@shared/recipeBundle'
import type { AgentProfile } from '@shared/types'

const RECIPE = `name: Ship it
stages:
  - id: build
    agent: Security reviewer@claude
    prompt: |
      Build {intent}.
      Keep it small.
  - id: check
    agent: ${STARTER_PROFILES[0].name}
    prompt: Check it
  - id: raw
    agent: codex
    prompt: Polish
`
const mine: AgentProfile = { id: 'project:/p/.sldev/agents/sec.md', name: 'Security reviewer', description: 'Finds holes', agent: 'claude', model: 'opus', role: 'You review for security.\nNever edit files.', scope: 'project', path: '/p/.sldev/agents/sec.md' }

describe('sharing recipes', () => {
  const recipe = parseRecipe(RECIPE).recipe!
  const text = makeBundle(RECIPE, recipe, [...STARTER_PROFILES, mine], ['claude', 'codex'])

  it('bundles the recipe with the custom agents it names, not the built-in ones', () => {
    expect(text.startsWith('# sldev-io recipe "Ship it"')).toBe(true)
    const back = readBundle(text)
    if ('error' in back) throw new Error(back.error)
    expect(back.recipeText).toBe(RECIPE)
    expect(back.recipe.nodes.map((n) => n.id)).toEqual(['build', 'check', 'raw'])
    expect(back.profiles.map((p) => [p.name, p.agent, p.model, p.role])).toEqual([['Security reviewer', 'claude', 'opus', 'You review for security.\nNever edit files.']])
  })

  it('takes a plain recipe too, and explains what is wrong with anything else', () => {
    const plain = readBundle(RECIPE)
    expect('error' in plain ? plain.error : plain.profiles).toEqual([])
    expect(readBundle('name: [').error).toMatch(/Not valid YAML/)
    expect(readBundle('sldev: sldev-recipe/9\nrecipe: x').error).toMatch(/newer sldev-io/)
    expect(readBundle('name: x').error).toBeTruthy()
    expect(readBundle(`sldev: sldev-recipe/1\nrecipe: |\n${RECIPE.trimEnd().replace(/^/gm, '  ')}\nagents:\n  - not a profile\n`).error).toMatch(/Agent 1/)
  })
})
