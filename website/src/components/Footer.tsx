import { site } from '../lib/site'
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
          <Logo size={18} /> {site.brand}
        </span>
        <span className="muted">© {new Date().getFullYear()} {site.brand} · free and open source</span>
        <span className="grow" />
        <a href={`mailto:${site.contactEmail}`}>Contact</a>
        <a href={site.sourceUrl}>GitHub</a>
        <a href={site.sponsorUrl}>Sponsor</a>
        <a href="/app">App</a>
        <a href="/cli">CLI</a>
        <a href="/docs">Docs</a>
        <a href="/compare">Compare</a>
        <a href="/changelog">Changelog</a>
        <a href="/privacy">Privacy</a>
      </div>
    </footer>
  )
}
