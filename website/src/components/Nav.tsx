import { Download, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { site } from '../lib/pricing'
import { Logo } from './Logo'

export type NavPage = 'features' | 'pricing' | 'download' | 'docs'

const links: { page?: NavPage; href: string; label: string }[] = [
  { href: '/#how', label: 'How it works' },
  { page: 'features', href: '/features', label: 'Features' },
  { page: 'pricing', href: '/pricing', label: 'Pricing' },
  { page: 'docs', href: '/docs', label: 'Docs' },
  { href: site.cliUrl, label: 'sldev CLI (free)' }
]

export function Nav({ active }: { active?: NavPage }) {
  const [open, setOpen] = useState(false)
  return (
    <header className="nav">
      <div className="container nav-inner">
        <a href="/" className="nav-logo" aria-label={`${site.name} home`}>
          <Logo />
          <span>{site.name}</span>
        </a>
        <nav className={`nav-links${open ? ' open' : ''}`} aria-label="Main">
          {links.map((l) => (
            <a key={l.href} href={l.href} aria-current={l.page && l.page === active ? 'page' : undefined} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <a className="btn primary nav-cta-mobile" href="/download" onClick={() => setOpen(false)}>
            <Download size={14} /> Download
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
