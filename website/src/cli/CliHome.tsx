import { Footer } from '../components/Footer'
import { Nav } from '../components/Nav'
import { hrefTo, useScrollToHash } from './Chrome'
import cli from './cli.json'
import data from './cliHelp.json'
import { CopyCommand } from './CopyCommand'
import { Features } from './Features'
import { TerminalMockup } from './TerminalMockup'

const version = data.version

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

/** /cli: the sldev CLI's page. */
export function CliHome() {
  useScrollToHash()
  return (
    <>
      <Nav active="cli" />

      <main id="top" className="cli">
        <section className="hero">
          <div className="hero-glow" aria-hidden="true" />
          <div className="container hero-inner">
            <p className="eyebrow">
              <span className="dot" /> sldev CLI {version} · free and open source
            </p>
            <h1>
              Every coding agent,
              <br />
              <span className="brand-text">side by side in your terminal.</span>
            </h1>
            <p className="lede">{cli.description}</p>
            <div className="install">
              <CopyCommand command={cli.install} label="install command" />
              <p className="install-note">{cli.requires}</p>
            </div>
            <ul className="agents" aria-label="Agents it runs">
              {cli.agents.map((a) => (
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

        <Features />

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
              <CopyCommand command={cli.install} label="install command" />
              <p className="install-note">
                Every command and option: <a className="text-link" href={hrefTo('commands')}>the command list</a>
              </p>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  )
}
