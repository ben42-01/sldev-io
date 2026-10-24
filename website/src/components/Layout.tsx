import type { ReactNode } from 'react'
import { Footer } from './Footer'
import { Nav, type NavPage } from './Nav'

/** Nav + main + footer, shared by every page. */
export function Layout({ page, children }: { page?: NavPage; children: ReactNode }) {
  return (
    <>
      <Nav active={page} />
      <main>{children}</main>
      <Footer />
    </>
  )
}

/** Top of a sub-page: the hero's grid and glow, smaller. */
export function PageHeader({ eyebrow, title, lead, children }: { eyebrow: string; title: ReactNode; lead?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="hero-glow" aria-hidden="true" />
      <div className="container page-head-inner">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
        {children}
      </div>
    </header>
  )
}
