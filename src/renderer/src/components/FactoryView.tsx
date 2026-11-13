import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClaudeAsset, Mission } from '@shared/types'
import { missions } from '../state/missions'
import { useProfiles } from '../state/profiles'
import { useAgents } from '../state/agents'
import { slugify } from '../lib/agents'
import { BookOpen, Check, Factory, FilePlus2, Import, Play, Plus, Share2 } from 'lucide-react'
import { isBakeoff, issueText, recipeTextWithOverrides, runtimeNames, seedableNodes, type FactoryRun, type Recipe, type RecipeNode, type StageAgentChoice, type StageOverride } from '@shared/factory'
import type { AgentDef } from '../lib/agents'
import { branchName } from '@shared/branch'
import { IssuePicker } from './IssuePicker'
import { BUILTIN_RECIPES } from '@shared/recipes'
import { openInEditor } from '../lib/actions'
import { factory, loadRecipes, openPipeline, recipeBundle, specAgent, startRun } from '../state/factory'
import { openImport, openRecipes } from '../dock/RecipesPanel'
import { createStore, useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { showContextMenu } from './ContextMenu'
import { ViewShell } from './RuntimesView'
import { StatusPill } from './StatusDot'
import { runSignal } from '@shared/status'
import { removeRunFlow, showNotice } from '../lib/removals'
import { Modal } from './Modal'
import { FolderField } from './FolderField'
import { AutomationsSection } from './AutomationsSection'

/** What the run form starts with, e.g. a plan from a finished mission. */
export interface RunDraft {
  intent?: string
  seedMission?: string
  /** the recipe to preselect, by name */
  recipe?: string
}

const newRun = createStore<{ open: boolean; draft?: RunDraft; n: number }>({ open: false, n: 0 })

/** Opens the New factory run dialog, optionally starting from a mission's plan; works with the sidebars closed. */
export function openNewRun(draft?: RunDraft): void {
  if (!workspace.get().rootFolder) return void showNotice('No folder open', 'Open a git project to run factory recipes in it.')
  newRun.set({ open: true, draft, n: newRun.get().n + 1 })
}

export function NewRunHost(): React.JSX.Element | null {
  const s = useStore(newRun, (x) => x)
  const root = useStore(workspace, (w) => w.rootFolder)
  if (!s.open || !root) return null
  return <NewRunForm key={s.n} root={root} draft={s.draft} onDone={() => newRun.set({ open: false, n: s.n })} />
}

export function FactoryView(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const runs = useStore(factory, (s) => s.runs)
  const recipes = useStore(factory, (s) => s.recipes)
  const errors = useStore(factory, (s) => s.recipeErrors)
  useEffect(() => void loadRecipes(root), [root])
  const mine = useMemo(() => runs.filter((r) => r.root === root), [runs, root])
  /** unfinished runs in another repository (picked in the run form) stay visible */
  const elsewhere = useMemo(() => runs.filter((r) => r.root !== root && (r.status === 'running' || r.status === 'paused')), [runs, root])

  return (
    <ViewShell
      title="Factory"
      actions={
        <button className="icon-btn" title="New run" aria-label="New run" onClick={() => openNewRun()}>
          <Plus size={14} />
        </button>
      }
    >
      <div className="view-scroll">
        {!root ? (
          <div className="empty-state"><p>Open a git project to run factory recipes in it.</p></div>
        ) : (
          <div className="view-footer">
            <button className="btn primary full" onClick={() => openNewRun()}>
              <Factory size={14} /> New factory run
            </button>
          </div>
        )}
        {mine.length > 0 && <div className="section-label pad">Runs</div>}
        {mine.map((r) => <RunRow key={r.id} run={r} />)}
        {elsewhere.length > 0 && <div className="section-label pad">Other repositories · {elsewhere.length}</div>}
        {elsewhere.map((r) => <RunRow key={r.id} run={r} />)}
        {root && (
          <>
            <div className="section-label pad side-head">
              <span>Recipes · {recipes.length}</span>
              <span className="grow" />
              <button className="icon-btn" title="Import a recipe" aria-label="Import a recipe" onClick={() => openImport()}>
                <Import size={13} />
              </button>
              <button className="icon-btn" title="Build a new recipe" aria-label="Build a new recipe" onClick={() => openRecipes({ mode: 'new' })}>
                <Plus size={13} />
              </button>
            </div>
            {Object.entries(errors).map(([path, error]) => (
              <div key={path} className="muted-note bad" title={path}>
                {path.split(/[\\/]/).pop()}: {error}
              </div>
            ))}
            <ul className="side-recipes">
              {recipes.map((r) => (
                <li key={r.recipe.path ?? r.builtin}>
                  <button
                    className="side-recipe"
                    title={r.recipe.description || r.recipe.name}
                    onClick={() => openRecipes({ select: r.recipe.name })}
                    onContextMenu={(e) =>
                      showContextMenu(e, [
                        { label: 'Run…', run: () => openNewRun({ recipe: r.recipe.name }) },
                        { label: 'Show in Recipes', run: () => openRecipes({ select: r.recipe.name }) },
                        ...(r.recipe.path ? [{ label: 'Open YAML', run: () => void openInEditor(r.recipe.path!) }] : [])
                      ])
                    }
                  >
                    <span className="side-recipe-name">{r.recipe.name}</span>
                    <span className="side-recipe-meta">{r.builtin ? 'built-in' : 'project'} · {r.recipe.nodes.length}</span>
                  </button>
                  <button className="icon-btn side-recipe-run" title={`Run ${r.recipe.name}`} aria-label={`Run ${r.recipe.name}`} onClick={() => openNewRun({ recipe: r.recipe.name })}>
                    <Play size={12} />
                  </button>
                </li>
              ))}
            </ul>
            <button className="btn ghost sm side-recipes-open" onClick={() => openRecipes()}>
              <BookOpen size={13} /> Open recipes: build, import, share
            </button>
          </>
        )}
        {root && <AutomationsSection root={root} />}
        {root && !mine.length && (
          <div className="muted-note">
            A recipe is a graph of steps: agents write specs and code, commands check the result, you approve the steps that matter, and the last step opens a pull request. Each run works in its own branch and worktree.
          </div>
        )}
      </div>
    </ViewShell>
  )
}

export function RunRow({ run }: { run: FactoryRun }): React.JSX.Element {
  const nodes = Object.values(run.nodes)
  const done = nodes.filter((n) => n.status === 'done').length
  const waiting = nodes.some((n) => n.status === 'approval')
  return (
    <div
      className={`run-row ${run.status}${waiting ? ' waiting' : ''}`}
      onClick={() => openPipeline(run.id)}
      onContextMenu={(e) =>
        showContextMenu(e, [
          { label: 'Open pipeline', run: () => openPipeline(run.id) },
          { type: 'separator' },
          { label: 'Remove from list (keep branches)…', run: () => void removeRunFlow(run, false) },
          { label: 'Remove with its worktrees…', run: () => void removeRunFlow(run, true) }
        ])
      }
    >
      <div className="run-row-head">
        <StatusPill signal={runSignal(run.status, waiting)} />
        <span className="run-recipe">{run.recipe.name}</span>
        <span className="run-progress">{done}/{nodes.length}</span>
      </div>
      <div className="run-intent">{run.intent}</div>
      <div className="run-bar"><i style={{ width: `${(done / nodes.length) * 100}%` }} /></div>
    </div>
  )
}

function NewRunForm({ root: projectRoot, draft, onDone }: { root: string; draft?: RunDraft; onDone: () => void }): React.JSX.Element {
  /** the repository the run works in: the open project unless another one is picked */
  const [root, setRoot] = useState(projectRoot)
  const [isRepo, setIsRepo] = useState(true)
  const recipes = useStore(factory, (s) => s.recipes)
  /** by name: the list reloads (another repository, an import) and positions move */
  const [pick, setPick] = useState(draft?.recipe ?? '')
  const [intent, setIntent] = useState(draft?.intent ?? '')
  /** per agent stage: another agent or profile, or a skill instead of the recipe prompt */
  const [overrides, setOverrides] = useState<Record<string, StageOverride>>({})
  /** start past a stage with an output that already exists */
  const [seed, setSeed] = useState<{ node: string; source: 'file' | 'mission'; file: string; mission: string }>(() => ({ node: '', source: draft?.seedMission ? 'mission' : 'file', file: '', mission: draft?.seedMission ?? '' }))
  const [branches, setBranches] = useState<string[]>([])
  const [base, setBase] = useState('')
  /** null: follows the intent (feature/…, fix/…) until you type your own */
  const [branch, setBranch] = useState<string | null>(null)
  const suggested = branchName(intent)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [scripts, setScripts] = useState<string[] | null>(null)
  const [issue, setIssue] = useState<number | undefined>()
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      void window.api.git.isRepo(root).then((r) => {
        if (!live) return
        setIsRepo(r)
        if (!r) return
        // the picked repo's own recipes, checks and branches; the base is reset, never carried over
        if (root !== projectRoot) void loadRecipes(root)
        void window.api.runtimes.detect(root).then((d) => live && setScripts(d.map((x) => x.name)), () => setScripts([]))
        void window.api.git.branches(root).then((b) => live && setBranches(b))
        void window.api.git.branch(root).then((b) => live && setBase(b ?? ''))
      })
    }, 250)
    return () => ((live = false), clearTimeout(t))
  }, [root, projectRoot])
  // the dialog can open without the Factory view ever having loaded the recipes; the sidebar lists the open
  // project's recipes again once the form closes (another repository may have been picked)
  useEffect(() => {
    void loadRecipes(projectRoot)
    return () => void loadRecipes(projectRoot)
  }, [projectRoot])
  const intentRef = useRef<HTMLTextAreaElement>(null)
  const entry = recipes.find((r) => r.recipe.name === pick) ?? recipes[0]
  // choices belong to one recipe's stages
  useEffect(() => {
    setOverrides({})
    const first = entry ? seedableNodes(entry.recipe)[0]?.id : undefined
    setSeed((s) => ({ ...s, node: s.source === 'mission' && s.mission && first ? first : '' }))
  }, [entry])

  const ready = !!entry && !!intent.trim() && isRepo && !(seed.node && !(seed.source === 'file' ? seed.file.trim() : seed.mission))
  const submit = async (): Promise<void> => {
    if (!ready || busy) return
    setBusy(true)
    setError('')
    try {
      await startRun({ recipe: entry.recipe, intent, root, base, branch: branch ?? suggested, issue, overrides, seed: seed.node ? await seedInput(root, seed) : undefined })
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const saveCustom = async (): Promise<void> => {
    if (!entry) return
    const p = await window.api.factory.saveRecipe(root, slugify(`${entry.recipe.name} custom`), recipeTextWithOverrides(entry.text, overrides, '(custom)'))
    await loadRecipes(root)
    void openInEditor(p)
  }
  const addToProject = async (): Promise<void> => {
    const b = BUILTIN_RECIPES.find((x) => x.slug === entry?.builtin)
    if (!b) return
    const p = await window.api.factory.saveRecipe(root, b.slug, b.text)
    await loadRecipes(root)
    void openInEditor(p)
  }

  return (
    <Modal title="New factory run" size="lg" onClose={onDone} busy={busy} initialFocus={intentRef} onSubmit={() => void submit()}>
    <div
      className="form factory-form"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.preventDefault(), void submit())
      }}
    >
      <label className="field">
        <span>Recipe</span>
        <select value={entry?.recipe.name ?? ''} onChange={(e) => setPick(e.target.value)}>
          {recipes.map((r, i) => (
            <option key={`${r.recipe.name}-${i}`} value={r.recipe.name}>
              {r.recipe.name}
              {r.builtin ? '' : ' (project)'}
            </option>
          ))}
        </select>
      </label>
      {entry && (
        <>
          {entry.recipe.description && <div className="hint">{entry.recipe.description}</div>}
          <div className="recipe-steps">
            {entry.recipe.nodes.map((n) => (
              <span key={n.id} className={`recipe-step ${n.kind}`} title={n.kind === 'agent' ? `${n.agents.join(', ') || 'default agent'}${n.skill ? `, skill ${n.skill}` : ''}` : n.kind === 'run' ? n.run.join(' && ') : 'pull request'}>
                {n.id}
                {n.approve ? ' ✓' : ''}
              </span>
            ))}
          </div>
          {scripts && runtimeNames(entry.recipe).length > 0 && (
            <div className="hint recipe-checks">
              Checks:{' '}
              {runtimeNames(entry.recipe).map((n) => (
                <span key={n} className={scripts.includes(n) ? 'found' : 'missing'} title={scripts.includes(n) ? 'Found in this project' : 'Not in this project: skipped'}>
                  {n}
                </span>
              ))}
            </div>
          )}
          <div className="hint recipe-links">
            <ShareLink text={() => recipeBundle(entry)} />
            {entry.builtin ? (
              <span className="link" onClick={() => void addToProject()}>
                <FilePlus2 size={11} /> Copy to .sldev/factory to edit it
              </span>
            ) : (
              <span className="link" onClick={() => entry.recipe.path && void openInEditor(entry.recipe.path)}>Edit recipe</span>
            )}
            <span className="link" onClick={() => (onDone(), openRecipes({ select: entry.recipe.name }))}>
              <BookOpen size={11} /> Open in Recipes
            </span>
          </div>
        </>
      )}
      {!isRepo && <div className="field-hint tone-error">The factory needs a git repository. Pick a folder inside one under "Start point and repository" below.</div>}
      {isRepo && <IssuePicker key={root} root={root} onPick={(i) => (setIntent(issueText(i)), setIssue(i.number))} />}
      <label className="field">
        <span>{seed.node ? 'What should the factory build? (a short title is enough)' : 'What should the factory build?'}</span>
        <textarea ref={intentRef} rows={4} value={intent} placeholder="Add a dark mode toggle to the settings page" onChange={(e) => setIntent(e.target.value)} />
      </label>
      <div className="field-row">
        <label className="field">
          <span>New branch</span>
          <input className="mono" value={branch ?? suggested} spellCheck={false} onChange={(e) => setBranch(e.target.value)} />
          <span className="field-hint">
            {branch === null ? 'From what you wrote: feature/, fix/, docs/… and a few key words.' : <span className="link" onClick={() => setBranch(null)}>Use the suggestion</span>}
          </span>
        </label>
        <label className="field">
          <span>Branch from</span>
          <select value={base} onChange={(e) => setBase(e.target.value)}>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
      </div>
      {entry && <StageChoices recipe={entry.recipe} root={root} value={overrides} onChange={setOverrides} onSave={() => void saveCustom()} />}
      <details className="stage-choices run-more" open={!isRepo || !!draft?.seedMission || root !== projectRoot}>
        <summary>
          Start point and repository
          {seed.node ? ` · from an existing ${seed.node}` : ''}
          {root !== projectRoot ? ` · ${root.split(/[\\/]/).pop()}` : ''}
        </summary>
        {entry && <SeedChoice recipe={entry.recipe} root={root} value={seed} onChange={setSeed} />}
        <FolderField label="Repository" value={root} onChange={setRoot} hint={isRepo ? 'The run gets its own worktree and branch here; your checkout is not touched.' : undefined} />
      </details>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="form-actions">
        <span className="form-note">Ctrl/Cmd+Enter starts</span>
        <button type="button" className="btn ghost" disabled={busy} onClick={onDone}>Cancel</button>
        <button type="submit" className="btn primary" disabled={busy || !ready}>
          <Factory size={14} /> {busy ? 'Starting…' : 'Start'}
        </button>
      </div>
    </div>
    </Modal>
  )
}

