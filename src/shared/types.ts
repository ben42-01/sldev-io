import type { FactoryRun } from './factory'
import type { Automation } from './automations'
import type { BoardItem, BoardSettings, StoryJob } from './board'
import type { EvalRun } from './evals'

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
  isSymlink: boolean
}

export interface EditorInfo {
  id: string
  name: string
  /** 'terminal' editors (nvim, vim, …) open inside an sldev terminal panel */
  kind: 'gui' | 'terminal'
  /** it can show two files side by side from its command line (VS Code family, JetBrains) */
  canDiff?: boolean
}

export interface PtyCreateOptions {
  cwd?: string
  /**
   * Run this instead of an interactive shell; the pty exits with it. A string is a shell command line
   * (runtimes, shell tasks); an array is a program and its arguments, spawned without any shell (agents).
   */
  command?: string | string[]
  cols: number
  rows: number
  shell?: string
  args?: string[]
  env?: Record<string, string>
}

export interface PtyInfo {
  pid: number
  shell: string
  cwd: string
}

export type RightTab = 'overview' | 'agents' | 'skills' | 'context' | 'workflows'

/** Settings → Appearance: a fixed theme, or whatever the OS uses */
export type ThemePref = 'dark' | 'light' | 'system'

export interface AppSettings {
  /** colour theme (default dark) */
  theme?: ThemePref
  /** interface size, a zoom factor for the whole window (default 1) */
  uiZoom?: number
  rootFolder: string | null
  recentFolders: string[]
  preferredEditor: string | null
  sidebarWidth: number
  sidebarVisible: boolean
  /** the right sidebar: overview, agents, skills, context, workflows */
  rightPanelWidth: number
  rightPanelVisible: boolean
  rightPanelTab: RightTab
  /** how Mission Control lays out missions: status columns, a grid of cards, or one row each */
  missionLayout: 'columns' | 'grid' | 'list'
  /** mission cards in the right sidebar: full cards or one compact row each */
  missionCards: 'cards' | 'compact'
  /** the review tab: old and new side by side, or one column */
  diffLayout?: 'split' | 'unified'
  /** the Review tab opens on the walkthrough (the review cockpit) or on every file */
  reviewView?: 'walk' | 'files'
  /** the sidebars hide while a review tab is on screen (default on) */
  reviewFocus?: boolean
  terminalFontSize: number
  terminalFontFamily: string
  /** where open tabs sit in each dock group: a strip on top, or a list down the left side */
  tabLayout: 'top' | 'side'
  notifications: boolean
  /** a short chime when a mission needs you and you aren't looking at it */
  notificationSound: boolean
  /** custom shell executable; null = $SHELL / PowerShell */
  shell: string | null
  /** Electron accelerator that shows/hides the window from anywhere; null = off */
  globalHotkey: string | null
  /** agent preselected for new missions and tasks */
  defaultAgent: string
  /** permission mode per agent id for Factory stages; missing = the agent's recommended one, '' = the CLI default */
  factoryModes: Record<string, string>
  /** user-defined agent CLIs */
  customAgents: CustomAgent[]
  /** agents to continue on, in order, when one stops at its usage limit */
  failoverOrder: string[]
  /** continue on the next agent without asking (missions and factory stages) */
  failoverAuto: boolean
  /** give Claude Code and Codex missions the sldev MCP tools (status, output, other missions) */
  agentTools: boolean
  /** point missions at the project's .sldev/memory.md when it exists */
  projectMemory: boolean
  /** agent profiles kept for every project (project ones live in .sldev/agents) */
  agentProfiles: AgentProfile[]
  /** the setup check has been shown once; after that it only opens itself when a required tool is missing */
  setupSeen: boolean
  /** the version whose What's new was last shown; null until the first launch records it */
  lastSeenVersion: string | null
  /** Skills groups and Workflows sections the user opened (true) or closed (false), keyed by `${tab}:${group}` / `workflows:${section}` */
  assetGroups: Record<string, boolean>
}

/**
 * A named agent: a CLI with fixed options plus a role (Markdown instructions). User profiles live in
 * settings; project profiles are `.sldev/agents/<slug>.md` so a team can commit them.
 */
export interface AgentProfile {
  id: string
  name: string
  description: string
  /** CLI id; unset = whichever agent is picked (or the default agent) */
  agent?: string
  model?: string
  permissionMode?: string
  effort?: string
  role: string
  scope: 'builtin' | 'user' | 'project'
  /** project profiles: the .md file */
  path?: string
}

