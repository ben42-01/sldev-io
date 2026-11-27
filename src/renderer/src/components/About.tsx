import { Bug, Check, Copy, Download, ExternalLink, FolderOpen, Heart, MessageSquare, RefreshCw, RotateCw, Sparkles, Star } from 'lucide-react'
import type { UpdateStatus } from '@shared/types'
import { installText } from '@shared/updates'
import { useState } from 'react'
import { checkForUpdates, diagnostics, downloadUpdate, openSource, openSponsor, reportBug, siteLink, updates } from '../state/updates'
import { openWhatsNew } from '../state/whatsNew'
import { useStore } from '../state/store'
import { Logo } from './Logo'

const links = [
  { label: 'Website', path: '/' },
  { label: 'Privacy policy', path: '/privacy' }
]

function UpdateRow(): React.JSX.Element {
  const status = useStore(updates, (u) => u.status)
  const [busy, setBusy] = useState(false)
  const check = async (): Promise<void> => {
    setBusy(true)
    await checkForUpdates()
    setBusy(false)
  }
  if (!status) return <div className="muted">Checking how this copy was installed…</div>
  const kind = installText(status)
  const how = (
    <p className="muted small about-install" data-testid="about-install">
      <b>{kind.label}.</b> {kind.update}
    </p>
  )
  if (status.state === 'unsupported') return how
  const text: Record<UpdateStatus['state'], string> = {
    unsupported: '',
    idle: 'Checks for updates automatically.',
    checking: 'Checking for updates…',
    none: 'You have the latest version.',
    available: `Version ${status.version} is available.`,
    downloading: `Downloading ${status.version}… ${status.percent ?? 0}%`,
    ready: `Version ${status.version} is ready to install.`,
    error: `Couldn't check for updates: ${status.error}`
  }
  return (
    <>
      <div className="about-update">
        <span className={status.state === 'error' ? 'bad' : status.state === 'ready' || status.state === 'available' ? 'ok' : undefined}>
          {text[status.state]}
        </span>
        {status.state === 'ready' ? (
          <button className="btn sm primary" onClick={() => void window.api.update.install()}>
            <RotateCw size={13} /> Restart to update
          </button>
        ) : status.state === 'available' && status.manual ? (
          <button className="btn sm primary" onClick={downloadUpdate}>
            <Download size={13} /> Download
          </button>
        ) : (
          <button className="btn sm" disabled={busy || status.state === 'checking' || status.state === 'downloading'} onClick={() => void check()}>
            <RefreshCw size={13} /> Check for updates
          </button>
        )}
      </div>
      {how}
    </>
  )
}

export function AboutSection(): React.JSX.Element {
  const info = useStore(updates, (u) => u.info)
  const status = useStore(updates, (u) => u.status)
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    if (!info) return
    void navigator.clipboard.writeText(diagnostics(info, status)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <section id="settings-about" className="about">
      <h3>About</h3>
      <div className="about-head">
        <Logo size={36} stroke={1.2} />
        <div>
          <div className="about-name">
            sldev-io <span className="mono">{info?.version ?? '…'}</span>
            {info?.channel === 'beta' && <span className="about-tag">beta</span>}
          </div>
          <div className="muted">The terminal-first workspace for agentic coding.</div>
        </div>
      </div>
      <div className="about-sponsor">
        <p>sldev-io is free and open source. If it saves you time, a star or a sponsorship keeps it going.</p>
        <div className="about-actions">
          <button className="btn sm" onClick={openSource}>
            <Star size={13} /> Star on GitHub
          </button>
          <button className="btn sm" onClick={openSponsor}>
            <Heart size={13} /> Sponsor
          </button>
        </div>
      </div>
      <UpdateRow />
      {info && (
        <dl className="about-details">
          <dt>Electron</dt>
          <dd>{info.electron}</dd>
          <dt>Chromium</dt>
          <dd>{info.chrome}</dd>
          <dt>Node.js</dt>
          <dd>{info.node}</dd>
          <dt>System</dt>
          <dd>
            {info.os} ({info.arch})
          </dd>
        </dl>
      )}
      <div className="about-actions">
        <button className="btn sm" disabled={!info} onClick={copy}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy diagnostics'}
        </button>
        <button className="btn sm" onClick={() => void window.api.app.openDataFolder()}>
          <FolderOpen size={13} /> Open data folder
        </button>
        <button className="btn sm" onClick={() => openWhatsNew()}>
          <Sparkles size={13} /> What's new
        </button>
        <button className="btn sm" onClick={reportBug}>
          <Bug size={13} /> Report a bug or idea
        </button>
      </div>
      <div className="about-links">
        {links.map((l) => (
          <button key={l.path} className="link" onClick={() => void window.api.shell.openExternal(siteLink(l.path))}>
            {l.label} <ExternalLink size={11} />
          </button>
        ))}
      </div>
      <p className="muted small">No telemetry: sldev-io doesn't send usage data anywhere.</p>
    </section>
  )
}

/** Status-bar chip once an update is ready (or, on macOS, available to download). */
export function UpdateChip(): React.JSX.Element | null {
  const status = useStore(updates, (u) => u.status)
  if (status?.state === 'ready') {
    return (
      <button
        className="status-item clickable ok"
        title={
          status.install === 'deb' ? `Restart to install ${status.version} (asks for your administrator password)` : `Restart to install ${status.version}`
        }
        onClick={() => void window.api.update.install()}
      >
        <RotateCw size={12} /> restart to update
      </button>
    )
  }
  if (status?.state === 'available' && status.manual) {
    return (
      <button className="status-item clickable" title={`Download ${status.version}`} onClick={downloadUpdate}>
        <Download size={12} /> update available
      </button>
    )
  }
  return null
}

/** Beta builds only: a standing invitation to report what broke. */
export function FeedbackChip(): React.JSX.Element | null {
  const beta = useStore(updates, (u) => u.info?.channel === 'beta')
  if (!beta) return null
  return (
    <button className="status-item clickable" title="Report a bug or send an idea (opens GitHub)" onClick={reportBug}>
      <MessageSquare size={12} /> feedback
    </button>
  )
}
