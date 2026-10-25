import {
  ancestors,
  approveNode,
  newNodeRun,
  needsOwnWorktree,
  nodeFinished,
  nodePrompt,
  nodeStarted,
  parseRecipe,
  readyNodes,
  rejectNode,
  resolveAgentSpec,
  resolveRun,
  retryNode,
  totalLines,
  type FactoryRun,
  type Finish,
  type Recipe
} from '@shared/factory'
import { applyProfile } from '@shared/profiles'
import { BUILTIN_RECIPES } from '@shared/recipes'
import type { AgentOptions } from '@shared/types'
import { groupOf, openPanel, openTerminal, type OpenTerminalOptions } from '../dock/dockApi'
import { slugify } from '../lib/agents'
import { onTerminalEvent, terminalTail } from '../lib/terminals'
import { allAgents } from '../lib/agents'
import { getMission, missions, startMission } from './missions'
import { allProfiles } from './profiles'
import { createStore, useStore } from './store'
import { workspace } from './workspace'

/**
 * Runs factory recipes: the pure state machine is in @shared/factory, this file does the work.
 * Agent nodes are missions (print mode unless the recipe says interactive), run nodes are terminals,
 * and every finished node is committed so parallel branches can be merged back.
 */

export interface RecipeEntry {
  recipe: Recipe
  /** built-in slug, for "Add to project" */
  builtin?: string
}

interface FactoryState {
  runs: FactoryRun[]
  recipes: RecipeEntry[]
  /** recipe files that didn't parse: path → error */
  recipeErrors: Record<string, string>
}

export const factory = createStore<FactoryState>({ runs: [], recipes: [], recipeErrors: {} })

let saveTimer: ReturnType<typeof setTimeout> | undefined
function persist(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void window.api.store.set('factoryRuns', { runs: factory.get().runs.slice(0, 100) }), 300)
}

export const getRun = (id: string): FactoryRun | undefined => factory.get().runs.find((r) => r.id === id)
export const useRun = (id: string): FactoryRun | undefined => useStore(factory, (s) => s.runs.find((r) => r.id === id))

function put(run: FactoryRun): FactoryRun {
  factory.set((s) => ({ runs: s.runs.map((r) => (r.id === run.id ? run : r)) }))
  persist()
  return run
}

export async function loadFactory(): Promise<void> {
  const saved = (await window.api.store.get('factoryRuns'))?.runs ?? []
  // nothing keeps running across a restart: live runs come back paused, never re-running on their own
  const runs = saved.map((r) => {
    if (r.status !== 'running') return r
    const nodes = Object.fromEntries(
      Object.entries(r.nodes).map(([id, n]) => [id, n.status === 'running' ? { ...n, status: 'pending' as const, note: 'Interrupted when the app closed' } : n])
    )
    return { ...r, nodes, status: 'paused' as const, note: 'Paused when the app closed. Resume to continue.' }
  })
  factory.set({ runs })
  if (saved.some((r) => r.status === 'running')) persist()
}

export async function loadRecipes(root: string | null): Promise<void> {
  const recipes: RecipeEntry[] = []
  const recipeErrors: Record<string, string> = {}
  for (const f of root ? await window.api.factory.recipes(root).catch(() => []) : []) {
    const r = parseRecipe(f.text, f.path)
    if (r.recipe) recipes.push({ recipe: r.recipe })
    else recipeErrors[f.path] = r.error
  }
  for (const b of BUILTIN_RECIPES) {
    const r = parseRecipe(b.text)
    if (r.recipe && !recipes.some((x) => x.recipe.name === r.recipe.name)) recipes.push({ recipe: r.recipe, builtin: b.slug })
  }
  factory.set({ recipes, recipeErrors })
}

export function openPipeline(runId: string): void {
  const run = getRun(runId)
  if (run) openPanel('pipeline', `pipeline-${runId}`, `${run.recipe.name}: ${run.intent.slice(0, 40)}`, { runId })
}

/** Checks every agent spec up front, so a typo fails before anything starts. */
export function checkRecipe(recipe: Recipe): string | null {
  const ids = allAgents(workspace.get().customAgents).map((a) => a.id)
  for (const n of recipe.nodes)
    for (const spec of n.agents) {
      const r = resolveAgentSpec(spec, allProfiles(), ids)
      if ('error' in r) return `Stage "${n.id}": ${r.error}`
    }
  return null
}