export interface RulesState {
  sourcePath: string
  /** null until .sldev/rules.md exists */
  source: string | null
  config: { targets: Record<string, boolean>; written: Record<string, string> }
  targets: Array<{
    id: string
    path: string
    readers: string
    exists: boolean
    /** null while there is no source */
    status: 'off' | 'in-sync' | 'create' | 'update' | 'hand-edited' | null
    added: number
    removed: number
  }>
}

export interface CustomAgent {
  id: string
  name: string
  /** interactive command; {prompt} {model} {name} are filled in, the prompt is appended if {prompt} is absent */
  command: string
  /** non-interactive variant, if the CLI has one */
  printCommand?: string
  /** command that continues the most recent session */
  resumeCommand?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  rootFolder: null,
  recentFolders: [],
  preferredEditor: null,
  sidebarWidth: 280,
  sidebarVisible: true,
  rightPanelWidth: 320,
  rightPanelVisible: true,
  rightPanelTab: 'overview',
  missionLayout: 'columns',
  missionCards: 'cards',
  terminalFontSize: 13,
  terminalFontFamily:
    '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, "DejaVu Sans Mono", monospace',
  tabLayout: 'top',
  notifications: true,
  notificationSound: false,
  shell: null,
  globalHotkey: 'CommandOrControl+Shift+Space',
  defaultAgent: 'claude',
  customAgents: [],
  failoverOrder: [],
  failoverAuto: false,
  factoryModes: {},
  agentProfiles: [],
  agentTools: true,
  projectMemory: true,
  setupSeen: false,
  lastSeenVersion: null,
  assetGroups: {}
}

export type RuntimeSource = 'npm' | 'make' | 'just' | 'cargo' | 'python' | 'compose' | 'go' | 'deno' | 'custom'

export interface RuntimeDef {
  /** stable across detections: `${source}:${relDir}:${name}` */
  id: string
  name: string
  command: string
  cwd: string
  source: RuntimeSource
  /** where it came from, e.g. `web/package.json`; used for grouping */
  group: string
  /** e.g. the script body from package.json */
  detail?: string
}

export interface CustomRuntime {
  id: string
  name: string
  command: string
  /** relative to the project root; '' = root */
  cwd: string
}

export interface AgentOptions {
  /** agent id (claude, codex, cursor, copilot, opencode, gemini or a custom id); unset = claude */
  agent?: string
  model?: string
  /** the agent's approval / permission mode */
  permissionMode?: string
  effort?: string
  /** run in a fresh git worktree */
  worktree?: boolean
  /** non-interactive: print the result and exit */
  print?: boolean
  extraArgs?: string
  /** agent profile id: its role goes to the agent with the prompt */
  profile?: string
}

export interface Task {
  id: string
  name: string
  /** project root this task belongs to, or null for a global task */
  scope: string | null
  kind: 'shell' | 'agent'
  /** relative to the scope root ('' = root); absolute for global tasks ('' = home) */
  cwd: string
  command?: string
  prompt?: string
  agent?: AgentOptions
  createdAt: number
  lastRunAt?: number
}

export interface StoreFiles {
  tasks: { tasks: Task[] }
  missions: { missions: Mission[] }
  connections: { connections: SshConnection[] }
  runtimes: { custom: Record<string, CustomRuntime[]> }
  factoryRuns: { runs: FactoryRun[] }
  automations: { automations: Automation[] }
  savedMissions: { saved: SavedMission[] }
  /** the work board (src/shared/board.ts): items of every project, and each project's pick-up setting */
  board: { items: BoardItem[]; settings: BoardSettings[]; jobs?: StoryJob[] }
  /** eval suites run against agents (src/shared/evals.ts); the eval files themselves live in .sldev/evals */
  evals: { runs: EvalRun[] }
}

/** a mission written in the New mission form and kept to launch later (Save for later) */
export interface SavedMission {
  id: string
  /** the project it was saved in: it's listed there */
  project: string
  /** where the agent works: the project unless another folder was picked */
  root: string
  title?: string
  brief: string
  criteria?: string
  /** mission kind id */
  kind: string
  options: AgentOptions
  worktree: boolean
  base?: string
  /** other agents to run it on as a bake-off */
  compare?: string[]
  issue?: number
  /** an agent wrote it with the sldev-mission skill (its id, or 'agent'); it waits here like any saved mission */
  draftedBy?: string
  createdAt: number
  updatedAt: number
}

export interface WorktreeInfo {
  path: string
  branch: string
  base: string
  /** main repository top-level */
  repo: string
}

export interface WorktreeStatus {
  exists: boolean
  /** changed tracked files (staged or not) */
  modified: number
  untracked: number
  /** commits on the branch that its base doesn't have */
  unmerged: number
}

