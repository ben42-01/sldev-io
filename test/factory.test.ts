import { describe, expect, it } from 'vitest'
import {
  applyOverrides,
  compareRecipe,
  recipeTextWithOverrides,
  approveNode,
  describeEvent,
  recordEvents,
  statusesAt,
  descendants,
  fill,
  layout,
  missingAgents,
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
  sendBack,
  sendBackTargets,
  setupCommand,
  type FactoryRun,
  type Recipe
} from '@shared/factory'
import { STARTER_PROFILES, TEAM_TEMPLATES, teamProviding } from '@shared/profiles'
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

  it('a failed check can be sent back with a note, and gets its retries back', () => {
    let run = approveNode(finishAll(newRun(recipe()), ['spec']), 'spec', 3)
    for (let i = 0; i < 2; i++) {
      run = finishAll(run, ['api', 'ui'])
      run = nodeFinished(nodeStarted(run, 'verify', 5), 'verify', { ok: false, log: "Cannot find module 'left-pad'" }, 6)
    }
    expect(run.status).toBe('failed')
    expect(sendBackTargets(run, 'verify')).toEqual(['api', 'ui'])
    run = sendBack(run, 'verify', 'Run npm ci first', 7)
    expect(run.status).toBe('running')
    expect(run.nodes.api.status).toBe('pending')
    expect(run.nodes.api.feedback).toContain('From the user: Run npm ci first')
    expect(run.nodes.api.feedback).toContain("Cannot find module 'left-pad'")
    expect(run.nodes.verify).toMatchObject({ status: 'pending', attempts: 0 })
    // the retry loop works again: one more failure goes back to the agents instead of failing the run
    run = finishAll(run, ['api', 'ui'])
    run = nodeFinished(nodeStarted(run, 'verify', 8), 'verify', { ok: false, log: 'x' }, 9)
    expect(run.status).toBe('running')
  })

  it('a failed agent stage keeps its reason and is sent back to itself', () => {
    let run = nodeFinished(nodeStarted(newRun(recipe()), 'spec', 1), 'spec', { ok: false, reason: 'Ended without writing spec.md', log: 'Permission denied' }, 2)
    expect(run.nodes.spec).toMatchObject({ status: 'failed', note: 'Ended without writing spec.md' })
    expect(sendBackTargets(run, 'spec')).toEqual(['spec'])
    run = sendBack(run, 'spec', '', 3)
    expect(run.nodes.spec.feedback).toContain('Permission denied')
    expect(run.nodes.spec.feedback).not.toContain('From the user')
  })

  it('sending back does nothing unless the stage failed', () => {
    const run = newRun(recipe())
    expect(sendBack(run, 'verify', 'x', 1)).toBe(run)
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

  describe('Software team', () => {
    const recipe = parseRecipe(BUILTIN_RECIPES.find((b) => b.slug === 'software-team')!.text).recipe!
    const team = TEAM_TEMPLATES.find((t) => t.id === 'software')!
    const ids = ['claude', 'codex']
    const node = (id: string) => recipe.nodes.find((n) => n.id === id)!

    it('runs the roles in order, reviewer and QA side by side, and ends on the pr stage', () => {
      expect(recipe.nodes.map((n) => [n.id, n.needs])).toEqual([
        ['spec', []],
        ['build', ['spec']],
        ['review', ['build']],
        ['qa', ['build']],
        ['fix', ['review', 'qa']],
        ['release', ['fix']],
        ['pr', ['release']]
      ])
      expect(node('spec').approve).toBe(true)
      expect(recipe.nodes.filter((n) => n.kind === 'pr').map((n) => n.id)).toEqual(['pr'])
      expect(recipe.nodes.at(-1)!.kind).toBe('pr')
      expect(node('pr').pr!.body).toBe('{release.out}')
    })

    it('names a team profile on every agent stage', () => {
      const agentStages = recipe.nodes.filter((n) => n.kind === 'agent')
      expect(agentStages.map((n) => n.agents)).toEqual([['Product owner'], ['Implementer'], ['Reviewer'], ['QA'], ['Implementer'], ['Release manager']])
      for (const n of agentStages) {
        const r = resolveAgentSpec(n.agents[0], team.profiles, ids)
        expect('profile' in r && r.profile?.id.startsWith('team:software:'), n.id).toBe(true)
      }
    })

    it('names the missing roles before a run, and the team that has them', () => {
      const missing = missingAgents(recipe, STARTER_PROFILES, ids)
      expect(missing).toEqual(['Product owner', 'QA', 'Release manager'])
      expect(teamProviding(missing)?.id).toBe('software')
      // installed team profiles come first, as the app merges them
      expect(missingAgents(recipe, [...team.profiles, ...STARTER_PROFILES], ids)).toEqual([])
    })
  })
})

