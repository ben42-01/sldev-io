import { legalPages, type LegalPageId } from '../content/legal'
import { site } from '../lib/pricing'

export function LegalPage({ id }: { id: LegalPageId }) {
  const p = legalPages[id]
  const updated = new Date(`${site.legal.updatedAt}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  return (
    <section className="legal">
      <div className="container legal-inner">
        <p className="eyebrow">Legal</p>
        <h1>{p.title}</h1>
        <p className="legal-summary">{p.summary}</p>
        <p className="legal-updated">Last updated {updated}</p>
        <nav className="legal-tabs" aria-label="Legal pages">
          {Object.values(legalPages).map((l) => (
            <a key={l.id} href={`/${l.id}`} aria-current={l.id === id ? 'page' : undefined}>
              {l.title.split(' and ')[0]}
            </a>
          ))}
        </nav>
        <article className="legal-body">{p.body}</article>
      </div>
    </section>
  )
}