/** `git status --porcelain=v2 --branch` of one working tree (parsed in src/shared/git.ts) */
export interface GitStatus {
  /** short branch name; null when HEAD is detached */
  branch: string | null
  /** commit HEAD points at; null in a repository with no commits yet */
  head: string | null
  detached: boolean
  /** e.g. "origin/master"; null when the branch tracks nothing */
  upstream: string | null
  /** commits the upstream lacks / commits it has that we don't; 0 without an upstream */
  ahead: number
  behind: number
  /** files with staged changes, changes not staged, untracked files, and merge conflicts */
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
}

/** A local or remote-tracking branch, as the Git view lists it */
export interface GitBranchRef {
  /** "feature/x", or "origin/feature/x" for a remote-tracking branch */
  name: string
  /** the branch checked out in this working tree */
  current: boolean
  /** committer date of its last commit, ms since epoch (0 when unknown) */
  committedAt: number
  /** subject line of its last commit */
  subject: string
  /** upstream of a local branch ("origin/x"), or null */
  upstream: string | null
  /** folder of another worktree that has it checked out (git won't switch to it here), or null */
  worktree: string | null
}

/** `git:branchList`: local branches and remote-tracking branches, most recent commit first */
export interface GitBranchList {
  local: GitBranchRef[]
  remote: GitBranchRef[]
}

/** One entry of `git worktree list --porcelain` */
export interface GitWorktree {
  path: string
  /** commit checked out; null for a bare repository */
  head: string | null
  /** short branch name; null when detached or bare */
  branch: string | null
  detached: boolean
  bare: boolean
  locked: boolean
  lockReason?: string
  /** its folder is gone; `git worktree prune` would drop it */
  prunable: boolean
  prunableReason?: string
  /** the repository's main working tree (listed first by git) */
  isMain: boolean
}

export interface DiffStat {
  files: number
  insertions: number
  deletions: number
}

export type HookEvent = {
  mission: string
  sessionId?: string
  type: 'session-start' | 'prompt' | 'tool' | 'notification' | 'stop' | 'session-end'
  text?: string
  /** Claude Code's session transcript, read for token usage */
  transcriptPath?: string
}

/** From the sldev MCP server: an agent reporting on its own mission */
export type McpEvent =
  | { mission: string; type: 'status'; state: 'working' | 'needs_input' | 'done'; text?: string }
  | { mission: string; type: 'output'; text: string }
  | { mission: string; type: 'done'; text?: string }
  /** an agent filed a card on the work board (it lands in Proposed) */
  | { mission: string; type: 'board-add'; card: { title: string; body: string; labels: string[]; priority: 'high' | 'normal' | 'low'; after?: Array<number | string> } }
  /** an agent rewrote a card it was asked to refine (it moves to Proposed) */
  | { mission: string; type: 'board-update'; key: number; card: { title: string; body: string; labels: string[]; priority: 'high' | 'normal' | 'low'; after?: Array<number | string> } }

export type MissionStatus = 'starting' | 'working' | 'waiting' | 'needs-input' | 'ended' | 'failed'

/** a status the mission entered, and when */
export interface StatusChange {
  status: MissionStatus
  at: number
}

export interface Mission {
  id: string
  title: string
  /** exactly what the agent was started with */
  prompt: string
  /** the task as the user wrote it (missions from the New mission form, follow-ups, second opinions) */
  brief?: string
  criteria?: string
  /** the agent's final reply (Claude's last message, or sldev_done), up to 6,000 characters */
  report?: string
  /** set when the report is the agent's terminal screen, for agents that don't report back (no hooks, no sldev_done) */
  reportFrom?: 'terminal'
  /** the reviewer's notes; handed to follow-ups instead of the report when present */
  handoff?: string
  /** what kind of work it is (Build, Research, Plan, a custom kind…); missing = Build */
  kind?: { id: string; name: string; readOnly: boolean }
  /** the mission this one continues or reviews */
  parent?: { id: string; kind: 'follow-up' | 'second-opinion' | 'failover' }
  /** the agent stopped at its usage limit: when, and the line that said so */
  limited?: { at: number; text: string }
  /** the mission that took over after the limit */
  continuedBy?: string
  /** project root the mission belongs to */
  root: string
  cwd: string
  worktree?: WorktreeInfo
  /** for missions without a worktree: HEAD when the mission started */
  baseCommit?: string
  options: AgentOptions
  status: MissionStatus
  sessionId?: string
  taskId?: string
  createdAt: number
  updatedAt: number
  activity?: string
  /** when the agent last showed it's busy: a tool call started (hooks) or the terminal printed something */
  activityAt?: number
  lastMessage?: string
  notification?: string
  stats?: DiffStat
  /** every status change, oldest first (feeds the usage dashboard) */
  history?: StatusChange[]
  /** the factory run and node this mission works for */
  factory?: { run: string; node: string }
  /** a Lead mission (kind 'lead'): how many workers it may start, and at once */
  lead?: { maxWorkers: number; parallel: number }
  /** a worker a Lead started with sldev_delegate; the Lead was told it finished, and merged it */
  delegate?: { lead: string; reported?: boolean; merged?: boolean; why?: string }
  /** an eval attempt's agent or judge: like a factory stage, it reports to its run, not to you */
  eval?: { run: string; attempt: string; judge?: boolean }
  /** a pass of a repeated mission (src/shared/repeat.ts): its automation (app) or loop (CLI), its number, the total (0 = open-ended) */
  repeat?: { loop: string; pass: number; of: number; accept?: boolean }
  /** Claude Code transcript (from its hooks), for token usage */
  transcriptPath?: string
  /** the review cockpit on this mission's diff (src/shared/review.ts): the walkthrough, the reviewer's marks and questions */
  review?: ReviewState
  /** a helper of the review cockpit (a walkthrough or a question about another mission): hidden from the boards, no notifications */
  explains?: { mission: string }
}

