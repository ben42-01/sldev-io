import changelog from '../content/changelog.json'

/** Released versions only; the app bakes in the same file for its What's new panel. */
export function ChangelogList() {
  return (
    <section className="section page-first">
      <div className="container changelog">
        {changelog
          .filter((e) => e.date !== null)
          .map((e) => (
            <article key={e.version} className="changelog-entry">
              <h2>
                {e.version} <time dateTime={e.date!}>{e.date}</time>
              </h2>
              <ul>
                {e.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </article>
          ))}
      </div>
    </section>
  )
}
