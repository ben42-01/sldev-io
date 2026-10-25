import { describe, expect, it } from 'vitest'
import {
  approveNode,
  descendants,
  fill,
  layout,
  needsOwnWorktree,
  newNodeRun,
  nodeFinished,
  nodePrompt,
  nodeStarted,
  parseRecipe,
  pickWinner,
  readyNodes,
  rejectNode,
  resolveAgentSpec,
  resolveRun,
  runtimeNames,
  type FactoryRun,
  type Recipe
} from '@shared/factory'
import { STARTER_PROFILES } from '@shared/profiles'
import { BUILTIN_RECIPES } from '@shared/recipes'

const FEATURE = `
name: Feature
stages:
  - id: spec
    agent: Spec writer
    prompt: Write a spec for {intent}. Save it to {out}.
    gate: approve
  - id: api
    needs: [spec]
    agent: Implementer@claude
    prompt: Build the API from {spec.out}
  - id: ui
    needs: spec
    agent: codex
    prompt: Build the UI from {spec.out}
  - id: verify
    needs: [api, ui]
    run: [npm run lint, npm test]
    onFail: { retry: [api, ui], max: 1 }
  - id: pr
    pr: { title: "{intent}" }
`

const recipe = (text = FEATURE): Recipe => {
  const r = parseRecipe(text)
  if (!r.recipe) throw new Error(r.error)
  return r.recipe
}

const newRun = (r: Recipe): FactoryRun => ({
  id: 'f1',
  recipe: r,
  intent: 'Add dark mode',
  root: '/p',
  worktree: { path: '/wt', branch: 'sldev/factory', base: 'main', repo: '/p' },
  outDir: '/wt/.sldev/runs/f1',
  status: 'running',
  nodes: Object.fromEntries(r.nodes.map((n) => [n.id, newNodeRun()])),
  createdAt: 0,
  updatedAt: 0
})

const finishAll = (run: FactoryRun, ids: string[]): FactoryRun => ids.reduce((r, id) => nodeFinished(nodeStarted(r, id, 1), id, { ok: true }, 2), run)

describe('parseRecipe', () => {
  it('reads stages, kinds and needs', () => {
    const r = recipe()
    expect(r.nodes.map((n) => `${n.id}:${n.kind}:${n.needs.join('+')}`)).toEqual(['spec:agent:', 'api:agent:spec', 'ui:agent:spec', 'verify:run:api+ui', 'pr:pr:verify'])
    expect(r.nodes[0].approve).toBe(true)
    expect(r.nodes[3].onFail).toEqual({ retry: ['api', 'ui'], max: 1 })
    expect(r.nodes[4].pr).toEqual({ title: '{intent}', body: '' })
  })

  it('without needs, a stage follows the one above it', () => {
    const r = recipe('name: x\nstages:\n  - id: a\n    run: echo a\n  - id: b\n    run: echo b')
    expect(r.nodes[1].needs).toEqual(['a'])
  })

  it.each([
    ['name: x\nstages: []', 'at least one stage'],
    ['stages:\n  - run: x', 'needs a name'],
    ['name: x\nstages:\n  - id: a\n    run: x\n    agent: codex\n    prompt: p', 'exactly one of'],
    ['name: x\nstages:\n  - id: a\n    agent: codex', 'needs a prompt'],
    ['name: x\nstages:\n  - id: a\n    run: x\n    needs: [b]\n  - id: b\n    run: y', 'isn\'t defined above'],
    ['name: x\nstages:\n  - id: a\n    run: x\n  - id: a\n    run: y', 'Two stages'],
    ['name: x\nstages:\n  - id: a\n    run: x\n    onFail: { retry: z }', 'retries "z"'],
    ['name: [', 'YAML']
  ])('rejects %j', (text, error) => {
    expect(parseRecipe(text).error).toContain(error)
  })
})

