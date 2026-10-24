import { Download, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { site } from '../lib/pricing'
import { Logo } from './Logo'

const links = [
  { href: '#features', label: 'Features' },
  { href: '#agents', label: 'Agents' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' }
]

export function Nav() {
  const [open, setOpen] = useState(false)
  return (
    <header className="nav">
      <div className="container nav-inner">
        <a href="#top" className="nav-logo" aria-label={`${site.name} home`}>
          <Logo />
          <span>{site.name}</span>
        </a>
        <nav className={`nav-links${open ? ' open' : ''}`} aria-label="Main">
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <a className="btn primary nav-cta-mobile" href="#download" onClick={() => setOpen(false)}>
            <Download size={14} /> Download
          </a>
        </nav>
        <a className="btn primary nav-cta" href="#download">
          <Download size={14} /> Download
        </a>
        <button className="nav-toggle" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>
    </header>
  )
}
