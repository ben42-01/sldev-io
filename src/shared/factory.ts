import { parse } from 'yaml'
import type { AgentProfile, WorktreeInfo } from './types'

/**
 * Software Factory: a recipe is a graph of nodes. An agent node is a mission, a run node runs
 * commands, a pr node opens the pull request. A node starts when everything in `needs` is done;
 * without `needs` it follows the node above it. This file is the pure part: parsing, validation,
 * placeholders, layout and the run state machine. Side effects live in the renderer's factory store.
 */

export interface RecipeNode {
  id: string
  kind: 'agent' | 'run' | 'pr'
  needs: string[]
  /** agent nodes: profile name, CLI id or "Profile@cli"; several = bake-off */
  agents: string[]
  prompt: string
  /** normal session instead of print mode; finishes with a Done click */
  interactive: boolean
  /** run nodes: shell commands, run in order */
  run: string[]
  onFail?: { retry: string[]; max: number }
  /** wait for a human after the node finishes */
  approve: boolean
  /** ask for approval when the run's diff grows past this many changed lines */
  maxDiff?: number
  pr?: { title: string; body: string }
}

export interface Recipe {
  name: string
  description: string
  intake: 'prompt' | 'issue'
  nodes: RecipeNode[]
  /** file it came from; unset for built-ins */
  path?: string
}

export type ParseResult = { recipe: Recipe; error?: undefined } | { recipe?: undefined; error: string }

const list = (v: unknown): string[] => (v === undefined || v === null ? [] : (Array.isArray(v) ? v : [v]).map((x) => String(x).trim()).filter(Boolean))

export function parseRecipe(text: string, path?: string): ParseResult {
  let doc: Record<string, unknown>
  try {
    doc = parse(text) as Record<string, unknown>
  } catch (e) {
    return { error: `YAML: ${(e as Error).message.split('\n')[0]}` }
  }
  if (!doc || typeof doc !== 'object') return { error: 'A recipe is a YAML mapping with name and stages' }
  const name = typeof doc.name === 'string' ? doc.name.trim() : ''
  if (!name) return { error: 'The recipe needs a name' }
  const stages = doc.stages
  if (!Array.isArray(stages) || !stages.length) return { error: 'The recipe needs at least one stage' }

  const nodes: RecipeNode[] = []
  for (const [i, raw] of stages.entries()) {
    const s = (raw ?? {}) as Record<string, unknown>
    const id = typeof s.id === 'string' && s.id.trim() ? s.id.trim() : `stage-${i + 1}`
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return { error: `Stage id "${id}": use letters, digits, - and _` }
    if (nodes.some((n) => n.id === id)) return { error: `Two stages are called "${id}"` }
    const agents = list(s.agent)
    const run = list(s.run)
    const kinds = [agents.length > 0, run.length > 0, s.pr !== undefined && s.pr !== false].filter(Boolean).length
    if (kinds !== 1) return { error: `Stage "${id}": give exactly one of agent, run or pr` }
    const kind: RecipeNode['kind'] = agents.length ? 'agent' : run.length ? 'run' : 'pr'
    if (kind === 'agent' && (typeof s.prompt !== 'string' || !s.prompt.trim())) return { error: `Stage "${id}": an agent stage needs a prompt` }
    const needs = s.needs === undefined ? (nodes.length ? [nodes[nodes.length - 1].id] : []) : list(s.needs)
    for (const n of needs) if (!nodes.some((x) => x.id === n)) return { error: `Stage "${id}" needs "${n}", which isn't defined above it` }
    let onFail: RecipeNode['onFail']
    if (s.onFail) {
      const f = s.onFail as Record<string, unknown>
      const retry = list(f.retry)
      if (!retry.length) return { error: `Stage "${id}": onFail needs retry: <stage>` }
      for (const r of retry) if (!nodes.some((x) => x.id === r)) return { error: `Stage "${id}" retries "${r}", which isn't defined above it` }
      onFail = { retry, max: Math.max(1, Math.min(10, Number(f.max ?? 2) || 2)) }
    }
    const pr = s.pr && typeof s.pr === 'object' ? (s.pr as Record<string, unknown>) : {}
    nodes.push({
      id,
      kind,
      needs,
      agents,
      prompt: typeof s.prompt === 'string' ? s.prompt.trim() : '',
      interactive: s.interactive === true,
      run,
      onFail,
      approve: s.gate === 'approve',
      maxDiff: typeof s.maxDiff === 'number' && s.maxDiff > 0 ? s.maxDiff : undefined,
      pr: kind === 'pr' ? { title: typeof pr.title === 'string' ? pr.title : '{intent}', body: typeof pr.body === 'string' ? pr.body : '' } : undefined
    })
  }
  return {
    recipe: {
      name,
      description: typeof doc.description === 'string' ? doc.description.trim() : '',
      intake: doc.intake === 'issue' ? 'issue' : 'prompt',
      nodes,
      path
    }
  }
}

