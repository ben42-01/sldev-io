import {
  ancestors,
  applyOverrides,
  findSkill,
  approveNode,
  isBakeoff,
  pickWinner,
  newNodeRun,
  needsOwnWorktree,
  nodeFinished,
  nodePrompt,
  nodeStarted,
  parseRecipe,
  readyNodes,
  recordEvents,
  rejectNode,
  resolveAgentSpec,
  resolveRun,
  retryNode,
  seedNode,
  sendBack as sendBackNode,
  totalLines,
  type FactoryRun,
  type FillContext,
  type Finish,
  type NodeRun,
  type Recipe,
  type RecipeNode,
  type StageOverride
} from '@shared/factory'
import { applyProfile } from '@shared/profiles'
import { feedbackPrompt, prNumber, unaddressed } from '@shared/prFeedback'
import { makeBundle, readBundle } from '@shared/recipeBundle'
import { BUILTIN_RECIPES } from '@shared/recipes'
import type { AgentOptions, GhPrComment, WorktreeInfo } from '@shared/types'
import { groupOf, openPanel, openTerminal, type OpenTerminalOptions } from '../dock/dockApi'
import { allAgents, findAgent, skillPrompt, slugify, stageMode } from '../lib/agents'
import { onTerminalEvent, terminalTail } from '../lib/terminals'
import { getMission, missions, startMission } from './missions'
import { allProfiles, loadProjectProfiles } from './profiles'
import { createStore, useStore } from './store'
import { workspace } from './workspace'

/**
 * Runs factory recipes: the pure state machine is in @shared/factory, this file does the work.
 * Agent nodes are missions (print mode unless the recipe says interactive), run nodes are terminals,
 * and every finished node is committed so parallel branches can be merged back.
 */

export interface RecipeEntry {
  recipe: Recipe
  /** the YAML it came from, for sharing */
  text: string
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

function put(next: FactoryRun): FactoryRun {
  const run = recordEvents(getRun(next.id), next, Date.now())
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
    return recordEvents(r, { ...r, nodes, status: 'paused' as const, note: 'Paused when the app closed. Resume to continue.' }, Date.now())
  })
  factory.set({ runs })
  if (saved.some((r) => r.status === 'running')) persist()
}

export async function loadRecipes(root: string | null): Promise<void> {
  const recipes: RecipeEntry[] = []
  const recipeErrors: Record<string, string> = {}
  for (const f of root ? await window.api.factory.recipes(root).catch(() => []) : []) {
    const r = parseRecipe(f.text, f.path)
    if (r.recipe) recipes.push({ recipe: r.recipe, text: f.text })
    else recipeErrors[f.path] = r.error
  }
  for (const b of BUILTIN_RECIPES) {
    const r = parseRecipe(b.text)
    if (r.recipe && !recipes.some((x) => x.recipe.name === r.recipe.name)) recipes.push({ recipe: r.recipe, text: b.text, builtin: b.slug })
  }
  factory.set({ recipes, recipeErrors })
}

/** The recipe and its agent profiles as one text to paste anywhere. */
export function recipeBundle(entry: RecipeEntry): string {
  return makeBundle(entry.text, entry.recipe, allProfiles(), allAgents(workspace.get().customAgents).map((a) => a.id))
}

/**
 * Adds a pasted bundle (or plain recipe) to the project: the recipe goes to .sldev/factory, its
 * agents to .sldev/agents. An agent you already have by that name is kept as it is.
 */
