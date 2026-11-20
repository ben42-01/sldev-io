import { hrefTo } from './Chrome'
import { FEATURES } from './features'

/** One card per thing the CLI does, each naming the command or key that does it (linked to /cli/commands). */
export function Features() {
  return (
    <section className="section" id="features">
      <div className="container">
        <h2>What it does</h2>
        <p className="section-lede">Everything below is in the CLI today. Each card names the command or key that does it.</p>
        <ul className="features">
          {FEATURES.map((f) => (
            <li key={f.title} className="feature">
              <h3>{f.title}</h3>
              <p>{f.text}</p>
              <ul className="uses" aria-label="Uses">
                {f.uses.map((u) => (
                  <li key={u.text}>
                    {u.command ? (
                      <a className="use" href={hrefTo('commands', `#${u.command}`)}>
                        <code>{u.text}</code>
                      </a>
                    ) : (
                      <code className="use">{u.text}</code>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
