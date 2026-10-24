import { site } from '../lib/pricing'
import { DownloadButton } from './Download'
import { Logo } from './Logo'

export function FinalCta() {
  return (
    <section className="section final">
      <div className="container center">
        <h2>
          Stop juggling terminals.
          <br />
          <span className="brand-text">Start shipping with agents.</span>
        </h2>
        <div className="hero-cta">
          <DownloadButton />
        </div>
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
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="/refunds">Refunds</a>
      </div>
    </footer>
  )
}