export interface ReviewState {
  /** the walkthrough an agent wrote to a file under .sldev/runs; `diff` is what the diff looked like then */
  walk?: { file: string; mission: string; agent: string; status: 'writing' | 'ready' | 'failed'; at: number; note?: string; diff?: string }
  /** by part id: looked good, or sent back with a note */
  marks?: Record<string, { ok?: boolean; note?: string }>
  asks?: Array<{ id: string; part: string; q: string; file: string; mission: string; agent: string; a?: string; failed?: boolean; at: number }>
  /** the follow-up the marked parts went back in */
  sent?: { at: number; mission: string; parts: number }
}

export interface ClaudeAsset {
  kind: 'skill' | 'command' | 'agent'
  name: string
  description: string
  source: 'user' | 'project' | 'plugin' | 'synced'
  plugin?: string
  /** the .md file */
  path: string
  /** what to type in Claude Code, e.g. `/review` or `/plugin:skill` */
  invocation: string
}

export interface McpServer {
  name: string
  detail: string
  status: string
}

export interface GhRepoInfo {
  authed: boolean
  repo: string | null
  url: string | null
  defaultBranch: string | null
  error?: string
}

export interface GhWorkflow {
  id: number
  name: string
  path: string
  state: string
}

export interface GhWorkflowInput {
  name: string
  description?: string
  required?: boolean
  default?: string
  type?: string
  options?: string[]
}

export interface GhRun {
  databaseId: number
  displayTitle: string
  workflowName: string
  status: string
  conclusion: string
  headBranch: string
  event: string
  createdAt: string
  url: string
  number: number
}

/** One part of RepoStats: its value, or why it couldn't be read. Parts fail on their own. */
export interface StatsPart<T> {
  /** null when the part failed (see error) or there is nothing (no commits, no releases) */
  value: T | null
  error?: string
}

export interface RepoCommit {
  sha: string
  short: string
  subject: string
  author: string
  /** ISO 8601, author date */
  date: string
}

export interface RepoGithub {
  /** owner/name */
  repo: string
  url: string
  defaultBranch: string | null
  stars: number
  forks: number
  openIssues: number
  openPrs: number
}

export interface RepoRelease {
  tag: string
  name: string
  publishedAt: string
  prerelease: boolean
}

export interface RepoBranchPr {
  number: number
  title: string
  url: string
  isDraft: boolean
}

/** What scripts/gh-stats.sh shows, as data: local git parts and GitHub parts read through gh (read-only). */
export interface RepoStats {
  status: StatsPart<GitStatus>
  lastCommit: StatsPart<RepoCommit>
  /** gh can't be used at all (not installed, not logged in); every GitHub part then carries the same error */
  githubError?: string
  github: StatsPart<RepoGithub>
  release: StatsPart<RepoRelease>
  /** the last workflow runs on the current branch (all branches when HEAD is detached) */
  runs: StatsPart<GhRun[]>
  /** open pull requests whose head is the current branch; [] when detached */
  branchPrs: StatsPart<RepoBranchPr[]>
}

/** One commit of the activity charts (git log --since on HEAD). */
export interface ActivityCommit {
  /** ISO 8601 committer date: the date `git log --since` filters on, so the counts match git's */
  date: string
  /** has more than one parent */
  merge: boolean
  author: string
}

