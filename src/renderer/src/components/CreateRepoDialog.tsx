import { useEffect, useState } from 'react'
import { CloudUpload, Globe, Lock } from 'lucide-react'
import { repoNameProblem, type RepoOwners, type RepoPushPlan, type RepoVisibility } from '@shared/newProject'
import { errText } from '../lib/removals'
import { Modal } from './Modal'
import { ErrorBanner, Loading } from './States'
import { toast } from './Toast'

/**
 * New project → Create repository on GitHub: the one place a new project gets a remote. Nothing is created or
 * pushed until the Create click; main checks again (signed in, name free, a commit, no origin) before gh runs.
 */
export function CreateRepoDialog({ dir, suggested, onClose, onCreated }: { dir: string; suggested: string; onClose: () => void; onCreated: (url: string) => void }): React.JSX.Element {
  const [owners, setOwners] = useState<(RepoOwners & { loading?: false }) | { loading: true }>({ loading: true })
  const [plan, setPlan] = useState<RepoPushPlan | null>(null)
  const [owner, setOwner] = useState('')
  const [name, setName] = useState(suggested)
  const [visibility, setVisibility] = useState<RepoVisibility>('private')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const loadOwners = (): void => {
    setOwners({ loading: true })
    window.api.gh.repoOwners().then(
      (r) => {
        setOwners(r)
        setOwner((o) => (o && r.owners.includes(o) ? o : (r.owners[0] ?? '')))
      },
      (e) => setOwners({ owners: [], error: errText(e) })
    )
  }
  useEffect(loadOwners, [])
  useEffect(() => {
    void window.api.gh.repoPushPlan(dir).then(setPlan, () => setPlan({ branch: null, commits: 0, origin: null }))
  }, [dir])

  const nameProblem = repoNameProblem(name)
  const ownersError = !owners.loading ? owners.error : undefined
  const blocker = plan?.origin ? `This project already has a remote: origin is ${plan.origin}.` : plan && !plan.commits ? 'There is no commit to push yet.' : null
  const can = !owners.loading && !ownersError && !!owner && !nameProblem && !!plan && !blocker && !creating
  const full = `${owner || '…'}/${name.trim() || '…'}`

  const create = async (): Promise<void> => {
    if (!can) return
    setError('')
    setCreating(true)
    try {
      const url = await window.api.gh.createRepo({ dir, owner, name: name.trim(), visibility, description })
      toast(`Created ${owner}/${name.trim()} on GitHub and pushed ${plan?.branch ?? 'the project'}`)
      onCreated(url)
      onClose()
    } catch (e) {
      setError(errText(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal
      title="Create repository on GitHub"
      size="md"
      busy={creating}
      onClose={onClose}
      onSubmit={() => void create()}
      footerNote="Through your GitHub CLI, as you. Only this click creates or pushes anything."
      footer={
        <>
          <button type="button" className="btn ghost" disabled={creating} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!can} data-testid="create-repo">
            <CloudUpload size={13} /> {creating ? 'Creating and pushing…' : 'Create and push'}
          </button>
        </>
      }
    >
      {ownersError && (
        <ErrorBanner onRetry={loadOwners}>{ownersError} Nothing can be created until the GitHub CLI works.</ErrorBanner>
      )}
      <div className="field-row">
        <label className="field cr-owner">
          <span>Owner</span>
          {owners.loading ? (
            <Loading what="Asking GitHub…" />
          ) : (
            <select value={owner} disabled={creating || !owners.owners.length} onChange={(e) => setOwner(e.target.value)}>
              {owners.owners.map((o, i) => (
                <option key={o} value={o}>
                  {o}
                  {i === 0 ? ' (you)' : ''}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="field cr-name">
          <span>Name</span>
          <input className="mono" value={name} disabled={creating} spellCheck={false} onChange={(e) => setName(e.target.value)} />
          {nameProblem && <span className="field-hint np-problem">{nameProblem}</span>}
        </label>
      </div>
      <div className="field">
        <span>Visibility</span>
        <div className="np-choices cr-visibility" role="radiogroup" aria-label="Visibility">
          <button type="button" role="radio" aria-checked={visibility === 'private'} className={`np-choice${visibility === 'private' ? ' on' : ''}`} disabled={creating} onClick={() => setVisibility('private')}>
            <Lock size={14} />
            <span>
              <b>Private</b>
              <span className="muted small">Only you and those you invite</span>
            </span>
          </button>
          <button type="button" role="radio" aria-checked={visibility === 'public'} className={`np-choice${visibility === 'public' ? ' on' : ''}`} disabled={creating} onClick={() => setVisibility('public')}>
            <Globe size={14} />
            <span>
              <b>Public</b>
              <span className="muted small">Anyone on the internet can see it</span>
            </span>
          </button>
        </div>
      </div>
      <label className="field cr-desc">
        <span>Description</span>
        <input value={description} disabled={creating} placeholder="Optional, shown on GitHub" onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="cr-summary" data-testid="create-repo-summary">
        {blocker ? (
          <span className="np-problem">{blocker}</span>
        ) : (
          <>
            Creates <b className="mono">{full}</b> on GitHub as a <b>{visibility}</b> repository, sets it as <code>origin</code> in{' '}
            <span className="mono">{dir}</span> and pushes{' '}
            {plan ? (
              <>
                <b className="mono">{plan.branch ?? 'the current branch'}</b> ({plan.commits} commit{plan.commits === 1 ? '' : 's'})
              </>
            ) : (
              'the current branch'
            )}
            . Nothing else in the project changes. A name that already exists is refused before anything is created.
          </>
        )}
      </div>
      {error && (
        <ErrorBanner>
          <pre className="cr-error">{error}</pre>
          {!/push didn’t finish/.test(error) && <span className="muted small">Nothing was created; your project is as it was.</span>}
        </ErrorBanner>
      )}
    </Modal>
  )
}
