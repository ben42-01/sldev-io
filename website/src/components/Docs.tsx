import { ArrowRight } from 'lucide-react'
import { docs, type DocPage } from '../content/docs'

/** /docs: every guide, one card each. */
export function DocsIndex() {
  return (
    <section className="section page-first">
      <div className="container docs-index">
        {docs.map((d) => (
          <a key={d.id} className="docs-card" href={`/docs/${d.id}`}>
            <h2>{d.title}</h2>
            <p>{d.summary}</p>
            <span className="docs-card-more">
              Read the guide <ArrowRight size={14} />
            </span>
          </a>
        ))}
      </div>
    </section>
  )
}

/** One guide: its sections, with a table of contents that stays in view on wide screens. */
export function DocArticle({ page }: { page: DocPage }) {
  return (
    <section className="docs">
      <div className="container docs-inner">
        <nav className="docs-toc" aria-label="On this page">
          <a className="docs-back" href="/docs">All docs</a>
          <Toc page={page} />
        </nav>
        <article className="docs-body">
          <p className="eyebrow">
            <a href="/docs">Docs</a>
          </p>
          <h1>{page.title}</h1>
          <p className="docs-summary">{page.summary}</p>
          {/* phones: the contents fold away under the title instead of pushing the guide down */}
          <details className="docs-toc-mobile">
            <summary>On this page</summary>
            <Toc page={page} />
          </details>
          {page.sections.map((s) => (
            <section key={s.id} id={s.id}>
              <h2>
                <a href={`#${s.id}`}>{s.title}</a>
              </h2>
              {s.body}
            </section>
          ))}
        </article>
      </div>
    </section>
  )
}

function Toc({ page }: { page: DocPage }) {
  return (
    <ol>
      {page.sections.map((s) => (
        <li key={s.id}>
          <a href={`#${s.id}`}>{s.title}</a>
        </li>
      ))}
    </ol>
  )
}
