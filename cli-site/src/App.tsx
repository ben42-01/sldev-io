import { CopyCommand } from './components/CopyCommand'
import { Logo } from './components/Logo'
import { TerminalMockup } from './components/TerminalMockup'
import site from './content/site.json'

const version = __CLI_VERSION__

const STEPS: Array<{ title: string; command: string; text: string }> = [
  {
    title: 'Open the workspace',
    command: 'sldev',
    text: 'Every agent you start is a tab. The sidebar groups them by project and shows who is working, who is done and who is waiting for you.'
  },
  {
    title: 'Start an agent',
    command: 'sldev new --agent claude "Fix the flaky parser test"',
    text: 'Any agent you have installed, with a brief. Add --worktree to give it a branch of its own, so several can work on one repo at once.'
  },
  {
    title: 'Detach and come back',
    command: 'Ctrl-b d   …   sldev',
    text: 'Close the terminal and the agents keep going. Run sldev again, from anywhere, and every tab is where you left it.'
  }
]

const POINTS: Array<{ title: string; text: string }> = [
  { title: 'Status you can trust', text: 'Claude reports through its hooks; every other agent is watched from its terminal. A bell or an approval prompt on screen marks the tab "needs you".' },
  { title: 'Worktrees, not collisions', text: 'Each agent can get a git worktree and branch of its own, so parallel work never steps on itself.' },
  { title: 'Scriptable', text: 'sldev ls, wait, send and read work from scripts and from other agents, so one agent can hand work to another.' },
  { title: 'Local and quiet', text: 'No account, no telemetry. Everything runs on your machine, under your own agent logins.' }
]

export function App() {
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <a className="nav-logo" href="#top" aria-label="sldev home">
            <Logo />
            <span>{site.name}</span>
          </a>
          <span className="nav-free">Free</span>
          <a className="nav-link" href="#how">
            How it works
          </a>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-glow" aria-hidden="true" />
          <div className="container hero-inner">
            <p className="eyebrow">
              <span className="dot" /> sldev CLI {version} · free
            </p>
            <h1>
              Every coding agent,
              <br />
              <span className="brand-text">side by side in your terminal.</span>
            </h1>
            <p className="lede">{site.description}</p>
            <div className="install">
              <CopyCommand command={site.install} label="install command" />
              <p className="install-note">{site.requires}</p>
            </div>
            <ul className="agents" aria-label="Agents it runs">
              {site.agents.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
          <div className="container mockup-wrap">
            <TerminalMockup version={version} />
          </div>
        </section>

        <section className="section" id="how">
          <div className="container">
            <h2>How it works</h2>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="step">
                  <span className="step-n">{i + 1}</span>
                  <h3>{s.title}</h3>
                  <pre className="step-cmd">
                    <code>{s.command}</code>
                  </pre>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <ul className="points">
              {POINTS.map((p) => (
                <li key={p.title}>
                  <h3>{p.title}</h3>
                  <p>{p.text}</p>
                </li>
              ))}
            </ul>
            <div className="install install-bottom">
              <CopyCommand command={site.install} label="install command" />
            </div>
          </div>
        </section>
      </main>

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
    </>
  )
}
