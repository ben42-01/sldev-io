/**
 * The home page's feature cards. Each names the command or key that uses it; `command` is the anchor of that
 * command on /commands (its id in the parsed `sldev help`), and test/cliSite.test.ts checks each one still exists.
 * Describe only what the CLI on master does.
 */
export interface Use {
  /** what to type, shown as code */
  text: string
  /** the command's anchor on /commands, when it is one */
  command?: string
}

export interface Feature {
  title: string
  text: string
  uses: Use[]
}

export const FEATURES: Feature[] = [
  {
    title: 'Agents side by side',
    text: 'Claude Code, Codex, Cursor Agent, Copilot, OpenCode and Gemini CLI each run in a tab of their own, grouped by project. Add any other CLI as a custom agent in the config file.',
    uses: [{ text: 'sldev new --agent <id>', command: 'new' }, { text: 'Ctrl-b c', command: 'attach' }, { text: 'sldev config', command: 'config' }]
  },
  {
    title: 'A worktree per agent',
    text: 'Give an agent a git worktree and a branch of its own, so several can work on one repo without stepping on each other. Clean them up once they are done.',
    uses: [{ text: '--worktree <branch>', command: 'new' }, { text: 'sldev clean', command: 'clean' }]
  },
  {
    title: 'Status at a glance',
    text: 'Every tab says working, needs you or ready. Claude reports through its hooks; other agents are watched from their terminal, and a bell or an approval prompt on screen means it needs you.',
    uses: [{ text: 'sldev ls', command: 'ls' }, { text: 'sldev wait --for needs-you', command: 'wait' }]
  },
  {
    title: 'Briefs, launched when you are ready',
    text: 'Write a brief as Markdown in .sldev-cli/briefs/, with its kind, agent, worktree and acceptance criteria in front matter, and start it whenever you like.',
    uses: [{ text: 'sldev launch <name>', command: 'launch' }, { text: 'sldev briefs', command: 'briefs' }, { text: 'Ctrl-b b', command: 'attach' }]
  },
  {
    title: 'Repeat loops',
    text: 'Run one brief again and again, each pass building on the last and committed in the loop’s worktree. A check command runs after every pass, and its failure goes to the next one.',
    uses: [{ text: '--repeat <n>', command: 'new' }, { text: '--check "<cmd>"', command: 'new' }, { text: 'sldev loops', command: 'loops' }]
  },
  {
    title: 'A second opinion',
    text: 'Have another agent review what one has changed, read-only, before you merge it.',
    uses: [{ text: 'sldev review <pane> --agent <id>', command: 'review' }]
  },
  {
    title: 'The conductor',
    text: 'An agent that runs agents: it splits a brief between workers in their own worktrees, merges their branches into its own and reports. You set how many it may start; they never push.',
    uses: [{ text: '--allow-spawn <n>', command: 'new' }, { text: 'sldev skills install', command: 'skills' }]
  },
  {
    title: 'Skills for every agent',
    text: 'Install sldev’s skills into a project, as plain SKILL.md folders any agent can read: drafting missions, stories, recipes and evals, and the conductor.',
    uses: [{ text: 'sldev skills install', command: 'skills' }, { text: 'sldev skills check <file>', command: 'skills-check' }]
  },
  {
    title: 'Usage from local logs',
    text: 'Tokens and an estimated cost for today or the week, read from Claude Code’s and Codex’s own logs on your machine. Nothing is sent anywhere.',
    uses: [{ text: 'sldev usage [--week]', command: 'usage' }]
  },
  {
    title: 'GitHub workflow runs',
    text: 'The repo’s latest GitHub Actions runs, next to your agents. Asked through your own gh, and only while the view is open.',
    uses: [{ text: 'sldev workflows', command: 'workflows' }, { text: 'Ctrl-b w', command: 'attach' }]
  }
]
