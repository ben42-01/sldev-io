import {
  ArrowRight,
  ArrowRightLeft,
  Boxes,
  Brain,
  ChartGantt,
  Clock,
  Command,
  Compass,
  Factory,
  FileStack,
  GitPullRequest,
  HardDrive,
  KeyRound,
  Layers,
  MessageSquareReply,
  Plug,
  Puzzle,
  Rocket,
  Server,
  Settings2,
  ShieldCheck,
  SquareTerminal,
  Swords,
  UserCog,
  Workflow,
  NotebookPen,
  type LucideIcon
} from 'lucide-react'

type GroupId = 'run' | 'automate' | 'control' | 'workspace'

interface Feature {
  icon: LucideIcon
  title: string
  text: string
  group: GroupId
}

/** The three things the site sells, plus the everyday workspace around them. */
const groups: { id: GroupId; icon: LucideIcon; title: string; text: string }[] = [
  { id: 'run', icon: Layers, title: 'Run every agent', text: "All the agents you pay for, working together instead of one vendor's model on everything." },
  { id: 'automate', icon: Factory, title: 'Automate the pipeline', text: 'From an issue or a CI failure to a reviewed pull request, with your own skills at every step.' },
  { id: 'control', icon: ShieldCheck, title: 'Stay in control', text: 'On your machine, with your setup. Nothing is merged or pushed without your click.' },
  { id: 'workspace', icon: SquareTerminal, title: 'And the rest of the day', text: 'Terminals, scripts, servers and notes, next to your agents.' }
]

const features: Feature[] = [
  { group: 'run', icon: Layers, title: 'Every agent, one window', text: 'Claude Code, Codex, Cursor Agent, Copilot, OpenCode and Gemini side by side, plus any CLI you add with a command template.' },
  { group: 'run', icon: ArrowRightLeft, title: 'Continues at the usage limit', text: 'When an agent stops at its plan\'s limit, the next agent in your order takes over in the same folder, with the task and the work so far.' },
  { group: 'run', icon: Compass, title: 'Missions for every kind of work', text: 'Build, Research, Investigate, Plan and Review missions, each framed for the job. A Research mission answers without touching your code; your own kinds are Markdown templates.' },
  { group: 'run', icon: Swords, title: 'Bake-offs and second opinions', text: 'Run one task on two or three agents and keep the best diff, or have a different agent review the work before you do.' },
  { group: 'run', icon: UserCog, title: 'Agent builder', text: 'Create agents with a role, model and permissions, like a read-only reviewer or a spec writer. Share them with the project or export them as Claude subagents.' },
  { group: 'run', icon: Rocket, title: 'Live mission board', text: 'One board shows what every agent is doing, what waits for you and what is ready, with a desktop notification when one needs you.' },

  { group: 'automate', icon: Factory, title: 'Software Factory', text: 'Recipes turn an idea into a reviewed pull request: a graph of agent steps, checks and approvals. Failing tests and review comments go back to the agent, and every run can be replayed step by step.' },
  { group: 'automate', icon: Puzzle, title: 'Your own skills and specs', text: 'Run your spec, build and review skills as factory steps on any agent, swap them per run, or start from a spec you already wrote.' },
  { group: 'automate', icon: Clock, title: 'Automations', text: 'Start a recipe or a mission every weekday morning, when CI fails on main, or when an issue gets a label. Never more than one at a time, never pushed without you.' },
  { group: 'automate', icon: Brain, title: 'Project context', text: 'What one agent learns, your docs and pinned files, indexed and linked to the code. Each mission gets the notes that match its task, whichever CLI runs it, and notes whose files changed are flagged. Plain Markdown you commit.' },
  { group: 'automate', icon: Workflow, title: 'GitHub issues and workflows', text: 'Start a mission or a factory run from an issue, dispatch workflows with typed inputs, follow runs and see the PR checks for your branch.' },
  { group: 'automate', icon: MessageSquareReply, title: 'Review comments back to the agent', text: 'Review comments on a factory run\'s pull request go to an agent in the run\'s worktree. The update is pushed when you click.' },

  { group: 'control', icon: HardDrive, title: 'Runs on your machine', text: 'Agents work with your local setup: your databases, Docker, secrets and tools. No extra service gets a copy of your code; it goes only to the agent you chose.' },
  { group: 'control', icon: GitPullRequest, title: 'Diff review to PR', text: 'Missions can each work in their own git worktree. Read the per-file diff, commit, merge, or push and open a pull request without leaving the app.' },
  { group: 'control', icon: FileStack, title: 'One set of rules', text: 'Write your project rules once. sldev-io keeps AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules and Copilot instructions in sync, and never overwrites a hand edit.' },
  { group: 'control', icon: ChartGantt, title: 'Usage dashboard', text: 'A timeline of every agent, how long they waited on you, and token usage with an estimated cost, read from the logs on your machine.' },
  { group: 'control', icon: KeyRound, title: 'Encrypted vault', text: 'Passwords and keys are encrypted with your OS keychain and resolved in the main process. Secrets never reach the UI.' },
  { group: 'control', icon: Settings2, title: 'Your agent settings stay yours', text: 'Claude Code missions get their own settings file on the command line. Your ~/.claude settings and other agent configs are never modified.' },

  { group: 'workspace', icon: SquareTerminal, title: 'Terminals that stay alive', text: 'Dock, split and float as many terminals as you like. Sessions live outside the UI, so moving a panel never restarts your shell or your agent.' },
  { group: 'workspace', icon: Boxes, title: 'Runtimes and tasks', text: 'Scripts from package.json, Makefile, Cargo, uv, Go, Docker Compose and more, with live status and one-click localhost previews.' },
  { group: 'workspace', icon: Plug, title: 'Skills and MCP', text: "Run skills with any agent, manage MCP servers, and give agents the sldev tools to report their own status and read each other's work." },
  { group: 'workspace', icon: Server, title: 'SSH, SFTP and Docker', text: 'Remote terminals, an SFTP browser, port forwards and local containers with shells and followed logs.' },
  { group: 'workspace', icon: NotebookPen, title: 'Notes that act', text: 'Markdown notes per project or global. Paste one into a terminal or turn it straight into a mission.' },
  { group: 'workspace', icon: Command, title: 'Command palette and shortcuts', text: 'Every action in one palette, with keyboard shortcuts that leave the keys your terminal programs need alone.' }
]

