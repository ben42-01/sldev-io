import { Bug, ExternalLink } from 'lucide-react'
import { released } from '@shared/changelog'
import { reportBug, siteLink } from '../state/updates'
import { useStore } from '../state/store'
import { whatsNew } from '../state/whatsNew'

export function WhatsNewPanel(): React.JSX.Element {
  const picked = useStore(whatsNew, (s) => s.entries)
  const entries = picked.length ? picked : released(__CHANGELOG__)
  return (
    <div className="panel-page settings whats-new">
      <div className="panel-page-head">
        <h2>What's new</h2>
        {picked.length > 0 && <span className="muted">since you last opened sldev-io</span>}
      </div>
      {entries.map((e) => (
        <section key={e.version}>
          <h3>
            {e.version} {e.date && <span className="muted">{e.date}</span>}
          </h3>
          <ul className="whats-new-list">
            {e.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      ))}
      <div className="about-actions">
        <button className="btn sm" onClick={() => void window.api.shell.openExternal(siteLink('/changelog'))}>
          <ExternalLink size={13} /> Full changelog
        </button>
        <button className="btn sm" onClick={reportBug}>
          <Bug size={13} /> Report a bug or idea
        </button>
      </div>
    </div>
  )
}
