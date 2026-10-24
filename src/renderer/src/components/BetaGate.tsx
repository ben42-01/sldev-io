import { ExternalLink, FolderOpen, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { formatBetaDate } from '@shared/beta'
import { beta, pricingUrl, recheckBeta } from '../state/beta'
import { useStore } from '../state/store'
import { Logo } from './Logo'

/** Full-screen page shown instead of the workspace when the free beta has ended. Data is untouched. */
export function BetaEnded(): React.JSX.Element {
  const status = useStore(beta, (b) => b.status)
  const [checking, setChecking] = useState(false)
  const recheck = async (): Promise<void> => {
    setChecking(true)
    await recheckBeta()
    setChecking(false)
  }
  return (
    <div className="beta-ended">
      <div className="beta-ended-card brand-frame">
        <Logo size={44} stroke={1} />
        <h1>The sldev-io beta has ended</h1>
        <p>
          Thanks for testing{status?.config.endsAt ? ` until ${formatBetaDate(status.config.endsAt)}` : ''}. Get a license to keep going.
          Your terminals, missions, notes, connections and settings are all still here and come back exactly as you left them.
        </p>
        <div className="beta-ended-actions">
          <button className="btn primary" onClick={() => void window.api.shell.openExternal(pricingUrl())}>
            <ExternalLink size={14} /> Get sldev-io
          </button>
          <button className="btn" disabled={checking} onClick={() => void recheck()}>
            <RefreshCw size={14} /> {checking ? 'Checking…' : 'Check again'}
          </button>
          <button className="btn" onClick={() => void window.api.app.openDataFolder()}>
            <FolderOpen size={14} /> Open data folder
          </button>
        </div>
      </div>
    </div>
  )
}

/** Thin bar under the title bar during the last days of the beta. */
export function BetaBanner(): React.JSX.Element | null {
  const status = useStore(beta, (b) => b.status)
  const dismissed = useStore(beta, (b) => b.dismissed)
  if (dismissed || status?.phase !== 'ending' || !status.config.endsAt) return null
  const days = status.daysLeft ?? 0
  return (
    <div className="beta-banner">
      <span>
        The free beta ends on <strong>{formatBetaDate(status.config.endsAt)}</strong> ({days === 1 ? 'last day' : `${days} days left`}).
      </span>
      <button className="link" onClick={() => void window.api.shell.openExternal(pricingUrl())}>
        Get sldev-io
      </button>
      <button className="icon-btn" title="Dismiss until next start" onClick={() => beta.set({ dismissed: true })}>
        <X size={13} />
      </button>
    </div>
  )
}

/** Status-bar chip while the beta has an end date. */
export function BetaChip(): React.JSX.Element | null {
  const status = useStore(beta, (b) => b.status)
  if (!status || (status.phase !== 'active' && status.phase !== 'ending') || status.daysLeft === null) return null
  return (
    <button
      className={`status-item clickable${status.phase === 'ending' ? ' warn' : ''}`}
      title={`Free beta until ${formatBetaDate(status.config.endsAt ?? '')}`}
      onClick={() => void window.api.shell.openExternal(pricingUrl())}
    >
      beta · {status.daysLeft === 1 ? 'last day' : `${status.daysLeft} days left`}
    </button>
  )
}
