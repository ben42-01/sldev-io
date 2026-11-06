import { describe, expect, it } from 'vitest'
import { parseRecipe } from '../src/shared/factory'
import { BUILTIN_RECIPES } from '../src/shared/recipes'
import { checkDraft, draftFromRecipe, draftToYaml, emptyDraft, emptyStage, freeId, freeName, placeholdersFor, recipeSlug, renameRecipeText } from '../src/shared/recipeDraft'

/** Everything a run uses from a recipe, without the file path. */
const shape = (text: string): unknown => {
  const r = parseRecipe(text).recipe!
  return { ...r, path: undefined }
}

describe('recipe drafts', () => {
  it.each(BUILTIN_RECIPES.map((b) => [b.slug, b.text]))('round-trips the built-in %s', (_slug, text) => {
    const draft = draftFromRecipe(parseRecipe(text).recipe!)
    expect(shape(draftToYaml(draft))).toEqual(shape(text))
  })

  it('keeps needs implicit when a stage follows the one above', () => {
    const d = draftFromRecipe(parseRecipe(BUILTIN_RECIPES.find((b) => b.slug === 'feature')!.text).recipe!)
    expect(d.stages.every((s) => s.needs === null)).toBe(true)
    expect(draftToYaml(d)).not.toContain('needs:')
  })

  it('writes short lists in flow style like the built-ins', () => {
    const d = emptyDraft()
    d.name = 'Check'
    d.stages = [{ ...emptyStage('run', 'verify') }]
    expect(draftToYaml(d)).toContain('run: [ typecheck?, test? ]')
  })

  it('builds a new recipe the factory can read', () => {
    const d = emptyDraft()
    d.name = 'Plan and build'
    const plan = { ...emptyStage('agent', 'plan'), agents: ['claude'], prompt: 'Plan {intent}\nSave it to {out}.', approve: true }
    const build = { ...emptyStage('agent', 'build'), agents: ['codex'], prompt: 'Build {plan.out}' }
    const check = { ...emptyStage('run', 'check'), retry: ['build'], retryMax: 3 }
    const pr = emptyStage('pr', 'pr')
    d.stages = [plan, build, check, pr]
    const c = checkDraft(d)
    expect(c.error).toBeUndefined()
    expect(c.warnings).toEqual([])
    const r = c.recipe!
    expect(r.nodes.map((n) => [n.id, n.kind, n.needs])).toEqual([
      ['plan', 'agent', []],
      ['build', 'agent', ['plan']],
      ['check', 'run', ['build']],
      ['pr', 'pr', ['check']]
    ])
    expect(r.nodes[0].approve).toBe(true)
    expect(r.nodes[0].prompt).toBe('Plan {intent}\nSave it to {out}.')
    expect(r.nodes[2].onFail).toEqual({ retry: ['build'], max: 3 })
  })

  it('names the stage that is wrong', () => {
    const d = emptyDraft()
    d.name = 'Broken'
    d.stages = [{ ...emptyStage('agent', 'spec'), agents: ['claude'] }]
    expect(checkDraft(d)).toMatchObject({ stage: 'spec', error: expect.stringContaining('needs a prompt') })
    d.stages[0].prompt = 'Write it'
    d.name = ''
    expect(checkDraft(d).error).toContain('name')
    expect(checkDraft({ ...emptyDraft(), name: 'x' }).error).toBe('Add at least one stage')
  })

  it('warns about a missing pull request and unknown outputs', () => {
    const d = emptyDraft()
    d.name = 'W'
    d.stages = [{ ...emptyStage('agent', 'build'), agents: ['claude'], prompt: 'Use {spec.out}' }]
    expect(checkDraft(d).warnings).toEqual([expect.stringContaining('No pull request'), expect.stringContaining('{spec.out}')])
  })

  it('keeps explicit needs and setup', () => {
    const text = BUILTIN_RECIPES.find((b) => b.slug === 'parallel-feature')!.text
    const d = draftFromRecipe(parseRecipe(text).recipe!)
    expect(d.stages.find((s) => s.id === 'part-b')!.needs).toEqual(['spec'])
    d.setup = 'none'
    expect(parseRecipe(draftToYaml(d)).recipe!.setup).toBe(false)
    d.setup = 'make deps'
    expect(parseRecipe(draftToYaml(d)).recipe!.setup).toBe('make deps')
  })

  it('offers the outputs of earlier agent stages as placeholders', () => {
    const d = emptyDraft()
    d.stages = [emptyStage('agent', 'spec'), emptyStage('run', 'verify'), emptyStage('agent', 'build')]
    const texts = placeholdersFor(d, 2).map((p) => p.text)
    expect(texts).toContain('{spec.out}')
    expect(texts).not.toContain('{verify.out}')
    expect(placeholdersFor(d, 0).map((p) => p.text)).not.toContain('{spec.out}')
  })

  it('finds free ids, names and slugs', () => {
    expect(freeId([{ id: 'build' }, { id: 'build-2' }], 'build')).toBe('build-3')
    expect(freeName('Feature', ['feature', 'Feature 2'])).toBe('Feature 3')
    expect(recipeSlug('Bug fix: the "Big" one!')).toBe('bug-fix-the-big-one')
    expect(renameRecipeText('# mine\nname: A\nstages: []\n', 'B')).toBe('# mine\nname: B\nstages: []\n')
  })
})

describe('prompt-only stages', () => {
  it('run on the default agent', () => {
    const r = parseRecipe('name: x\nstages:\n  - id: a\n    prompt: Do {intent}\n  - id: b\n    run: test').recipe!
    expect(r.nodes[0]).toMatchObject({ kind: 'agent', agents: [], prompt: 'Do {intent}' })
    const d = emptyDraft()
    d.name = 'Default'
    d.stages = [{ ...emptyStage('agent', 'build'), prompt: 'Build {intent}' }, emptyStage('pr', 'pr')]
    expect(checkDraft(d).recipe!.nodes[0]).toMatchObject({ kind: 'agent', agents: [] })
  })

  it('still reject a stage that is two things at once', () => {
    expect(parseRecipe('name: x\nstages:\n  - id: a\n    agent: codex\n    prompt: p\n    pr: {}').error).toMatch(/exactly one/)
  })

  it('say in plain words what a stage is missing', () => {
    const d = emptyDraft()
    d.name = 'x'
    d.stages = [{ ...emptyStage('run', 'check'), run: [] }]
    expect(checkDraft(d)).toMatchObject({ stage: 'check', error: 'Stage "check" needs a command to run' })
  })
})
