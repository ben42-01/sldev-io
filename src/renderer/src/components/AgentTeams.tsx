import { useState } from 'react'
import { ChevronRight, Rocket, Users } from 'lucide-react'
import { installSummary, TEAM_TEMPLATES, teamFiles } from '@shared/profiles'
import type { AgentProfile } from '@shared/types'
import { installTeam, loadProjectProfiles, useProjectProfiles } from '../state/profiles'
import { createStore, useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { openNewMission } from './MissionsView'
import { Modal } from './Modal'
import { ErrorBanner, Loading } from './States'
import { toast } from './Toast'
import { errText, showNotice } from '../lib/removals'

const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p

const dialog = createStore<{ open: boolean; n: number }>({ open: false, n: 0 })

export function openAddTeam(): void {
  if (!workspace.get().rootFolder) return void showNotice('Open a folder first', 'A team is installed into a project, as profiles in .sldev/agents.')
  dialog.set({ open: true, n: dialog.get().n + 1 })
  // files may have changed on disk since the last read; the preview's "kept" marks follow them
  void loadProjectProfiles(workspace.get().rootFolder)
}

export function AddTeamHost(): React.JSX.Element | null {
  const s = useStore(dialog, (d) => d)
  const root = useStore(workspace, (w) => w.rootFolder)
  if (!s.open || !root) return null
  return <AddTeamDialog key={s.n} root={root} onClose={() => dialog.set({ open: false, n: s.n })} />
}

/** Pick a team template, see each role before anything is written, then install it into .sldev/agents. */
function AddTeamDialog({ root, onClose }: { root: string; onClose: () => void }): React.JSX.Element {
  const { list } = useProjectProfiles()
  const [picked, setPicked] = useState(TEAM_TEMPLATES[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const template = TEAM_TEMPLATES.find((t) => t.id === picked)
  const plan = template ? teamFiles(template, list.flatMap((p) => (p.path ? [p.path] : []))) : { write: [], skipped: [] }
  const kept = new Set(plan.skipped.map((f) => f.path))

  const install = async (): Promise<void> => {
    if (!template) return
    setBusy(true)
    setError('')
    try {
      const r = await installTeam(root, template.id)
      toast(installSummary(template.name, r.written, r.skipped), r.skipped.length ? 7000 : 3200)
      onClose()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Add a team"
      size="lg"
      busy={busy}
      onClose={onClose}
      onSubmit={() => void install()}
      footerNote="Each role is a file in .sldev/agents you can edit and commit. Files already there are kept."
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !template || plan.write.length === 0} data-autofocus>
            <Users size={13} /> {busy ? 'Installing…' : plan.write.length === 0 ? 'Already installed' : `Install ${plan.write.length} role${plan.write.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <div className="team-templates" role="radiogroup" aria-label="Team templates">
        {TEAM_TEMPLATES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={t.id === picked} className={`team-template${t.id === picked ? ' on' : ''}`} onClick={() => setPicked(t.id)}>
            <Users size={15} />
            <span>
              <b>{t.name}</b>
              <span className="muted small">{t.description}</span>
            </span>
            <span className="chip">{t.profiles.length} roles</span>
          </button>
        ))}
      </div>
      {template && (
        <>
          <div className="section-label">Roles</div>
          <ul className="team-preview" aria-label={`Roles in ${template.name}`}>
            {template.profiles
              .flatMap((r) => [...plan.write, ...plan.skipped].filter((f) => f.profile.id === r.id))
              .map((f) => (
                <li key={f.path} className="team-role-preview">
                  <details>
                    <summary>
                      <ChevronRight size={12} className="team-caret" />
                      <b>{f.profile.name}</b>
                      <span className="muted small team-role-desc">{f.profile.description}</span>
                      <span className="grow" />
                      {kept.has(f.path) ? <span className="chip" title="This file is already in the project; it is kept as it is">kept</span> : <span className="chip mono">{fileName(f.path)}</span>}
                    </summary>
                    <pre className="team-role-text">{f.profile.role}</pre>
                  </details>
                </li>
              ))}
          </ul>
        </>
      )}
      {busy && <Loading what="Writing the role files…" />}
      {error && <ErrorBanner onRetry={() => void install()}>Couldn't install the team: {error}</ErrorBanner>}
    </Modal>
  )
}

/** The project's installed teams in the Agents panel: each team's roles, one click to start a mission as one. */
export function TeamStrip(): React.JSX.Element | null {
  const { list, loading } = useProjectProfiles()
  const teams = new Map<string, AgentProfile[]>()
  for (const p of list) if (p.team) teams.set(p.team, [...(teams.get(p.team) ?? []), p])
  if (!teams.size) return loading ? <Loading what="Reading the project's agent profiles…" /> : null
  // keep each team in its template's order (product owner first), not alphabetical
  const order = (team: string, p: AgentProfile): number => {
    const t = TEAM_TEMPLATES.find((x) => x.name === team)
    const i = t ? t.profiles.findIndex((r) => r.name === p.name) : -1
    return i < 0 ? 99 : i
  }
  return (
    <section className="team-strip" aria-label="Teams">
      {[...teams].map(([team, roles]) => (
        <div key={team} className="team-group">
          <div className="team-group-head">
            <Users size={13} />
            <b>{team}</b>
            <span className="muted small">{roles.length} role{roles.length === 1 ? '' : 's'} · .sldev/agents</span>
          </div>
          <div className="team-roles">
            {[...roles].sort((a, b) => order(team, a) - order(team, b) || a.name.localeCompare(b.name)).map((p) => (
              <button key={p.id} type="button" className="btn sm team-role" title={`${p.description}\nStart a mission as ${p.name}`} onClick={() => openNewMission({ profile: p.id })}>
                <Rocket size={12} /> {p.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
