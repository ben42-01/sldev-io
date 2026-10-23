import { useCallback, useEffect, useState } from 'react'
import type { GhPr, GhRepoInfo, GhRun, GhWorkflow, GhWorkflowInput } from '@shared/types'
import { CircleCheck, CircleDashed, CircleX, ExternalLink, GitPullRequest, Loader, Play, RefreshCw, RotateCw, ScrollText, Square, Eye, CircleSlash } from 'lucide-react'
import { openTerminal } from '../dock/dockApi'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { showContextMenu } from './ContextMenu'
import { ago } from './MissionCard'
import { ViewShell } from './RuntimesView'

const errText = (e: unknown): string => String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')

export function WorkflowsView(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const [repo, setRepo] = useState<GhRepoInfo | null>(null)
  const [workflows, setWorkflows] = useState<GhWorkflow[]>([])
  const [runs, setRuns] = useState<GhRun[] | null>(null)
  const [pr, setPr] = useState<GhPr | null>(null)
  const [selected, setSelected] = useState<GhWorkflow | null>(null)
  const [dispatching, setDispatching] = useState<GhWorkflow | null>(null)
  const [error, setError] = useState('')

  const loadRuns = useCallback(async () => {
    if (!root) return
    try {
      setRuns(await window.api.gh.runs(root, selected ? String(selected.id) : undefined))
    } catch (e) {
      setError(errText(e))
    }
  }, [root, selected])

  const loadAll = useCallback(async () => {
    if (!root) return
    setError('')
    const info = await window.api.gh.repo(root)
    setRepo(info)
    if (!info.repo) return
    const [wfs, p] = await Promise.all([window.api.gh.workflows(root).catch((e) => (setError(errText(e)), [])), window.api.gh.pr(root)])
    setWorkflows(wfs)
    setPr(p)
    await loadRuns()
  }, [root, loadRuns])

  useEffect(() => void loadAll(), [root]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void loadRuns(), [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  // poll while something is running
  const anyActive = runs?.some((r) => r.status !== 'completed')
  useEffect(() => {
    if (!anyActive) return
    const t = setInterval(() => void loadRuns(), 10000)
    return () => clearInterval(t)
  }, [anyActive, loadRuns])

  if (!root) return <ViewShell title="GitHub Workflows"><div className="empty-state"><p>Open a folder that is a GitHub repository.</p></div></ViewShell>

  return (
    <ViewShell
      title="GitHub Workflows"
      actions={
        <button className="icon-btn" title="Refresh" onClick={() => void loadAll()}>
          <RefreshCw size={14} />
        </button>
      }
    >
      <div className="view-scroll">
        {repo === null && <div className="muted-note">Checking GitHub…</div>}
        {repo?.error && (
          <div className="empty-state">
            <p>{repo.error}</p>
            {!repo.authed && <button className="btn" onClick={() => openTerminal({ cwd: root, title: 'gh auth', command: 'gh auth login' })}>Log in with gh</button>}
          </div>
        )}
        {repo?.repo && (
          <>
            <div className="gh-repo">
              <a onClick={() => void window.api.shell.openExternal(repo.url!)}>{repo.repo}</a>
            </div>
            {pr && (
              <div className="pr-card" onClick={() => void window.api.shell.openExternal(pr.url)}>
                <GitPullRequest size={14} className={pr.state === 'OPEN' ? 'ok' : 'muted'} />
                <div className="rt-main">
                  <div className="rt-name">#{pr.number} {pr.title}</div>
                  <div className="rt-meta">
                    {pr.isDraft ? 'Draft · ' : ''}{pr.state.toLowerCase()} · <span className="add">{pr.checks.passed} passed</span>
                    {pr.checks.failed > 0 && <> · <span className="del">{pr.checks.failed} failed</span></>}
                    {pr.checks.pending > 0 && <> · {pr.checks.pending} pending</>}
                  </div>
                </div>
              </div>
            )}
            <div className="section-label pad">Workflows</div>
            <div className={`wf-row${!selected ? ' on' : ''}`} onClick={() => setSelected(null)}>All workflows</div>
            {workflows.map((w) => (
              <div key={w.id} className={`wf-row${selected?.id === w.id ? ' on' : ''}${w.state !== 'active' ? ' dim' : ''}`} onClick={() => setSelected(w)}>
                <span className="wf-name">{w.name}</span>
                <button className="icon-btn go" title="Run workflow…" onClick={(e) => (e.stopPropagation(), setDispatching(w))}>
                  <Play size={12} />
                </button>
              </div>
            ))}
            {dispatching && <DispatchForm root={root} workflow={dispatching} defaultRef={repo.defaultBranch} onDone={(ran) => (setDispatching(null), ran && setTimeout(() => void loadRuns(), 2500))} />}
            <div className="section-label pad">Runs{selected ? ` · ${selected.name}` : ''}</div>
            {error && <div className="form-error pad">{error}</div>}
            {runs?.map((r) => <RunRow key={r.databaseId} run={r} root={root} onChange={() => setTimeout(() => void loadRuns(), 1500)} />)}
            {runs && !runs.length && <div className="muted-note">No runs yet.</div>}
          </>
        )}
      </div>
    </ViewShell>
  )
}

function RunIcon({ run }: { run: GhRun }): React.JSX.Element {
  if (run.status !== 'completed') return run.status === 'in_progress' ? <Loader size={14} className="spin run-active" /> : <CircleDashed size={14} className="muted" />
  if (run.conclusion === 'success') return <CircleCheck size={14} className="ok" />
  if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') return <CircleSlash size={14} className="muted" />
  return <CircleX size={14} className="bad" />
}

function RunRow({ run: r, root, onChange }: { run: GhRun; root: string; onChange: () => void }): React.JSX.Element {
  const active = r.status !== 'completed'
  const failed = r.status === 'completed' && r.conclusion !== 'success' && r.conclusion !== 'skipped' && r.conclusion !== 'cancelled'
  const watch = (): void => void openTerminal({ cwd: root, title: `run #${r.number}`, command: `gh run watch ${r.databaseId} --exit-status` })
  const logs = (): void => void openTerminal({ cwd: root, title: `logs #${r.number}`, command: `gh run view ${r.databaseId} ${failed ? '--log-failed' : '--log'} | less -R` })
  const act = (fn: () => Promise<void>): void => void fn().then(onChange, (e) => alert(errText(e)))
  return (
    <div
      className="rt-row run-row"
      onDoubleClick={() => (active ? watch() : logs())}
      onContextMenu={(e) =>
        showContextMenu(e, [
          { label: 'Watch in terminal', icon: <Eye size={13} />, run: watch },
          { label: failed ? 'Failed logs' : 'Logs', icon: <ScrollText size={13} />, run: logs },
          { label: 'Open in browser', icon: <ExternalLink size={13} />, run: () => void window.api.shell.openExternal(r.url) },
          { type: 'separator' },
          { label: 'Re-run failed jobs', icon: <RotateCw size={13} />, disabled: !failed, run: () => act(() => window.api.gh.rerun(root, r.databaseId, true)) },
          { label: 'Re-run all jobs', icon: <RotateCw size={13} />, disabled: active, run: () => act(() => window.api.gh.rerun(root, r.databaseId, false)) },
          { label: 'Cancel', icon: <Square size={13} />, disabled: !active, run: () => act(() => window.api.gh.cancel(root, r.databaseId)) }
        ])
      }
    >
      <span className="run-icon"><RunIcon run={r} /></span>
      <div className="rt-main">
        <div className="rt-name" title={r.displayTitle}>{r.displayTitle}</div>
        <div className="rt-meta">{r.workflowName} · {r.headBranch} · {r.event} · {ago(Date.parse(r.createdAt))}</div>
      </div>
      <div className="row-actions">
        <button className="icon-btn" title={active ? 'Watch' : 'Logs'} onClick={active ? watch : logs}>
          {active ? <Eye size={13} /> : <ScrollText size={13} />}
        </button>
        <button className="icon-btn" title="Open in browser" onClick={() => void window.api.shell.openExternal(r.url)}>
          <ExternalLink size={13} />
        </button>
      </div>
    </div>
  )
}

function DispatchForm({ root, workflow, defaultRef, onDone }: { root: string; workflow: GhWorkflow; defaultRef: string | null; onDone: (ran: boolean) => void }): React.JSX.Element {
  const [inputs, setInputs] = useState<GhWorkflowInput[] | null | undefined>(undefined)
  const [values, setValues] = useState<Record<string, string>>({})
  const [branches, setBranches] = useState<string[]>([])
  const [ref, setRef] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.gh.inputs(root, workflow.path).then((list) => {
      setInputs(list)
      setValues(Object.fromEntries((list ?? []).map((i) => [i.name, i.default ?? (i.type === 'boolean' ? 'false' : i.options?.[0] ?? '')])))
    })
    void window.api.git.branches(root).then(setBranches)
    void window.api.git.branch(root).then((b) => setRef(b ?? defaultRef ?? ''))
  }, [root, workflow, defaultRef])

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.gh.dispatch(root, workflow.id, ref, values)
      onDone(true)
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  return (
    <form className="form inline-form" onSubmit={(e) => (e.preventDefault(), void submit())}>
      <strong>Run {workflow.name}</strong>
      {inputs === undefined && <div className="muted">Reading workflow…</div>}
      {inputs === null && <div className="form-error">This workflow has no workflow_dispatch trigger, so it can't be started manually.</div>}
      {inputs && (
        <>
          <label className="field">
            <span>Branch</span>
            <select value={ref} onChange={(e) => setRef(e.target.value)}>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          {inputs.map((i) => (
            <label key={i.name} className={i.type === 'boolean' ? 'check' : 'field'} title={i.description}>
              {i.type === 'boolean' ? (
                <>
                  <input type="checkbox" checked={values[i.name] === 'true'} onChange={(e) => setValues({ ...values, [i.name]: String(e.target.checked) })} />
                  <span>{i.description || i.name}</span>
                </>
              ) : (
                <>
                  <span>{i.description || i.name}{i.required ? ' *' : ''}</span>
                  {i.options ? (
                    <select value={values[i.name]} onChange={(e) => setValues({ ...values, [i.name]: e.target.value })}>
                      {i.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input value={values[i.name] ?? ''} onChange={(e) => setValues({ ...values, [i.name]: e.target.value })} />
                  )}
                </>
              )}
            </label>
          ))}
        </>
      )}
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => onDone(false)}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!inputs || busy || inputs.some((i) => i.required && !values[i.name])}>
          <Play size={13} /> {busy ? 'Starting…' : 'Run workflow'}
        </button>
      </div>
    </form>
  )
}
