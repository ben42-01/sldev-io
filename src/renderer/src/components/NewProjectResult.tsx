import { useEffect, useState } from 'react'
import { CloudUpload, ExternalLink, FileWarning, PackageCheck } from 'lucide-react'
import type { Mission } from '@shared/types'
import { CreateRepoDialog } from './CreateRepoDialog'
import { NEW_PROJECT_RESULT, parseNewProjectResult, type NewProjectResult as Result } from '@shared/sldevSkills'

type Read = { state: 'loading' } | { state: 'ok'; result: Result; warning?: string } | { state: 'missing' } | { state: 'bad'; error: string }

/**
 * What a New project mission set up, read from the .sldev/runs/new-project.json it writes. Read once its agent
 * stops (waiting, ended, failed); a missing or unreadable file says so instead of showing nothing.
 */
export function NewProjectResult({ mission: m }: { mission: Mission }): React.JSX.Element | null {
  const resting = m.status === 'waiting' || m.status === 'ended' || m.status === 'failed'
  const [read, setRead] = useState<Read>({ state: 'loading' })
  // the project's origin: undefined while unknown, null when it has none (then it can be created on GitHub)
  const [origin, setOrigin] = useState<string | null | undefined>(undefined)
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    if (!resting) return
    let live = true
    void window.api.newProject.result(m.cwd).then(
      (text) => {
        if (!live) return
        if (text === null) return setRead({ state: 'missing' })
        const r = parseNewProjectResult(text)
        setRead(r.result ? { state: 'ok', result: r.result, warning: r.warning } : { state: 'bad', error: r.error ?? 'It isn’t a result file.' })
      },
      () => live && setRead({ state: 'missing' })
    )
    return () => {
      live = false
    }
  }, [m.status, m.cwd, resting])
  useEffect(() => {
    if (!resting) return
    let live = true
    void window.api.gh.repoPushPlan(m.cwd).then(
      (p) => live && setOrigin(p.origin),
      () => live && setOrigin(undefined)
    )
    return () => {
      live = false
    }
  }, [m.status, m.cwd, resting, creating])
  if (!resting || read.state === 'loading') return null
  if (read.state === 'ok') {
    const r = read.result
    return (
      <div className="np-result" data-testid="np-result">
        <div className="np-result-head">
          <PackageCheck size={12} />
          <b className="mono">{r.name}</b>
          <span className="muted">{r.stack}</span>
        </div>
        <div className="np-result-cmds">
          <span>build <code>{r.build}</code></span>
          <span>test <code>{r.test}</code></span>
          {r.license && <span>{r.license}</span>}
        </div>
        {read.warning && <div className="np-result-note">{read.warning}</div>}
        {origin ? (
          <div className="np-result-remote" data-testid="np-remote">
            <span>origin</span>
            {/^https:\/\//.test(origin) ? (
              <button type="button" className="np-result-link mono" title={`Open ${origin}`} onClick={() => void window.api.shell.openExternal(origin)}>
                {origin.replace(/^https:\/\//, '').replace(/\.git$/, '')} <ExternalLink size={10} />
              </button>
            ) : (
              <span className="mono">{origin}</span>
            )}
          </div>
        ) : origin === null && m.status !== 'failed' ? (
          r.checks === 'passed' ? (
            <button type="button" className="btn np-result-create" data-testid="np-create-repo" onClick={() => setCreating(true)}>
              <CloudUpload size={12} /> Create repository on GitHub…
            </button>
          ) : (
            <div className="np-result-note">
              {r.checks === 'failed' ? 'The build or tests didn’t pass' : 'The agent didn’t say the build and tests pass'}, so it isn’t offered on GitHub yet. Ask it to fix them in a follow-up.
            </div>
          )
        ) : null}
        {creating && <CreateRepoDialog dir={m.cwd} suggested={r.name} onClose={() => setCreating(false)} onCreated={(url) => setOrigin(url)} />}
      </div>
    )
  }
  return (
    <div className="np-result np-result-missing" data-testid="np-result" role="status">
      <FileWarning size={12} />
      <span>
        {read.state === 'missing'
          ? m.status === 'waiting'
            ? `No result yet: ${NEW_PROJECT_RESULT} hasn’t been written.`
            : `No result: the agent didn’t write ${NEW_PROJECT_RESULT}.`
          : `The result in ${NEW_PROJECT_RESULT} can’t be read: ${read.error}`}
      </span>
    </div>
  )
}
