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
}

export const DEFAULT_SETTINGS: AppSettings = {
  rootFolder: null,
  recentFolders: [],
  preferredEditor: null,
  sidebarWidth: 280,
  sidebarVisible: true,
  terminalFontSize: 13,
  terminalFontFamily:
    '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, "DejaVu Sans Mono", monospace'
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
  runtimes: { custom: Record<string, CustomRuntime[]> }
}
