import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, ExternalLink, FileDiff, FlaskConical, Pause, Play, Plus, RefreshCw, Trash2, Trophy, X } from 'lucide-react'
import { attemptDone, cellTone, contestantKey, scoreboard, scoreboardMarkdown, withPrompts, type Contestant, type EvalAttempt, type EvalRun, type Score } from '@shared/evals'
import type { Signal } from '@shared/status'
import { Modal, confirmAction } from './Modal'
import { StatusDot } from './StatusDot'
import { Empty } from './States'
import { TimeAgo } from './TimeAgo'
import { openMissionDetails } from './MissionDetails'
import { getAgent, useAgents } from '../state/agents'
import { continueRun, evals, loadEvalFiles, loadPrompts, newEvalFile, newPromptFile, removeRun, startEvalRun, stopRun, useEvalRuns, type EvalFile, type PromptFile } from '../state/evals'
import { reviewMission } from '../state/missions'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { openInEditor } from '../lib/actions'
import { toast } from './Toast'

/**
 * Mission Control → Evals: the project's eval files, a leaderboard of every attempt so far, and each
 * run as a matrix of evals × agents. Which agent does the work best on this repository, measured.
 */

const NO_FILES: EvalFile[] = []

export const contestantLabel = (c: Contestant): string => `${getAgent(c.agent).name}${c.model ? ` · ${c.model}` : ''}${c.prompt ? ` · ${c.prompt.name}` : ''}`