// ── agents ───────────────────────────────────────────────────────

export interface AgentChoice {
  agent?: string
  profile?: AgentProfile
}

/** "Reviewer@gemini" → the Reviewer profile on Gemini; "codex" → the Codex CLI; "Reviewer" → the profile. */
export function resolveAgentSpec(spec: string, profiles: AgentProfile[], agentIds: string[]): AgentChoice | { error: string } {
  const [name, cli] = spec.split('@').map((s) => s.trim())
  if (cli && !agentIds.includes(cli)) return { error: `Unknown agent "${cli}" in "${spec}"` }
  if (!cli && agentIds.includes(name)) return { agent: name }
  const profile = profiles.find((p) => p.name.toLowerCase() === name.toLowerCase())
  if (!profile) return { error: `No agent or profile called "${name}"` }
  return { profile, agent: cli || profile.agent }
}

// ── placeholders ─────────────────────────────────────────────────

export interface FillContext {
  intent: string
  issue?: string
  /** this node's output file */
  out?: string
  /** node id → output file */
  outs: Record<string, string>
  /** file with the run's current diff */
  diff?: string
  /** output of the check that failed, on a retry */
  log?: string
  /** the branch the run started from */
  base?: string
}

/** Fills {intent} {issue} {base} {out} {<node>.out} {diff} {log}; unknown placeholders stay as written. */
export function fill(text: string, c: FillContext): string {
  return text.replace(/\{([A-Za-z0-9_-]+)(?:\.out)?\}/g, (m, key: string) => {
    if (m.endsWith('.out}')) return c.outs[key] ?? m
    if (key === 'intent') return c.intent
    if (key === 'issue') return c.issue ?? c.intent
    if (key === 'out') return c.out ?? m
    if (key === 'diff') return c.diff ?? m
    if (key === 'log') return c.log ?? ''
    if (key === 'base') return c.base ?? m
    return m
  })
}

// ── layout ───────────────────────────────────────────────────────

/** Column per node: the longest chain of needs before it. */
export function layout(r: Recipe): Map<string, { col: number; row: number }> {
  const col = new Map<string, number>()
  for (const n of r.nodes) col.set(n.id, n.needs.length ? Math.max(...n.needs.map((x) => col.get(x) ?? 0)) + 1 : 0)
  const rows = new Map<number, number>()
  const out = new Map<string, { col: number; row: number }>()
  for (const n of r.nodes) {
    const c = col.get(n.id) ?? 0
    const row = rows.get(c) ?? 0
    rows.set(c, row + 1)
    out.set(n.id, { col: c, row })
  }
  return out
}

export function descendants(r: Recipe, id: string): Set<string> {
  const out = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const n of r.nodes) if (!out.has(n.id) && n.needs.some((x) => x === id || out.has(x))) (out.add(n.id), (grew = true))
  }
  return out
}

export function ancestors(r: Recipe, id: string): Set<string> {
  const byId = new Map(r.nodes.map((n) => [n.id, n]))
  const out = new Set<string>()
  const walk = (x: string): void => byId.get(x)?.needs.forEach((p) => out.has(p) || (out.add(p), walk(p)))
  walk(id)
  return out
}

// ── runs ─────────────────────────────────────────────────────────

export type NodeStatus = 'pending' | 'running' | 'approval' | 'done' | 'failed'
export type RunStatus = 'running' | 'paused' | 'done' | 'failed' | 'stopped'

export interface NodeRun {
  status: NodeStatus
  attempts: number
  missionIds: string[]
  /** run-node terminal */
  panelId?: string
  /** ran in its own worktree (parallel with another node) */
  worktree?: WorktreeInfo
  /** its branch is merged into the run branch */
  merged?: boolean
  startedAt?: number
  endedAt?: number
  /** why it is waiting or failed, shown on the node */
  note?: string
  /** handed to the agent on its next attempt: failing checks or a reviewer's note */
  feedback?: string
  /** bake-off: the mission whose work was kept */
  winner?: string
  /** bake-off: one attempt per agent, each in its own worktree */
  candidates?: Candidate[]
}

