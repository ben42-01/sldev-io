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
  globalHotkey: 'CommandOrControl+Shift+Space'
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

export interface ClaudeTaskOptions {
  model?: string
  permissionMode?: string
  effort?: string
  /** run in a fresh git worktree (`claude -w`) */
  worktree?: boolean
  /** non-interactive (`claude -p`) */
  print?: boolean
  extraArgs?: string
}

export interface Task {
  id: string
  name: string
  /** project root this task belongs to, or null for a global task */
  scope: string | null
  kind: 'shell' | 'claude'
  /** relative to the scope root ('' = root); absolute for global tasks ('' = home) */
  cwd: string
  command?: string
  prompt?: string
  claude?: ClaudeTaskOptions
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
  options: ClaudeTaskOptions
  status: MissionStatus
  sessionId?: string
  taskId?: string
  createdAt: number
  updatedAt: number
  activity?: string
  lastMessage?: string
  notification?: string
  stats?: DiffStat
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
