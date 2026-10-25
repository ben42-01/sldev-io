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
}

export interface PtyCreateOptions {
  cwd?: string
  /** Run this command (via the user's shell) instead of an interactive shell; the pty exits with it. */
  command?: string
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

export interface AppSettings {
  rootFolder: string | null
  recentFolders: string[]
  preferredEditor: string | null
  sidebarWidth: number
  sidebarVisible: boolean
  terminalFontSize: number
  terminalFontFamily: string
  notifications: boolean
  /** custom shell executable; null = $SHELL / PowerShell */
  shell: string | null
  /** Electron accelerator that shows/hides the window from anywhere; null = off */
  globalHotkey: string | null
  /** agent preselected for new missions and tasks */
  defaultAgent: string
  /** user-defined agent CLIs */
  customAgents: CustomAgent[]
  /** agent profiles kept for every project (project ones live in .sldev/agents) */
  agentProfiles: AgentProfile[]
  /** the setup check has been shown once; after that it only opens itself when a required tool is missing */
  setupSeen: boolean
  /** Skills view groups the user opened (true) or closed (false), keyed by `${tab}:${group}` */
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
  terminalFontSize: 13,
  terminalFontFamily:
    '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, "DejaVu Sans Mono", monospace',
  notifications: true,
  shell: null,
  globalHotkey: 'CommandOrControl+Shift+Space',
  defaultAgent: 'claude',
  customAgents: [],
  agentProfiles: [],
  setupSeen: false,
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
}

export interface WorktreeInfo {
  path: string
  branch: string
  base: string
  /** main repository top-level */
  repo: string
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
}

export type MissionStatus = 'starting' | 'working' | 'waiting' | 'needs-input' | 'ended' | 'failed'

/** a status the mission entered, and when */
export interface StatusChange {
  status: MissionStatus
  at: number
}

export interface Mission {
  id: string
  title: string
  prompt: string
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
  lastMessage?: string
  notification?: string
  stats?: DiffStat
  /** every status change, oldest first (feeds the usage dashboard) */
  history?: StatusChange[]
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

export interface GhPr {
  number: number
  title: string
  state: string
  url: string
  isDraft: boolean
  checks: { passed: number; failed: number; pending: number }
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