export interface Candidate {
  spec: string
  missionId: string
  worktree: WorktreeInfo
  status: 'running' | 'done' | 'failed'
  stats?: { files: number; insertions: number; deletions: number }
}

export const isBakeoff = (n: RecipeNode): boolean => n.kind === 'agent' && n.agents.length > 1

export interface FactoryRun {
  id: string
  recipe: Recipe
  intent: string
  root: string
  /** the run's own worktree and branch */
  worktree: WorktreeInfo
  /** <worktree>/.sldev/runs/<id> */
  outDir: string
  status: RunStatus
  note?: string
  nodes: Record<string, NodeRun>
  createdAt: number
  updatedAt: number
}

export const newNodeRun = (): NodeRun => ({ status: 'pending', attempts: 0, missionIds: [] })

/** Nodes whose needs are all done, in recipe order. */
export function readyNodes(run: FactoryRun): string[] {
  if (run.status !== 'running') return []
  return run.recipe.nodes.filter((n) => run.nodes[n.id]?.status === 'pending' && n.needs.every((x) => run.nodes[x]?.status === 'done')).map((n) => n.id)
}

/** A node gets its own worktree when another node is working in the run worktree, or several start together. */
export function needsOwnWorktree(run: FactoryRun, id: string, startingTogether: string[]): boolean {
  const node = run.recipe.nodes.find((n) => n.id === id)
  if (!node || node.kind === 'pr') return false
  if (startingTogether.length > 1) return true
  return run.recipe.nodes.some((n) => n.id !== id && run.nodes[n.id]?.status === 'running' && !run.nodes[n.id]?.worktree)
}

const setNode = (run: FactoryRun, id: string, patch: Partial<NodeRun>, now: number): FactoryRun => ({
  ...run,
  updatedAt: now,
  nodes: { ...run.nodes, [id]: { ...run.nodes[id], ...patch } }
})

const settle = (run: FactoryRun): FactoryRun => {
  const all = Object.values(run.nodes)
  if (all.every((n) => n.status === 'done')) return { ...run, status: 'done', note: undefined }
  return run
}

export function nodeStarted(run: FactoryRun, id: string, now: number, patch: Partial<NodeRun> = {}): FactoryRun {
  const n = run.nodes[id]
  return setNode(run, id, { status: 'running', attempts: n.attempts + 1, startedAt: now, endedAt: undefined, note: undefined, ...patch }, now)
}

/** Back to pending, with everything after it, so it runs again. */
function rerun(run: FactoryRun, ids: string[], feedback: string | undefined, now: number): FactoryRun {
  const reset = new Set(ids)
  for (const id of ids) descendants(run.recipe, id).forEach((d) => reset.add(d))
  const nodes = { ...run.nodes }
  for (const id of reset) {
    const old = nodes[id]
    nodes[id] = { ...old, status: 'pending', note: undefined, merged: undefined, endedAt: undefined, feedback: ids.includes(id) ? feedback : old.feedback, winner: undefined, candidates: undefined }
  }
  return { ...run, nodes, updatedAt: now }
}

export interface Finish {
  ok: boolean
  /** failing output, handed to the retried agents */
  log?: string
  /** lines changed in the run so far, for maxDiff */
  diffLines?: number
}

export function nodeFinished(run: FactoryRun, id: string, f: Finish, now: number): FactoryRun {
  const node = run.recipe.nodes.find((n) => n.id === id)
  if (!node) return run
  if (!f.ok) {
    const retries = run.nodes[id].attempts
    if (node.onFail && retries <= node.onFail.max) {
      const feedback = `${node.run.join(' && ')} failed (attempt ${retries} of ${node.onFail.max + 1}):\n\n${(f.log ?? '').slice(-4000)}`
      return rerun(run, node.onFail.retry, feedback, now)
    }
    const failed = setNode(run, id, { status: 'failed', endedAt: now, note: node.onFail ? `Still failing after ${node.onFail.max} retries` : 'Failed' }, now)
    return { ...failed, status: 'failed', note: `${id} failed` }
  }
  if (isBakeoff(node)) {
    const ok = (run.nodes[id].candidates ?? []).filter((c) => c.status === 'done').length
    return setNode(run, id, { status: 'approval', endedAt: now, note: `${ok} version${ok === 1 ? '' : 's'} to compare. Keep one.` }, now)
  }
  const tooBig = node.maxDiff !== undefined && (f.diffLines ?? 0) > node.maxDiff
  if (node.approve || tooBig) {
    const note = tooBig ? `${f.diffLines} lines changed, over the ${node.maxDiff} limit` : 'Waiting for your approval'
    return setNode(run, id, { status: 'approval', endedAt: now, note }, now)
  }
  return settle(setNode(run, id, { status: 'done', endedAt: now, feedback: undefined }, now))
}