const pct = (n: number): string => `${Math.round(n * 100)}%`
const lines = (n: number): string => `${n} line${n === 1 ? '' : 's'}`
const duration = (ms?: number): string => (ms === undefined ? '–' : ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${(ms / 60_000).toFixed(1)} min`)

const ATTEMPT_SIGNAL: Record<EvalAttempt['status'], Signal> = {
  queued: { tone: 'neutral', label: 'Queued', pulse: false },
  running: { tone: 'working', label: 'Agent working', pulse: true },
  checking: { tone: 'working', label: 'Checking', pulse: true },
  passed: { tone: 'done', label: 'Passed', pulse: false },
  failed: { tone: 'error', label: 'Failed', pulse: false },
  error: { tone: 'error', label: 'Could not run', pulse: false },
  stopped: { tone: 'neutral', label: 'Stopped', pulse: false }
}

export function EvalsView({ root }: { root: string | null }): React.JSX.Element {
  const allFiles = useStore(evals, (s) => s.files)
  const filesRoot = useStore(evals, (s) => s.filesRoot)
  const files = filesRoot === root ? allFiles : NO_FILES
  const runs = useEvalRuns(root)
  const [running, setRunning] = useState(false)
  useEffect(() => void loadEvalFiles(root), [root])
  const board = useMemo(() => scoreboard(runs.flatMap((r) => r.attempts)), [runs])
  const valid = files.filter((f) => f.spec)

  if (!root) return <Empty big icon={<FlaskConical size={22} />} title="No folder open" hint="Open a project folder to measure agents on it." />

  const create = async (): Promise<void> => {
    const p = await newEvalFile(root)
    void openInEditor(p)
  }

  return (
    <div className="panel-page mc-page evals-page">
      <div className="board-filters">
        <span className="muted small">{files.length ? `${files.length} eval${files.length === 1 ? '' : 's'} in .sldev/evals` : 'Evals live in .sldev/evals, next to your code'}</span>
        <span className="grow" />
        <button className="btn sm" onClick={() => void loadEvalFiles(root)} title="Read the eval files again"><RefreshCw size={13} /> Reload</button>
        <button className="btn sm" onClick={() => void create()} title="A new eval file from a template, opened in your editor"><Plus size={13} /> New eval</button>
        <button className="btn sm primary" disabled={!valid.length} onClick={() => setRunning(true)} title="Run evals against one or more agents"><Play size={13} /> Run evals</button>
      </div>

      {!files.length ? (
        <Empty
          big
          icon={<FlaskConical size={22} />}
          title="Measure your agents on your own code"
          hint="An eval is a task with checks: a brief, the commit to start from, and how to tell a good result (tests pass, a command prints ok, a small diff, or a judge agent with a rubric). Run a suite against Claude, Codex or any agent and model, and see who passes most, fastest, with the smallest diff."
          action={<button className="btn sm" onClick={() => void create()}><Plus size={13} /> New eval</button>}
        />
      ) : (
        <>
          {board.length > 0 && <Leaderboard scores={board} />}
          <section aria-label="Eval files">
            <div className="section-label">Evals · {files.length}</div>
            <div className="evals-files">{files.map((f) => <EvalFileRow key={f.path} file={f} />)}</div>
          </section>
        </>
      )}

      {runs.length > 0 && (
        <section aria-label="Eval runs">
          <div className="section-label">Runs · {runs.length}</div>
          <div className="evals-runs">{runs.map((r) => <RunCard key={r.id} run={r} />)}</div>
        </section>
      )}
      {running && <RunDialog root={root} files={valid} onClose={() => setRunning(false)} />}
    </div>
  )
}

function EvalFileRow({ file }: { file: EvalFile }): React.JSX.Element {
  const name = file.spec?.name ?? file.path.split(/[\\/]/).pop()
  return (
    <div className={`evals-file${file.error ? ' broken' : ''}`}>
      <FlaskConical size={14} />
      <div className="evals-file-main">
        <div className="evals-file-name">{name}</div>
        {file.error ? <div className="evals-error small">{file.error}</div> : file.spec?.description && <div className="muted small">{file.spec.description}</div>}
      </div>
      {file.spec && (
        <div className="evals-checks">
          {file.spec.checks.map((c, n) => (
            <span key={n} className="board-label static" title={c.type === 'run' ? c.command : c.type === 'judge' ? c.rubric : `at most ${c.maxLines} changed lines`}>
              {c.type === 'run' ? c.command.split(' ').slice(0, 2).join(' ') : c.type === 'diff' ? `diff ≤ ${c.maxLines}` : 'judge'}
            </span>
          ))}
        </div>
      )}
      <button className="icon-btn" title="Open in your editor" aria-label="Open in your editor" onClick={() => void openInEditor(file.path)}><ExternalLink size={13} /></button>
    </div>
  )
}

function Leaderboard({ scores }: { scores: Score[] }): React.JSX.Element {
  return (
    <section className="evals-leaderboard" aria-label="Leaderboard">
      <div className="section-label"><Trophy size={12} /> Leaderboard · every finished attempt in this project</div>
      <table className="evals-table">
        <thead>
          <tr><th>#</th><th>Agent</th><th>Pass rate</th><th>Checks</th><th>Median time</th><th>Median diff</th><th>Attempts</th></tr>
        </thead>
        <tbody>
          {scores.map((s, n) => (
            <tr key={s.key} className={n === 0 ? 'lead' : undefined}>
              <td className="muted">{n + 1}</td>
              <td className="evals-who">
                {contestantLabel(s.contestant)}
                {s.contestant.prompt && (
                  <button type="button" className="icon-btn evals-copy-prompt" title={`Copy the “${s.contestant.prompt.name}” prompt`} aria-label="Copy the prompt" onClick={() => void window.api.clipboard.writeText(s.contestant.prompt!.text).then(() => toast(`Copied the “${s.contestant.prompt!.name}” prompt`))}>
                    <Copy size={11} />
                  </button>
                )}
              </td>
              <td>
                <div className="evals-rate">
                  <span className="evals-bar"><span style={{ width: pct(s.attempts ? s.passed / s.attempts : 0) }} /></span>
                  {pct(s.attempts ? s.passed / s.attempts : 0)}
                </div>
              </td>
              <td>{pct(s.checkRate)}</td>
              <td>{duration(s.medianMs)}</td>
              <td>{s.medianLines === undefined ? '–' : lines(s.medianLines)}</td>
              <td className="muted">{s.passed}/{s.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function RunCard({ run }: { run: EvalRun }): React.JSX.Element {
  const done = run.attempts.filter(attemptDone).length
  const live = !run.finishedAt && !run.stopped
  const scores = useMemo(() => scoreboard(run.attempts), [run.attempts])
  const [copied, setCopied] = useState(false)
  const status = run.finishedAt ? 'Finished' : run.stopped ? 'Stopped' : 'Running'
  const copy = (): void => {
    void window.api.clipboard.writeText(scoreboardMarkdown(run, contestantLabel))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const remove = async (): Promise<void> => {
    const ok = await confirmAction({
      title: 'Delete this eval run?',
      message: `${run.specs.length} eval${run.specs.length === 1 ? '' : 's'} × ${run.contestants.length} agent${run.contestants.length === 1 ? '' : 's'}, ${status.toLowerCase()}`,
      removes: ['Its results and scores', 'The worktrees and branches its attempts worked in', 'The attempts’ missions'],
      keeps: ['The eval files in .sldev/evals'],
      confirmLabel: 'Delete run',
      danger: true
    })
    if (ok) await removeRun(run.id)
  }
  return (
    <article className={`evals-run${live ? ' live' : ''}`} data-run={run.id}>
      <header className="evals-run-head">
        <StatusDot signal={live ? { tone: 'working', label: 'Running', pulse: true } : run.finishedAt ? { tone: 'done', label: 'Finished', pulse: false } : { tone: 'neutral', label: 'Stopped', pulse: false }} small />
        <span className="evals-run-title">{status} · {done}/{run.attempts.length} attempts</span>
        <TimeAgo t={run.createdAt} />
        <span className="grow" />
        {live && <button className="btn sm" onClick={() => stopRun(run.id)}><Pause size={12} /> Stop</button>}
        {run.stopped && !run.finishedAt && <button className="btn sm" onClick={() => continueRun(run.id)}><Play size={12} /> Continue</button>}
        <button className="btn sm" onClick={copy} disabled={!scores.length} title="The scoreboard as a Markdown table">{copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}</button>
        <button className="icon-btn" title="Delete run" aria-label="Delete run" onClick={() => void remove()}><Trash2 size={13} /></button>
      </header>
      <div className="evals-matrix-wrap">
        <table className="evals-table evals-matrix">
          <thead>
            <tr>
              <th>Eval</th>
              {run.contestants.map((c) => <th key={contestantKey(c)}>{contestantLabel(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {run.specs.map((s) => (
              <tr key={s.name}>
                <td className="evals-who">{s.name}</td>
                {run.contestants.map((c) => {
                  const mine = run.attempts.filter((a) => a.eval === s.name && contestantKey(a.contestant) === contestantKey(c))
                  const fin = mine.filter((a) => a.status === 'passed' || a.status === 'failed' || a.status === 'error')
                  const cell = { passed: fin.filter((a) => a.status === 'passed').length, attempts: fin.length }
                  const busy = mine.some((a) => a.status === 'running' || a.status === 'checking')
                  return (
                    <td key={contestantKey(c)}>
                      <span className={`evals-cell tone-${busy ? 'working' : cellTone(cell)}`} data-eval={s.name} data-agent={contestantKey(c)}>
                        {busy ? '…' : cell.attempts ? `${cell.passed}/${cell.attempts}` : '–'}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="evals-attempts">
        {run.attempts.filter((a) => a.status !== 'queued').map((a) => <AttemptRow key={a.id} attempt={a} />)}
        {run.attempts.some((a) => a.status === 'queued') && <li className="muted small evals-queued">{run.attempts.filter((a) => a.status === 'queued').length} queued</li>}
      </ul>
    </article>
  )
}

function AttemptRow({ attempt: a }: { attempt: EvalAttempt }): React.JSX.Element {
  const signal = ATTEMPT_SIGNAL[a.status]
  return (
    <li className="evals-attempt" data-status={a.status}>
      <StatusDot signal={signal} small />
      <span className="evals-attempt-what">
        <span>{a.eval}</span>
        <span className="muted small">{contestantLabel(a.contestant)} · {signal.label}{a.agentMs !== undefined ? ` · ${duration(a.agentMs)}` : ''}{a.diff ? ` · ${lines(a.diff.lines)}` : ''}</span>
        {a.note && <span className="evals-error small">{a.note}</span>}
      </span>
      <span className="evals-attempt-checks">
        {a.checks.map((c, n) => (
          <span key={n} className={`evals-check ${c.ok ? 'ok' : 'bad'}`} title={`${c.label}${c.detail ? `\n\n${c.detail}` : ''}`}>
            {c.ok ? <Check size={11} /> : <X size={11} />} {c.label.length > 28 ? `${c.label.slice(0, 27)}…` : c.label}
          </span>
        ))}
      </span>
      {a.mission && (
        <>
          <button className="icon-btn" title="Review the diff" aria-label="Review the diff" onClick={() => reviewMission(a.mission!)}><FileDiff size={13} /></button>
          <button className="icon-btn" title="Open the mission" aria-label="Open the mission" onClick={() => openMissionDetails(a.mission!)}><ExternalLink size={13} /></button>
        </>
      )}
    </li>
  )
}

function RunDialog({ root, files, onClose }: { root: string; files: EvalFile[]; onClose: () => void }): React.JSX.Element {
  const agents = useAgents()
  const [picked, setPicked] = useState<Set<string>>(new Set(files.map((f) => f.spec!.name)))
  const def = workspace.get().defaultAgent
  const second = agents.find((a) => a.id !== def)?.id
  const [contestants, setContestants] = useState<Contestant[]>([{ agent: def }, ...(second ? [{ agent: second }] : [])])
  const [repeat, setRepeat] = useState(1)
  const [parallel, setParallel] = useState(1)
  const [busy, setBusy] = useState(false)
  const [prompts, setPrompts] = useState<PromptFile[]>([])
  const [usePrompts, setUsePrompts] = useState<Set<string>>(new Set())
  const [asWritten, setAsWritten] = useState(true)
  const [newName, setNewName] = useState<string | null>(null)
  const reloadPrompts = (): void => void loadPrompts(root).then(setPrompts)
  useEffect(() => {
    reloadPrompts()
    window.addEventListener('focus', reloadPrompts)
    return () => window.removeEventListener('focus', reloadPrompts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])
  const chosen = prompts.filter((p) => usePrompts.has(p.name))
  const all = withPrompts(contestants, chosen, asWritten)
  const keys = contestants.map(contestantKey)
  const dupes = keys.length !== new Set(keys).size
  const total = picked.size * all.length * repeat
  const togglePrompt = (n: string): void => setUsePrompts((p) => {
    const next = new Set(p)
    if (next.has(n)) next.delete(n)
    else next.add(n)
    return next
  })
  const createPrompt = async (): Promise<void> => {
    const name = newName?.trim()
    if (!name) return setNewName(null)
    const p = await newPromptFile(root, name)
    const list = await loadPrompts(root)
    setPrompts(list)
    const made = list.find((x) => x.path === p)
    if (made) setUsePrompts((s) => new Set([...s, made.name]))
    setNewName(null)
  }
  const toggle = (n: string): void => setPicked((p) => {
    const next = new Set(p)
    if (next.has(n)) next.delete(n)
    else next.add(n)
    return next
  })
  const set = (i: number, patch: Partial<Contestant>): void => setContestants((cs) => cs.map((c, n) => (n === i ? { ...c, ...patch, model: (patch.model ?? c.model)?.trim() || undefined } : c)))
  const go = async (): Promise<void> => {
    setBusy(true)
    await startEvalRun(root, { specs: files.filter((f) => picked.has(f.spec!.name)).map((f) => f.spec!), contestants: all, repeat, parallel })
    onClose()
  }
  return (
    <Modal
      title="Run evals"
      size="md"
      onClose={onClose}
      onSubmit={() => void go()}
      footerNote="Each attempt works in its own worktree from the eval's base, in print mode with the unattended mode from Settings → Software Factory. Nothing is pushed."
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !total || dupes}><Play size={13} /> Run {total} attempt{total === 1 ? '' : 's'}</button>
        </>
      }
    >
      <div className="form board-form">
        <div className="field">
          <span>Evals</span>
          <ul className="board-import-list">
            {files.map((f) => (
              <li key={f.path}>
                <label className="check">
                  <input type="checkbox" checked={picked.has(f.spec!.name)} onChange={() => toggle(f.spec!.name)} />
                  <span className="board-import-title">{f.spec!.name}</span>
                  <span className="muted small">{f.spec!.checks.length} check{f.spec!.checks.length === 1 ? '' : 's'}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="field">
          <span>Agents</span>
          {contestants.map((c, i) => {
            const a = getAgent(c.agent)
            return (
              <div key={i} className="evals-contestant">
                <select value={c.agent} onChange={(e) => set(i, { agent: e.target.value, model: '' })} aria-label="Agent">
                  {agents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <input list={`models-${i}`} value={c.model ?? ''} onChange={(e) => set(i, { model: e.target.value })} placeholder={a.modelPlaceholder ?? 'default model'} aria-label="Model" />
                <datalist id={`models-${i}`}>{a.models.map((m) => <option key={m} value={m} />)}</datalist>
                <button type="button" className="icon-btn" disabled={contestants.length === 1} title="Remove" aria-label="Remove" onClick={() => setContestants((cs) => cs.filter((_, n) => n !== i))}><X size={13} /></button>
              </div>
            )
          })}
          <button type="button" className="btn sm evals-add" onClick={() => setContestants((cs) => [...cs, { agent: def }])}><Plus size={12} /> Add an agent or model</button>
          {dupes && <span className="field-hint evals-error">The same agent and model is listed twice.</span>}
        </div>
        <div className="field">
          <span>Prompts</span>
          <ul className="board-import-list">
            <li>
              <label className="check">
                <input type="checkbox" checked={asWritten || !chosen.length} disabled={!chosen.length} onChange={(e) => setAsWritten(e.target.checked)} />
                <span className="board-import-title">As written</span>
                <span className="muted small">the eval's brief alone</span>
              </label>
            </li>
            {prompts.map((p) => (
              <li key={p.path}>
                <label className="check">
                  <input type="checkbox" checked={usePrompts.has(p.name)} onChange={() => togglePrompt(p.name)} />
                  <span className="board-import-title">{p.name}</span>
                  <span className="muted small evals-prompt-peek">{p.text.replace(/<!--[\s\S]*?-->/g, '').trim().split('\n')[0]}</span>
                </label>
                <button type="button" className="icon-btn" title="Open in your editor" aria-label="Open in your editor" onClick={() => void openInEditor(p.path)}><ExternalLink size={12} /></button>
              </li>
            ))}
          </ul>
          {newName === null ? (
            <button type="button" className="btn sm evals-add" onClick={() => setNewName('')}><Plus size={12} /> New prompt variant</button>
          ) : (
            <div className="evals-contestant">
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void createPrompt() } if (e.key === 'Escape') { e.stopPropagation(); setNewName(null) } }} placeholder="A name, e.g. tests first" aria-label="Prompt name" />
              <button type="button" className="btn sm" onClick={() => void createPrompt()}>Create and edit</button>
            </div>
          )}
          <span className="field-hint">Each variant's text goes before the brief, for every agent: measure which instructions work on your code before you put them in your rules. Files in .sldev/evals/prompts.</span>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Attempts each</span>
            <select value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
              {[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="field-hint">Agents vary from run to run: three attempts tell you more than one.</span>
          </label>
          <label className="field">
            <span>At a time</span>
            <select value={parallel} onChange={(e) => setParallel(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="field-hint">Parallel attempts finish sooner but share your machine and your plan's limits.</span>
          </label>
        </div>
      </div>
    </Modal>
  )
}