describe('resolveAgentSpec', () => {
  const ids = ['claude', 'codex', 'gemini']
  it('handles a CLI, a profile and profile@cli', () => {
    expect(resolveAgentSpec('codex', STARTER_PROFILES, ids)).toEqual({ agent: 'codex' })
    expect(resolveAgentSpec('reviewer', STARTER_PROFILES, ids)).toMatchObject({ profile: { name: 'Reviewer' } })
    expect(resolveAgentSpec('Implementer@gemini', STARTER_PROFILES, ids)).toMatchObject({ agent: 'gemini', profile: { name: 'Implementer' } })
  })
  it('explains unknown names', () => {
    expect(resolveAgentSpec('Nobody', STARTER_PROFILES, ids)).toEqual({ error: 'No agent or profile called "Nobody"' })
    expect(resolveAgentSpec('Reviewer@aider', STARTER_PROFILES, ids)).toEqual({ error: 'Unknown agent "aider" in "Reviewer@aider"' })
  })
})

describe('fill', () => {
  it('replaces known placeholders and keeps unknown ones', () => {
    expect(fill('{intent} → {out}; spec at {spec.out}; {other} {nope.out}', { intent: 'Dark mode', out: '/o.md', outs: { spec: '/s.md' } })).toBe(
      'Dark mode → /o.md; spec at /s.md; {other} {nope.out}'
    )
  })
})

describe('graph', () => {
  it('lays nodes out in columns by their longest chain of needs', () => {
    const l = layout(recipe())
    expect([...l.entries()].map(([id, p]) => `${id}@${p.col},${p.row}`)).toEqual(['spec@0,0', 'api@1,0', 'ui@1,1', 'verify@2,0', 'pr@3,0'])
  })
  it('finds everything downstream', () => {
    expect([...descendants(recipe(), 'api')]).toEqual(['verify', 'pr'])
  })
})

describe('a run', () => {
  it('starts with the root, waits at the gate, then fans out', () => {
    let run = newRun(recipe())
    expect(readyNodes(run)).toEqual(['spec'])
    run = nodeFinished(nodeStarted(run, 'spec', 1), 'spec', { ok: true }, 2)
    expect(run.nodes.spec.status).toBe('approval')
    expect(readyNodes(run)).toEqual([])
    run = approveNode(run, 'spec', 3)
    expect(readyNodes(run)).toEqual(['api', 'ui'])
    expect(needsOwnWorktree(run, 'api', ['api', 'ui'])).toBe(true)
  })

  it('runs a lone node in the run worktree unless another node is working there', () => {
    let run = finishAll(newRun(recipe()), ['spec'])
    run = approveNode(run, 'spec', 3)
    expect(needsOwnWorktree(run, 'api', ['api'])).toBe(false)
    run = nodeStarted(run, 'api', 4)
    expect(needsOwnWorktree(run, 'ui', ['ui'])).toBe(true)
  })

  it('fans in only when every branch is done', () => {
    let run = approveNode(finishAll(newRun(recipe()), ['spec']), 'spec', 3)
    run = finishAll(run, ['api'])
    expect(readyNodes(run)).toEqual(['ui'])
    run = finishAll(run, ['ui'])
    expect(readyNodes(run)).toEqual(['verify'])
  })

  it('a failing check sends its log back to the retried agents, then gives up', () => {
    let run = approveNode(finishAll(newRun(recipe()), ['spec']), 'spec', 3)
    run = finishAll(run, ['api', 'ui'])
    run = nodeFinished(nodeStarted(run, 'verify', 5), 'verify', { ok: false, log: 'TypeError at x.ts:3' }, 6)
    expect(run.status).toBe('running')
    expect(run.nodes.api.status).toBe('pending')
    expect(run.nodes.api.feedback).toContain('TypeError at x.ts:3')
    expect(run.nodes.verify.status).toBe('pending')
    expect(run.nodes.spec.status).toBe('done')
    run = finishAll(run, ['api', 'ui'])
    run = nodeFinished(nodeStarted(run, 'verify', 7), 'verify', { ok: false, log: 'still broken' }, 8)
    expect(run.status).toBe('failed')
    expect(run.nodes.verify.note).toContain('after 1 retries')
  })

  it('a rejection reruns the node with the note', () => {
    let run = finishAll(newRun(recipe()), ['spec'])
    run = rejectNode(run, 'spec', 'Cover mobile too', 3)
    expect(run.nodes.spec.status).toBe('pending')
    expect(nodePrompt(run.recipe.nodes[0], run.nodes.spec, { intent: 'Dark mode', out: '/o.md', outs: {} })).toBe(
      'Write a spec for Dark mode. Save it to /o.md.\n\n---\n\nYour previous attempt was rejected: Cover mobile too'
    )
  })

  it('asks for approval when the diff grows past maxDiff', () => {
    const r = recipe('name: x\nstages:\n  - id: a\n    agent: codex\n    prompt: go\n    maxDiff: 100')
    const run = nodeFinished(nodeStarted(newRun(r), 'a', 1), 'a', { ok: true, diffLines: 250 }, 2)
    expect(run.nodes.a.status).toBe('approval')
    expect(run.nodes.a.note).toContain('250 lines')
  })

  it('is done when every node is', () => {
    const r = recipe('name: x\nstages:\n  - id: a\n    run: echo a\n  - id: b\n    run: echo b')
    expect(finishAll(newRun(r), ['a', 'b']).status).toBe('done')
  })

  it('asks agents for a summary when the prompt has no {out}', () => {
    const r = recipe('name: x\nstages:\n  - id: a\n    agent: codex\n    prompt: Fix {intent}')
    expect(nodePrompt(r.nodes[0], newNodeRun(), { intent: 'the bug', out: '/o.md', outs: {} })).toBe('Fix the bug\n\nWrite a short summary of what you did to /o.md.')
  })
})