export function approveNode(run: FactoryRun, id: string, now: number): FactoryRun {
  if (run.nodes[id]?.status !== 'approval') return run
  // a bake-off is approved by keeping one version
  if (run.recipe.nodes.some((n) => n.id === id && isBakeoff(n))) return run
  return settle(setNode(run, id, { status: 'done', note: undefined, feedback: undefined }, now))
}

/** Keeps one bake-off version: its worktree becomes the node's, merged into the run like any parallel branch. */
export function pickWinner(run: FactoryRun, id: string, missionId: string, now: number): FactoryRun {
  const nr = run.nodes[id]
  const c = nr?.candidates?.find((x) => x.missionId === missionId)
  if (nr?.status !== 'approval' || !c || c.status !== 'done') return run
  return settle(setNode(run, id, { status: 'done', winner: missionId, worktree: c.worktree, merged: undefined, note: `Kept ${c.spec}`, feedback: undefined }, now))
}

/** Rejecting sends the node back with your note. */
export function rejectNode(run: FactoryRun, id: string, note: string, now: number): FactoryRun {
  if (run.nodes[id]?.status !== 'approval') return run
  return rerun(run, [id], note.trim() ? `Your previous attempt was rejected: ${note.trim()}` : 'Your previous attempt was rejected. Try again.', now)
}

export function retryNode(run: FactoryRun, id: string, now: number): FactoryRun {
  const r = rerun(run, [id], run.nodes[id]?.feedback, now)
  return { ...r, status: 'running', note: undefined }
}

/** The prompt an agent node gets: the recipe prompt, then any feedback from a failed check or a rejection. */
export function nodePrompt(node: RecipeNode, nr: NodeRun, c: FillContext): string {
  const base = fill(node.prompt, c)
  const out = c.out && !node.prompt.includes('{out}') ? `\n\nWrite a short summary of what you did to ${c.out}.` : ''
  const fb = nr.feedback ? `\n\n---\n\n${fill(nr.feedback, c)}` : ''
  return `${base}${out}${fb}`
}

export function totalLines(stat: { insertions: number; deletions: number }): number {
  return stat.insertions + stat.deletions
}

// ── run nodes ────────────────────────────────────────────────────

/** Runtime names a recipe's run stages refer to ("test?" → "test"). */
export function runtimeNames(r: Recipe): string[] {
  return [...new Set(r.nodes.flatMap((n) => n.run).filter((e) => /^[\w:.-]+\??$/.test(e)).map((e) => e.replace(/\?$/, '')))]
}

export interface RuntimeRef {
  name: string
  command: string
  /** directory relative to the project root, '' for the root */
  rel: string
}

/**
 * A run entry is a shell command, or the name of a detected runtime ("test", "lint"), whose command
 * then runs in its own folder. A trailing "?" makes a runtime optional: skipped when the project
 * has none by that name.
 */
export function resolveRun(entries: string[], runtimes: RuntimeRef[]): { command: string; skipped: string[] } {
  const parts: string[] = []
  const skipped: string[] = []
  for (const entry of entries) {
    const optional = entry.endsWith('?')
    const name = optional ? entry.slice(0, -1) : entry
    const matches = /^[\w:.-]+$/.test(name) ? runtimes.filter((r) => r.name === name) : []
    const rt = matches.find((r) => r.rel === '') ?? matches[0]
    if (rt) parts.push(rt.rel ? `(cd ${JSON.stringify(rt.rel)} && ${rt.command})` : rt.command)
    else if (optional) skipped.push(name)
    else parts.push(name)
  }
  return { command: parts.join(' && '), skipped }
}
