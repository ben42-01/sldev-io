import { Check, Copy, Download as DownloadIcon } from 'lucide-react'
import { useState } from 'react'
import { detectPlatform, downloadHref, installCommand, platformLabels, type Platform } from '../lib/download'

/** "Download for Windows" on desktops we build for; otherwise a jump to the download section. */
export function DownloadButton({ className = 'btn primary lg', size = 16 }: { className?: string; size?: number }) {
  const platform = detectPlatform()
  return platform ? (
    <a className={className} href={downloadHref(platform)}>
      <DownloadIcon size={size} /> Download for {platformLabels[platform]}
    </a>
  ) : (
    <a className={className} href="/#download">
      <DownloadIcon size={size} /> Download
    </a>
  )
}

interface Card {
  id: 'windows' | 'mac' | 'linux'
  name: string
  note: string
  files: { platform: Platform; label: string }[]
}

const cards: Card[] = [
  { id: 'windows', name: 'Windows', note: 'Windows 10 and 11, 64-bit', files: [{ platform: 'windows', label: 'Installer (.exe)' }] },
  {
    id: 'mac',
    name: 'macOS',
    note: 'macOS 12 or newer',
    files: [
      { platform: 'mac', label: 'Apple Silicon (.dmg)' },
      { platform: 'mac-intel', label: 'Intel (.dmg)' }
    ]
  },
  { id: 'linux', name: 'Linux', note: 'Debian, Ubuntu and derivatives, x86_64', files: [{ platform: 'linux', label: 'Package (.deb)' }] }
]

function CopyCommand() {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard.writeText(installCommand).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="install-cmd">
      <code>
        <span className="prompt">$</span> {installCommand}
      </code>
      <button className="btn" onClick={copy} aria-label="Copy install command">
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export function DownloadSection() {
  const detected = detectPlatform()
  const current = detected === 'mac-intel' ? 'mac' : detected
  return (
    <section className="section" id="download">
      <div className="container">
        <p className="eyebrow center">Download</p>
        <h2 className="center">Get sldev-io</h2>
        <p className="section-lead center">Free during the beta. Pick your system, or install from a terminal.</p>
        <div className="downloads">
          {cards.map((c) => (
            <article key={c.id} className={`download-card${c.id === current ? ' current brand-frame' : ''}`}>
              <h3>{c.name}</h3>
              <p className="muted">{c.note}</p>
              <div className="download-files">
                {c.files.map((f, i) => (
                  <a key={f.platform} className={`btn${c.id === current && i === 0 ? ' primary' : ''}`} href={downloadHref(f.platform)}>
                    <DownloadIcon size={14} /> {f.label}
                  </a>
                ))}
              </div>
            </article>
          ))}
        </div>
        <p className="install-label">macOS and Linux, from a terminal</p>
        <CopyCommand />
        <p className="download-note">
          Builds aren't code-signed yet. Windows: <b>More info → Run anyway</b>. macOS: right-click the app and choose{' '}
          <b>Open</b> the first time (the terminal install skips this).
        </p>
      </div>
    </section>
  )
}