describe('teamProviding', () => {
  it('finds the team with every role, ignoring case and @cli', () => {
    expect(teamProviding(['qa@codex', 'Release manager'])?.id).toBe('software')
    expect(teamProviding(['QA', 'Security reviewer'])).toBeUndefined()
    expect(teamProviding([])).toBeUndefined()
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

describe('run history and replay', () => {
  const r = recipe('name: H\nstages:\n  - id: a\n    agent: claude\n    prompt: x\n  - id: b\n    run: npm test\n')
  const base = (): FactoryRun => ({
    id: 'r', recipe: r, intent: 'i', root: '/r', outDir: '/o', status: 'running', createdAt: 0, updatedAt: 0,
    worktree: { path: '/w', branch: 'sldev/x', base: 'main', repo: '/r' },
    nodes: { a: newNodeRun(), b: newNodeRun() }
  })

  it('starts with the run, then logs node changes, retries and the PR', () => {
    let run = recordEvents(undefined, base(), 0)
    run = recordEvents(run, nodeStarted(run, 'a', 10), 10)
    run = recordEvents(run, nodeFinished(run, 'a', { ok: true }, 20), 20)
    run = recordEvents(run, nodeStarted(run, 'b', 30), 30)
    run = recordEvents(run, nodeStarted(run, 'b', 40), 40)
    run = recordEvents(run, { ...run, pr: { number: 3, url: 'u' } }, 50)
    expect(run.events!.map((e, i) => `${e.at} ${describeEvent(e, i === 0)}`)).toEqual([
      '0 Run started',
      '10 a started',
      '20 a done',
      '30 b started',
      '40 b started again (try 2)',
      '50 Pull request opened'
    ])
    expect(recordEvents(run, { ...run }, 60).events).toHaveLength(6)
  })

  it('replays every node status at a point in time', () => {
    let run = recordEvents(undefined, base(), 0)
    run = recordEvents(run, nodeStarted(run, 'a', 10), 10)
    run = recordEvents(run, nodeFinished(run, 'a', { ok: true }, 20), 20)
    expect(statusesAt(run, 5)).toEqual({ a: 'pending', b: 'pending' })
    expect(statusesAt(run, 15)).toEqual({ a: 'running', b: 'pending' })
    expect(statusesAt(run, 25)).toEqual({ a: 'done', b: 'pending' })
  })
})

describe('worktree setup', () => {
  it('picks the install for the lockfile', () => {
    expect(setupCommand(['package.json', 'package-lock.json'])).toBe('npm ci')
    expect(setupCommand(['package.json', 'pnpm-lock.yaml', 'package-lock.json'])).toBe('pnpm install --frozen-lockfile')
    expect(setupCommand(['package.json', 'yarn.lock'])).toBe('yarn install --frozen-lockfile')
    expect(setupCommand(['package.json', 'bun.lock'])).toBe('bun install --frozen-lockfile')
    expect(setupCommand(['package.json'])).toBe('npm install --no-package-lock')
    expect(setupCommand(['pyproject.toml', 'uv.lock'])).toBe('uv sync')
    expect(setupCommand(['Cargo.toml', 'src'])).toBeNull()
  })

  it('a recipe can set or turn off the setup', () => {
    const base = 'name: x\nstages:\n  - id: a\n    run: make\n'
    expect(recipe(base).setup).toBeUndefined()
    expect(recipe(`${base}setup: make deps\n`).setup).toBe('make deps')
    expect(recipe(`${base}setup: false\n`).setup).toBe(false)
    expect(recipe(`${base}setup: none\n`).setup).toBe(false)
  })
})

describe('stage options from the run form', () => {
  const text = `name: Opts
stages:
  - id: plan
    agent: claude
    model: opus
    prompt: Plan {intent}
  - id: build
    agent: codex
    prompt: Build it
`
  it('parses model, effort and mode from a recipe', () => {
    const r = parseRecipe(`name: X\nstages:\n  - id: a\n    agent: claude\n    model: sonnet\n    effort: high\n    mode: plan\n    prompt: hi\n`).recipe!
    expect(r.nodes[0]).toMatchObject({ model: 'sonnet', effort: 'high', mode: 'plan' })
  })
  it('applies model, interactive, and drops the recipe model when the agent changes', () => {
    const r = parseRecipe(text).recipe!
    const out = applyOverrides(r, { plan: { interactive: true }, build: { model: 'gpt-5' } }, 'claude')
    expect(out.nodes[0]).toMatchObject({ model: 'opus', interactive: true })
    expect(out.nodes[1]).toMatchObject({ model: 'gpt-5', interactive: false })
    expect(applyOverrides(r, { plan: { agent: 'codex' } }, 'claude').nodes[0].model).toBeUndefined()
    expect(applyOverrides(r, { plan: { model: '' } }, 'claude').nodes[0].model).toBeUndefined()
  })
  it('writes them into a saved copy', () => {
    const saved = recipeTextWithOverrides(text, { build: { model: 'gpt-5', interactive: true } }, '(custom)')
    const r = parseRecipe(saved).recipe!
    expect(r.nodes[1]).toMatchObject({ model: 'gpt-5', interactive: true })
  })
  it('tells an interactive stage the user is there', () => {
    const r = parseRecipe(text).recipe!
    const live = applyOverrides(r, { plan: { interactive: true } }, 'claude').nodes[0]
    expect(nodePrompt(live, newNodeRun(), { intent: 'x', outs: {} })).toContain('The user is watching')
    expect(nodePrompt(r.nodes[0], newNodeRun(), { intent: 'x', outs: {} })).not.toContain('The user is watching')
  })
})

describe('bake-off choices per agent', () => {
  it('compareRecipe carries the mission form model for its own agent', () => {
    const r = compareRecipe(['claude', 'codex'], { claude: { model: 'opus', effort: 'high' } })
    expect(r.nodes[0].perAgent).toEqual({ claude: { model: 'opus', effort: 'high' } })
  })
  it('the run form adds per-agent choices to a bake-off stage', () => {
    const r = compareRecipe(['claude', 'codex'], { claude: { model: 'opus' } })
    const out = applyOverrides(r, { compare: { perAgent: { codex: { model: 'gpt-5', effort: 'high' } } } }, 'claude')
    expect(out.nodes[0].agents).toEqual(['claude', 'codex'])
    expect(out.nodes[0].perAgent).toEqual({ claude: { model: 'opus' }, codex: { model: 'gpt-5', effort: 'high' } })
  })
})