/** The full grid, for /features, one block per group. */
export function FeatureGrid() {
  return (
    <section className="section page-first">
      <div className="container">
        {groups.map((g) => (
          <div className="feature-group" key={g.id} id={g.id}>
            <h2 className="feature-group-h">{g.title}</h2>
            <p className="section-lead">{g.text}</p>
            <div className="grid">
              {features
                .filter((f) => f.group === g.id)
                .map(({ icon: Icon, title, text }) => (
                  <article className="card" key={title}>
                    <Icon size={20} />
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </article>
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/** The three pillars, on the home page: what sets sldev-io apart, each with what makes it up. */
export function FeatureHighlights() {
  return (
    <section className="section alt" id="features">
      <div className="container">
        <div className="section-head">
          <div>
            <p className="eyebrow">Features</p>
            <h2>What one vendor's agent app can't do.</h2>
            <p className="section-lead">Agents write the code. sldev-io makes them work together, keeps them busy and keeps you in charge.</p>
          </div>
          <a className="more-link" href="/features">
            All features <ArrowRight size={15} />
          </a>
        </div>
        <div className="pillars">
          {groups
            .filter((g) => g.id !== 'workspace')
            .map(({ id, icon: Icon, title, text }) => (
              <article className="pillar" key={id}>
                <Icon size={22} />
                <h3>{title}</h3>
                <p>{text}</p>
                <ul>
                  {features
                    .filter((f) => f.group === id)
                    .map((f) => (
                      <li key={f.title}>
                        <a href={`/features#${id}`}>
                          <f.icon size={14} /> {f.title}
                        </a>
                      </li>
                    ))}
                </ul>
              </article>
            ))}
        </div>
      </div>
    </section>
  )
}
