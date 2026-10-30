import { useEffect, useMemo, useState } from 'react'
import type { ClaudeAsset, Mission } from '@shared/types'
import { missions } from '../state/missions'
import { useProfiles } from '../state/profiles'
import { useAgents } from '../state/agents'
import { showView } from '../lib/commands'
import { slugify } from '../lib/agents'
import { Check, Factory, FilePlus2, Import, Plus, Share2 } from 'lucide-react'
import { isBakeoff, issueText, recipeTextWithOverrides, runtimeNames, seedableNodes, type FactoryRun, type Recipe, type StageOverride } from '@shared/factory'
import { IssuePicker } from './IssuePicker'
import { BUILTIN_RECIPES } from '@shared/recipes'
import { openInEditor } from '../lib/actions'
import { factory, importRecipe, loadRecipes, openPipeline, recipeBundle, startRun } from '../state/factory'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { showContextMenu } from './ContextMenu'
import { ViewShell } from './RuntimesView'
import { StatusPill } from './StatusDot'
import { runSignal } from '@shared/status'
import { removeRunFlow } from '../lib/removals'
import { FolderField } from './FolderField'

/** What the run form starts with, e.g. a plan from a finished mission. */
export interface RunDraft {
  intent?: string
  seedMission?: string
}

/** Shows the Factory with the new-run form open, optionally starting from a mission's plan. */
export function openNewRun(draft?: RunDraft): void {
  showView('factory')
  setTimeout(() => window.dispatchEvent(new CustomEvent('sldev:new-run', { detail: draft })), 50)
}

export function FactoryView(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const runs = useStore(factory, (s) => s.runs)
  const errors = useStore(factory, (s) => s.recipeErrors)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<RunDraft | undefined>()
  useEffect(() => {
    const open = (e: Event): void => {
      setDraft((e as CustomEvent<RunDraft | undefined>).detail)
      setCreating(true)
    }
    window.addEventListener('sldev:new-run', open)
    return () => window.removeEventListener('sldev:new-run', open)
  }, [])
  const [importing, setImporting] = useState(false)
  useEffect(() => void loadRecipes(root), [root])
  const mine = useMemo(() => runs.filter((r) => r.root === root), [runs, root])
  /** unfinished runs in another repository (picked in the run form) stay visible */
  const elsewhere = useMemo(() => runs.filter((r) => r.root !== root && (r.status === 'running' || r.status === 'paused')), [runs, root])

  return (
    <ViewShell
      title="Factory"
      actions={
        <button className="icon-btn" title="New run" aria-label="New run" onClick={() => setCreating(true)}>
          <Plus size={14} />
        </button>
      }
    >
      <div className="view-scroll">
        {!root ? (
          <div className="empty-state"><p>Open a git project to run factory recipes in it.</p></div>
        ) : creating ? (
          <NewRunForm key={draft?.seedMission ?? ''} root={root} draft={draft} onDone={() => (setCreating(false), setDraft(undefined))} />
        ) : importing ? (
          <ImportForm root={root} onDone={() => setImporting(false)} />
        ) : (
          <div className="view-footer">
            <button className="btn primary full" onClick={() => setCreating(true)}>
              <Factory size={14} /> New factory run
            </button>
            <button className="btn full" onClick={() => setImporting(true)}>
              <Import size={14} /> Import recipe
            </button>
          </div>
        )}
        {Object.entries(errors).map(([path, error]) => (
          <div key={path} className="muted-note bad" title={path}>
            {path.split('/').pop()}: {error}
          </div>
        ))}
        {mine.length > 0 && <div className="section-label pad">Runs</div>}
        {mine.map((r) => <RunRow key={r.id} run={r} />)}
        {elsewhere.length > 0 && <div className="section-label pad">Other repositories · {elsewhere.length}</div>}
        {elsewhere.map((r) => <RunRow key={r.id} run={r} />)}
        {root && !mine.length && !creating && (
          <div className="muted-note">
            A recipe is a graph of steps: agents write specs and code, commands check the result, you approve the steps that matter, and the last step opens a pull request. Each run works in its own branch and worktree.
          </div>
        )}
      </div>
    </ViewShell>
  )
}

