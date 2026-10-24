import {
  ArrowRight,
  Boxes,
  GitPullRequest,
  KeyRound,
  Plug,
  Rocket,
  Server,
  SquareTerminal,
  Workflow,
  NotebookPen,
  type LucideIcon
} from 'lucide-react'

interface Feature {
  icon: LucideIcon
  title: string
  text: string
}

const features: Feature[] = [
  { icon: SquareTerminal, title: 'Terminals that stay alive', text: 'Dock, split and float as many terminals as you like. Sessions live outside the UI, so moving a panel never restarts your shell or your agent.' },
  { icon: Rocket, title: 'Agent missions', text: 'Launch a prompt with a model, effort and permission mode, optionally in its own git worktree. One board shows what is working, waiting or done.' },
  { icon: GitPullRequest, title: 'Diff review to PR', text: 'Read the per-file diff, commit, merge into the base branch, or push and open a pull request without leaving the app.' },
  { icon: Plug, title: 'Skills and MCP', text: 'Browse, create and run skills with any agent. List MCP servers with live health, add or remove them in a click.' },
  { icon: Boxes, title: 'Runtimes and tasks', text: 'Scripts from package.json, Makefile, Cargo, uv, Go, Docker Compose and more, with live status and one-click localhost links.' },
  { icon: Workflow, title: 'GitHub workflows', text: 'Dispatch workflows with typed inputs, follow runs live, re-run failures and see the PR checks for your branch.' },
  { icon: Server, title: 'SSH, SFTP and Docker', text: 'Remote terminals, an SFTP browser, port forwards and local containers with shells and followed logs.' },
  { icon: KeyRound, title: 'Encrypted vault', text: 'Passwords and keys are encrypted with your OS keychain and resolved in the main process. Secrets never reach the UI.' },
  { icon: NotebookPen, title: 'Notes that act', text: 'Markdown notes per project or global. Paste one into a terminal or turn it straight into a mission.' }
]

/** The full grid, for /features. */
export function FeatureGrid() {
  return (
    <section className="section page-first">
      <div className="container">
        <div className="grid">
          {features.map(({ icon: Icon, title, text }) => (
            <article className="card" key={title}>
              <Icon size={20} />
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Three features on the home page, linking to the rest. */
export function FeatureHighlights() {
  return (
    <section className="section alt" id="features">
      <div className="container">
        <div className="section-head">
          <div>
            <p className="eyebrow">Features</p>
            <h2>Everything around the agent, nothing in the way.</h2>
          </div>
          <a className="more-link" href="/features">
            All features <ArrowRight size={15} />
          </a>
        </div>
        <div className="grid">
          {features.slice(0, 3).map(({ icon: Icon, title, text }) => (
            <article className="card" key={title}>
              <Icon size={20} />
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