export async function startRun(input: { recipe: Recipe; intent: string; root: string; base?: string }): Promise<FactoryRun> {
  const problem = checkRecipe(input.recipe)
  if (problem) throw new Error(problem)
  if (!(await window.api.git.isRepo(input.root))) throw new Error('The factory needs a git repository')
  const base = input.base || (await window.api.git.branch(input.root)) || 'HEAD'
  const id = `f-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  const worktree = await window.api.git.addWorktree(input.root, `factory-${slugify(input.intent).slice(0, 30)}`, base)
  const outDir = `${worktree.path}/.sldev/runs/${id}`
  await window.api.factory.prepare(outDir)
  const now = Date.now()
  const run: FactoryRun = {
    id,
    recipe: input.recipe,
    intent: input.intent.trim(),
    root: input.root,
    worktree,
    outDir,
    status: 'running',
    nodes: Object.fromEntries(input.recipe.nodes.map((n) => [n.id, newNodeRun()])),
    createdAt: now,
    updatedAt: now
  }
  factory.set((s) => ({ runs: [run, ...s.runs] }))
  persist()
  openPipeline(id)
  void tick(id)
  return run
}

// ── advancing ────────────────────────────────────────────────────

const ticking = new Set<string>()
const again = new Set<string>()

/** Start every node whose needs are done. Serialized per run; a tick during a tick runs once more after. */
async function tick(runId: string): Promise<void> {
  if (ticking.has(runId)) return void again.add(runId)
  ticking.add(runId)
  try {
    const run = getRun(runId)
    if (!run) return
    const ready = readyNodes(run)
    for (const id of ready) {
      if (getRun(runId)?.status !== 'running') break
      await startNode(runId, id, ready)
    }
  } finally {
    ticking.delete(runId)
    if (again.delete(runId)) void tick(runId)
  }
}

/** A run's terminals share one group beside its pipeline, so the graph stays in view. */
function placement(run: FactoryRun): Pick<OpenTerminalOptions, 'referencePanel' | 'referenceGroup' | 'direction'> {
  const panels = missions.get().panels
  for (const nr of Object.values(run.nodes)) {
    const panel = nr.panelId ?? (nr.missionIds[0] ? panels[nr.missionIds[0]] : undefined)
    const group = panel ? groupOf(panel) : undefined
    if (group && group !== groupOf(`pipeline-${run.id}`)) return { referenceGroup: group }
  }
  return groupOf(`pipeline-${run.id}`) ? { referencePanel: `pipeline-${run.id}`, direction: 'right' } : {}
}

const outFile = (dir: string, runId: string, node: string): string => `${dir}/.sldev/runs/${runId}/${node}.md`

function pause(runId: string, note: string): void {
  const run = getRun(runId)
  if (run) put({ ...run, status: 'paused', note, updatedAt: Date.now() })
}

async function commit(cwd: string, message: string): Promise<void> {
  // nothing to commit is fine
  await window.api.git.commitAll(cwd, message).catch(() => undefined)
}

/** Parallel branches that finished come back into the run branch before anything builds on them. */
async function mergeFinished(runId: string, nodeId: string): Promise<boolean> {
  let run = getRun(runId)!
  for (const a of ancestors(run.recipe, nodeId)) {
    const nr = run.nodes[a]
    if (!nr.worktree || nr.merged || nr.status !== 'done') continue
    try {
      await window.api.git.merge(run.worktree.path, nr.worktree.branch)
    } catch (e) {
      pause(runId, `Merging ${a} into ${run.worktree.branch} failed: ${(e as Error).message.split('\n')[0]}. Resolve it in ${run.worktree.path}, commit, then resume.`)
      return false
    }
    run = put({ ...run, nodes: { ...run.nodes, [a]: { ...nr, merged: true } } })
  }
  return true
}

function nodeOptions(spec: string): AgentOptions {
  const ids = allAgents(workspace.get().customAgents).map((a) => a.id)
  const r = resolveAgentSpec(spec, allProfiles(), ids)
  if ('error' in r) throw new Error(r.error)
  const base: AgentOptions = { agent: workspace.get().defaultAgent }
  const o = applyProfile(base, r.profile)
  return { ...o, agent: r.agent ?? o.agent }
}

async function startNode(runId: string, nodeId: string, together: string[]): Promise<void> {
  let run = getRun(runId)!
  const node = run.recipe.nodes.find((n) => n.id === nodeId)!
  await commit(run.worktree.path, `factory: before ${nodeId}`)
  if (!(await mergeFinished(runId, nodeId))) return
  run = getRun(runId)!

  const own = needsOwnWorktree(run, nodeId, together)
  const worktree = own ? await window.api.git.addWorktree(run.worktree.repo, `${run.worktree.branch.replace(/^sldev\//, '')}-${nodeId}`, run.worktree.branch) : undefined
  const cwd = worktree?.path ?? run.worktree.path
  if (worktree) await window.api.factory.prepare(`${cwd}/.sldev/runs/${run.id}`)
  run = put(nodeStarted(run, nodeId, Date.now(), { worktree, merged: undefined, missionIds: [], panelId: undefined, winner: undefined }))
  const nr = run.nodes[nodeId]
  const outs = Object.fromEntries(run.recipe.nodes.map((n) => [n.id, outFile(run.worktree.path, run.id, n.id)]))

  if (node.kind === 'pr') {
    put({ ...run, nodes: { ...run.nodes, [nodeId]: { ...nr, status: 'approval', note: `Push ${run.worktree.branch} and open a pull request into ${run.worktree.base}?` } } })
    return
  }

  if (node.kind === 'run') {
    const detected = await window.api.runtimes.detect(run.root).catch(() => [])
    const refs = detected.map((d) => ({ name: d.name, command: d.command, rel: d.cwd === run.root ? '' : d.cwd.slice(run.root.length + 1) }))
    const { command, skipped } = resolveRun(node.run, refs)
    if (!command) {
      // every check was optional and the project has none of them
      finish(runId, nodeId, { ok: true }, `Skipped: no ${skipped.join(', ')} in this project`)
      return
    }
    const panelId = openTerminal({ cwd, title: `${nodeId} · ${run.recipe.name}`, command, ...placement(run) })
    put({ ...getRun(runId)!, nodes: { ...getRun(runId)!.nodes, [nodeId]: { ...nr, panelId: panelId ?? undefined, note: skipped.length ? `No ${skipped.join(', ')} here` : undefined } } })
    return
  }

  try {
    const options = { ...nodeOptions(node.agents[0]), print: !node.interactive }
    const prompt = nodePrompt(node, nr, { intent: run.intent, out: outFile(cwd, run.id, nodeId), outs, log: nr.feedback })
    const m = await startMission({ prompt, title: `${nodeId}: ${run.intent}`.slice(0, 60), root: run.root, cwd, options, worktree: false, factory: { run: run.id, node: nodeId }, placement: placement(run) })
    const cur = getRun(runId)!
    put({ ...cur, nodes: { ...cur.nodes, [nodeId]: { ...cur.nodes[nodeId], missionIds: [m.id] } } })
  } catch (e) {
    finish(runId, nodeId, { ok: false, log: (e as Error).message })
  }
}

const completing = new Set<string>()

/** A node's work is over: commit it, bring its output file home, then let the state machine decide. */
async function complete(runId: string, nodeId: string, f: Finish): Promise<void> {
  const key = `${runId}:${nodeId}`
  const run = getRun(runId)
  if (!run || run.nodes[nodeId]?.status !== 'running' || completing.has(key)) return
  completing.add(key)
  try {
    await completeNode(run, nodeId, f)
  } finally {
    completing.delete(key)
  }
}

async function completeNode(run: FactoryRun, nodeId: string, f: Finish): Promise<void> {
  const runId = run.id
  const nr = run.nodes[nodeId]
  const node = run.recipe.nodes.find((n) => n.id === nodeId)!
  const cwd = nr.worktree?.path ?? run.worktree.path
  let diffLines: number | undefined
  if (node.kind === 'agent') {
    await commit(cwd, `factory(${nodeId}): ${run.intent}`.slice(0, 100))
    if (nr.worktree) await window.api.factory.copy(outFile(cwd, run.id, nodeId), outFile(run.worktree.path, run.id, nodeId))
    if (node.maxDiff !== undefined) diffLines = totalLines(await window.api.git.diffStat(cwd, run.worktree.base).catch(() => ({ files: 0, insertions: 0, deletions: 0 })))
  }
  finish(runId, nodeId, { ...f, diffLines })
}

function finish(runId: string, nodeId: string, f: Finish, note?: string): void {
  const run = getRun(runId)
  if (!run) return
  let next = nodeFinished(run, nodeId, f, Date.now())
  if (note && next.nodes[nodeId].status === 'done') next = { ...next, nodes: { ...next.nodes, [nodeId]: { ...next.nodes[nodeId], note } } }
  put(next)
  const status = next.nodes[nodeId].status
  if (status === 'approval') ping(next, `${nodeId} is waiting for you`, next.nodes[nodeId].note ?? '')
  if (next.status === 'failed') ping(next, `${next.recipe.name} failed`, next.note ?? '')
  if (next.status === 'done') ping(next, `${next.recipe.name} finished`, next.intent)
  void tick(runId)
}

function ping(run: FactoryRun, title: string, body: string): void {
  if (!workspace.get().notifications || document.hasFocus()) return
  const n = new Notification(title, { body: body.slice(0, 200) })
  n.onclick = () => {
    void window.api.app.focus()
    openPipeline(run.id)
  }
}

// ── user actions ─────────────────────────────────────────────────

export async function approve(runId: string, nodeId: string): Promise<void> {
  const run = getRun(runId)
  if (!run) return
  const node = run.recipe.nodes.find((n) => n.id === nodeId)
  if (node?.kind === 'pr') return openPr(run, nodeId)
  put(approveNode(run, nodeId, Date.now()))
  void tick(runId)
}

export function reject(runId: string, nodeId: string, note: string): void {
  const run = getRun(runId)
  if (!run) return
  put(rejectNode(run, nodeId, note, Date.now()))
  void tick(runId)
}

export function retry(runId: string, nodeId: string): void {
  const run = getRun(runId)
  if (!run) return
  put(retryNode(run, nodeId, Date.now()))
  void tick(runId)
}

/** Interactive agent nodes finish when you say so. */
export function markDone(runId: string, nodeId: string): void {
  void complete(runId, nodeId, { ok: true })
}

export function resume(runId: string): void {
  const run = getRun(runId)
  if (!run || run.status === 'done') return
  put({ ...run, status: 'running', note: undefined, updatedAt: Date.now() })
  void tick(runId)
}

export function stop(runId: string): void {
  const run = getRun(runId)
  if (run) put({ ...run, status: 'stopped', note: 'Stopped. Running agents keep their terminals.', updatedAt: Date.now() })
}

export async function removeRun(runId: string, removeWorktrees: boolean): Promise<void> {
  const run = getRun(runId)
  if (!run) return
  if (removeWorktrees) {
    for (const nr of Object.values(run.nodes)) if (nr.worktree) await window.api.git.removeWorktree(nr.worktree, true).catch(() => undefined)
    await window.api.git.removeWorktree(run.worktree, false).catch(() => undefined)
  }
  factory.set((s) => ({ runs: s.runs.filter((r) => r.id !== runId) }))
  persist()
}

async function openPr(run: FactoryRun, nodeId: string): Promise<void> {
  const node = run.recipe.nodes.find((n) => n.id === nodeId)!
  const outs = Object.fromEntries(run.recipe.nodes.map((n) => [n.id, outFile(run.worktree.path, run.id, n.id)]))
  // {stage.out} in a PR is the file's text, not its path
  const texts: Record<string, string> = {}
  for (const [id, p] of Object.entries(outs)) texts[id] = (await window.api.factory.read(p)) ?? ''
  const fillText = (t: string): string => t.replace(/\{intent\}/g, run.intent).replace(/\{([A-Za-z0-9_-]+)\.out\}/g, (m, id: string) => texts[id] ?? m)
  const nr = run.nodes[nodeId]
  put({ ...run, nodes: { ...run.nodes, [nodeId]: { ...nr, status: 'running', note: 'Pushing and opening the pull request…' } } })
  try {
    await commit(run.worktree.path, `factory: ${run.intent}`.slice(0, 100))
    const body = fillText(node.pr?.body ?? '').trim()
    const url = await window.api.git.pushAndPr(run.worktree.path, run.worktree.branch, run.worktree.base, fillText(node.pr?.title ?? '{intent}'), body || undefined)
    const cur = getRun(run.id)!
    const nodes = { ...cur.nodes, [nodeId]: { ...cur.nodes[nodeId], status: 'done' as const, endedAt: Date.now(), note: url || 'Pull request opened' } }
    const done = Object.values(nodes).every((n) => n.status === 'done')
    put({ ...cur, nodes, status: done ? 'done' : cur.status, updatedAt: Date.now() })
    void tick(run.id)
  } catch (e) {
    const cur = getRun(run.id)!
    put({ ...cur, nodes: { ...cur.nodes, [nodeId]: { ...cur.nodes[nodeId], status: 'approval', note: `Couldn't open the PR: ${(e as Error).message.split('\n')[0]}` } } })
  }
}

// ── watching missions and terminals ─────────────────────────────

/** Agent nodes finish when their mission's process ends (print mode exits when the agent is done). */
missions.subscribe(() => {
  for (const run of factory.get().runs) {
    if (run.status !== 'running' && run.status !== 'paused') continue
    for (const [nodeId, nr] of Object.entries(run.nodes)) {
      if (nr.status !== 'running' || !nr.missionIds.length) continue
      const m = getMission(nr.missionIds[0])
      if (m?.status === 'ended') void complete(run.id, nodeId, { ok: true })
      else if (m?.status === 'failed') void complete(run.id, nodeId, { ok: false, log: `${m.title} exited with an error` })
    }
  }
})

onTerminalEvent((e) => {
  if (e.type !== 'status' || e.status !== 'exited') return
  for (const run of factory.get().runs)
    for (const [nodeId, nr] of Object.entries(run.nodes))
      if (nr.status === 'running' && nr.panelId === e.id) void complete(run.id, nodeId, { ok: e.exitCode === 0, log: terminalTail(e.id) })
})
