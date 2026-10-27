import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import type { RulesState } from '@shared/types'
import { openInEditor } from '../lib/actions'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'

type Status = RulesState['targets'][number]['status']

const statusLabel: Record<NonNullable<Status>, string> = {
  off: 'off',
  'in-sync': 'in sync',
  create: 'will create',
  update: 'will update',
  'hand-edited': 'edited by hand'
}

/** Skills → Rules: .sldev/rules.md and the agent files generated from it. */
export function RulesTab(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const [state, setState] = useState<RulesState | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    if (root) void window.api.rules.state(root).then(setState, (e: Error) => setError(e.message))
  }, [root])
  useEffect(() => {
    load()
    // rules.md is edited in the user's editor; pick up the change when they come back
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  if (!root) return <div className="muted-note">Open a project to sync its agent rules.</div>
  if (!state) return <div className="muted-note">Reading rules…</div>

  const run = (p: Promise<unknown>): void => {
    setError('')
    p.then(load, (e: Error) => setError(e.message))
  }
  const create = (): void => run(window.api.rules.create(root).then((p) => openInEditor(p)))
  const sync = (overwrite: string[] = []): void => run(window.api.rules.sync(root, overwrite))
  const pending = state.targets.filter((t) => t.status === 'create' || t.status === 'update').length

  if (state.source === null)
    return (
      <div className="view-scroll rules">
        <p className="muted-note">
          One <code>.sldev/rules.md</code> becomes AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules and Copilot instructions, so every agent follows the same rules.
        </p>
        <div className="rules-actions">
          <button className="btn sm primary" onClick={create}>
            Create from this project's agent files
          </button>
        </div>
        <p className="muted-note">Existing files are read, not changed: their text becomes the first version of rules.md.</p>
        {error && <div className="muted-note bad">{error}</div>}
      </div>
    )

  return (
    <div className="view-scroll rules">
      <div className="rules-actions">
        <button className="btn sm" onClick={() => void openInEditor(state.sourcePath)}>
          <ExternalLink size={13} /> Edit rules.md
        </button>
        <button className="btn sm primary" disabled={!pending} onClick={() => sync()}>
          {pending ? `Sync ${pending} file${pending === 1 ? '' : 's'}` : 'All in sync'}
        </button>
        <button className="icon-btn" title="Rescan" aria-label="Rescan" onClick={load}>
          <RefreshCw size={13} />
        </button>
      </div>
      {state.targets.map((t) => (
        <div key={t.id} className={`rt-row rule-row ${t.status ?? ''}`} title={`Read by ${t.readers}`}>
          <input type="checkbox" checked={t.status !== 'off'} title="Write this file" onChange={(e) => run(window.api.rules.setTarget(root, t.id, e.target.checked))} />
          <div className="rt-main">
            <div className="rt-name mono">{t.path}</div>
            <div className="asset-desc">{t.readers}</div>
          </div>
          <div className="rule-status">
            <span className={`rule-chip ${t.status ?? ''}`}>{t.status ? statusLabel[t.status] : ''}</span>
            {(t.added > 0 || t.removed > 0) && (
              <span className="stats">
                <span className="add">+{t.added}</span> <span className="del">−{t.removed}</span>
              </span>
            )}
            {t.status === 'hand-edited' && (
              <span className="rule-fix">
                <button className="link" onClick={() => void openInEditor(`${root}/${t.path}`)}>open</button>
                {' · '}
                <button className="link" onClick={() => sync([t.id])}>overwrite</button>
              </span>
            )}
          </div>
        </div>
      ))}
      <p className="muted-note">Files edited by hand are never overwritten without asking. Copy what you want to keep into rules.md, then overwrite.</p>
      {error && <div className="muted-note bad">{error}</div>}
    </div>
  )
}
