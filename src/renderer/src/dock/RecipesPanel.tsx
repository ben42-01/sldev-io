import { useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Bot,
  Check,
  Copy,
  Download,
  Factory,
  FileCode2,
  FileUp,
  GitPullRequest,
  Import,
  ListChecks,
  Pencil,
  Plus,
  RotateCcw,
  Share2,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react'
import type { ClaudeAsset } from '@shared/types'
import { layout, type Recipe, type RecipeNode } from '@shared/factory'
import {
  checkDraft,
  draftFromRecipe,
  draftToYaml,
  emptyDraft,
  emptyStage,
  freeId,
  placeholdersFor,
  recipeSlug,
  type DraftStage,
  type RecipeDraft,
  type StageKind
} from '@shared/recipeDraft'
import { AgentFields, openNewRun } from '../components/FactoryView'
import { Modal, confirmAction } from '../components/Modal'
import { Empty } from '../components/States'
import { openInEditor } from '../lib/actions'
import { useAgents } from '../state/agents'
import { factory, importRecipe, loadRecipes, previewImport, recipeBundle, specAgent, type ImportPreview, type RecipeEntry } from '../state/factory'
import { useProfiles } from '../state/profiles'
import { createStore, useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { showNotice } from '../lib/removals'
import { openPanel } from './dockApi'

/**
 * Recipes: the library of the project's and the built-in recipes, a step-by-step builder that writes
 * the YAML for you, and import/export to share them. Recipes stay plain files in .sldev/factory.
 */

export function openRecipes(o: { select?: string; mode?: 'new' | 'import' } = {}): void {
  if (!workspace.get().rootFolder) return void showNotice('No folder open', 'Open a git project to keep recipes in it.')
  openPanel('recipes', 'recipes', 'Recipes', { ...o, at: Date.now() })
  if (o.mode === 'import') openImport()
}

// ── import dialog (also opened from the sidebar and the command palette) ──

const importer = createStore<{ open: boolean; n: number }>({ open: false, n: 0 })
/** set by the panel: what to show after an import */
let afterImport: ((name: string) => void) | undefined

export function openImport(): void {
  if (!workspace.get().rootFolder) return void showNotice('No folder open', 'Open a git project to import recipes into it.')
  importer.set((s) => ({ open: true, n: s.n + 1 }))
}

export function ImportRecipeHost(): React.JSX.Element | null {
  const s = useStore(importer, (x) => x)
  const root = useStore(workspace, (w) => w.rootFolder)
  if (!s.open || !root) return null
  return <ImportDialog key={s.n} root={root} onDone={() => importer.set({ open: false, n: s.n })} />
}

function ImportDialog({ root, onDone }: { root: string; onDone: () => void }): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ name: string; message: string } | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  // project recipes must be known to spot a name that's taken
  useEffect(() => void loadRecipes(root), [root])
  const preview = useMemo<ImportPreview | { error: string } | null>(() => (text.trim() ? previewImport(text) : null), [text])
  const fromFile = async (): Promise<void> => {
    setError('')
    try {
      const t = await window.api.factory.importRecipeFile()
      if (t !== null) setText(t)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const fromClipboard = async (): Promise<void> => {
    const t = await navigator.clipboard.readText().catch(() => '')
    if (t.trim()) setText(t)
    else setError('The clipboard is empty.')
  }
  const submit = async (): Promise<void> => {
    if (!preview || 'error' in preview || busy) return
    setBusy(true)
    setError('')
    try {
      const r = await importRecipe(root, text)
      const message = [
        r.duplicate ? `You already have "${r.name}"; nothing new to add.` : `Added "${r.name}" to .sldev/factory.`,
        r.added.length ? `New agents: ${r.added.join(', ')}.` : '',
        r.kept.length ? `Kept your own ${r.kept.join(', ')}.` : ''
      ]
        .filter(Boolean)
        .join(' ')
      setDone({ name: r.name, message })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done)
    return (
      <Modal
        title="Recipe imported"
        size="sm"
        onClose={onDone}
        onSubmit={() => (onDone(), afterImport?.(done.name), openRecipes({ select: done.name }))}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={onDone}>Close</button>
            <button type="button" className="btn" onClick={() => (onDone(), openNewRun({ recipe: done.name }))}>
              <Factory size={13} /> Run it
            </button>
            <button type="submit" className="btn primary" data-autofocus>Show recipe</button>
          </>
        }
      >
        <p className="import-ok ok">{done.message}</p>
      </Modal>
    )

  return (
    <Modal
      title="Import a recipe"
      size="lg"
      onClose={onDone}
      busy={busy}
      initialFocus={ref}
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !preview || 'error' in preview}>
            <Import size={14} /> {busy ? 'Importing…' : preview && !('error' in preview) && preview.duplicate ? 'Import agents only' : 'Import'}
          </button>
        </>
      }
    >
      <div className="form import-form">
        <div className="import-sources">
          <button type="button" className="btn sm" onClick={() => void fromFile()}><FileUp size={13} /> From a file…</button>
          <button type="button" className="btn sm" onClick={() => void fromClipboard()}><Copy size={13} /> Paste from clipboard</button>
        </div>
        <label className="field">
          <span>Or paste it here</span>
          <textarea ref={ref} rows={9} value={text} className="mono" spellCheck={false} placeholder={'# sldev-io recipe "…"\nsldev: sldev-recipe/1\n…\n\nor any recipe YAML (name: …, stages: …)'} onChange={(e) => setText(e.target.value)} />
          <span className="field-hint">What someone shared with Recipes → Share, an exported .yml file, or a recipe file from another project.</span>
        </label>
        {preview && 'error' in preview && <div className="form-error bad" role="alert">{preview.error}</div>}
        {preview && !('error' in preview) && (
          <div className="import-preview">
            <div className="import-preview-head">
              <b>{preview.recipe.name}</b>
              <span className="muted">{preview.recipe.nodes.length} stage{preview.recipe.nodes.length === 1 ? '' : 's'}</span>
            </div>
            {preview.recipe.description && <div className="muted small">{preview.recipe.description}</div>}
            <FlowPreview recipe={preview.recipe} />
            <ul className="import-notes">
              {preview.duplicate && <li>This project already has this exact recipe.</li>}
              {!preview.duplicate && preview.name !== preview.recipe.name && <li>A recipe called "{preview.recipe.name}" exists here, so this one is saved as "{preview.name}".</li>}
              {preview.replacesBuiltin && preview.name === preview.recipe.name && <li>Replaces the built-in "{preview.recipe.name}" in this project.</li>}
              {preview.newAgents.length > 0 && <li>Adds agents to .sldev/agents: {preview.newAgents.join(', ')}</li>}
              {preview.keptAgents.length > 0 && <li>Keeps your own {preview.keptAgents.join(', ')} (same name)</li>}
              {preview.missing.length > 0 && <li className="tone-attention">Names agents you don't have: {preview.missing.join(', ')}. Pick others in the builder or the run form.</li>}
            </ul>
          </div>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
    </Modal>
  )
}

// ── the panel ────────────────────────────────────────────────────

type Mode = { kind: 'browse' } | { kind: 'edit'; draft: RecipeDraft; path?: string; original: string; builtin?: boolean; started: number }

export function RecipesPanel({ params }: IDockviewPanelProps<{ select?: string; mode?: 'new' | 'import'; at?: number }>): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const recipes = useStore(factory, (s) => s.recipes)
  const errors = useStore(factory, (s) => s.recipeErrors)
  const [selected, setSelected] = useState(params.select ?? '')
  const [mode, setMode] = useState<Mode>({ kind: 'browse' })
  const dirty = mode.kind === 'edit' && draftToYaml(mode.draft) !== mode.original

  useEffect(() => void loadRecipes(root), [root])
  useEffect(() => {
    afterImport = (name) => (setMode({ kind: 'browse' }), setSelected(name))
    return () => void (afterImport = undefined)
  }, [])
  useEffect(() => {
    if (params.select) setSelected(params.select)
    if (params.mode === 'new') startNew()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.at])

  const entry = recipes.find((r) => r.recipe.name === selected) ?? recipes[0]
  const own = recipes.filter((r) => !r.builtin)
  const builtins = recipes.filter((r) => r.builtin)

  /** leaving the builder with changes asks first */
  const leave = async (): Promise<boolean> => {
    if (!dirty) return true
    return !!(await confirmAction({ title: 'Discard your changes?', message: 'The recipe you are building has changes that are not saved.', confirmLabel: 'Discard', danger: true }))
  }
  const startNew = (): void => {
    const d = emptyDraft()
    setMode({ kind: 'edit', draft: d, original: draftToYaml(d), started: Date.now() })
  }
  const edit = (e: RecipeEntry): void => {
    const d = draftFromRecipe(e.recipe)
    setMode({ kind: 'edit', draft: d, path: e.recipe.path, original: draftToYaml(d), builtin: !!e.builtin, started: Date.now() })
  }
  const duplicate = (e: RecipeEntry): void => {
    const d = draftFromRecipe(e.recipe)
    d.name = `${e.recipe.name} copy`
    setMode({ kind: 'edit', draft: d, original: '', started: Date.now() })
  }
  const pick = async (name: string): Promise<void> => {
    if (mode.kind === 'edit' && !(await leave())) return
    setMode({ kind: 'browse' })
    setSelected(name)
  }

  if (!root) return <div className="panel-page"><Empty title="No project open" hint="Open a git project to keep recipes in it." /></div>

  return (
    <div className="recipes">
      <header className="mc-head recipes-head">
        <div className="board-icon aurora"><BookOpen size={17} /></div>
        <div className="board-title">
          <h2>Recipes</h2>
          <div className="muted small">Step-by-step plans the Software Factory runs: agents write, checks verify, you approve, a pull request comes out.</div>
        </div>
        <span className="grow" />
        <div className="recipes-head-actions">
          <button className="btn sm" onClick={() => openImport()}><Import size={13} /> Import</button>
          <button className="btn sm primary" onClick={() => void leave().then((ok) => ok && startNew())}><Plus size={13} /> New recipe</button>
        </div>
      </header>
      <div className={`recipes-body${mode.kind === 'edit' ? ' editing' : ''}`}>
        {mode.kind !== 'edit' && <nav className="recipes-list" aria-label="Recipes">
          <div className="section-label">In this project{own.length ? ` · ${own.length}` : ''}</div>
          {own.length === 0 && <div className="muted-note">None yet. Build one, import one, or customize a built-in; they are saved in .sldev/factory so you can commit and share them.</div>}
          {own.map((r) => <RecipeItem key={r.recipe.path ?? r.recipe.name} entry={r} on={mode.kind === 'browse' && entry === r} onClick={() => void pick(r.recipe.name)} />)}
          {Object.entries(errors).map(([path, error]) => (
            <button key={path} className="recipe-item broken" title={error} onClick={() => void openInEditor(path)}>
              <span className="recipe-item-name">{path.split(/[\\/]/).pop()}</span>
              <span className="recipe-item-meta tone-error">Can't be read: {error}</span>
            </button>
          ))}
          <div className="section-label">Built-in</div>
          {builtins.map((r) => <RecipeItem key={r.builtin} entry={r} on={mode.kind === 'browse' && entry === r} onClick={() => void pick(r.recipe.name)} />)}
        </nav>}
        <main className="recipes-main">
          {mode.kind === 'edit' ? (
            <Builder
              key={mode.started}
              root={root}
              mode={mode}
              others={recipes.filter((r) => !r.builtin && r.recipe.path !== mode.path).map((r) => r.recipe.name)}
              onChange={(draft) => setMode({ ...mode, draft })}
              onCancel={() => void leave().then((ok) => ok && setMode({ kind: 'browse' }))}
              onSaved={(name) => (setMode({ kind: 'browse' }), setSelected(name))}
            />
          ) : entry ? (
            <RecipeDetail key={entry.recipe.path ?? entry.builtin} entry={entry} onEdit={() => edit(entry)} onDuplicate={() => duplicate(entry)} />
          ) : (
            <Empty title="No recipes" hint="Build your first one." />
          )}
        </main>
      </div>
    </div>
  )
}

function RecipeItem({ entry, on, onClick }: { entry: RecipeEntry; on: boolean; onClick: () => void }): React.JSX.Element {
  const r = entry.recipe
  const agents = r.nodes.filter((n) => n.kind === 'agent').length
  const checks = r.nodes.filter((n) => n.kind === 'run').length
  return (
    <button className={`recipe-item${on ? ' on' : ''}`} aria-current={on ? 'true' : undefined} onClick={onClick}>
      <span className="recipe-item-name">{r.name}</span>
      <span className="recipe-item-meta">
        {r.nodes.length} stages · {agents} agent{agents === 1 ? '' : 's'}
        {checks ? ` · ${checks} check${checks === 1 ? '' : 's'}` : ''}
      </span>
    </button>
  )
}

// ── a recipe at a glance ─────────────────────────────────────────

const KIND: Record<StageKind, { label: string; icon: React.ComponentType<{ size?: number }> }> = {
  agent: { label: 'Agent', icon: Bot },
  run: { label: 'Check', icon: ListChecks },
  pr: { label: 'Pull request', icon: GitPullRequest }
}

/** Stages in columns by what they wait for: parallel stages stack, the flow reads left to right. */
export function FlowPreview({ recipe, active, onPick }: { recipe: Recipe; active?: string; onPick?: (id: string) => void }): React.JSX.Element {
  const pos = layout(recipe)
  const cols: RecipeNode[][] = []
  for (const n of recipe.nodes) (cols[pos.get(n.id)!.col] ??= []).push(n)
  return (
    <div className="flow" role="list" aria-label="Stages in order">
      {cols.map((col, i) => (
        <div key={i} className="flow-col-wrap">
          {i > 0 && <ArrowRight size={13} className="flow-arrow" aria-hidden />}
          <div className="flow-col">
            {col.map((n) => {
              const Icon = KIND[n.kind].icon
              return (
                <button
                  key={n.id}
                  type="button"
                  role="listitem"
                  className={`flow-node ${n.kind}${active === n.id ? ' on' : ''}`}
                  disabled={!onPick}
                  title={stageSummary(n)}
                  onClick={() => onPick?.(n.id)}
                >
                  <Icon size={12} />
                  <span className="mono">{n.id}</span>
                  {n.approve && <ShieldCheck size={11} aria-label="you approve" />}
                  {n.onFail && <RotateCcw size={11} aria-label={`retries ${n.onFail.retry.join(', ')}`} />}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function stageSummary(n: RecipeNode): string {
  if (n.kind === 'run') return `Runs ${n.run.join(' && ')}${n.onFail ? `; on failure back to ${n.onFail.retry.join(', ')} (up to ${n.onFail.max}×)` : ''}`
  if (n.kind === 'pr') return `Opens a pull request: ${n.pr?.title}`
  const who = n.agents.length > 1 ? `Bake-off: ${n.agents.join(', ')}` : (n.agents[0] ?? 'Default agent')
  return `${who}${n.skill ? ` · skill ${n.skill}` : ''}${n.interactive ? ' · interactive' : ''}${n.approve ? ' · you approve' : ''}`
}

function RecipeDetail({ entry, onEdit, onDuplicate }: { entry: RecipeEntry; onEdit: () => void; onDuplicate: () => void }): React.JSX.Element {
  const r = entry.recipe
  const root = useStore(workspace, (w) => w.rootFolder)!
  const [copied, setCopied] = useState(false)
  const share = (): void =>
    void navigator.clipboard.writeText(recipeBundle(entry)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  const exportFile = async (): Promise<void> => {
    const p = await window.api.factory.exportRecipe(`${recipeSlug(r.name)}.sldev-recipe.yml`, recipeBundle(entry))
    if (p) void showNotice('Recipe exported', <>Saved to <span className="mono">{p}</span>. Anyone with sldev-io can add it with Recipes → Import → From a file.</>)
  }
  const remove = async (): Promise<void> => {
    if (!r.path) return
    const ok = await confirmAction({
      title: `Delete "${r.name}"?`,
      message: 'The recipe file goes to your trash, so you can still get it back.',
      removes: [<span key="f" className="mono">{r.path.split(/[\\/]/).slice(-3).join('/')}</span>],
      keeps: ['Runs that used it, their branches and worktrees', 'The agents it names'],
      confirmLabel: 'Delete recipe',
      danger: true
    })
    if (!ok) return
    await window.api.factory.deleteRecipe(r.path)
    await loadRecipes(root)
  }
  return (
    <div className="recipe-detail">
      <div className="recipe-detail-head">
        <div>
          <h3>{r.name}</h3>
          <div className="muted small">{entry.builtin ? 'Built-in recipe' : <span className="mono">{r.path?.split(/[\\/]/).slice(-3).join('/')}</span>}</div>
        </div>
        <span className="grow" />
        <button className="btn primary" onClick={() => openNewRun({ recipe: r.name })}><Factory size={14} /> Run</button>
      </div>
      {r.description && <p className="recipe-detail-desc">{r.description}</p>}
      <FlowPreview recipe={r} />
      <ol className="recipe-stage-list">
        {r.nodes.map((n) => {
          const Icon = KIND[n.kind].icon
          return (
            <li key={n.id} className={`recipe-stage ${n.kind}`}>
              <div className="recipe-stage-head">
                <Icon size={13} />
                <b className="mono">{n.id}</b>
                <span className="muted small">{KIND[n.kind].label}</span>
                {n.needs.length > 1 && <span className="muted small">after {n.needs.join(' + ')}</span>}
                <span className="grow" />
                {n.approve && <span className="chip"><ShieldCheck size={11} /> You approve</span>}
                {n.interactive && <span className="chip">Interactive</span>}
              </div>
              <div className="recipe-stage-body">
                {n.kind === 'agent' && (
                  <>
                    <div className="muted small">
                      {n.agents.length > 1 ? `Bake-off: ${n.agents.join(', ')}` : (n.agents[0] ?? 'Your default agent')}
                      {n.skill ? ` · runs the skill ${n.skill}` : ''}
                      {n.model ? ` · ${n.model}` : ''}
                    </div>
                    {!(n.skill && n.prompt === '{intent}') && <pre className="recipe-prompt">{n.prompt}</pre>}
                  </>
                )}
                {n.kind === 'run' && (
                  <div className="muted small">
                    Runs <span className="mono">{n.run.join(', ')}</span>
                    {n.onFail ? `. If it fails, ${n.onFail.retry.join(' and ')} tries again (up to ${n.onFail.max}×).` : '. If it fails, the run stops.'}
                  </div>
                )}
                {n.kind === 'pr' && <div className="muted small">Opens a pull request titled <span className="mono">{n.pr?.title}</span> when you click it; nothing is pushed before.</div>}
              </div>
            </li>
          )
        })}
      </ol>
      <div className="recipe-actions">
        <button className="btn sm" onClick={onEdit}><Pencil size={13} /> {entry.builtin ? 'Customize' : 'Edit'}</button>
        <button className="btn sm" onClick={onDuplicate}><Copy size={13} /> Duplicate</button>
        <button className="btn sm" title="Copies the recipe and its custom agents as text to paste in chat, an issue or a gist" onClick={share}>
          {copied ? <Check size={13} /> : <Share2 size={13} />} {copied ? 'Copied' : 'Copy to share'}
        </button>
        <button className="btn sm" onClick={() => void exportFile()}><Download size={13} /> Export file…</button>
        {r.path && <button className="btn sm ghost" onClick={() => void openInEditor(r.path!)}><FileCode2 size={13} /> Open YAML</button>}
        {r.path && <button className="btn sm ghost danger" onClick={() => void remove()}><Trash2 size={13} /> Delete…</button>}
      </div>
      {entry.builtin && <div className="field-hint">Customize saves a copy in this project's .sldev/factory; under the same name it replaces the built-in here.</div>}
    </div>
  )
}

// ── the builder ──────────────────────────────────────────────────

const STEPS = ['Basics', 'Stages', 'Review & save'] as const

function Builder({
  root,
  mode,
  others,
  onChange,
  onCancel,
  onSaved
}: {
  root: string
  mode: Extract<Mode, { kind: 'edit' }>
  others: string[]
  onChange: (d: RecipeDraft) => void
  onCancel: () => void
  onSaved: (name: string) => void
}): React.JSX.Element {
  const d = mode.draft
  const isNew = !mode.path && !mode.builtin && !d.stages.length
  const [step, setStep] = useState(0)
  const [active, setActive] = useState(d.stages[0]?.key ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const check = useMemo(() => checkDraft(d), [d])
  const taken = others.some((n) => n.toLowerCase() === d.name.trim().toLowerCase())
  const problem = !d.name.trim() ? 'Give the recipe a name' : taken ? `Another recipe in this project is called "${d.name.trim()}"` : check.error
  const set = (patch: Partial<RecipeDraft>): void => onChange({ ...d, ...patch })

  const save = async (): Promise<void> => {
    if (problem || busy) return
    setBusy(true)
    setError('')
    try {
      const text = draftToYaml(d)
      if (mode.path) await window.api.factory.writeRecipe(mode.path, text)
      else await window.api.factory.saveRecipe(root, recipeSlug(d.name), text)
      await loadRecipes(root)
      onSaved(d.name.trim())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="builder">
      <div className="builder-steps" role="tablist" aria-label="Recipe builder steps">
        {STEPS.map((s, i) => (
          <button key={s} type="button" role="tab" aria-selected={step === i} className={`builder-step${step === i ? ' on' : ''}${i < step ? ' past' : ''}`} onClick={() => setStep(i)}>
            <span className="builder-step-n">{i < step ? <Check size={11} /> : i + 1}</span> {s}
          </button>
        ))}
        <span className="grow" />
        <span className="muted small">{mode.path ? `Editing ${d.name || 'recipe'}` : mode.builtin ? 'Customizing a built-in' : 'New recipe'}</span>
      </div>

      <div className="builder-body">
        {step === 0 && <BasicsStep d={d} isNew={isNew} set={set} onTemplate={(t) => (onChange(t), setActive(t.stages[0]?.key ?? ''), setStep(1))} />}
        {step === 1 && <StagesStep root={root} d={d} set={set} active={active} setActive={setActive} badStage={check.stage} />}
        {step === 2 && <ReviewStep d={d} path={mode.path} problem={problem} warnings={check.warnings} onStage={(id) => (setActive(d.stages.find((s) => s.id === id)?.key ?? active), setStep(1))} />}
      </div>

      <footer className="builder-foot">
        <div className={`builder-status${problem ? ' tone-attention' : ''}`} role="status">
          {error ? <span className="tone-error">{error}</span> : problem ? problem : check.warnings.length ? `Ready to save · ${check.warnings.length} note${check.warnings.length === 1 ? '' : 's'} on the last step` : 'Ready to save'}
        </div>
        <button type="button" className="btn ghost" onClick={onCancel}><X size={13} /> Cancel</button>
        {step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)}><ArrowLeft size={13} /> Back</button>}
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn primary" disabled={step === 0 && !d.name.trim()} onClick={() => setStep(step + 1)}>
            Next <ArrowRight size={13} />
          </button>
        ) : (
          <button type="button" className="btn primary" disabled={!!problem || busy} onClick={() => void save()}>
            <Check size={13} /> {busy ? 'Saving…' : mode.path ? 'Save changes' : 'Save recipe'}
          </button>
        )}
      </footer>
    </div>
  )
}

/** A few starting points beside the built-ins: one per common shape. */
function starters(): Array<{ name: string; hint: string; draft: () => RecipeDraft }> {
  const agent = (id: string, prompt: string, approve = false): DraftStage => ({ ...emptyStage('agent', id), prompt, approve })
  const build = (name: string, stages: DraftStage[]): RecipeDraft => ({ ...emptyDraft(), name, stages })
  return [
    {
      name: 'Plan → build → check → PR',
      hint: 'You approve the plan before any code is written.',
      draft: () =>
        build('', [
          agent('plan', 'Write a short plan for: {intent}\nSave it to {out}. Don\'t change any code.', true),
          agent('build', 'Implement the plan in {plan.out}.\nCommit your work when the checks pass.'),
          { ...emptyStage('run', 'check'), retry: ['build'] },
          emptyStage('pr', 'pr')
        ])
    },
    {
      name: 'Build → check → review',
      hint: 'A second agent reviews the work before the pull request.',
      draft: () =>
        build('', [
          agent('build', 'Implement: {intent}\nCommit your work when the checks pass.'),
          { ...emptyStage('run', 'check'), retry: ['build'] },
          agent('review', 'Review the changes on this branch for bugs and missed cases.\nWrite your findings to {out}.', true),
          emptyStage('pr', 'pr')
        ])
    },
    { name: 'Blank', hint: 'Start with nothing and add stages yourself.', draft: () => build('', []) }
  ]
}

function BasicsStep({ d, isNew, set, onTemplate }: { d: RecipeDraft; isNew: boolean; set: (p: Partial<RecipeDraft>) => void; onTemplate: (d: RecipeDraft) => void }): React.JSX.Element {
  const recipes = useStore(factory, (s) => s.recipes)
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => nameRef.current?.focus(), [])
  const setupMode = d.setup === '' ? 'auto' : d.setup === 'none' ? 'none' : 'custom'
  const from = (t: RecipeDraft): void => onTemplate({ ...t, name: d.name || (t.name ? `${t.name} (custom)` : ''), description: d.description || t.description })
  return (
    <div className="builder-page">
      <p className="builder-intro">
        A recipe is a list of stages the factory runs in a fresh branch: agents do the work, checks run your scripts, you approve the stages that matter, and a pull request comes out at the end. Name it, then add stages.
      </p>
      <label className="field">
        <span>Name</span>
        <input ref={nameRef} value={d.name} placeholder="Feature with security review" onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="field">
        <span>Description</span>
        <input value={d.description} placeholder="What it does, in one line; shown when you pick a recipe" onChange={(e) => set({ description: e.target.value })} />
      </label>
      {isNew && (
        <div className="field">
          <span>Start from</span>
          <div className="template-grid">
            {starters().map((s) => (
              <button key={s.name} type="button" className="template-card" onClick={() => from(s.draft())}>
                <b>{s.name}</b>
                <span className="muted small">{s.hint}</span>
              </button>
            ))}
            {recipes.map((r) => (
              <button key={r.recipe.path ?? r.builtin} type="button" className="template-card" onClick={() => from(draftFromRecipe(r.recipe))}>
                <b>{r.recipe.name}</b>
                <span className="muted small">{r.recipe.description || `${r.recipe.nodes.length} stages`}</span>
              </button>
            ))}
          </div>
          <span className="field-hint">Picking one fills in its stages; you change them on the next step.</span>
        </div>
      )}
      <details className="builder-more" open={!!d.setup || d.intake === 'issue'}>
        <summary>More options</summary>
        <label className="field">
          <span>Preparing the worktree</span>
          <select value={setupMode} onChange={(e) => set({ setup: e.target.value === 'auto' ? '' : e.target.value === 'none' ? 'none' : 'make setup' })}>
            <option value="auto">Install dependencies from the lockfile (npm ci, pnpm, yarn, uv, poetry…)</option>
            <option value="none">Nothing to install</option>
            <option value="custom">My own command…</option>
          </select>
          {setupMode === 'custom' && <input className="mono" value={d.setup} aria-label="Setup command" onChange={(e) => set({ setup: e.target.value })} />}
          <span className="field-hint">Each run works in a new git worktree, which starts without node_modules or a virtualenv. This runs once before the first stage.</span>
        </label>
      </details>
    </div>
  )
}

function StagesStep({ root, d, set, active, setActive, badStage }: { root: string; d: RecipeDraft; set: (p: Partial<RecipeDraft>) => void; active: string; setActive: (k: string) => void; badStage?: string }): React.JSX.Element {
  const i = Math.max(0, d.stages.findIndex((s) => s.key === active))
  const stage = d.stages[i]
  const setStages = (stages: DraftStage[]): void => set({ stages })
  const add = (kind: StageKind): void => {
    const base = kind === 'agent' ? (d.stages.some((s) => s.kind === 'agent') ? 'review' : 'build') : kind === 'run' ? 'check' : 'pr'
    const s = emptyStage(kind, freeId(d.stages, base))
    // a check that fails usually sends the work back to the agent stage above it
    if (kind === 'run') {
      const lastAgent = [...d.stages].reverse().find((x) => x.kind === 'agent')
      s.retry = lastAgent ? [lastAgent.id] : []
    }
    // a pull request goes last; anything else goes before it
    const pr = d.stages.findIndex((x) => x.kind === 'pr')
    const at = kind !== 'pr' && pr >= 0 ? pr : d.stages.length
    setStages([...d.stages.slice(0, at), s, ...d.stages.slice(at)])
    setActive(s.key)
  }
  const update = (patch: Partial<DraftStage>): void => {
    const old = stage.id
    let stages = d.stages.map((s) => (s.key === stage.key ? { ...s, ...patch } : s))
    // a renamed stage keeps the stages that point at it
    if (patch.id !== undefined && patch.id !== old) {
      const ren = (xs: string[]): string[] => xs.map((x) => (x === old ? patch.id! : x))
      stages = stages.map((s) => ({
        ...s,
        needs: s.needs && ren(s.needs),
        retry: ren(s.retry),
        prompt: s.prompt.split(`{${old}.out}`).join(`{${patch.id}.out}`),
        prBody: s.prBody.split(`{${old}.out}`).join(`{${patch.id}.out}`),
        prTitle: s.prTitle.split(`{${old}.out}`).join(`{${patch.id}.out}`)
      }))
    }
    setStages(stages)
  }
  const move = (dir: -1 | 1): void => {
    const j = i + dir
    if (j < 0 || j >= d.stages.length) return
    const next = [...d.stages]
    ;[next[i], next[j]] = [next[j], next[i]]
    setStages(next)
  }
  const remove = (): void => {
    const id = stage.id
    const rest = d.stages.filter((s) => s.key !== stage.key).map((s) => ({ ...s, needs: s.needs && s.needs.filter((x) => x !== id), retry: s.retry.filter((x) => x !== id) }))
    setStages(rest)
    setActive(rest[Math.min(i, rest.length - 1)]?.key ?? '')
  }

  return (
    <div className="builder-stages">
      <div className="stage-list">
        {d.stages.map((s, j) => {
          const Icon = KIND[s.kind].icon
          return (
            <button key={s.key} type="button" className={`stage-list-item${s.key === stage?.key ? ' on' : ''}${s.id === badStage ? ' bad' : ''}`} onClick={() => setActive(s.key)}>
              <span className="stage-list-n">{j + 1}</span>
              <Icon size={13} />
              <span className="mono stage-list-id">{s.id || '(no name)'}</span>
              {s.approve && <ShieldCheck size={11} aria-label="you approve" />}
              <span className="stage-list-sub">{draftSummary(s)}</span>
            </button>
          )
        })}
        {!d.stages.length && <div className="muted-note">No stages yet. Most recipes start with an agent stage.</div>}
        <div className="stage-add">
          <span className="field-label">Add a stage</span>
          <button type="button" className="btn sm" onClick={() => add('agent')} title="An agent works on a prompt: plan, build, review, write docs…"><Bot size={13} /> Agent</button>
          <button type="button" className="btn sm" onClick={() => add('run')} title="Runs your scripts or commands; a failure can send the work back"><ListChecks size={13} /> Check</button>
          <button type="button" className="btn sm" disabled={d.stages.some((s) => s.kind === 'pr')} onClick={() => add('pr')} title="Waits for your click, then pushes the branch and opens the pull request"><GitPullRequest size={13} /> Pull request</button>
        </div>
      </div>
      <div className="stage-editor">
        {stage ? (
          <StageEditor
            key={stage.key}
            root={root}
            d={d}
            index={i}
            stage={stage}
            update={update}
            onMove={move}
            onRemove={remove}
          />
        ) : (
          <Empty title="Add your first stage" hint="Agent stages do the work, checks run your tests, and a pull request stage ends the run." />
        )}
      </div>
    </div>
  )
}

function draftSummary(s: DraftStage): string {
  if (s.kind === 'run') return s.run.filter(Boolean).join(', ') || 'no commands yet'
  if (s.kind === 'pr') return 'opens the pull request'
  const who = s.agents.filter(Boolean)
  return `${who.length > 1 ? `bake-off of ${who.length}` : (who[0] ?? 'default agent')}${s.skill ? ` · ${s.skill}` : ''}`
}

function StageEditor({ root, d, index, stage: s, update, onMove, onRemove }: { root: string; d: RecipeDraft; index: number; stage: DraftStage; update: (p: Partial<DraftStage>) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void }): React.JSX.Element {
  const before = d.stages.slice(0, index)
  const agentStagesBefore = before.filter((x) => x.kind === 'agent')
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const prBodyRef = useRef<HTMLTextAreaElement>(null)
  const insert = (ref: React.RefObject<HTMLTextAreaElement | null>, field: 'prompt' | 'prBody', text: string): void => {
    const el = ref.current
    const cur = s[field]
    const at = el ? el.selectionStart : cur.length
    const end = el ? el.selectionEnd : cur.length
    update({ [field]: cur.slice(0, at) + text + cur.slice(end) })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + text.length, at + text.length)
    })
  }
  const places = placeholdersFor(d, index)
  return (
    <div className="stage-form">
      <div className="stage-form-head">
        <div className="seg sm" role="radiogroup" aria-label="Stage type">
          {(Object.keys(KIND) as StageKind[]).map((k) => {
            const Icon = KIND[k].icon
            return (
              <button key={k} type="button" role="radio" aria-checked={s.kind === k} className={s.kind === k ? 'on' : ''} disabled={k === 'pr' && s.kind !== 'pr' && d.stages.some((x) => x.kind === 'pr')} onClick={() => update({ ...emptyStage(k, s.id), key: s.key, needs: s.needs, approve: s.approve })}>
                <Icon size={12} /> {KIND[k].label}
              </button>
            )
          })}
        </div>
        <span className="grow" />
        <button type="button" className="icon-btn" title="Move up" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={14} /></button>
        <button type="button" className="icon-btn" title="Move down" aria-label="Move down" disabled={index === d.stages.length - 1} onClick={() => onMove(1)}><ArrowDown size={14} /></button>
        <button type="button" className="icon-btn danger" title="Remove stage" aria-label="Remove stage" onClick={onRemove}><Trash2 size={14} /></button>
      </div>

      <label className="field">
        <span>Stage name</span>
        <input className="mono" value={s.id} aria-label="Stage name" onChange={(e) => update({ id: e.target.value.replace(/\s+/g, '-') })} />
        <span className="field-hint">Short, like spec, build or review. Later stages read what an agent stage wrote as {`{${s.id || 'name'}.out}`}.</span>
      </label>

      {s.kind === 'agent' && <AgentStageFields root={root} s={s} update={update} />}

      {s.kind === 'agent' && (
        <label className="field">
          <span>{s.skill ? 'Arguments for the skill (optional)' : 'Prompt'}</span>
          <textarea ref={promptRef} rows={6} value={s.prompt} placeholder={s.skill ? '{intent}' : 'Write a short spec for: {intent}\nSave it to {out}.'} onChange={(e) => update({ prompt: e.target.value })} />
          <Placeholders items={places} onPick={(t) => insert(promptRef, 'prompt', t)} />
          <span className="field-hint">
            {agentStagesBefore.length
              ? `Point the agent at earlier results with ${agentStagesBefore.map((x) => `{${x.id}.out}`).join(', ')}.`
              : 'Use {intent} for what you ask the factory to build when you start a run.'}{' '}
            The agent is told to write a summary to {'{out}'} if the prompt doesn't mention it.
          </span>
        </label>
      )}

      {s.kind === 'run' && <CheckFields root={root} s={s} before={before} update={update} />}

      {s.kind === 'pr' && (
        <>
          <label className="field">
            <span>Pull request title</span>
            <input value={s.prTitle} placeholder="{intent}" onChange={(e) => update({ prTitle: e.target.value })} />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea ref={prBodyRef} rows={3} value={s.prBody} placeholder={agentStagesBefore[0] ? `{${agentStagesBefore[0].id}.out}` : ''} onChange={(e) => update({ prBody: e.target.value })} />
            <Placeholders items={places.filter((p) => p.text !== '{out}' && p.text !== '{log}')} onPick={(t) => insert(prBodyRef, 'prBody', t)} />
            <span className="field-hint">A placeholder like {'{spec.out}'} puts that stage's file in the description. The run waits for your click before it pushes anything.</span>
          </label>
        </>
      )}

      <div className="field">
        <span>Starts after</span>
        {index === 0 ? (
          <span className="field-hint">The first stage starts when the run does.</span>
        ) : (
          <>
            <div className="seg sm" role="radiogroup" aria-label="Starts after">
              <button type="button" role="radio" aria-checked={s.needs === null} className={s.needs === null ? 'on' : ''} onClick={() => update({ needs: null })}>
                The stage above ({before[before.length - 1].id})
              </button>
              <button type="button" role="radio" aria-checked={s.needs !== null} className={s.needs !== null ? 'on' : ''} onClick={() => update({ needs: s.needs ?? [before[before.length - 1].id] })}>
                Pick stages
              </button>
            </div>
            {s.needs !== null && (
              <div className="chip-checks">
                {before.map((b) => (
                  <label key={b.key} className={`chip-check${s.needs!.includes(b.id) ? ' on' : ''}`}>
                    <input type="checkbox" checked={s.needs!.includes(b.id)} onChange={(e) => update({ needs: e.target.checked ? [...s.needs!, b.id] : s.needs!.filter((x) => x !== b.id) })} />
                    {b.id}
                  </label>
                ))}
              </div>
            )}
            <span className="field-hint">
              {s.needs === null ? 'Stages run one after another.' : s.needs.length ? `Waits for ${s.needs.join(' and ')}. Two stages that wait for the same one run at the same time, each in its own worktree, and are merged when a later stage waits for both.` : 'Starts right away, alongside the first stage.'}
            </span>
          </>
        )}
      </div>

      {s.kind !== 'pr' && (
        <label className="check">
          <input type="checkbox" checked={s.approve} onChange={(e) => update({ approve: e.target.checked })} />
          <span>Wait for my approval after this stage: you read what it did and approve, reject or send it back with a note</span>
        </label>
      )}
    </div>
  )
}

function Placeholders({ items, onPick }: { items: Array<{ text: string; hint: string }>; onPick: (t: string) => void }): React.JSX.Element {
  return (
    <div className="placeholders" aria-label="Insert a placeholder">
      {items.map((p) => (
        <button key={p.text} type="button" className="placeholder-chip mono" title={p.hint} onClick={() => onPick(p.text)}>
          {p.text}
        </button>
      ))}
    </div>
  )
}

function AgentStageFields({ root, s, update }: { root: string; s: DraftStage; update: (p: Partial<DraftStage>) => void }): React.JSX.Element {
  const agents = useAgents()
  const profiles = useProfiles()
  const [skills, setSkills] = useState<ClaudeAsset[]>([])
  useEffect(() => void window.api.claude.assets(root).then((a) => setSkills(a.filter((x) => x.kind !== 'agent')), () => setSkills([])), [root])
  const list = s.agents.length ? s.agents : ['']
  const bakeoff = list.length > 1
  const cli = agents.find((a) => a.id === specAgent(list[0] || undefined)) ?? agents[0]
  const setAgent = (j: number, v: string): void => {
    const next = [...list]
    next[j] = v
    // model, effort and mode are one CLI's values: another agent drops them
    update({ agents: next.filter((x, k) => x || k === 0).filter(Boolean), ...(j === 0 && !bakeoff ? { model: '', effort: '', mode: '' } : {}) })
  }
  const options = (
    <>
      <optgroup label="Agents">{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
      {profiles.length > 0 && <optgroup label="Agent profiles">{profiles.map((p) => <option key={p.id} value={p.name}>{p.name} ({p.agent})</option>)}</optgroup>}
    </>
  )
  return (
    <>
      <div className="field">
        <span>{bakeoff ? 'Agents (bake-off)' : 'Agent'}</span>
        {list.map((a, j) => (
          <div key={j} className="stage-agent-row">
            <select aria-label={`Agent ${j + 1}`} value={a} onChange={(e) => setAgent(j, e.target.value)}>
              {j === 0 && <option value="">Your default agent (Settings)</option>}
              {j > 0 && !a && <option value="">Pick an agent…</option>}
              {a && !agents.some((x) => x.id === a) && !profiles.some((p) => p.name === a) && <option value={a}>{a} (not found here)</option>}
              {options}
            </select>
            {j > 0 && (
              <button type="button" className="icon-btn" title="Remove from the bake-off" aria-label="Remove from the bake-off" onClick={() => update({ agents: list.filter((_, k) => k !== j).filter(Boolean) })}>
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        <span className="field-hint">
          {bakeoff
            ? 'Every agent gets the same prompt in its own worktree; you keep the best result.'
            : 'A profile is an agent with a role (Spec writer, Reviewer…); manage them under Agents.'}{' '}
          {list[0] && <span className="link" onClick={() => update({ agents: [...list, ''] })}>{bakeoff ? 'Add another agent' : 'Make it a bake-off'}</span>}
        </span>
      </div>
      <label className="field">
        <span>Skill (optional)</span>
        <select value={s.skill} onChange={(e) => update({ skill: e.target.value })}>
          <option value="">None: the agent follows the prompt</option>
          {s.skill && !skills.some((k) => k.name === s.skill || `${k.plugin}:${k.name}` === s.skill) && <option value={s.skill}>{s.skill} (not found here)</option>}
          {skills.map((k) => (
            <option key={k.path} value={k.plugin ? `${k.plugin}:${k.name}` : k.name}>
              {k.invocation} ({k.source})
            </option>
          ))}
        </select>
        <span className="field-hint">A skill replaces the prompt; the prompt becomes its arguments. Any agent can run one.</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={s.interactive} onChange={(e) => update({ interactive: e.target.checked })} />
        <span>Interactive: a normal session you can watch and talk to; you click Done to move on</span>
      </label>
      {!bakeoff && (
        <details className="builder-more">
          <summary>Model, effort and approval mode</summary>
          <div className="stage-card-grid">
            <AgentFields key={cli?.id} agent={cli} label={s.id} value={{ model: s.model, effort: s.effort, mode: s.mode }} interactive={s.interactive} onChange={(p) => update({ model: p.model ?? s.model, effort: p.effort ?? s.effort, mode: p.mode ?? s.mode })} />
          </div>
        </details>
      )}
    </>
  )
}

function CheckFields({ root, s, before, update }: { root: string; s: DraftStage; before: DraftStage[]; update: (p: Partial<DraftStage>) => void }): React.JSX.Element {
  const [scripts, setScripts] = useState<string[]>([])
  useEffect(() => void window.api.runtimes.detect(root).then((d) => setScripts([...new Set(d.map((x) => x.name))]), () => setScripts([])), [root])
  const [text, setText] = useState(s.run.join('\n'))
  const agentsBefore = before.filter((x) => x.kind === 'agent')
  const has = (n: string): boolean => s.run.includes(n) || s.run.includes(`${n}?`)
  const toggle = (n: string): void => {
    const run = has(n) ? s.run.filter((x) => x !== n && x !== `${n}?`) : [...s.run, `${n}?`]
    setText(run.join('\n'))
    update({ run })
  }
  return (
    <>
      <label className="field">
        <span>Commands, one per line</span>
        <textarea className="mono" rows={3} value={text} spellCheck={false} placeholder={'test?\nnpm run e2e'} onChange={(e) => (setText(e.target.value), update({ run: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) }))} />
        {scripts.length > 0 && (
          <div className="placeholders" aria-label="Scripts in this project">
            {scripts.slice(0, 12).map((n) => (
              <button key={n} type="button" className={`placeholder-chip mono${has(n) ? ' on' : ''}`} aria-pressed={has(n)} title={has(n) ? 'Remove' : 'Add this script'} onClick={() => toggle(n)}>
                {has(n) ? <Check size={10} /> : <Plus size={10} />} {n}
              </button>
            ))}
          </div>
        )}
        <span className="field-hint">A name with ? (test?) runs that script from package.json, a Makefile or similar if the project has it, and is skipped if not, so the recipe works in any repository. Anything else runs as a shell command.</span>
      </label>
      <div className="field-row">
        <label className="field">
          <span>If it fails</span>
          <select value={s.retry[0] ?? ''} onChange={(e) => update({ retry: e.target.value ? [e.target.value] : [] })}>
            <option value="">Stop the run and tell me</option>
            {agentsBefore.map((a) => <option key={a.key} value={a.id}>Send the errors back to {a.id}</option>)}
          </select>
        </label>
        {s.retry.length > 0 && (
          <label className="field">
            <span>Tries</span>
            <input type="number" min={1} max={10} value={s.retryMax} onChange={(e) => update({ retryMax: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} />
          </label>
        )}
      </div>
      {s.retry.length > 0 && <span className="field-hint">{s.retry.join(', ')} gets the failing output as {'{log}'} and tries again, up to {s.retryMax}×; then the run stops for you.</span>}
    </>
  )
}

function ReviewStep({ d, path, problem, warnings, onStage }: { d: RecipeDraft; path?: string; problem?: string; warnings: string[]; onStage: (id: string) => void }): React.JSX.Element {
  const check = useMemo(() => checkDraft(d), [d])
  const yaml = draftToYaml(d)
  const [showYaml, setShowYaml] = useState(false)
  return (
    <div className="builder-page">
      <div className="review-head">
        <h3>{d.name || 'Untitled recipe'}</h3>
        {d.description && <p className="muted">{d.description}</p>}
      </div>
      {check.recipe ? <FlowPreview recipe={check.recipe} onPick={onStage} /> : null}
      {problem && (
        <div className="form-error" role="alert">
          {problem}
          {check.stage && <> · <span className="link" onClick={() => onStage(check.stage!)}>Go to {check.stage}</span></>}
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="review-notes">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      <div className="field-hint">
        Saved as <span className="mono">{path ? path.split(/[\\/]/).slice(-3).join('/') : `.sldev/factory/${recipeSlug(d.name)}.yml`}</span>: a plain file you can commit so your team gets it too.
        {path ? ' Saving from the builder rewrites the file, so comments in it are not kept.' : ''}
      </div>
      <details className="builder-more" open={showYaml} onToggle={(e) => setShowYaml((e.target as HTMLDetailsElement).open)}>
        <summary>Show the YAML</summary>
        <pre className="recipe-yaml mono">{yaml}</pre>
      </details>
    </div>
  )
}
