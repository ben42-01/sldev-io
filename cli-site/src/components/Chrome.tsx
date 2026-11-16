import { useEffect } from 'react'
import { Logo } from './Logo'
import site from '../content/site.json'

export type Page = 'home' | 'commands'

/**
 * Links between pages are relative to the page they're on, so the site works under any base path
 * (`/`, `/downloads.sldev.io/`, a preview folder). Home is the site's root, Commands is `commands/` under it.
 */
export function hrefTo(from: Page, to: Page, hash = ''): string {
  const root = from === 'home' ? './' : '../'
  return `${root}${to === 'home' ? '' : 'commands/'}${hash}`
}

/**
 * The pages are drawn by React after load, so the browser finds no element for a #hash it was opened with
 * (a feature card's link to commands/#review). Scroll to it once the page is there.
 */
function useScrollToHash(): void {
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (!id) return
    const go = (): void => document.getElementById(id)?.scrollIntoView()
    go()
    // web fonts change line heights, so land again once they are in
    void document.fonts?.ready.then(go)
  }, [])
}

export function Nav({ page }: { page: Page }) {
  useScrollToHash()
  return (
    <header className="nav">
      <div className="container nav-inner">
        <a className="nav-logo" href={hrefTo(page, 'home')} aria-label="sldev home">
          <Logo />
          <span>{site.name}</span>
        </a>
        <span className="nav-free">Free</span>
        <nav className="nav-links" aria-label="Pages">
          <a className="nav-link" href={hrefTo(page, 'home')} aria-current={page === 'home' ? 'page' : undefined}>
            Home
          </a>
          <a className="nav-link" href={hrefTo(page, 'home', '#features')}>
            Features
          </a>
          <a className="nav-link" href={hrefTo(page, 'commands')} aria-current={page === 'commands' ? 'page' : undefined}>
            Commands
          </a>
        </nav>
      </div>
    </header>
  )
}

export function Footer({ version }: { version: string }) {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span className="footer-brand">
          <Logo size={16} /> sldev {version}
        </span>
        <span className="muted">Free to use.</span>
        <a className="footer-app" href={site.app.url}>
          Want a window instead? {site.app.name}, the desktop app →
        </a>
      </div>
    </footer>
  )
}
