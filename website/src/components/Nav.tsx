import { Download, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { site } from '../lib/site'
import { Logo } from './Logo'

export type NavPage = 'app' | 'features' | 'cli' | 'download' | 'docs'

// the app's own pages (features, download) light up "App"
const links: { pages?: NavPage[]; href: string; label: string }[] = [
  { pages: ['app', 'features', 'download'], href: '/app', label: 'App' },
  { pages: ['cli'], href: '/cli', label: 'CLI' },
  { pages: ['docs'], href: '/docs', label: 'Docs' },
  { href: site.sourceUrl, label: 'GitHub' },
  { href: site.sponsorUrl, label: 'Sponsor' }
]

export function Nav({ active }: { active?: NavPage }) {
  const [open, setOpen] = useState(false)
  return (
    <header className="nav">
      <div className="container nav-inner">
        <a href="/" className="nav-logo" aria-label={`${site.brand} home`}>
          <Logo />
          <span>{site.brand}</span>
        </a>
        <nav className={`nav-links${open ? ' open' : ''}`} aria-label="Main">
          {links.map((l) => (
            <a key={l.href} href={l.href} aria-current={active && l.pages?.includes(active) ? 'page' : undefined} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <a className="btn primary nav-cta-mobile" href="/download" onClick={() => setOpen(false)}>
            <Download size={14} /> Download the app
          </a>
        </nav>
        <a className="btn primary nav-cta" href="/download" aria-current={active === 'download' ? 'page' : undefined}>
          <Download size={14} /> Download
        </a>
        <button className="nav-toggle" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>
    </header>
  )
}
