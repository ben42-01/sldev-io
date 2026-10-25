import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BetaStatus } from '@shared/beta'
import type { LicenseStatus } from '@shared/license'
import type { TokenUsage } from '@shared/usage'
import type {
  AgentProfile,
  RulesState,
  AppInfo,
  AppSettings,
  ClaudeAsset,
  CredentialInput,
  CredentialMeta,
  DiffStat,
  DockerAction,
  DockerList,
  DirEntry,
  EditorInfo,
  GhIssue,
  GhPr,
  GhRepoInfo,
  GhRun,
  GhWorkflow,
  GhWorkflowInput,
  HookEvent,
  McpEvent,
  McpServer,
  NoteMeta,
  PortForward,
  PtyCreateOptions,
  PtyInfo,
  RemoteEntry,
  RuntimeDef,
  SetupReport,
  SshConnection,
  SshPrompt,
  StoreFiles,
  UpdateStatus,
  VaultStatus,
  WorktreeInfo
} from '../shared/types'

type Unsubscribe = () => void

function on<A extends unknown[]>(channel: string, cb: (...args: A) => void): Unsubscribe {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  platform: process.platform,
  pty: {
    create: (id: string, opts: PtyCreateOptions): Promise<PtyInfo> => ipcRenderer.invoke('pty:create', id, opts),
    write: (id: string, data: string): void => ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number): void => ipcRenderer.send('pty:resize', id, cols, rows),
    ack: (id: string, bytes: number): void => ipcRenderer.send('pty:ack', id, bytes),
    kill: (id: string): void => ipcRenderer.send('pty:kill', id),
    onData: (cb: (id: string, data: string) => void): Unsubscribe => on('pty:data', cb),
    onExit: (cb: (id: string, code: number) => void): Unsubscribe => on('pty:exit', cb)
  },
  fs: {
    readDir: (dir: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:readDir', dir),
    home: (): Promise<string> => ipcRenderer.invoke('fs:home'),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke('fs:pickFolder'),
    watch: (dir: string): void => ipcRenderer.send('fs:watch', dir),
    unwatch: (dir: string): void => ipcRenderer.send('fs:unwatch', dir),
    onChanged: (cb: (dir: string) => void): Unsubscribe => on('fs:changed', cb),
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
    existingFiles: (paths: string[]): Promise<string[]> => ipcRenderer.invoke('fs:existingFiles', paths),
    listFiles: (root: string): Promise<string[]> => ipcRenderer.invoke('fs:listFiles', root)
  },
  agents: {
    /** which of these executables are on PATH */
    installed: (bins: string[]): Promise<string[]> => ipcRenderer.invoke('agents:installed', bins)
  },
  editors: {
    list: (): Promise<EditorInfo[]> => ipcRenderer.invoke('editors:list'),
    open: (id: string, target: string, line?: number, col?: number): Promise<boolean> => ipcRenderer.invoke('editors:open', id, target, line, col),
    terminalCommand: (id: string): Promise<string | null> => ipcRenderer.invoke('editors:terminalCommand', id),
    terminalGoto: (id: string, file: string, line: number): Promise<string | null> => ipcRenderer.invoke('editors:terminalGoto', id, file, line)
  },
  shell: {
    reveal: (p: string): Promise<void> => ipcRenderer.invoke('shell:reveal', p),
    openPath: (p: string): Promise<string> => ipcRenderer.invoke('shell:openPath', p),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url)
  },
  beta: {
    /** the free-beta window; the first call waits for the startup check */
    status: (): Promise<BetaStatus> => ipcRenderer.invoke('beta:status'),
    refresh: (): Promise<BetaStatus> => ipcRenderer.invoke('beta:refresh'),
    onChanged: (cb: (s: BetaStatus) => void): Unsubscribe => on('beta:changed', cb)
  },
  app: {
    focus: (): Promise<void> => ipcRenderer.invoke('app:focus'),
    openDataFolder: (): Promise<string> => ipcRenderer.invoke('app:openDataFolder'),
    info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info')
  },
  license: {
    status: (): Promise<LicenseStatus> => ipcRenderer.invoke('license:status'),
    /** throws with a message for the user (invalid key, too many machines, offline) */
    activate: (key: string): Promise<LicenseStatus> => ipcRenderer.invoke('license:activate', key),
    deactivate: (): Promise<LicenseStatus> => ipcRenderer.invoke('license:deactivate'),
    refresh: (): Promise<LicenseStatus> => ipcRenderer.invoke('license:refresh'),
    onChanged: (cb: (s: LicenseStatus) => void): Unsubscribe => on('license:changed', cb)
  },
  update: {
    status: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:status'),
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
    /** asks the user, then restarts into the downloaded update */
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onChanged: (cb: (s: UpdateStatus) => void): Unsubscribe => on('update:changed', cb)
  },
  git: {
    branch: (cwd: string): Promise<string | null> => ipcRenderer.invoke('git:branch', cwd),
    head: (cwd: string): Promise<string | null> => ipcRenderer.invoke('git:head', cwd),
    isRepo: (cwd: string): Promise<boolean> => ipcRenderer.invoke('git:isRepo', cwd),
    branches: (cwd: string): Promise<string[]> => ipcRenderer.invoke('git:branches', cwd),
    switch: (cwd: string, branch: string): Promise<void> => ipcRenderer.invoke('git:switch', cwd, branch),
    addWorktree: (root: string, slug: string, base: string): Promise<WorktreeInfo> => ipcRenderer.invoke('git:addWorktree', root, slug, base),
    removeWorktree: (wt: WorktreeInfo, deleteBranch: boolean): Promise<void> => ipcRenderer.invoke('git:removeWorktree', wt, deleteBranch),
    diff: (cwd: string, base: string): Promise<string> => ipcRenderer.invoke('git:diff', cwd, base),
    diffStat: (cwd: string, base: string): Promise<DiffStat> => ipcRenderer.invoke('git:diffStat', cwd, base),
    commitAll: (cwd: string, message: string): Promise<string> => ipcRenderer.invoke('git:commitAll', cwd, message),
    merge: (repo: string, branch: string): Promise<string> => ipcRenderer.invoke('git:merge', repo, branch),
    pushAndPr: (cwd: string, branch: string, base: string, title: string, body?: string): Promise<string> => ipcRenderer.invoke('git:pushAndPr', cwd, branch, base, title, body)
  },
  missions: {
    hookInfo: (): Promise<{ port: number; token: string; settingsPath: string; mcp: { command: string; script: string } } | null> => ipcRenderer.invoke('missions:hookInfo'),
    onHook: (cb: (e: HookEvent) => void): Unsubscribe => on('mission:hook', cb),
    onMcp: (cb: (e: McpEvent) => void): Unsubscribe => on('mission:mcp', cb)
  },
  claude: {
    assets: (root: string | null): Promise<ClaudeAsset[]> => ipcRenderer.invoke('claude:assets', root),
    createSkill: (scope: 'user' | 'project', root: string | null, name: string, description: string, body: string): Promise<string> =>
      ipcRenderer.invoke('claude:createSkill', scope, root, name, description, body),
    mcpList: (cwd: string): Promise<{ servers: McpServer[]; raw: string }> => ipcRenderer.invoke('claude:mcpList', cwd)
  },
  gh: {
    repo: (cwd: string): Promise<GhRepoInfo> => ipcRenderer.invoke('gh:repo', cwd),
    workflows: (cwd: string): Promise<GhWorkflow[]> => ipcRenderer.invoke('gh:workflows', cwd),
    runs: (cwd: string, workflow?: string): Promise<GhRun[]> => ipcRenderer.invoke('gh:runs', cwd, workflow),
    inputs: (cwd: string, path: string): Promise<GhWorkflowInput[] | null> => ipcRenderer.invoke('gh:inputs', cwd, path),
    dispatch: (cwd: string, id: number, ref: string, inputs: Record<string, string>): Promise<void> => ipcRenderer.invoke('gh:dispatch', cwd, id, ref, inputs),
    rerun: (cwd: string, runId: number, failedOnly: boolean): Promise<void> => ipcRenderer.invoke('gh:rerun', cwd, runId, failedOnly),
    cancel: (cwd: string, runId: number): Promise<void> => ipcRenderer.invoke('gh:cancel', cwd, runId),
    pr: (cwd: string): Promise<GhPr | null> => ipcRenderer.invoke('gh:pr', cwd),
    issues: (cwd: string): Promise<GhIssue[]> => ipcRenderer.invoke('gh:issues', cwd)
  },
  notes: {
    list: (scope: string | null): Promise<NoteMeta[]> => ipcRenderer.invoke('notes:list', scope),
    create: (scope: string | null, title: string): Promise<string> => ipcRenderer.invoke('notes:create', scope, title),
    read: (path: string): Promise<string> => ipcRenderer.invoke('notes:read', path),
    write: (path: string, text: string): Promise<void> => ipcRenderer.invoke('notes:write', path, text),
    remove: (path: string): Promise<void> => ipcRenderer.invoke('notes:delete', path),
    openFolder: (scope: string | null): Promise<string> => ipcRenderer.invoke('notes:openFolder', scope)
  },
  usage: {
    tokens: (reqs: Array<{ id: string; agent: string; cwd: string; from: number; to: number; transcriptPath?: string }>): Promise<Record<string, TokenUsage | null>> =>
      ipcRenderer.invoke('usage:tokens', reqs)
  },
  factory: {
    recipes: (root: string): Promise<Array<{ path: string; text: string }>> => ipcRenderer.invoke('factory:recipes', root),
    saveRecipe: (root: string, slug: string, text: string): Promise<string> => ipcRenderer.invoke('factory:saveRecipe', root, slug, text),
    prepare: (dir: string): Promise<void> => ipcRenderer.invoke('factory:prepare', dir),
    read: (path: string): Promise<string | null> => ipcRenderer.invoke('factory:read', path),
    write: (path: string, text: string): Promise<void> => ipcRenderer.invoke('factory:write', path, text),
    copy: (from: string, to: string): Promise<boolean> => ipcRenderer.invoke('factory:copy', from, to)
  },
  rules: {
    state: (root: string): Promise<RulesState> => ipcRenderer.invoke('rules:state', root),
    create: (root: string): Promise<string> => ipcRenderer.invoke('rules:create', root),
    setTarget: (root: string, id: string, on: boolean): Promise<void> => ipcRenderer.invoke('rules:target', root, id, on),
    sync: (root: string, overwrite: string[] = []): Promise<RulesState> => ipcRenderer.invoke('rules:sync', root, overwrite)
  },
  profiles: {
    list: (root: string): Promise<AgentProfile[]> => ipcRenderer.invoke('profiles:list', root),
    save: (root: string, profile: AgentProfile): Promise<string> => ipcRenderer.invoke('profiles:save', root, profile),
    remove: (root: string, path: string): Promise<void> => ipcRenderer.invoke('profiles:remove', root, path),
    export: (root: string, profile: AgentProfile, target: 'claude' | 'opencode'): Promise<string> => ipcRenderer.invoke('profiles:export', root, profile, target)
  },
  vault: {
    status: (): Promise<VaultStatus> => ipcRenderer.invoke('vault:status'),
    list: (): Promise<CredentialMeta[]> => ipcRenderer.invoke('vault:list'),
    save: (input: CredentialInput): Promise<CredentialMeta> => ipcRenderer.invoke('vault:save', input),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('vault:delete', id)
  },
  ssh: {
    openShell: (id: string, connId: string, cols: number, rows: number): Promise<void> => ipcRenderer.invoke('ssh:openShell', id, connId, cols, rows),
    importConfig: (): Promise<SshConnection[]> => ipcRenderer.invoke('ssh:importConfig'),
    connected: (): Promise<string[]> => ipcRenderer.invoke('ssh:connected'),
    disconnect: (connId: string): Promise<void> => ipcRenderer.invoke('ssh:disconnect', connId),
    home: (connId: string): Promise<string> => ipcRenderer.invoke('ssh:home', connId),
    list: (connId: string, path: string): Promise<RemoteEntry[]> => ipcRenderer.invoke('ssh:list', connId, path),
    download: (connId: string, path: string): Promise<string> => ipcRenderer.invoke('ssh:download', connId, path),
    forwards: (): Promise<string[]> => ipcRenderer.invoke('ssh:forwards'),
    startForward: (connId: string, fwd: PortForward): Promise<void> => ipcRenderer.invoke('ssh:startForward', connId, fwd),
    stopForward: (connId: string, fwdId: string): Promise<void> => ipcRenderer.invoke('ssh:stopForward', connId, fwdId),
    onPrompt: (cb: (p: SshPrompt) => void): Unsubscribe => on('ssh:prompt', cb),
    reply: (requestId: string, answer: string[] | null): void => ipcRenderer.send('ssh:prompt-reply', requestId, answer)
  },
  docker: {
    list: (): Promise<DockerList> => ipcRenderer.invoke('docker:list'),
    action: (id: string, action: DockerAction): Promise<void> => ipcRenderer.invoke('docker:action', id, action)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke('settings:set', patch)
  },
  store: {
    get: <K extends keyof StoreFiles>(name: K): Promise<StoreFiles[K]> => ipcRenderer.invoke('store:get', name),
    set: <K extends keyof StoreFiles>(name: K, data: StoreFiles[K]): Promise<void> => ipcRenderer.invoke('store:set', name, data)
  },
  runtimes: {
    detect: (root: string): Promise<RuntimeDef[]> => ipcRenderer.invoke('runtimes:detect', root)
  },
  setup: {
    /** reloadEnv: re-read the login-shell PATH first, to find tools installed since startup */
    check: (reloadEnv = false): Promise<SetupReport> => ipcRenderer.invoke('setup:check', reloadEnv)
  },
  layout: {
    load: (): Promise<unknown> => ipcRenderer.invoke('layout:load'),
    save: (data: unknown): Promise<void> => ipcRenderer.invoke('layout:save', data)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
