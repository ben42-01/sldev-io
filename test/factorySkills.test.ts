import { describe, expect, it } from 'vitest'
import { applyOverrides, findSkill, newNodeRun, nodePrompt, parseRecipe, readyNodes, recipeTextWithOverrides, seedableNodes, seedNode, type FactoryRun } from '@shared/factory'
import type { ClaudeAsset } from '@shared/types'

const TEXT = `name: Feature
# keep this comment
stages:
  - id: spec
    skill: my-spec
  - id: build
    agent: Implementer
    prompt: Build {spec.out}
  - id: pr
    pr: { title: "{intent}" }
`

const recipe = () => parseRecipe(TEXT).recipe!

const run = (): FactoryRun => {
  const r = recipe()
  return {
    id: 'f1',
    recipe: r,
    intent: 'dark mode',
    root: '/r',
    worktree: { path: '/w', branch: 'b', base: 'main', repo: '/r' },
    outDir: '/w/.sldev/runs/f1',
    status: 'running',
    nodes: Object.fromEntries(r.nodes.map((n) => [n.id, newNodeRun()])),
    createdAt: 0,
    updatedAt: 0
  }
}

describe('skill stages', () => {
  it('parses a skill stage without agent or prompt: the intent becomes its arguments', () => {
    const spec = recipe().nodes[0]
    expect(spec).toMatchObject({ kind: 'agent', skill: 'my-spec', agents: [], prompt: '{intent}' })
    expect(parseRecipe('name: x\nstages:\n  - id: a\n    skill: /review\n    agent: codex\n    prompt: the auth module').recipe!.nodes[0]).toMatchObject({ skill: 'review', agents: ['codex'], prompt: 'the auth module' })
    expect(parseRecipe('name: x\nstages:\n  - id: a\n    skill: s\n    run: [test]').error).toMatch(/exactly one/)
  })

  it('runs the skill with the filled prompt as arguments and still asks for the output file', () => {
    const node = recipe().nodes[0]
    const p = nodePrompt(node, newNodeRun(), { intent: 'dark mode', outs: {}, out: '/w/.sldev/runs/f1/spec.md' }, (args) => `/my-spec ${args}`)
    expect(p.startsWith('/my-spec dark mode')).toBe(true)
    expect(p).toContain('/w/.sldev/runs/f1/spec.md')
  })

  it('finds skills by name, slash name or plugin name; skills before commands, project first', () => {
    const a = (name: string, kind: ClaudeAsset['kind'], source: ClaudeAsset['source'], plugin?: string): ClaudeAsset => ({ kind, name, source, plugin, description: '', path: `/${source}/${name}`, invocation: `/${plugin ? `${plugin}:` : ''}${name}` })
    const assets = [a('spec', 'command', 'project'), a('spec', 'skill', 'user'), a('spec', 'skill', 'project'), a('audit', 'skill', 'plugin', 'sec'), a('spec', 'agent', 'project')]
    expect(findSkill(assets, '/spec')).toMatchObject({ kind: 'skill', source: 'project' })
    expect(findSkill(assets, 'sec:audit')?.name).toBe('audit')
    expect(findSkill(assets, 'audit')?.name).toBe('audit')
    expect(findSkill(assets, 'nope')).toBeUndefined()
  })
})

describe('per-run choices', () => {
  it('fills the default agent into skill stages and applies overrides', () => {
    const r = applyOverrides(recipe(), {}, 'claude')
    expect(r.nodes[0].agents).toEqual(['claude'])
    const o = applyOverrides(recipe(), { spec: { agent: 'codex', skill: '' }, build: { skill: 'tdd' } }, 'claude')
    expect(o.nodes[0]).toMatchObject({ agents: ['codex'], skill: undefined })
    expect(o.nodes[1]).toMatchObject({ agents: ['Implementer'], skill: 'tdd' })
    expect(o.nodes[2].kind).toBe('pr')
  })

  it('writes the choices into a copy of the recipe text, comments kept', () => {
    const t = recipeTextWithOverrides(TEXT, { spec: { skill: '', agent: 'Spec writer' }, build: { skill: 'tdd' } }, '(custom)')
    expect(t).toContain('# keep this comment')
    const r = parseRecipe(t).recipe!
    expect(r.name).toBe('Feature (custom)')
    expect(r.nodes[0]).toMatchObject({ agents: ['Spec writer'], skill: undefined })
    expect(r.nodes[1].skill).toBe('tdd')
  })
})

describe('starting from an existing output', () => {
  it('offers only first agent stages and counts a seeded one as done', () => {
    expect(seedableNodes(recipe()).map((n) => n.id)).toEqual(['spec'])
    const r = seedNode(run(), 'spec', 'From docs/spec.md', 1)
    expect(r.nodes.spec).toMatchObject({ status: 'done', note: 'From docs/spec.md' })
    expect(readyNodes(r)).toEqual(['build'])
  })
})