/** One pull request of the activity charts (gh pr list --state all). */
export interface ActivityPr {
  number: number
  createdAt: string
  mergedAt: string | null
  closedAt: string | null
}

/** The data behind the stats panel's activity charts for the last `days` days. */
export interface RepoActivity {
  days: number
  /** the first day of the range (YYYY-MM-DD, local time), what --since was given */
  from: string
  commits: StatsPart<ActivityCommit[]>
  /** fails with the reason when gh is missing or logged out; the commit chart still shows */
  prs: StatsPart<ActivityPr[]>
}

export interface GhIssue {
  number: number
  title: string
  body: string
  url: string
  labels?: string[]
}

export interface GhPr {
  number: number
  title: string
  state: string
  url: string
  isDraft: boolean
  checks: { passed: number; failed: number; pending: number }
}

/** A review, a conversation comment or a line comment on a pull request. */
export interface GhPrComment {
  id: string
  author: string
  body: string
  createdAt: string
  url: string
  /** line comments only */
  path?: string
  line?: number
}

export interface NoteMeta {
  path: string
  title: string
  mtime: number
}

export type CredentialKind = 'password' | 'key' | 'key-file'

export interface CredentialMeta {
  id: string
  name: string
  kind: CredentialKind
  username?: string
  keyPath?: string
  hasSecret: boolean
  hasPassphrase: boolean
}

export interface CredentialInput {
  id?: string
  name: string
  kind: CredentialKind
  username?: string
  keyPath?: string
  /** password or private key text; undefined keeps the stored value */
  secret?: string
  passphrase?: string
}

export interface PortForward {
  id: string
  localPort: number
  remoteHost: string
  remotePort: number
}

export interface SshConnection {
  id: string
  name: string
  host: string
  port: number
  username?: string
  /** agent: ssh-agent / pageant; credential: from the vault; prompt: ask for a password each time */
  auth: 'agent' | 'credential' | 'prompt'
  credentialId?: string
  /** connect through another saved connection */
  jumpId?: string
  remoteDir?: string
  forwards: PortForward[]
}

export interface RemoteEntry {
  name: string
  path: string
  isDir: boolean
  size: number
}

export interface SshPrompt {
  requestId: string
  kind: 'hostkey' | 'secret' | 'confirm'
  title: string
  message: string
  /** for keyboard-interactive / password prompts */
  fields?: Array<{ label: string; secret: boolean }>
}

export interface VaultStatus {
  encrypted: boolean
  backend: string
}

export type PackageManager = 'brew' | 'winget' | 'apt' | 'dnf' | 'pacman' | 'zypper'

export type SetupLevel = 'required' | 'recommended' | 'optional'

export interface SetupCheck {
  id: string
  name: string
  /** what the app uses it for */
  why: string
  level: SetupLevel
  state: 'ok' | 'missing' | 'not-ready'
  version?: string
  /** installs it on this machine; run in a terminal so the user sees sudo/UAC prompts */
  install?: string
  /** finishes setup when installed but not ready, e.g. `gh auth login` */
  fix?: string
  docs: string
  detail?: string
}

export interface SetupReport {
  platform: string
  packageManager: PackageManager | null
  checks: SetupCheck[]
}

export interface DockerContainer {
  id: string
  name: string
  image: string
  /** running, exited, paused, created, restarting, dead */
  state: string
  /** human status, e.g. "Up 3 hours" */
  status: string
  ports: string
  /** host ports published on localhost */
  hostPorts: number[]
  /** docker compose project and service, from labels */
  project?: string
  service?: string
}

export interface DockerList {
  available: boolean
  error?: string
  containers: DockerContainer[]
}

export type DockerAction = 'start' | 'stop' | 'restart' | 'rm'

/** Version details for Settings → About and support requests. */
export interface AppInfo {
  name: string
  version: string
  /** beta builds (`-beta.N`) follow pre-releases; stable builds only stable releases */
  channel: 'beta' | 'stable'
  electron: string
  chrome: string
  node: string
  platform: NodeJS.Platform
  arch: string
  os: string
  /** freezes noticed this session (main-process stalls, unresponsive window) */
  stalls?: string[]
}

export interface UpdateStatus {
  /** unsupported: dev builds, and Linux installs that didn't come from the .deb */
  state: 'unsupported' | 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  /** the newer version, once one is found */
  version: string | null
  percent: number | null
  /** macOS builds aren't signed yet, which Squirrel.Mac requires: the user downloads the new dmg */
  manual: boolean
  error: string | null
  checkedAt: number | null
}
