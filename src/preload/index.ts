import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { TokenUsage } from '@shared/usage'
import type { MissionKind } from '@shared/missionKinds'
import type { ContextHit, ContextStats } from '@shared/context'
import type { DraftFile, SkillState } from '@shared/sldevSkills'
import type { CodeGraph, SchemaGraph, StructureGraph } from '@shared/diagram'
import type { GraphLog } from '@shared/gitGraph'
import type { BaseMoved, MergeMethod, ShipStatus } from '@shared/ship'
import type { Use } from '@shared/review'
import type { OpenPrList, PrDetail, PrWorktree } from '@shared/prs'
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
  GhPrComment,
  GhPr,
  GhPrReview,
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
  RepoActivity,
  RepoStats,
  RuntimeDef,
  SetupReport,
  SshConnection,
  SshPrompt,
  StoreFiles,
  UpdateStatus,
  VaultStatus,
  WorktreeInfo,
  WorktreeStatus,
  GitStatus,
  GitWorktree,
  GitBranchList
} from '../shared/types'

import { themeFromArgv, type ResolvedTheme } from '../shared/theme'

type Unsubscribe = () => void

function on<A extends unknown[]>(channel: string, cb: (...args: A) => void): Unsubscribe {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  platform: process.platform,
  /** the theme main opened the window with, known before settings load so the first paint matches */
  initialTheme: themeFromArgv(process.argv),
  window: {
    /** recolour the native window (background, title-bar buttons) for the theme the page shows, and zoom it */
    setAppearance: (theme: ResolvedTheme, zoom: number): void => ipcRenderer.send('window:appearance', theme, zoom)
  },
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
    /** native folder picker, opened at `start` when it exists */
    pickFolder: (start?: string): Promise<string | null> => ipcRenderer.invoke('fs:pickFolder', start),
    isDir: (path: string): Promise<boolean> => ipcRenderer.invoke('fs:isDir', path),
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
    /** the editor's own diff of a file against the mission's base; false when it has none */
    diff: (id: string, cwd: string, base: string, path: string, oldPath?: string): Promise<boolean> => ipcRenderer.invoke('editors:diff', id, cwd, base, path, oldPath),
    terminalCommand: (id: string): Promise<string | null> => ipcRenderer.invoke('editors:terminalCommand', id),
    terminalGoto: (id: string, file: string, line: number): Promise<string | null> => ipcRenderer.invoke('editors:terminalGoto', id, file, line)
  },
  clipboard: {
    writeText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
    readText: (): Promise<string> => ipcRenderer.invoke('clipboard:read')
  },
  shell: {
    reveal: (p: string): Promise<void> => ipcRenderer.invoke('shell:reveal', p),
    openPath: (p: string): Promise<string> => ipcRenderer.invoke('shell:openPath', p),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url)
  },
  app: {
    focus: (): Promise<void> => ipcRenderer.invoke('app:focus'),
    /** overlay: a PNG data URL for the Windows taskbar, ignored elsewhere */
    badge: (count: number, overlay: string | null): Promise<void> => ipcRenderer.invoke('app:badge', count, overlay),
    openDataFolder: (): Promise<string> => ipcRenderer.invoke('app:openDataFolder'),
    info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info')
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
    /** fetch, then the upstream ("origin/master") when `branch` is only behind it, else `branch` */
    freshBase: (cwd: string, branch: string): Promise<string> => ipcRenderer.invoke('git:freshBase', cwd, branch),
    head: (cwd: string): Promise<string | null> => ipcRenderer.invoke('git:head', cwd),
    commitsSince: (cwd: string, from: string): Promise<number | null> => ipcRenderer.invoke('git:commitsSince', cwd, from),
    isRepo: (cwd: string): Promise<boolean> => ipcRenderer.invoke('git:isRepo', cwd),
    branches: (cwd: string): Promise<string[]> => ipcRenderer.invoke('git:branches', cwd),
    switch: (cwd: string, branch: string): Promise<void> => ipcRenderer.invoke('git:switch', cwd, branch),
    status: (cwd: string): Promise<GitStatus> => ipcRenderer.invoke('git:status', cwd),
    /** fetch --all --prune; resolves with git's report */
    fetch: (cwd: string): Promise<string> => ipcRenderer.invoke('git:fetch', cwd),
    /** fast-forward only: rejects with git's message when the branch has diverged */
    pull: (cwd: string): Promise<string> => ipcRenderer.invoke('git:pull', cwd),
    /** creates `name` at `base` (HEAD when ''); resolves with the branch name */
    createBranch: (cwd: string, name: string, base: string, switchTo: boolean): Promise<string> => ipcRenderer.invoke('git:createBranch', cwd, name, base, switchTo),
    worktrees: (cwd: string): Promise<GitWorktree[]> => ipcRenderer.invoke('git:worktrees', cwd),
    /** local and remote branches with their last commit, for the Git view */
    branchList: (cwd: string): Promise<GitBranchList> => ipcRenderer.invoke('git:branchList', cwd),
    remoteBranches: (cwd: string): Promise<string[]> => ipcRenderer.invoke('git:remoteBranches', cwd),
    /** `existing`: check out that branch; `exact`: a new branch named as typed (no sldev/ prefix, no -2) */
    addWorktree: (root: string, slug: string, base: string, opts?: { existing?: boolean; exact?: boolean }): Promise<WorktreeInfo> =>
      ipcRenderer.invoke('git:addWorktree', root, slug, base, opts),
    /** git worktree prune: forget worktrees whose folders are gone */
    pruneWorktrees: (cwd: string): Promise<void> => ipcRenderer.invoke('git:pruneWorktrees', cwd),
    worktreeStatus: (wt: WorktreeInfo): Promise<WorktreeStatus> => ipcRenderer.invoke('git:worktreeStatus', wt),
    /** fetch pull/<n>/head into refs/sldev/pr/<n> and check it out detached in its own worktree (reused, or moved to new commits) */
    prWorktree: (root: string, n: number, headSha?: string, remote?: string): Promise<PrWorktree> => ipcRenderer.invoke('git:prWorktree', root, n, headSha, remote),
    /** remove PR n's review worktree and fetched ref; git refuses changed files unless `discard` */
    removePrWorktree: (root: string, n: number, opts?: { discard: boolean }): Promise<void> => ipcRenderer.invoke('git:removePrWorktree', root, n, opts),
    removeWorktree: (wt: WorktreeInfo, opts: { deleteBranch: boolean; discard: boolean }): Promise<void> => ipcRenderer.invoke('git:removeWorktree', wt, opts),
    /** every ref's last `limit` commits in topo order, for the commit graph */
    graphLog: (cwd: string, limit: number): Promise<GraphLog> => ipcRenderer.invoke('git:graphLog', cwd, limit),
    /** one commit's own diff (a merge against its first parent) */
    showCommit: (cwd: string, sha: string): Promise<string> => ipcRenderer.invoke('git:showCommit', cwd, sha),
    diff: (cwd: string, base: string): Promise<string> => ipcRenderer.invoke('git:diff', cwd, base),
    /** where names are used in the checkout (git grep -w, local, capped), for the review's blast radius */
    uses: (cwd: string, names: string[]): Promise<{ uses: Use[]; capped: boolean }> => ipcRenderer.invoke('git:uses', cwd, names),
    /** the files a branch changed since `base` (committed, uncommitted and new) */
    changedFiles: (cwd: string, base: string): Promise<string[]> => ipcRenderer.invoke('git:changedFiles', cwd, base),
    diffStat: (cwd: string, base: string): Promise<DiffStat> => ipcRenderer.invoke('git:diffStat', cwd, base),
    commitAll: (cwd: string, message: string): Promise<string> => ipcRenderer.invoke('git:commitAll', cwd, message),
    /** merge `branch` locally in the main checkout, which must be on `into` */
    merge: (repo: string, branch: string, into?: string): Promise<string> => ipcRenderer.invoke('git:merge', repo, branch, into),
    /** the ship bar: commits on the base (or its upstream, fetched now and then) since the branch, and a trial merge's conflicts */
    baseMoved: (cwd: string, base: string): Promise<BaseMoved> => ipcRenderer.invoke('git:baseMoved', cwd, base),
    /** merge `ref` into the worktree's branch; a conflict is undone and its files returned. Never pushes */
    mergeBaseInto: (cwd: string, ref: string): Promise<{ merged: boolean; conflicts: string[]; output: string }> => ipcRenderer.invoke('git:mergeBaseInto', cwd, ref),
    push: (cwd: string, branch: string): Promise<void> => ipcRenderer.invoke('git:push', cwd, branch),
    pushAndPr: (cwd: string, branch: string, base: string, title: string, body?: string): Promise<string> => ipcRenderer.invoke('git:pushAndPr', cwd, branch, base, title, body)
  },
  missions: {
    hookInfo: (): Promise<{ port: number; token: string; settingsPath: string; mcp: { command: string; script: string } } | null> => ipcRenderer.invoke('missions:hookInfo'),
    briefFile: (id: string, text: string): Promise<string> => ipcRenderer.invoke('missions:briefFile', id, text),
    /** Claude's last reply from a transcript a hook reported or a mission saved */
    lastReply: (transcriptPath: string): Promise<string | undefined> => ipcRenderer.invoke('missions:lastReply', transcriptPath),
    onHook: (cb: (e: HookEvent) => void): Unsubscribe => on('mission:hook', cb),
    onMcp: (cb: (e: McpEvent) => void): Unsubscribe => on('mission:mcp', cb)
  },
  claude: {
    assets: (root: string | null): Promise<ClaudeAsset[]> => ipcRenderer.invoke('claude:assets', root),
    createSkill: (scope: 'user' | 'project', root: string | null, name: string, description: string, body: string): Promise<string> =>
      ipcRenderer.invoke('claude:createSkill', scope, root, name, description, body),
    mcpList: (cwd: string): Promise<{ servers: McpServer[]; raw: string }> => ipcRenderer.invoke('claude:mcpList', cwd)
  },
  /** sldev's own skills (draft a mission, stories, a recipe, an eval) and the drafts agents leave in .sldev/drafts */
  sldevSkills: {
    state: (root: string): Promise<SkillState[]> => ipcRenderer.invoke('sldevSkills:state', root),
    /** writes missing and outdated copies; hand-edited ones only when named in overwrite; returns the files written */
    install: (root: string, overwrite: string[] = []): Promise<string[]> => ipcRenderer.invoke('sldevSkills:install', root, overwrite),
    drafts: (root: string): Promise<DraftFile[]> => ipcRenderer.invoke('sldevSkills:drafts', root),
    /** ok: taken, the file goes; not ok: renamed to .bad */
    settle: (root: string, name: string, ok: boolean): Promise<void> => ipcRenderer.invoke('sldevSkills:settle', root, name, ok)
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
    /** pull request `n` for the Review tab: title, body, head commit, branches and its diff */
    prReview: (cwd: string, n: number): Promise<GhPrReview> => ipcRenderer.invoke('gh:prReview', cwd, n),
    issues: (cwd: string, label?: string): Promise<GhIssue[]> => ipcRenderer.invoke('gh:issues', cwd, label),
    prState: (cwd: string, n: number): Promise<'OPEN' | 'MERGED' | 'CLOSED' | null> => ipcRenderer.invoke('gh:prState', cwd, n),
    prForBranch: (cwd: string, branch: string): Promise<{ number: number; state: 'OPEN' | 'MERGED' | 'CLOSED' } | null> => ipcRenderer.invoke('gh:prForBranch', cwd, branch),
    /** the Review tab's ship bar: the branch's PR, its workflow runs and the local git facts */
    ship: (cwd: string, branch: string): Promise<ShipStatus> => ipcRenderer.invoke('gh:ship', cwd, branch),
    /** gh pr merge, only while the PR head is still `headSha` */
    mergePr: (cwd: string, n: number, method: MergeMethod, headSha: string, auto: boolean): Promise<string> => ipcRenderer.invoke('gh:mergePr', cwd, n, method, headSha, auto),
    /** open PRs, newest first; `error` instead of a throw when gh is missing, logged out or the folder isn't on GitHub */
    prs: (cwd: string): Promise<OpenPrList> => ipcRenderer.invoke('gh:prs', cwd),
    /** one PR with its body and the issues it closes */
    prDetail: (cwd: string, n: number): Promise<PrDetail> => ipcRenderer.invoke('gh:prDetail', cwd, n),
    prComments: (cwd: string, n: number): Promise<GhPrComment[]> => ipcRenderer.invoke('gh:prComments', cwd, n),
    /** gh-stats as data: local git parts always, GitHub parts each with its own error */
    stats: (cwd: string): Promise<RepoStats> => ipcRenderer.invoke('gh:stats', cwd),
    /** commits (git) and pull requests (gh) of the last `days` days, for the stats panel's charts */
    activity: (cwd: string, days: number): Promise<RepoActivity> => ipcRenderer.invoke('gh:activity', cwd, days)
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
  lead: {
    /** a Lead mission called sldev_delegate, wait, followup or integrate; answer with reply */
    onRequest: (cb: (r: { id: string; mission: string; tool: string; args: Record<string, unknown> }) => void): Unsubscribe => on('lead:request', cb),
    reply: (id: string, r: { text?: string; error?: string }): void => ipcRenderer.send('lead:reply', id, r)
  },
  evals: {
    list: (root: string): Promise<Array<{ path: string; text: string }>> => ipcRenderer.invoke('evals:list', root),
    save: (root: string, slug: string, text: string): Promise<string> => ipcRenderer.invoke('evals:save', root, slug, text),
    write: (path: string, text: string): Promise<void> => ipcRenderer.invoke('evals:write', path, text),
    check: (cwd: string, command: string, timeoutMs: number): Promise<{ code: number | null; output: string; timedOut?: boolean }> => ipcRenderer.invoke('evals:check', cwd, command, timeoutMs),
    /** prompt variants to compare: .sldev/evals/prompts/*.md */
    prompts: (root: string): Promise<Array<{ path: string; name: string; text: string }>> => ipcRenderer.invoke('evals:prompts', root),
    savePrompt: (root: string, slug: string, text: string): Promise<string> => ipcRenderer.invoke('evals:savePrompt', root, slug, text)
  },
  board: {
    /** .sldev/board.json, when the board is shared through git */
    readFile: (root: string): Promise<string | null> => ipcRenderer.invoke('board:readFile', root),
    writeFile: (root: string, text: string): Promise<void> => ipcRenderer.invoke('board:writeFile', root, text)
  },
  factory: {
    recipes: (root: string): Promise<Array<{ path: string; text: string }>> => ipcRenderer.invoke('factory:recipes', root),
    saveRecipe: (root: string, slug: string, text: string): Promise<string> => ipcRenderer.invoke('factory:saveRecipe', root, slug, text),
    prepare: (dir: string): Promise<void> => ipcRenderer.invoke('factory:prepare', dir),
    read: (path: string): Promise<string | null> => ipcRenderer.invoke('factory:read', path),
    write: (path: string, text: string): Promise<void> => ipcRenderer.invoke('factory:write', path, text),
    copy: (from: string, to: string): Promise<boolean> => ipcRenderer.invoke('factory:copy', from, to),
    setupPlan: (dir: string, command: string | false | undefined): Promise<string | null> => ipcRenderer.invoke('factory:setupPlan', dir, command),
    setup: (dir: string, command: string): Promise<{ ok: boolean; log: string }> => ipcRenderer.invoke('factory:setup', dir, command),
    /** a spec or plan inside the repository to start a run from */
    readSeed: (root: string, path: string): Promise<string> => ipcRenderer.invoke('factory:readSeed', root, path),
    /** saves over a recipe in some project's .sldev/factory */
    writeRecipe: (path: string, text: string): Promise<void> => ipcRenderer.invoke('factory:writeRecipe', path, text),
    /** moves a project recipe to the trash */
    deleteRecipe: (path: string): Promise<void> => ipcRenderer.invoke('factory:deleteRecipe', path),
    /** save dialog; the path written, or null when cancelled */
    exportRecipe: (fileName: string, text: string): Promise<string | null> => ipcRenderer.invoke('factory:exportRecipe', fileName, text),
    /** open dialog; the file's text, or null when cancelled */
    importRecipeFile: (): Promise<string | null> => ipcRenderer.invoke('factory:importRecipeFile')
  },
  rules: {
    state: (root: string): Promise<RulesState> => ipcRenderer.invoke('rules:state', root),
    create: (root: string): Promise<string> => ipcRenderer.invoke('rules:create', root),
    setTarget: (root: string, id: string, on: boolean): Promise<void> => ipcRenderer.invoke('rules:target', root, id, on),
    sync: (root: string, overwrite: string[] = []): Promise<RulesState> => ipcRenderer.invoke('rules:sync', root, overwrite)
  },
  memory: {
    info: (root: string): Promise<{ path: string; exists: boolean; entries: number }> => ipcRenderer.invoke('memory:info', root),
    /** creates .sldev/memory.md when missing; returns its path */
    ensure: (root: string): Promise<string> => ipcRenderer.invoke('memory:ensure', root),
    remember: (root: string, note: string, source: string, paths?: string[]): Promise<void> => ipcRenderer.invoke('memory:remember', root, note, source, paths),
    /** removes the entry on `line`, only if it still contains `expect` */
    forget: (root: string, line: number, expect: string): Promise<void> => ipcRenderer.invoke('memory:forget', root, line, expect)
  },
  /** project context: memory, .sldev/context docs, pinned files and skills, indexed for search by topic or file */
  context: {
    list: (root: string): Promise<{ nodes: ContextHit[]; stats: ContextStats }> => ipcRenderer.invoke('context:list', root),
    /** the notes a mission with this brief would be pointed at */
    search: (root: string, text: string, limit?: number): Promise<ContextHit[]> => ipcRenderer.invoke('context:search', root, text, limit),
    rebuild: (root: string): Promise<void> => ipcRenderer.invoke('context:rebuild', root),
    /** adds a file to .sldev/pinned.md; returns its project-relative path */
    pin: (root: string, path: string, note?: string): Promise<string> => ipcRenderer.invoke('context:pin', root, path, note),
    unpin: (root: string, path: string): Promise<void> => ipcRenderer.invoke('context:unpin', root, path),
    /** writes .sldev/skills/map-project/SKILL.md (kept if it exists); returns its path */
    installMapSkill: (root: string): Promise<string> => ipcRenderer.invoke('context:installMapSkill', root)
  },
  diagram: {
    /** imports between folders `depth` levels deep, parsed locally; `language` is a code map lang id (all when left out) */
    code: (root: string, depth: number, language?: string): Promise<CodeGraph> => ipcRenderer.invoke('diagram:code', root, depth, language),
    /** folders and source files of any language, `depth` levels deep */
    structure: (root: string, depth: number): Promise<StructureGraph> => ipcRenderer.invoke('diagram:structure', root, depth),
    /** tables and foreign keys from Prisma schemas and SQL DDL */
    schema: (root: string): Promise<SchemaGraph> => ipcRenderer.invoke('diagram:schema', root)
  },
  kinds: {
    list: (root: string | null): Promise<MissionKind[]> => ipcRenderer.invoke('kinds:list', root),
    create: (scope: 'project' | 'user', root: string | null, name: string, text: string): Promise<string> => ipcRenderer.invoke('kinds:create', scope, root, name, text)
  },
  profiles: {
    list: (root: string): Promise<AgentProfile[]> => ipcRenderer.invoke('profiles:list', root),
    save: (root: string, profile: AgentProfile): Promise<string> => ipcRenderer.invoke('profiles:save', root, profile),
    remove: (root: string, path: string): Promise<void> => ipcRenderer.invoke('profiles:remove', root, path),
    /** installs a team template's roles into .sldev/agents; existing files are kept (skipped), never overwritten */
    installTeam: (root: string, team: string): Promise<{ written: string[]; skipped: string[] }> => ipcRenderer.invoke('profiles:installTeam', root, team),
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
    ping: (host: string, port: number): Promise<{ ms: number } | { error: string }> => ipcRenderer.invoke('ssh:ping', host, port),
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
    detect: (root: string): Promise<RuntimeDef[]> => ipcRenderer.invoke('runtimes:detect', root),
    /** scripts in exactly this folder (package.json, Makefile, justfile, …) */
    scripts: (dir: string): Promise<RuntimeDef[]> => ipcRenderer.invoke('runtimes:scripts', dir)
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