function RunRow({ run }: { run: FactoryRun }): React.JSX.Element {
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
  const [pick, setPick] = useState(0)
  const [intent, setIntent] = useState(draft?.intent ?? '')
  /** per agent stage: another agent or profile, or a skill instead of the recipe prompt */
  const [overrides, setOverrides] = useState<Record<string, StageOverride>>({})
  /** start past a stage with an output that already exists */
  const [seed, setSeed] = useState<{ node: string; source: 'file' | 'mission'; file: string; mission: string }>(() => ({ node: '', source: draft?.seedMission ? 'mission' : 'file', file: '', mission: draft?.seedMission ?? '' }))
  const [branches, setBranches] = useState<string[]>([])
  const [base, setBase] = useState('')
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
  // the sidebar lists the open project's recipes again once the form closes
  useEffect(() => () => void loadRecipes(projectRoot), [projectRoot])
  const entry = recipes[pick]
  // choices belong to one recipe's stages
  useEffect(() => {
    setOverrides({})
    const first = entry ? seedableNodes(entry.recipe)[0]?.id : undefined
    setSeed((s) => ({ ...s, node: s.source === 'mission' && s.mission && first ? first : '' }))
  }, [entry])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!entry || !intent.trim()) return
    setBusy(true)
    setError('')
    try {
      await startRun({ recipe: entry.recipe, intent, root, base, issue, overrides, seed: seed.node ? await seedInput(root, seed) : undefined })
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
    <form className="form inline-form factory-form" onSubmit={(e) => void submit(e)}>
      <label className="field">
        <span>Recipe</span>
        <select value={pick} onChange={(e) => setPick(Number(e.target.value))}>
          {recipes.map((r, i) => (
            <option key={`${r.recipe.name}-${i}`} value={i}>
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
          <StageChoices recipe={entry.recipe} root={root} value={overrides} onChange={setOverrides} onSave={() => void saveCustom()} />
          <SeedChoice recipe={entry.recipe} root={root} value={seed} onChange={setSeed} />
          <div className="hint recipe-links">
            <ShareLink text={() => recipeBundle(entry)} />
            {entry.builtin ? (
              <span className="link" onClick={() => void addToProject()}>
                <FilePlus2 size={11} /> Copy to .sldev/factory to edit it
              </span>
            ) : (
              <span className="link" onClick={() => entry.recipe.path && void openInEditor(entry.recipe.path)}>Edit recipe</span>
            )}
          </div>
        </>
      )}
      <FolderField label="Repository" value={root} onChange={setRoot} hint={isRepo ? 'The run gets its own worktree and branch here; your checkout is not touched.' : undefined} />
      {!isRepo && <div className="field-hint tone-error">The factory needs a git repository. Pick a folder inside one.</div>}
      {isRepo && <IssuePicker key={root} root={root} onPick={(i) => (setIntent(issueText(i)), setIssue(i.number))} />}
      <label className="field">
        <span>{seed.node ? 'What should the factory build? (a short title is enough)' : 'What should the factory build?'}</span>
        <textarea rows={4} value={intent} autoFocus placeholder="Add a dark mode toggle to the settings page" onChange={(e) => setIntent(e.target.value)} />
      </label>
      <label className="field">
        <span>Branch from</span>
        <select value={base} onChange={(e) => setBase(e.target.value)}>
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn primary" disabled={busy || !intent.trim() || !entry || !isRepo || (!!seed.node && !(seed.source === 'file' ? seed.file.trim() : seed.mission))}>
          <Factory size={14} /> {busy ? 'Starting…' : 'Start'}
        </button>
      </div>
    </form>
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

function ImportForm({ root, onDone }: { root: string; onDone: () => void }): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await importRecipe(root, text)
      setResult(
        [`Added "${r.name}" to .sldev/factory.`, r.added.length ? `New agents: ${r.added.join(', ')}.` : '', r.kept.length ? `Kept your own ${r.kept.join(', ')}.` : '']
          .filter(Boolean)
          .join(' ')
      )
      setText('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="form inline-form import-form" onSubmit={(e) => void submit(e)}>
      <label className="field">
        <span>Paste a shared recipe (or any recipe YAML)</span>
        <textarea rows={8} value={text} autoFocus className="mono" placeholder="# sldev-io recipe …" onChange={(e) => setText(e.target.value)} />
      </label>
      {error && <div className="bad">{error}</div>}
      {result && <div className="ok">{result}</div>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>{result ? 'Done' : 'Cancel'}</button>
        <button type="submit" className="btn primary" disabled={busy || !text.trim()}>
          <Import size={14} /> {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
    </form>
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
  if (!stages.length) return null
  const set = (id: string, patch: StageOverride): void => onChange({ ...value, [id]: { ...value[id], ...patch } })
  const changed = Object.values(value).some((o) => o.agent || o.skill !== undefined)
  return (
    <details className="stage-choices" open={changed || undefined}>
      <summary>Agents and skills per stage{changed ? ' · changed' : ''}</summary>
      {stages.map((n) => {
        const o = value[n.id] ?? {}
        return (
          <div key={n.id} className="stage-choice">
            <span className="stage-id">{n.id}</span>
            <select aria-label={`Agent for ${n.id}`} value={o.agent ?? ''} onChange={(e) => set(n.id, { agent: e.target.value || undefined })}>
              <option value="">{n.agents[0] ? `Recipe: ${n.agents[0]}` : 'Default agent'}</option>
              <optgroup label="Profiles">{profiles.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}</optgroup>
              <optgroup label="Agents">{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
            </select>
            <select aria-label={`Skill for ${n.id}`} value={o.skill ?? n.skill ?? ''} onChange={(e) => set(n.id, { skill: e.target.value })}>
              <option value="">Recipe prompt</option>
              {n.skill && !skills.some((s) => s.name === n.skill) && <option value={n.skill}>{n.skill} (not found)</option>}
              {skills.map((s) => (
                <option key={s.path} value={s.plugin ? `${s.plugin}:${s.name}` : s.name}>
                  {s.invocation} ({s.source})
                </option>
              ))}
            </select>
          </div>
        )
      })}
      <div className="field-hint">
        A skill replaces the stage prompt; the prompt becomes its arguments. Any agent can run a skill: Claude Code by name, the others read its SKILL.md.{' '}
        {changed && <span className="link" onClick={onSave}>Save as a project recipe</span>}
      </div>
    </details>
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
