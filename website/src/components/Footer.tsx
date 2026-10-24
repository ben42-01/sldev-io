import { Download } from 'lucide-react'
import { site } from '../lib/pricing'
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
          <a className="btn primary lg" href={site.downloadUrl}>
            <Download size={16} /> Download sldev-io
          </a>
        </div>
        <p className="platforms">{site.platforms.join(' · ')}</p>
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
        <a href="#pricing">Pricing</a>
      </div>
    </footer>
  )
}
