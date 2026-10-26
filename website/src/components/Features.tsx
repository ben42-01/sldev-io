import {
  ArrowRight,
  Boxes,
  ChartGantt,
  Factory,
  FileStack,
  GitPullRequest,
  KeyRound,
  Layers,
  Plug,
  Rocket,
  Server,
  SquareTerminal,
  Swords,
  UserCog,
  Workflow,
  NotebookPen,
  type LucideIcon
} from 'lucide-react'

interface Feature {
  icon: LucideIcon
  title: string
  text: string
  /** shown on the home page, where the tour doesn't already cover it */
  home?: boolean
}

const features: Feature[] = [
  { icon: Factory, title: 'Software Factory', text: 'Recipes turn an idea into a reviewed pull request: a graph of agent steps, checks and approvals. Parallel steps get their own worktrees, failing tests and review comments go back to the agent, and every run can be replayed step by step.' },
  { icon: Swords, title: 'Bake-offs and second opinions', text: 'Run one task on two or three agents and keep the best diff, or have a different agent review the work before you do.' },
  { icon: Layers, title: 'Every agent, one window', text: 'Claude Code, Codex, Cursor Agent, Copilot, OpenCode and Gemini side by side, plus any CLI you add with a command template.' },
  { icon: SquareTerminal, title: 'Terminals that stay alive', text: 'Dock, split and float as many terminals as you like. Sessions live outside the UI, so moving a panel never restarts your shell or your agent.' },
  { icon: Rocket, title: 'Agent missions', text: 'Launch a prompt with a model, effort and permission mode, optionally in its own git worktree. One board shows what is working, waiting or done.' },
  { icon: UserCog, title: 'Agent builder', text: 'Create agents with a role, model and permissions, like a read-only reviewer or a spec writer. Share them with the project or export them as Claude subagents.', home: true },
  { icon: ChartGantt, title: 'Usage dashboard', text: 'A timeline of every agent, how long they waited on you, and token usage with an estimated cost, read from the logs on your machine.', home: true },
  { icon: GitPullRequest, title: 'Diff review to PR', text: 'Read the per-file diff, commit, merge into the base branch, or push and open a pull request without leaving the app.' },
  { icon: FileStack, title: 'One set of rules', text: 'Write your project rules once. sldev-io keeps AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules and Copilot instructions in sync, and never overwrites a hand edit.', home: true },
  { icon: Plug, title: 'Skills and MCP', text: 'Run skills with any agent, manage MCP servers, and give agents the sldev tools to report their own status and read each other\'s work.', home: true },
  { icon: Boxes, title: 'Runtimes and tasks', text: 'Scripts from package.json, Makefile, Cargo, uv, Go, Docker Compose and more, with live status and one-click localhost links.' },
  { icon: Workflow, title: 'GitHub issues and workflows', text: 'Start a mission or a factory run from an issue, dispatch workflows with typed inputs, follow runs and see the PR checks for your branch.', home: true },
  { icon: Server, title: 'SSH, SFTP and Docker', text: 'Remote terminals, an SFTP browser, port forwards and local containers with shells and followed logs.', home: true },
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

/** The features the showcase doesn't cover, on the home page. */
export function FeatureHighlights() {
  return (
    <section className="section alt" id="features">
      <div className="container">
        <div className="section-head">
          <div>
            <p className="eyebrow">Features</p>
            <h2>Everything around the agent, nothing in the way.</h2>
            <p className="section-lead">Agents write the code. The rest of the day happens here too.</p>
          </div>
          <a className="more-link" href="/features">
            All features <ArrowRight size={15} />
          </a>
        </div>
        <div className="grid">
          {features.filter((f) => f.home).map(({ icon: Icon, title, text }) => (
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