/** Copies the recipe bundle; the other person pastes it into Import recipe. */
function ShareLink({ text }: { text: () => string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard.writeText(text()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <span className="link" title="Copy the recipe and its agents to paste anywhere" onClick={copy}>
      {copied ? <Check size={11} /> : <Share2 size={11} />} {copied ? 'Copied' : 'Share'}
    </span>
  )
}

type Seed = { node: string; source: 'file' | 'mission'; file: string; mission: string }

/** A mission's result as a spec: the reviewer's handoff wins over the agent's report. */
const missionResult = (m: Mission): string => m.handoff?.trim() || m.report?.trim() || m.lastMessage?.trim() || ''

async function seedInput(root: string, s: Seed): Promise<{ node: string; text: string; from: string }> {
  if (s.source === 'file') return { node: s.node, text: await window.api.factory.readSeed(root, s.file.trim()), from: s.file.trim() }
  const m = missions.get().list.find((x) => x.id === s.mission)
  if (!m || !missionResult(m)) throw new Error('That mission has no plan or report to start from')
  return { node: s.node, text: `# ${m.title}\n\n${missionResult(m)}\n`, from: `the mission "${m.title}"` }
}

/** Agent and skill per stage, for this run; "save" writes them into a project copy of the recipe. */
function StageChoices({ recipe, root, value, onChange, onSave }: { recipe: Recipe; root: string; value: Record<string, StageOverride>; onChange: (v: Record<string, StageOverride>) => void; onSave: () => void }): React.JSX.Element | null {
  const profiles = useProfiles()
  const agents = useAgents()
  const [skills, setSkills] = useState<ClaudeAsset[]>([])
  useEffect(() => void window.api.claude.assets(root).then((a) => setSkills(a.filter((x) => x.kind !== 'agent')), () => setSkills([])), [root])
  const stages = recipe.nodes.filter((n) => n.kind === 'agent' && !isBakeoff(n))
  const bakeoffs = recipe.nodes.filter((n) => n.kind === 'agent' && isBakeoff(n))
  if (!stages.length && !bakeoffs.length) return null
  const set = (id: string, patch: StageOverride): void => onChange({ ...value, [id]: { ...value[id], ...patch } })
  const changed = Object.values(value).some((o) => o.agent || o.skill !== undefined || o.model !== undefined || o.effort !== undefined || o.mode !== undefined || o.interactive !== undefined || !!o.perAgent)
  const isInteractive = (n: RecipeNode): boolean => value[n.id]?.interactive ?? n.interactive
  const allLive = stages.every(isInteractive)
  const setAllLive = (on: boolean): void => onChange(Object.fromEntries(stages.map((n) => [n.id, { ...value[n.id], interactive: on }])))
  return (
    <>
    {/* outside the fold: how a stage runs decides whether you can watch it, and people missed it in there */}
    {stages.length > 0 && <label className="check stage-all">
      <input type="checkbox" checked={allLive} onChange={(e) => setAllLive(e.target.checked)} />
      <span>Run every agent stage interactively: you see the session, can answer and steer it, and click Done to move on. Off, stages run unattended in print mode and their terminal stays quiet until they end.</span>
    </label>}
    <details className="stage-choices">
      <summary>Stages: agent, model, skill and how each one runs{changed ? ' · changed' : ''}</summary>
      {stages.length > 1 && <AllStages stages={stages} value={value} onChange={onChange} />}
      {stages.map((n) => {
        const o = value[n.id] ?? {}
        // model, effort and mode are the CLI's own values: they follow the stage's agent
        const agent = agents.find((a) => a.id === specAgent(o.agent ?? n.agents[0])) ?? agents[0]
        const recipeOwn = !o.agent
        const model = o.model ?? (recipeOwn ? (n.model ?? '') : '')
        const effort = o.effort ?? (recipeOwn ? (n.effort ?? '') : '')
        const mode = o.mode ?? (recipeOwn ? (n.mode ?? '') : '')
        return (
          <div key={n.id} className="stage-card">
            <div className="stage-card-head">
              <b className="mono">{n.id}</b>
              <span className="grow" />
              <label className="check" title="A session you can type into; finishes with Done">
                <input type="checkbox" aria-label={`Interactive ${n.id}`} checked={isInteractive(n)} onChange={(e) => set(n.id, { interactive: e.target.checked })} />
                <span>Interactive</span>
              </label>
            </div>
            <div className="stage-card-grid">
              <label className="field">
                <span>Agent</span>
                <select aria-label={`Agent for ${n.id}`} value={o.agent ?? ''} onChange={(e) => set(n.id, { agent: e.target.value || undefined, model: undefined, effort: undefined, mode: undefined })}>
                  <option value="">{n.agents[0] ? `${n.agents[0]} (recipe)` : 'Default agent'}</option>
                  <optgroup label="Agents">{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
                  <optgroup label="Profiles">{profiles.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}</optgroup>
                </select>
              </label>
              <AgentFields key={agent?.id} agent={agent} label={n.id} value={{ model, effort, mode }} interactive={isInteractive(n)} onChange={(p) => set(n.id, p)} />
              <label className="field">
                <span>Skill</span>
                <select aria-label={`Skill for ${n.id}`} value={o.skill ?? n.skill ?? ''} onChange={(e) => set(n.id, { skill: e.target.value })}>
                  <option value="">None: the recipe prompt</option>
                  {n.skill && !skills.some((s) => s.name === n.skill) && <option value={n.skill}>{n.skill} (not found)</option>}
                  {skills.map((s) => (
                    <option key={s.path} value={s.plugin ? `${s.plugin}:${s.name}` : s.name}>
                      {s.invocation} ({s.source})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )
      })}
      {bakeoffs.map((n) => (
        <div key={n.id} className="stage-card">
          <div className="stage-card-head">
            <b className="mono">{n.id}</b>
            <span className="field-hint">Bake-off: every agent gets the same prompt in its own worktree; you keep the best version.</span>
          </div>
          {n.agents.map((spec) => {
            const agent = agents.find((a) => a.id === specAgent(spec)) ?? agents[0]
            const own = value[n.id]?.perAgent?.[spec] ?? n.perAgent?.[spec] ?? {}
            const v = { model: own.model ?? n.model ?? '', effort: own.effort ?? n.effort ?? '', mode: own.mode ?? n.mode ?? '' }
            return (
              <div key={spec} className="stage-card-grid">
                <label className="field">
                  <span>Agent</span>
                  <input value={spec} disabled aria-label={`Agent ${spec}`} />
                </label>
                <AgentFields key={agent?.id} agent={agent} label={`${n.id} ${spec}`} value={v} interactive={false} onChange={(p) => set(n.id, { perAgent: { ...value[n.id]?.perAgent, [spec]: { ...v, ...value[n.id]?.perAgent?.[spec], ...p } } })} />
              </div>
            )
          })}
        </div>
      ))}
      <div className="field-hint">
        Print-mode stages run unattended and show their answer when they end; interactive ones are a normal session you talk to. A skill replaces the stage prompt; the prompt becomes its arguments. Any agent can run a skill: Claude Code by name, the others read its SKILL.md.{' '}
        {changed && <span className="link" onClick={onSave}>Save as a project recipe</span>}
      </div>
    </details>
    </>
  )
}

/** One agent, model, effort and mode for every (non bake-off) stage at once; each stage can still differ below. */
function AllStages({ stages, value, onChange }: { stages: RecipeNode[]; value: Record<string, StageOverride>; onChange: (v: Record<string, StageOverride>) => void }): React.JSX.Element {
  const agents = useAgents()
  const profiles = useProfiles()
  // what every stage has in common; '' where they differ
  const same = <T,>(f: (n: RecipeNode) => T): T | '' => {
    const vals = stages.map(f)
    return vals.every((v) => v === vals[0]) ? vals[0] : ''
  }
  const chosen = same((n) => value[n.id]?.agent ?? '')
  const cli = same((n) => specAgent(value[n.id]?.agent ?? n.agents[0]))
  const agent = cli ? agents.find((a) => a.id === cli) : undefined
  const eff = (n: RecipeNode, k: 'model' | 'effort' | 'mode'): string => value[n.id]?.[k] ?? (value[n.id]?.agent ? '' : (n[k] ?? ''))
  const apply = (patch: StageOverride): void => onChange(Object.fromEntries(stages.map((n) => [n.id, { ...value[n.id], ...patch }])))
  return (
    <div className="stage-card all-stages">
      <div className="stage-card-head">
        <b>All stages</b>
        <span className="field-hint">Sets every stage below at once; change a single stage after that if it should differ.</span>
      </div>
      <div className="stage-card-grid">
        <label className="field">
          <span>Agent</span>
          <select aria-label="Agent for all stages" value={chosen} onChange={(e) => apply({ agent: e.target.value || undefined, model: undefined, effort: undefined, mode: undefined })}>
            <option value="">{chosen === '' && stages.some((n) => value[n.id]?.agent) ? 'Mixed' : "Each stage's recipe agent"}</option>
            <optgroup label="Agents">{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
            <optgroup label="Profiles">{profiles.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}</optgroup>
          </select>
        </label>
        {agent ? (
          <AgentFields key={agent.id} agent={agent} label="all stages" value={{ model: same((n) => eff(n, 'model')), effort: same((n) => eff(n, 'effort')), mode: same((n) => eff(n, 'mode')) }} interactive={false} onChange={apply} />
        ) : (
          <span className="field-hint all-stages-hint">The stages use different agents. Pick one agent here to set the model and effort for all of them.</span>
        )}
      </div>
    </div>
  )
}

/** Model, effort and approval mode for one agent, in that CLI's own values (what the mission form offers). */
export function AgentFields({ agent, label, value, interactive, onChange }: { agent: AgentDef | undefined; label: string; value: StageAgentChoice; interactive: boolean; onChange: (p: StageAgentChoice) => void }): React.JSX.Element {
  const models = agent?.models ?? []
  const typed = !!value.model && !models.includes(value.model)
  const [custom, setCustom] = useState(typed)
  return (
    <>
      <label className="field">
        <span>Model</span>
        {models.length && !custom ? (
          <select aria-label={`Model for ${label}`} value={value.model ?? ''} onChange={(e) => (e.target.value === '\u0000' ? setCustom(true) : onChange({ model: e.target.value }))}>
            <option value="">Default</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value={'\u0000'}>Other…</option>
          </select>
        ) : (
          <input aria-label={`Model for ${label}`} value={value.model ?? ''} placeholder={agent?.modelPlaceholder ?? 'default'} autoFocus={custom && !typed} onChange={(e) => onChange({ model: e.target.value })} />
        )}
      </label>
      <label className="field">
        <span>Effort</span>
        {agent && agent.efforts.length > 0 ? (
          <select aria-label={`Effort for ${label}`} value={value.effort ?? ''} onChange={(e) => onChange({ effort: e.target.value })}>
            <option value="">Default</option>
            {agent.efforts.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        ) : (
          <select disabled aria-label={`Effort for ${label}`} title={`${agent?.name ?? 'This agent'} has no effort setting`}><option>Not available</option></select>
        )}
      </label>
      <label className="field">
        <span>Approval mode</span>
        {agent && agent.modes.length > 0 ? (
          <select aria-label={`Approval mode for ${label}`} value={value.mode ?? ''} onChange={(e) => onChange({ mode: e.target.value })}>
            <option value="">{interactive ? 'Default' : 'Unattended (Settings)'}</option>
            {agent.modes.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        ) : (
          <select disabled aria-label={`Approval mode for ${label}`}><option>Not available</option></select>
        )}
      </label>
    </>
  )
}

/** Skip the first stage when its output already exists: a spec you wrote, or a plan from a mission. */
function SeedChoice({ recipe, root, value, onChange }: { recipe: Recipe; root: string; value: Seed; onChange: (s: Seed) => void }): React.JSX.Element | null {
  const list = useStore(missions, (s) => s.list)
  const done = useMemo(() => list.filter((m) => m.root === root && !m.factory && missionResult(m)).slice(0, 20), [list, root])
  const nodes = seedableNodes(recipe)
  if (!nodes.length) return null
  return (
    <>
      <label className="field">
        <span>Start from</span>
        <select value={value.node} onChange={(e) => onChange({ ...value, node: e.target.value })}>
          <option value="">The first stage</option>
          {nodes.map((n) => <option key={n.id} value={n.id}>An existing {n.id} (skip that stage)</option>)}
        </select>
      </label>
      {value.node && (
        <>
          <div className="seg sm" role="radiogroup" aria-label="Where it comes from">
            <button type="button" role="radio" aria-checked={value.source === 'file'} className={value.source === 'file' ? 'on' : ''} onClick={() => onChange({ ...value, source: 'file' })}>A file</button>
            <button type="button" role="radio" aria-checked={value.source === 'mission'} className={value.source === 'mission' ? 'on' : ''} onClick={() => onChange({ ...value, source: 'mission' })}>A mission's result</button>
          </div>
          {value.source === 'file' ? (
            <label className="field">
              <input value={value.file} placeholder="docs/specs/dark-mode.md" aria-label="File in the repository" onChange={(e) => onChange({ ...value, file: e.target.value })} />
              <span className="field-hint">Relative to the repository. Later stages read it wherever the recipe says {`{${value.node}.out}`}.</span>
            </label>
          ) : (
            <label className="field">
              <select value={value.mission} aria-label="Mission" onChange={(e) => onChange({ ...value, mission: e.target.value })}>
                <option value="">Pick a finished mission…</option>
                {done.map((m) => <option key={m.id} value={m.id}>{m.kind && m.kind.id !== 'build' ? `${m.kind.name}: ` : ''}{m.title}</option>)}
              </select>
              <span className="field-hint">{done.length ? 'Its handoff notes, or else its final report, become the stage output.' : 'No mission in this project has a report yet. Plan and Research missions end with one.'}</span>
            </label>
          )}
        </>
      )}
    </>
  )
}