describe('resolveRun', () => {
  const rts = [
    { name: 'test', command: 'npm run test', rel: '' },
    { name: 'test', command: 'cargo test', rel: 'core' },
    { name: 'lint', command: 'npm run lint', rel: 'web' }
  ]
  it('maps runtime names, prefers the root, and keeps literal commands', () => {
    expect(resolveRun(['test', 'lint', 'echo done'], rts)).toEqual({ command: 'npm run test && (cd "web" && npm run lint) && echo done', skipped: [] })
  })
  it('skips optional runtimes the project lacks', () => {
    expect(resolveRun(['typecheck?', 'test?'], rts)).toEqual({ command: 'npm run test', skipped: ['typecheck'] })
  })
})

describe('built-in recipes', () => {
  it('all parse', () => {
    for (const r of BUILTIN_RECIPES) expect(parseRecipe(r.text).error, r.slug).toBeUndefined()
  })
})

describe('bake-off', () => {
  const BAKE = 'name: b\nstages:\n  - id: build\n    agent: [claude, codex]\n    prompt: Build {intent}\n  - id: check\n    run: npm test'
  const wt = (b: string) => ({ path: `/wt/${b}`, branch: b, base: 'main', repo: '/p' })
  const started = (): FactoryRun => {
    const run = nodeStarted(newRun(recipe(BAKE)), 'build', 1)
    return {
      ...run,
      nodes: {
        ...run.nodes,
        build: {
          ...run.nodes.build,
          candidates: [
            { spec: 'claude', missionId: 'm1', worktree: wt('a'), status: 'done' },
            { spec: 'codex', missionId: 'm2', worktree: wt('b'), status: 'done' }
          ]
        }
      }
    }
  }

  it('waits for you to keep one version', () => {
    const run = nodeFinished(started(), 'build', { ok: true }, 2)
    expect(run.nodes.build.status).toBe('approval')
    expect(run.nodes.build.note).toBe('2 versions to compare. Keep one.')
    expect(approveNode(run, 'build', 3).nodes.build.status).toBe('approval')
  })

  it('keeps the winner\'s worktree so it merges like a parallel branch', () => {
    const run = pickWinner(nodeFinished(started(), 'build', { ok: true }, 2), 'build', 'm2', 3)
    expect(run.nodes.build).toMatchObject({ status: 'done', winner: 'm2', worktree: wt('b'), note: 'Kept codex' })
    expect(readyNodes(run)).toEqual(['check'])
  })

  it('a rejection runs every agent again', () => {
    const run = rejectNode(nodeFinished(started(), 'build', { ok: true }, 2), 'build', 'all too big', 3)
    expect(run.nodes.build.candidates).toBeUndefined()
    expect(run.nodes.build.status).toBe('pending')
  })
})

describe('runtimeNames', () => {
  it('lists the scripts a recipe checks with', () => {
    expect(runtimeNames(recipe())).toEqual([])
    expect(runtimeNames(recipe('name: x\nstages:\n  - id: a\n    run: [typecheck?, test, npm run build]'))).toEqual(['typecheck', 'test'])
  })
})
