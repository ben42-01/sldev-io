import { useEffect, useMemo, useState } from 'react'
import { Check, Factory, FilePlus2, Import, Plus, Share2 } from 'lucide-react'
import { issueText, runtimeNames, type FactoryRun } from '@shared/factory'
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

export function FactoryView(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const runs = useStore(factory, (s) => s.runs)
  const errors = useStore(factory, (s) => s.recipeErrors)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  useEffect(() => void loadRecipes(root), [root])
  const mine = useMemo(() => runs.filter((r) => r.root === root), [runs, root])

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
          <NewRunForm root={root} onDone={() => setCreating(false)} />
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

function NewRunForm({ root, onDone }: { root: string; onDone: () => void }): React.JSX.Element {
  const recipes = useStore(factory, (s) => s.recipes)
  const [pick, setPick] = useState(0)
  const [intent, setIntent] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [base, setBase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [scripts, setScripts] = useState<string[] | null>(null)
  const [issue, setIssue] = useState<number | undefined>()
  useEffect(() => {
    void window.api.runtimes.detect(root).then((d) => setScripts(d.map((r) => r.name)), () => setScripts([]))
    void window.api.git.branches(root).then(setBranches)
    void window.api.git.branch(root).then((b) => setBase(b ?? ''))
  }, [root])
  const entry = recipes[pick]

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!entry || !intent.trim()) return
    setBusy(true)
    setError('')
    try {
      await startRun({ recipe: entry.recipe, intent, root, base, issue })
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
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
              <span key={n.id} className={`recipe-step ${n.kind}`} title={n.kind === 'agent' ? n.agents.join(', ') : n.kind === 'run' ? n.run.join(' && ') : 'pull request'}>
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
          </div>
        </>
      )}
      <IssuePicker root={root} onPick={(i) => (setIntent(issueText(i)), setIssue(i.number))} />
      <label className="field">
        <span>What should the factory build?</span>
        <textarea rows={4} value={intent} autoFocus placeholder="Add a dark mode toggle to the settings page" onChange={(e) => setIntent(e.target.value)} />
      </label>
      <label className="field">
        <span>Branch from</span>
        <select value={base} onChange={(e) => setBase(e.target.value)}>
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      {error && <div className="bad">{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn primary" disabled={busy || !intent.trim() || !entry}>
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
