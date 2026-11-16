import help from 'virtual:cli-help'
import type { HelpCommand, SectionId } from '../scripts/cliHelp'
import { CopyCommand } from './components/CopyCommand'
import { Footer, Nav } from './components/Chrome'
import site from './content/site.json'

const version = __CLI_VERSION__

/** headings for the groups the parser sorts commands into; the commands themselves come from `sldev help` */
const SECTIONS: Record<SectionId, { title: string; text: string }> = {
  attach: { title: 'Attach', text: 'The tabbed view of every agent and shell. Keys start with Ctrl-b.' },
  panes: { title: 'Panes', text: 'Start agents, talk to them and clean up after them, from your shell, a script or another agent.' },
  loops: { title: 'Loops', text: 'Repeat loops, started with sldev new --repeat.' },
  repo: { title: 'Repo commands', text: 'Rules, skills, memory and usage for the project you are in.' }
}

function Command({ c }: { c: HelpCommand }) {
  return (
    <article className="cmd" id={c.id}>
      <h3 className="cmd-usage">
        <a href={`#${c.id}`} className="cmd-anchor" aria-label={`Link to ${c.usage}`}>
          #
        </a>
        <code>{c.usage}</code>
      </h3>
      {c.text && <p className="cmd-text">{c.text}</p>}
      {c.options.length > 0 && (
        <dl className="cmd-opts">
          {c.options.map((o, i) => (
            <div key={i} className={`cmd-opt depth-${o.depth}`}>
              <dt>
                <code>{o.flag}</code>
              </dt>
              <dd>{o.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  )
}

export function CommandsPage() {
  return (
    <>
      <Nav page="commands" />
      <main className="commands-page">
        <div className="container commands-layout">
          <aside className="commands-toc" aria-label="Sections">
            {help.sections.map((s) => (
              <div key={s.id}>
                <a className="toc-section" href={`#section-${s.id}`}>
                  {SECTIONS[s.id].title}
                </a>
                <ul>
                  {s.commands.map((c) => (
                    <li key={c.id}>
                      <a href={`#${c.id}`}>{c.name ? `sldev ${c.name}` : 'sldev'}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {help.notes.length > 0 && (
              <a className="toc-section" href="#notes">
                Notes
              </a>
            )}
          </aside>

          <div className="commands-body">
            <header className="commands-head">
              <h1>Commands</h1>
              <p className="section-lede">
                Generated from <code>sldev help</code> of sldev {version} when this site was built, so it always matches the CLI.
              </p>
              <div className="install">
                <CopyCommand command={site.install} label="install command" />
              </div>
            </header>

            {help.sections.map((s) => (
              <section key={s.id} className="cmd-section" id={`section-${s.id}`} aria-labelledby={`section-${s.id}-title`}>
                <h2 id={`section-${s.id}-title`}>{SECTIONS[s.id].title}</h2>
                <p className="cmd-section-text">{SECTIONS[s.id].text}</p>
                {s.commands.map((c) => (
                  <Command key={c.id} c={c} />
                ))}
              </section>
            ))}

            {help.notes.length > 0 && (
              <section className="cmd-section" id="notes" aria-labelledby="notes-title">
                <h2 id="notes-title">Notes</h2>
                {help.notes.map((n, i) => (
                  <p key={i} className="cmd-note">
                    {n}
                  </p>
                ))}
              </section>
            )}

            <details className="cmd-raw">
              <summary>The help as the CLI prints it</summary>
              <pre>
                <code>{help.raw}</code>
              </pre>
            </details>
          </div>
        </div>
      </main>
      <Footer version={version} />
    </>
  )
}