export async function importRecipe(root: string, text: string): Promise<{ name: string; added: string[]; kept: string[] }> {
  const b = readBundle(text)
  if ('error' in b) throw new Error(b.error)
  const added: string[] = []
  const kept: string[] = []
  for (const p of b.profiles) {
    if (allProfiles().some((x) => x.name.toLowerCase() === p.name.toLowerCase())) kept.push(p.name)
    else {
      await window.api.profiles.save(root, { ...p, id: '', scope: 'project', path: undefined })
      added.push(p.name)
    }
  }
  await window.api.factory.saveRecipe(root, slugify(b.recipe.name), b.recipeText)
  await Promise.all([loadProjectProfiles(root), loadRecipes(root)])
  return { name: b.recipe.name, added, kept }
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

export interface StartRunInput {
  recipe: Recipe
  intent: string
  root: string
  base?: string
  issue?: number
  /** the run form's agent and skill choices per stage */
  overrides?: Record<string, StageOverride>
  /** start past this stage: its output is this text (a spec file, a mission's plan) */
  seed?: { node: string; text: string; from: string }
}

export async function startRun(input: StartRunInput): Promise<FactoryRun> {
  const recipe = applyOverrides(input.recipe, input.overrides ?? {}, workspace.get().defaultAgent)
  const problem = checkRecipe(recipe)
  if (problem) throw new Error(problem)
  if (input.seed && !recipe.nodes.some((n) => n.id === input.seed!.node)) throw new Error(`The recipe has no stage "${input.seed.node}"`)
  if (!(await window.api.git.isRepo(input.root))) throw new Error('The factory needs a git repository')
  const base = input.base || (await window.api.git.branch(input.root)) || 'HEAD'
  const id = `f-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  const worktree = await window.api.git.addWorktree(input.root, `factory-${slugify(input.intent).slice(0, 30)}`, base)
  const outDir = `${worktree.path}/.sldev/runs/${id}`
  await window.api.factory.prepare(outDir)
  if (input.seed) await window.api.factory.write(outFile(worktree.path, id, input.seed.node), input.seed.text)
  const now = Date.now()
  let run: FactoryRun = {
    id,
    recipe,
    intent: input.intent.trim(),
    root: input.root,
    worktree,
    outDir,
    status: 'running',
    issue: input.issue,
    nodes: Object.fromEntries(input.recipe.nodes.map((n) => [n.id, newNodeRun()])),
    createdAt: now,
    updatedAt: now
  }
  if (input.seed) run = seedNode(run, input.seed.node, `From ${input.seed.from}`, now)
  factory.set((s) => ({ runs: [recordEvents(undefined, run, now), ...s.runs] }))
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
async function mergeFinished(runId: string, nodeId: string | null): Promise<boolean> {
  let run = getRun(runId)!
  // null: the run is over, so bring home every branch nothing came after
  for (const a of nodeId ? ancestors(run.recipe, nodeId) : run.recipe.nodes.map((n) => n.id)) {
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

/** Print-mode stages have nobody to approve a tool call, so they get the unattended mode unless the profile sets one. */
function stageOptions(spec: string, interactive: boolean): AgentOptions {
  const o = { ...nodeOptions(spec), print: !interactive }
  if (interactive || o.permissionMode) return o
  const { customAgents, factoryModes } = workspace.get()
  return { ...o, permissionMode: stageMode(findAgent(o.agent, customAgents), factoryModes) }
}

/** A skill stage's prompt runs the skill with the recipe prompt as its arguments; others get the recipe prompt. */
async function stagePrompt(run: FactoryRun, node: RecipeNode, nr: NodeRun, c: FillContext, agentId: string | undefined): Promise<string> {
  if (!node.skill) return nodePrompt(node, nr, c)
  const skill = findSkill(await window.api.claude.assets(run.root).catch(() => []), node.skill)
  if (!skill) throw new Error(`No skill or command called "${node.skill}" in .claude/skills, .sldev/skills or ~/.claude`)
  const agent = findAgent(agentId, workspace.get().customAgents)
  return nodePrompt(node, nr, c, (args) => skillPrompt(agent, skill, args))
}

/** Installs dependencies in a worktree before its first stage. False = it failed and the run is paused. */
async function setUp(runId: string, dir: string): Promise<boolean> {
  const run = getRun(runId)!
  const command = await window.api.factory.setupPlan(dir, run.recipe.setup).catch(() => null)
  if (!command) return true
  put({ ...run, note: `Setting up the worktree: ${command}`, updatedAt: Date.now() })
  const r = await window.api.factory.setup(dir, command)
  const cur = getRun(runId)!
  if (r.ok) {
    put({ ...cur, note: undefined, updatedAt: Date.now() })
    return true
  }
  const last = r.log.trim().split('\n').slice(-3).join(' ').slice(0, 300)
  put({ ...cur, status: 'paused', note: `Setup failed (${command}) in ${dir}: ${last}. Fix it there, or set "setup:" in the recipe, then resume.`, updatedAt: Date.now() })
  return false
}

async function startNode(runId: string, nodeId: string, together: string[]): Promise<void> {
  let run = getRun(runId)!
  const node = run.recipe.nodes.find((n) => n.id === nodeId)!
  await commit(run.worktree.path, `factory: before ${nodeId}`)
  if (!(await mergeFinished(runId, nodeId))) return
  run = getRun(runId)!

  const own = !isBakeoff(node) && needsOwnWorktree(run, nodeId, together)
  const worktree = own ? await window.api.git.addWorktree(run.worktree.repo, `${run.worktree.branch.replace(/^sldev\//, '')}-${nodeId}`, run.worktree.branch) : undefined
  const cwd = worktree?.path ?? run.worktree.path
  if (worktree) await window.api.factory.prepare(`${cwd}/.sldev/runs/${run.id}`)
  if (node.kind !== 'pr' && !(await setUp(runId, cwd))) return
  run = getRun(runId)!
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

  if (isBakeoff(node)) return startBakeoff(runId, nodeId, outs)

  try {
    const options = stageOptions(node.agents[0], node.interactive)
    const prompt = await stagePrompt(run, node, nr, { intent: run.intent, base: run.worktree.base, out: outFile(cwd, run.id, nodeId), outs, log: nr.feedback }, options.agent)
    const m = await startMission({ prompt, title: `${nodeId}: ${run.intent}`.slice(0, 60), root: run.root, cwd, options, worktree: false, factory: { run: run.id, node: nodeId }, placement: placement(run) })
    const cur = getRun(runId)!
    put({ ...cur, nodes: { ...cur.nodes, [nodeId]: { ...cur.nodes[nodeId], missionIds: [m.id] } } })
  } catch (e) {
    finish(runId, nodeId, { ok: false, log: (e as Error).message })
  }
}

/** One worktree and one mission per agent, all from the same commit, all with the same prompt. */
async function startBakeoff(runId: string, nodeId: string, outs: Record<string, string>): Promise<void> {
  const run = getRun(runId)!
  const node = run.recipe.nodes.find((n) => n.id === nodeId)!
  const nr = run.nodes[nodeId]
  const candidates: NonNullable<NodeRun['candidates']> = []
  try {
    for (const spec of node.agents) {
      const options = stageOptions(spec, node.interactive)
      const slug = `${run.worktree.branch.replace(/^sldev\//, '')}-${nodeId}-${slugify(spec)}`
      const worktree = await window.api.git.addWorktree(run.worktree.repo, slug, run.worktree.branch)
      await window.api.factory.prepare(`${worktree.path}/.sldev/runs/${run.id}`)
      if (!(await setUp(runId, worktree.path))) return
      const prompt = await stagePrompt(run, node, nr, { intent: run.intent, base: run.worktree.base, out: outFile(worktree.path, run.id, nodeId), outs, log: nr.feedback }, options.agent)
      const m = await startMission({ prompt, title: `${nodeId} (${spec}): ${run.intent}`.slice(0, 60), root: run.root, cwd: worktree.path, options, worktree: false, factory: { run: run.id, node: nodeId }, placement: placement(getRun(runId)!) })
      candidates.push({ spec, missionId: m.id, worktree, status: 'running' })
      const cur = getRun(runId)!
      put({ ...cur, nodes: { ...cur.nodes, [nodeId]: { ...cur.nodes[nodeId], candidates: [...candidates], missionIds: candidates.map((c) => c.missionId) } } })
    }
  } catch (e) {
    finish(runId, nodeId, { ok: false, log: (e as Error).message })
  }
}

/** Keep one bake-off version; the others' worktrees and branches go. */
export async function keep(runId: string, nodeId: string, missionId: string): Promise<void> {
  const run = getRun(runId)
  const nr = run?.nodes[nodeId]
  const winner = nr?.candidates?.find((c) => c.missionId === missionId)
  if (!run || !nr || !winner) return
  await window.api.factory.copy(outFile(winner.worktree.path, run.id, nodeId), outFile(run.worktree.path, run.id, nodeId))
  const next = put(pickWinner(run, nodeId, missionId, Date.now()))
  // picking the winner is the user's decision to drop the others (every stage was committed)
  for (const c of nr.candidates ?? []) if (c !== winner) await window.api.git.removeWorktree(c.worktree, { deleteBranch: true, discard: true }).catch(() => undefined)
  if (next.status === 'done') await mergeFinished(runId, null)
  void tick(runId)
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
  if (isBakeoff(node)) {
    const candidates = await Promise.all(
      (nr.candidates ?? []).map(async (c) => {
        await commit(c.worktree.path, `factory(${nodeId}, ${c.spec}): ${run.intent}`.slice(0, 100))
        return { ...c, stats: await window.api.git.diffStat(c.worktree.path, c.worktree.base).catch(() => undefined) }
      })
    )
    const cur = getRun(runId)!
    put({ ...cur, nodes: { ...cur.nodes, [nodeId]: { ...cur.nodes[nodeId], candidates } } })
    finish(runId, nodeId, { ok: candidates.some((c) => c.status === 'done'), log: 'Every agent in the bake-off failed' })
    return
  }
  if (node.kind === 'agent') {
    await commit(cwd, `factory(${nodeId}): ${run.intent}`.slice(0, 100))
    // later stages read this file; without it they'd build on nothing
    if (f.ok && !node.interactive && (await window.api.factory.read(outFile(cwd, run.id, nodeId))) === null) {
      const panel = nr.missionIds[0] ? missions.get().panels[nr.missionIds[0]] : undefined
      const tail = panel ? terminalTail(panel) : ''
      const reason = `Ended without writing .sldev/runs/${run.id}/${nodeId}.md. Open its terminal to see why`
      finish(runId, nodeId, { ok: false, reason, log: `The agent ended without writing ${outFile(cwd, run.id, nodeId)}.${tail ? `\n\nIts last output:\n${tail}` : ''}` })
      return
    }
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
  if (next.status === 'done') {
    ping(next, `${next.recipe.name} finished`, next.intent)
    void mergeFinished(runId, null)
  }
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

/** A failed stage goes back to the agent that can fix it, with your note. */
export function sendBack(runId: string, nodeId: string, note: string): void {
  const run = getRun(runId)
  if (!run) return
  put(sendBackNode(run, nodeId, note, Date.now()))
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

/** The run's main worktree first, then the per-stage ones (see removeRunFlow in lib/removals.tsx, which asks first). */
export function runWorktrees(run: FactoryRun): WorktreeInfo[] {
  return [run.worktree, ...Object.values(run.nodes).flatMap((nr) => (nr.worktree ? [nr.worktree] : []))]
}

export async function removeRun(runId: string, opts: { worktrees: boolean; discard?: boolean }): Promise<void> {
  const run = getRun(runId)
  if (!run) return
  if (opts.worktrees) {
    // stage branches are merged into the run's branch; the run's own branch is kept for its PR
    for (const nr of Object.values(run.nodes)) if (nr.worktree) await window.api.git.removeWorktree(nr.worktree, { deleteBranch: true, discard: !!opts.discard })
    await window.api.git.removeWorktree(run.worktree, { deleteBranch: false, discard: !!opts.discard })
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
    const body = [fillText(node.pr?.body ?? '').trim(), run.issue ? `Closes #${run.issue}` : ''].filter(Boolean).join('\n\n')
    const url = await window.api.git.pushAndPr(run.worktree.path, run.worktree.branch, run.worktree.base, fillText(node.pr?.title ?? '{intent}'), body || undefined)
    const cur = getRun(run.id)!
    const nodes = { ...cur.nodes, [nodeId]: { ...cur.nodes[nodeId], status: 'done' as const, endedAt: Date.now(), note: url || 'Pull request opened' } }
    const done = Object.values(nodes).every((n) => n.status === 'done')
    const number = prNumber(url)
    put({ ...cur, nodes, status: done ? 'done' : cur.status, pr: number ? { number, url } : cur.pr, updatedAt: Date.now() })
    void tick(run.id)
  } catch (e) {
    const cur = getRun(run.id)!
    put({ ...cur, nodes: { ...cur.nodes, [nodeId]: { ...cur.nodes[nodeId], status: 'approval', note: `Couldn't open the PR: ${(e as Error).message.split('\n')[0]}` } } })
  }
}

// ── review feedback on the run's pull request ───────────────────

/** Review comments nobody has handed to an agent yet. */
export async function prFeedback(runId: string): Promise<GhPrComment[]> {
  const run = getRun(runId)
  if (!run?.pr) return []
  return unaddressed(await window.api.gh.prComments(run.worktree.path, run.pr.number), run.pr.addressedAt)
}

/** An interactive mission in the run worktree, so you can watch and steer it; it commits, you push. */
export async function addressPrFeedback(runId: string, spec: string, comments: GhPrComment[]): Promise<void> {
  const run = getRun(runId)
  if (!run?.pr || !comments.length) return
  const prompt = feedbackPrompt(run.intent, run.pr.number, comments)
  const m = await startMission({ prompt, title: `PR #${run.pr.number} feedback: ${run.intent}`.slice(0, 60), root: run.root, cwd: run.worktree.path, options: nodeOptions(spec), worktree: false, placement: placement(run) })
  const cur = getRun(runId)!
  put({ ...cur, pr: { ...cur.pr!, addressedAt: Date.now(), missionId: m.id }, updatedAt: Date.now() })
}

/** Only on a click, like opening the PR. */
export async function pushPrUpdate(runId: string): Promise<void> {
  const run = getRun(runId)
  if (!run?.pr) return
  await commit(run.worktree.path, `Address review feedback on #${run.pr.number}`)
  await window.api.git.push(run.worktree.path, run.worktree.branch)
  const cur = getRun(runId)!
  put({ ...cur, pr: { ...cur.pr!, pushedAt: Date.now() }, updatedAt: Date.now() })
}

// ── watching missions and terminals ─────────────────────────────

/** Agent nodes finish when their mission's process ends (print mode exits when the agent is done). */
missions.subscribe(() => {
  for (const run of factory.get().runs) {
    if (run.status !== 'running' && run.status !== 'paused') continue
    for (const [nodeId, nr] of Object.entries(run.nodes)) {
      if (nr.status !== 'running' || !nr.missionIds.length) continue
      if (nr.candidates) {
        watchBakeoff(run, nodeId, nr)
        continue
      }
      const m = getMission(nr.missionIds[0])
      if (m?.status === 'ended') void complete(run.id, nodeId, { ok: true })
      else if (m?.status === 'failed') void complete(run.id, nodeId, { ok: false, log: `${m.title} exited with an error` })
    }
  }
})

function watchBakeoff(run: FactoryRun, nodeId: string, nr: NodeRun): void {
  const node = run.recipe.nodes.find((n) => n.id === nodeId)
  if (!nr.candidates || nr.candidates.length < (node?.agents.length ?? 0)) return
  let changed = false
  const candidates = nr.candidates.map((c) => {
    const status = getMission(c.missionId)?.status
    const next = status === 'ended' ? 'done' : status === 'failed' ? 'failed' : c.status
    if (next !== c.status) changed = true
    return next === c.status ? c : { ...c, status: next }
  })
  if (changed) put({ ...run, nodes: { ...run.nodes, [nodeId]: { ...nr, candidates } } })
  if (candidates.every((c) => c.status !== 'running')) void complete(run.id, nodeId, { ok: true })
}

onTerminalEvent((e) => {
  if (e.type !== 'status' || e.status !== 'exited') return
  for (const run of factory.get().runs)
    for (const [nodeId, nr] of Object.entries(run.nodes))
      if (nr.status === 'running' && nr.panelId === e.id) void complete(run.id, nodeId, { ok: e.exitCode === 0, log: terminalTail(e.id) })
})

/** Agents with the sldev MCP tools hand over their output, and finish interactive steps, themselves. */
window.api.missions.onMcp((e) => {
  const m = getMission(e.mission)
  const run = m?.factory ? getRun(m.factory.run) : undefined
  if (!m?.factory || !run) return
  if (e.type === 'output') void window.api.factory.write(outFile(m.cwd, run.id, m.factory.node), e.text)
  if (e.type === 'done' && run.recipe.nodes.find((n) => n.id === m.factory!.node)?.interactive) markDone(run.id, m.factory.node)
})
