import { site } from '../lib/pricing'
import { CopyCommand, DownloadButton } from './Download'
import { Logo } from './Logo'

export function FinalCta({ install = false }: { install?: boolean }) {
  return (
    <section className="section final">
      <div className="container center">
        <h2>
          Stop juggling terminals.
          <br />
          <span className="brand-text">Lead a team of agents.</span>
        </h2>
        <div className="hero-cta">
          <DownloadButton />
        </div>
        {install && (
          <>
            <p className="final-or">or, on macOS and Linux</p>
            <div className="final-install"><CopyCommand /></div>
          </>
        )}
        <p className="platforms">
          <a href="/download">{site.platforms.join(' · ')}</a>
        </p>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span className="nav-logo">
          <Logo size={18} /> {site.name}
        </span>
        <span className="muted">© {new Date().getFullYear()} {site.name}</span>
        <span className="grow" />
        <a href={`mailto:${site.contactEmail}`}>Contact</a>
        <a href={site.repoUrl}>GitHub</a>
        <a href="/pricing">Pricing</a>
        <a href="/docs">Docs</a>
        <a href="/compare">Compare</a>
        <a href="/changelog">Changelog</a>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="/refunds">Refunds</a>
      </div>
    </footer>
  )
}
