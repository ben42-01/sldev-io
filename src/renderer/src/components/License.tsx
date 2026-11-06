import { KeyRound, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { formatBetaDate } from '@shared/beta'
import { beta } from '../state/beta'
import { activateLicense, checkLicense, deactivateLicense, license } from '../state/license'
import { useStore } from '../state/store'
import { openSettings } from '../lib/commands'
import { scrollToTop } from '../lib/scroll'
import { confirmAction } from './Modal'
import { Plans } from './Plans'

const planName = { personal: 'Personal', team: 'Team' } as const

/** Key field + Activate, used in Settings and on the "ended" screen. */
export function LicenseForm({ autoFocus = false }: { autoFocus?: boolean }): React.JSX.Element {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await activateLicense(key)
      setKey('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="license-form" onSubmit={(e) => void submit(e)}>
      <div className="license-row">
        <input className="mono" value={key} autoFocus={autoFocus} spellCheck={false} placeholder="Paste your license key" onChange={(e) => setKey(e.target.value)} />
        <button type="submit" className="btn primary" disabled={busy || !key.trim()}>
          <KeyRound size={13} /> {busy ? 'Activating…' : 'Activate'}
        </button>
      </div>
      {error && <div className="bad license-error">{error}</div>}
    </form>
  )
}

export function LicenseSection(): React.JSX.Element {
  const status = useStore(license, (l) => l.status)
  const betaStatus = useStore(beta, (b) => b.status)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const act = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const deactivate = (): void =>
    void confirmAction({
      title: 'Deactivate the license on this machine?',
      message: 'You can activate it again here or on another machine.',
      confirmLabel: 'Deactivate',
      cancelLabel: 'Keep it active',
      danger: true
    }).then((ok) => ok && act(deactivateLicense))
  const betaEnds = betaStatus && betaStatus.phase !== 'off' && betaStatus.config.endsAt ? formatBetaDate(betaStatus.config.endsAt) : null
  const betaEnded = betaStatus?.phase === 'ended'

  return (
    <section id="settings-license">
      <h3>License</h3>
      {status?.devBuild ? (
        <div className="field">
          <span>
            <span className="ok">Development build</span> · running from source, so no license or trial is checked. Installed builds check as usual.
          </span>
        </div>
      ) : status?.licensed ? (
        <>
          <div className="field">
            <span>
              <span className="ok">Licensed</span> · {status.plan ? planName[status.plan] : ''}
              {status.email ? ` · ${status.email}` : ''}
            </span>
            <code className="mono small">{status.maskedKey}</code>
          </div>
          <div className="about-actions">
            <button className="btn sm" disabled={busy} onClick={() => void act(checkLicense)}>
              <RefreshCw size={13} /> Check license
            </button>
            <button className="btn sm" disabled={busy} onClick={deactivate}>
              Deactivate this machine
            </button>
          </div>
        </>
      ) : !status?.available ? (
        <div className="field">
          <span>{betaEnds ? (betaEnded ? `The free beta ended on ${betaEnds}.` : `Free during the beta, until ${betaEnds}.`) : 'Free during the beta.'}</span>
        </div>
      ) : (
        <>
          <div className="field">
            <span>
              {status.trial
                ? status.trial.ended
                  ? 'Your trial has ended. Enter a license key to keep using sldev-io.'
                  : `Trial: ${status.trial.daysLeft} day${status.trial.daysLeft === 1 ? '' : 's'} left. Enter a license key to keep using sldev-io after that.`
                : 'Enter your license key from the receipt email.'}
            </span>
          </div>
          <Plans />
          <LicenseForm />
        </>
      )}
      {status?.message && <div className="warn-text">{status.message}</div>}
      {error && <div className="bad">{error}</div>}
    </section>
  )
}

/** Status-bar chip while a stable build runs on its trial. */
export function TrialChip(): React.JSX.Element | null {
  const status = useStore(license, (l) => l.status)
  if (!status || status.licensed || !status.trial || status.trial.ended) return null
  return (
    <button className={`status-item clickable${status.trial.daysLeft <= 3 ? ' warn' : ''}`} title="Enter a license key" onClick={openLicense}>
      trial · {status.trial.daysLeft === 1 ? 'last day' : `${status.trial.daysLeft} days left`}
    </button>
  )
}

export function openLicense(): void {
  openSettings()
  requestAnimationFrame(() => scrollToTop(document.getElementById('settings-license')))
}
