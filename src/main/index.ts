import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, shell, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'fs'
import { arch, homedir, release, type as osType } from 'os'
import { basename, isAbsolute, join } from 'path'
import { DEFAULT_SETTINGS, type AppInfo, type AppSettings, type PtyCreateOptions, type StoreFiles } from '@shared/types'
import { clampZoom, resolveTheme, THEME_ARG, titleBarHeight, WINDOW_COLORS, type ResolvedTheme } from '@shared/theme'
import { PtyManager, setShellOverride, type PtySink } from './pty'
import { DirWatchers, existingFiles, readDir, walkFiles } from './fs'
import { detectEditors, openDiffInEditor, openInEditor, terminalEditorCommand, terminalEditorGoto, whichAsync } from './editors'
import { recentStalls, watchMainLoop, watchWindow } from './stalls'
import * as git from './git'
import * as gh from './github'
import * as notes from './notes'
import * as profiles from './profiles'
import * as missionKinds from './missionKinds'
import * as memory from './memory'
import * as context from './context'
import * as diagram from './diagram'
import * as rules from './rules'
import * as factory from './factory'
import { missionTokens, type UsageRequest } from './usage'
import * as vault from './vault'
import { createSkill, listClaudeAssets, listMcpServers } from './claudeAssets'
import { hookInfo, knownTranscripts, lastAssistantText, startHookServer } from './hooks'
import { importSshConfig, ping as pingHost, SshManager } from './ssh'
import type { AgentProfile, CredentialInput, DockerAction, PortForward, SshConnection, WorktreeInfo } from '@shared/types'
import { JsonStore } from './store'
import { detectRuntimes, detectScripts } from './runtimes'
import { loadShellEnv } from './shellEnv'
import { betaStatus, refreshBeta, startBetaChecks } from './beta'
import { checkSetup } from './setup'
import { containerAction, listContainers } from './docker'
import { checkForUpdates, installUpdate, startUpdateChecks, updateStatus } from './updater'
import { activateLicense, deactivateLicense, licenseStatus, refreshLicense, startLicenseChecks } from './license'

const isMac = process.platform === 'darwin'
const userData = (): string => app.getPath('userData')

// The app was called "sldev" before; carry its data dir over once (connections, settings, notes…).
function migrateLegacyUserData(): void {
  const current = app.getPath('userData')
  const legacy = join(app.getPath('appData'), 'sldev')
  if (basename(current) !== 'sldev-io' || existsSync(current) || !existsSync(legacy)) return
  try {
    renameSync(legacy, current)
  } catch (err) {
    console.error('could not migrate legacy user data', err)
  }
}
migrateLegacyUserData()

let win: BrowserWindow | null = null
const ptys = new PtyManager()
const ssh = new SshManager(() => stores.connections.get().connections)
const watchers = new DirWatchers(() => win?.webContents ?? null)
let settings: JsonStore<AppSettings>
let layout: JsonStore<{ layout: unknown }>
let stores: { [K in keyof StoreFiles]: JsonStore<StoreFiles[K]> }

// one sink per window, so killOwnedBy finds the ptys a window created
const sinks = new WeakMap<WebContents, PtySink>()
function windowSink(wc: WebContents): PtySink {
  let sink = sinks.get(wc)
  if (!sink) {
    sink = {
      data: (id, data) => !wc.isDestroyed() && wc.send('pty:data', id, data),
      exit: (id, code) => !wc.isDestroyed() && wc.send('pty:exit', id, code),
      closed: () => wc.isDestroyed()
    }
    sinks.set(wc, sink)
  }
  return sink
}

function createWindow(): void {
  const theme = resolveTheme(settings.get().theme, nativeTheme.shouldUseDarkColors)
  const colors = WINDOW_COLORS[theme]
  const zoom = clampZoom(settings.get().uiZoom)
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 480,
    show: false,
    backgroundColor: colors.background,
    title: 'sldev-io',
    // macOS and Windows take the icon from the app bundle / exe
    ...(process.platform === 'linux' ? { icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icons/512x512.png') } : {}),
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 12, y: 12 } }
      : { titleBarOverlay: { color: colors.background, symbolColor: colors.symbol, height: titleBarHeight(zoom) } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // read by the preload, so the page paints in the right theme before settings load
      additionalArguments: [THEME_ARG + theme],
      zoomFactor: zoom,
      sandbox: true,
      contextIsolation: true
    }
  })

  win.once('ready-to-show', () => win?.show())
  watchWindow(win)
  const wc = win.webContents
  const cleanup = (): void => {
    ptys.killOwnedBy(windowSink(wc))
    ssh.killOwnedBy(wc)
  }
  wc.on('destroyed', cleanup)
  wc.on('render-process-gone', cleanup)
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('closed', () => {
    win = null
    watchers.closeAll()
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function buildMenu(): void {
  // Keyboard shortcuts live in the renderer; the menu exists for OS conventions (copy/paste, quit, devtools).
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc(): void {
  // terminals
  ipcMain.handle('pty:create', (e, id: string, opts: PtyCreateOptions) => ptys.create(windowSink(e.sender), id, opts))
  // write/resize/ack/kill go to whichever backend (local pty or SSH shell) owns the id
  const backend = (id: string): PtyManager | SshManager => (ssh.has(id) ? ssh : ptys)
  ipcMain.on('pty:write', (_e, id: string, data: string) => backend(id).write(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => backend(id).resize(id, cols, rows))
  ipcMain.on('pty:ack', (_e, id: string, bytes: number) => backend(id).ack(id, bytes))
  ipcMain.on('pty:kill', (_e, id: string) => {
    ptys.kill(id)
    ssh.kill(id)
  })
  ipcMain.handle('ssh:openShell', async (e, id: string, connId: string, cols: number, rows: number) => {
    try {
      await ssh.openShell(e.sender, id, connId, cols, rows)
    } catch (err) {
      ssh.kill(id)
      throw err
    }
  })

  // filesystem
  ipcMain.handle('fs:readDir', (_e, dir: string) => readDir(dir))
  ipcMain.handle('fs:home', () => homedir())
  ipcMain.handle('fs:pickFolder', async (_e, start?: string) => {
    // without a start the OS dialog opens wherever it likes (often Downloads, or the last folder used): use home instead
    const defaultPath = start && existsSync(start) ? start : homedir()
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], defaultPath })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('fs:isDir', (_e, p: string) => {
    try {
      return isAbsolute(p) && statSync(p).isDirectory()
    } catch {
      return false
    }
  })
  ipcMain.handle('fs:existingFiles', (_e, paths: string[]) => existingFiles(paths))
  ipcMain.handle('fs:listFiles', async (_e, root: string) => ((await git.isRepo(root)) ? git.listFiles(root) : walkFiles(root)))
  ipcMain.on('fs:watch', (_e, dir: string) => watchers.watch(dir))
  ipcMain.on('fs:unwatch', (_e, dir: string) => watchers.unwatch(dir))

  // editors & OS integration
  ipcMain.handle('editors:list', () => detectEditors())
  ipcMain.handle('agents:installed', async (_e, bins: string[]) => {
    const found = await Promise.all(bins.map((b) => (b ? whichAsync(b) : null)))
    return bins.filter((_b, i) => !!found[i])
  })
  ipcMain.handle('editors:open', (_e, id: string, target: string, line?: number, col?: number) => openInEditor(id, target, line, col))
  ipcMain.handle('editors:diff', (_e, id: string, cwd: string, base: string, path: string, oldPath?: string) => openDiffInEditor(id, cwd, base, path, oldPath))
  ipcMain.handle('editors:terminalCommand', (_e, id: string) => terminalEditorCommand(id))
  ipcMain.handle('editors:terminalGoto', (_e, id: string, file: string, line: number) => terminalEditorGoto(id, file, line))
  ipcMain.handle('shell:reveal', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('shell:openPath', (_e, p: string) => shell.openPath(p))
  // the page's clipboard API refuses while the window isn't focused; terminals copy through here
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(String(text)))
  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('beta:status', () => betaStatus())
  ipcMain.handle('beta:refresh', () => refreshBeta())
  ipcMain.handle('app:openDataFolder', () => shell.openPath(app.getPath('userData')))
  ipcMain.handle('app:info', (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    channel: /-beta\b/.test(app.getVersion()) ? 'beta' : 'stable',
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: arch(),
    os: `${osType()} ${release()}`,
    stalls: recentStalls()
  }))

  // license
  ipcMain.handle('license:status', () => licenseStatus())
  ipcMain.handle('license:activate', (_e, key: string) => activateLicense(String(key)))
  ipcMain.handle('license:deactivate', () => deactivateLicense())
  ipcMain.handle('license:refresh', () => refreshLicense(true))

  // updates
  ipcMain.handle('update:status', () => updateStatus())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => installUpdate(win))
  // Missions that need you; Windows gets a drawn overlay because it has no badge count.
  ipcMain.handle('app:badge', (_e, count: number, overlay: string | null) => {
    if (process.platform === 'win32') win?.setOverlayIcon(overlay ? nativeImage.createFromDataURL(overlay) : null, count ? `${count} need you` : '')
    else app.setBadgeCount(count)
  })
  ipcMain.handle('app:focus', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  // git
  ipcMain.handle('git:branch', (_e, cwd: string) => git.gitBranch(cwd))
  ipcMain.handle('git:head', (_e, cwd: string) => git.head(cwd))
  ipcMain.handle('git:isRepo', (_e, cwd: string) => git.isRepo(cwd))
  ipcMain.handle('git:branches', (_e, cwd: string) => git.branches(cwd))
  ipcMain.handle('git:switch', (_e, cwd: string, b: string) => git.switchBranch(cwd, b))
  ipcMain.handle('git:addWorktree', (_e, root: string, slug: string, base: string) => git.addWorktree(root, slug, base))
  ipcMain.handle('git:worktreeStatus', (_e, wt: WorktreeInfo) => git.worktreeStatus(wt))
  ipcMain.handle('git:removeWorktree', (_e, wt: WorktreeInfo, opts: { deleteBranch: boolean; discard: boolean }) => git.removeWorktree(wt, opts))
  ipcMain.handle('git:diff', (_e, cwd: string, base: string) => git.diff(cwd, base))
  ipcMain.handle('git:diffStat', (_e, cwd: string, base: string) => git.diffStat(cwd, base))
  ipcMain.handle('git:commitAll', (_e, cwd: string, msg: string) => git.commitAll(cwd, msg))
  ipcMain.handle('git:merge', (_e, repo: string, branch: string) => git.merge(repo, branch))
  ipcMain.handle('git:push', (_e, cwd: string, branch: string) => git.push(cwd, branch))
  ipcMain.handle('git:pushAndPr', (_e, cwd: string, branch: string, base: string, title: string, body?: string) => git.pushAndCreatePr(cwd, branch, base, title, body))

  // missions (Claude Code hooks)
  ipcMain.handle('missions:hookInfo', () => hookInfo())
  // Claude writes its last reply to the transcript about when the Stop hook fires; the renderer reads it
  // again a moment later, so a reply written just after the hook isn't lost
  ipcMain.handle('missions:lastReply', (_e, path: string) => {
    const known = knownTranscripts.has(path) || stores.missions.get().missions.some((m) => m.transcriptPath === path)
    return known ? lastAssistantText(path) : undefined
  })
  ipcMain.handle('missions:briefFile', (_e, id: string, text: string) => {
    // a brief too long for a command line is handed over as a file the agent reads
    if (!/^[\w-]+$/.test(id)) throw new Error('Bad mission id')
    const dir = join(app.getPath('userData'), 'briefs')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${id}.md`)
    writeFileSync(file, text)
    return file
  })

  // Claude assets
  ipcMain.handle('claude:assets', (_e, root: string | null) => listClaudeAssets(root))
  ipcMain.handle('claude:createSkill', (_e, scope: 'user' | 'project', root: string | null, name: string, desc: string, body: string) => createSkill(scope, root, name, desc, body))
  ipcMain.handle('claude:mcpList', (_e, cwd: string) => listMcpServers(cwd))

  // GitHub
  ipcMain.handle('gh:repo', (_e, cwd: string) => gh.repoInfo(cwd))
  ipcMain.handle('gh:workflows', (_e, cwd: string) => gh.listWorkflows(cwd))
  ipcMain.handle('gh:runs', (_e, cwd: string, wf?: string) => gh.listRuns(cwd, wf))
  ipcMain.handle('gh:inputs', (_e, cwd: string, path: string) => gh.workflowInputs(cwd, path))
  ipcMain.handle('gh:dispatch', (_e, cwd: string, id: number, ref: string, inputs: Record<string, string>) => gh.dispatchWorkflow(cwd, id, ref, inputs))
  ipcMain.handle('gh:rerun', (_e, cwd: string, runId: number, failed: boolean) => gh.rerun(cwd, runId, failed))
  ipcMain.handle('gh:cancel', (_e, cwd: string, runId: number) => gh.cancelRun(cwd, runId))
  ipcMain.handle('gh:pr', (_e, cwd: string) => gh.currentPr(cwd))
  ipcMain.handle('gh:issues', (_e, cwd: string, label?: string) => gh.listIssues(cwd, label))
  ipcMain.handle('gh:prComments', (_e, cwd: string, n: number) => gh.prComments(cwd, n))

  // notes
  ipcMain.handle('notes:list', (_e, scope: string | null) => notes.listNotes(scope))
  ipcMain.handle('notes:create', (_e, scope: string | null, title: string) => notes.createNote(scope, title))
  ipcMain.handle('notes:read', (_e, p: string) => notes.readNote(p))
  ipcMain.handle('notes:write', (_e, p: string, text: string) => notes.writeNote(p, text))
  ipcMain.handle('notes:delete', (_e, p: string) => notes.deleteNote(p))
  ipcMain.handle('notes:openFolder', (_e, scope: string | null) => notes.openNotesFolder(scope))

  // agent profiles (project scope; user profiles live in settings)
  ipcMain.handle('profiles:list', (_e, root: string) => profiles.listProfiles(root))
  ipcMain.handle('profiles:save', (_e, root: string, p: AgentProfile) => profiles.saveProfile(root, p))
  ipcMain.handle('profiles:remove', (_e, root: string, path: string) => profiles.removeProfile(root, path, (p) => shell.trashItem(p)))
  ipcMain.handle('memory:info', (_e, root: string) => memory.memoryInfo(root))
  ipcMain.handle('memory:ensure', (_e, root: string) => memory.ensureMemory(root))
  ipcMain.handle('memory:remember', (_e, root: string, note: string, source: string, paths?: string[]) => memory.remember(root, note, source, paths))
  ipcMain.handle('memory:forget', (_e, root: string, line: number, expect: string) => memory.forget(root, line, expect))
  ipcMain.handle('context:list', (_e, root: string) => context.list(root))
  ipcMain.handle('context:search', (_e, root: string, text: string, limit?: number) => context.search(root, text, limit))
  ipcMain.handle('context:rebuild', (_e, root: string) => context.ensureIndex(root, true))
  ipcMain.handle('context:pin', (_e, root: string, path: string, note?: string) => context.pin(root, path, note))
  ipcMain.handle('context:unpin', (_e, root: string, path: string) => context.unpin(root, path))
  ipcMain.handle('context:installMapSkill', (_e, root: string) => context.installMapSkill(root))
  ipcMain.handle('diagram:code', (_e, root: string, depth: number) => diagram.codeGraph(root, Number(depth) || 2))
  ipcMain.handle('diagram:schema', (_e, root: string) => diagram.schemaGraph(root))
  ipcMain.handle('kinds:list', (_e, root: string | null) => missionKinds.listKinds(root, userData()))
  ipcMain.handle('kinds:create', (_e, scope: 'project' | 'user', root: string | null, name: string, text: string) => missionKinds.createKind(userData(), scope, root, name, text))
  ipcMain.handle('usage:tokens', (_e, reqs: UsageRequest[]) => missionTokens(reqs))
  ipcMain.handle('factory:recipes', (_e, root: string) => factory.listRecipes(root))
  ipcMain.handle('factory:saveRecipe', (_e, root: string, slug: string, text: string) => factory.saveRecipe(root, slug, text))
  ipcMain.handle('factory:prepare', (_e, dir: string) => factory.prepareRunDir(dir))
  ipcMain.handle('factory:read', (_e, p: string) => factory.readRunFile(p))
  ipcMain.handle('factory:write', (_e, p: string, text: string) => factory.writeRunFile(p, text))
  ipcMain.handle('factory:copy', (_e, from: string, to: string) => factory.copyRunFile(from, to))
  ipcMain.handle('factory:setupPlan', (_e, dir: string, command: string | false | undefined) => factory.setupPlan(dir, command))
  ipcMain.handle('factory:readSeed', (_e, root: string, p: string) => factory.readSeedFile(root, p))
  ipcMain.handle('factory:setup', (_e, dir: string, command: string) => factory.runSetup(dir, command))
  ipcMain.handle('factory:writeRecipe', (_e, p: string, text: string) => factory.writeRecipe(p, text))
  ipcMain.handle('factory:deleteRecipe', (_e, p: string) => factory.deleteRecipe(p, (x) => shell.trashItem(x)))
  ipcMain.handle('factory:exportRecipe', async (_e, fileName: string, text: string) => {
    const r = await dialog.showSaveDialog(win!, {
      title: 'Export recipe',
      defaultPath: join(app.getPath('downloads'), basename(fileName)),
      filters: [{ name: 'sldev-io recipe', extensions: ['yml', 'yaml'] }]
    })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, text)
    return r.filePath
  })
  ipcMain.handle('factory:importRecipeFile', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Import recipe', properties: ['openFile'], filters: [{ name: 'Recipe', extensions: ['yml', 'yaml', 'txt'] }, { name: 'All files', extensions: ['*'] }] })
    return r.canceled || !r.filePaths[0] ? null : factory.readImportFile(r.filePaths[0])
  })
  ipcMain.handle('rules:state', (_e, root: string) => rules.rulesState(root))
  ipcMain.handle('rules:create', (_e, root: string) => rules.createRules(root))
  ipcMain.handle('rules:target', (_e, root: string, id: string, on: boolean) => rules.setRuleTarget(root, id, on))
  ipcMain.handle('rules:sync', (_e, root: string, overwrite: string[]) => rules.syncRules(root, overwrite))
  ipcMain.handle('profiles:export', (_e, root: string, p: AgentProfile, target: profiles.ExportTarget) => profiles.exportProfile(root, p, target))

  // credentials & SSH
  ipcMain.handle('vault:status', () => vault.vaultStatus())
  ipcMain.handle('vault:list', () => vault.listCredentials())
  ipcMain.handle('vault:save', (_e, input: CredentialInput) => vault.saveCredential(input))
  ipcMain.handle('vault:delete', (_e, id: string) => vault.deleteCredential(id))
  ipcMain.handle('ssh:importConfig', () => importSshConfig(stores.connections.get().connections))
  ipcMain.handle('ssh:connected', () => ssh.connectedIds())
  ipcMain.handle('ssh:ping', (_e, host: string, port: number) => pingHost(host, port))
  ipcMain.handle('ssh:disconnect', (_e, connId: string) => ssh.disconnect(connId))
  ipcMain.handle('ssh:home', (e, connId: string) => ssh.home(e.sender, connId))
  ipcMain.handle('ssh:list', (e, connId: string, path: string) => ssh.list(e.sender, connId, path))
  ipcMain.handle('ssh:download', (e, connId: string, path: string) => ssh.download(e.sender, connId, path))
  ipcMain.handle('ssh:forwards', () => ssh.activeForwards())
  ipcMain.handle('ssh:startForward', (e, connId: string, fwd: PortForward) => ssh.startForward(e.sender, connId, fwd))
  ipcMain.handle('ssh:stopForward', (_e, connId: string, fwdId: string) => ssh.stopForward(connId, fwdId))

  // docker
  ipcMain.handle('docker:list', () => listContainers())
  ipcMain.handle('docker:action', (_e, id: string, action: DockerAction) => containerAction(id, action))

  // persistence
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    const next = settings.set(patch)
    if ('shell' in patch) setShellOverride(next.shell)
    if ('globalHotkey' in patch) registerHotkey(next.globalHotkey)
    return next
  })
  // Settings → Appearance changed, or the OS did under "Match system": the renderer sends the theme it now shows
  ipcMain.on('window:appearance', (e, theme: ResolvedTheme, rawZoom: number) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w || w.isDestroyed()) return
    const colors = WINDOW_COLORS[theme === 'light' ? 'light' : 'dark']
    const zoom = clampZoom(rawZoom)
    e.sender.setZoomFactor(zoom)
    w.setBackgroundColor(colors.background)
    if (!isMac) w.setTitleBarOverlay({ color: colors.background, symbolColor: colors.symbol, height: titleBarHeight(zoom) })
  })
  ipcMain.handle('layout:load', () => layout.get().layout)
  ipcMain.handle('layout:save', (_e, data: unknown) => void layout.set({ layout: data }))
  ipcMain.handle('store:get', (_e, name: keyof StoreFiles) => (Object.hasOwn(stores, name) ? stores[name].get() : null))
  ipcMain.handle('store:set', (_e, name: keyof StoreFiles, data: object) => {
    if (Object.hasOwn(stores, name)) (stores[name] as JsonStore<object>).set(data)
  })

  // runtimes
  ipcMain.handle('runtimes:detect', (_e, root: string) => detectRuntimes(root))
  ipcMain.handle('runtimes:scripts', (_e, dir: string) => detectScripts(dir))

  // first-run setup check
  ipcMain.handle('setup:check', (_e, reloadEnv: boolean) => checkSetup(!!reloadEnv))
}

app.whenReady().then(async () => {
  watchMainLoop()
  settings = new JsonStore(userData(), 'settings', DEFAULT_SETTINGS)
  layout = new JsonStore<{ layout: unknown }>(userData(), 'layout', { layout: null })
  stores = {
    tasks: new JsonStore<StoreFiles['tasks']>(userData(), 'tasks', { tasks: [] }),
    runtimes: new JsonStore<StoreFiles['runtimes']>(userData(), 'runtimes', { custom: {} }),
    missions: new JsonStore<StoreFiles['missions']>(userData(), 'missions', { missions: [] }),
    connections: new JsonStore<StoreFiles['connections']>(userData(), 'connections', { connections: [] as SshConnection[] }),
    factoryRuns: new JsonStore<StoreFiles['factoryRuns']>(userData(), 'factory-runs', { runs: [] }),
    automations: new JsonStore<StoreFiles['automations']>(userData(), 'automations', { automations: [] }),
    savedMissions: new JsonStore<StoreFiles['savedMissions']>(userData(), 'saved-missions', { saved: [] }),
    board: new JsonStore<StoreFiles['board']>(userData(), 'board', { items: [], settings: [] })
  }
  vault.initVault()
  context.initContext(app.getPath('userData'))
  setShellOverride(settings.get().shell)
  // runs alongside startup; the renderer awaits the first result before showing the app
  startBetaChecks((s) => win?.webContents.send('beta:changed', s))
  startUpdateChecks((s) => win?.webContents.send('update:changed', s))
  startLicenseChecks((s) => win?.webContents.send('license:changed', s))
  const toWindow = (channel: string) => (e: unknown): void => {
    const wc = win?.webContents
    if (wc && !wc.isDestroyed()) wc.send(channel, e)
  }
  await startHookServer({
    dir: userData(),
    node: process.execPath,
    onHook: toWindow('mission:hook'),
    mcp: { missions: () => stores.missions.get().missions, send: toWindow('mission:mcp') }
  })
  await loadShellEnv()
  buildMenu()
  registerIpc()
  createWindow()
  registerHotkey(settings.get().globalHotkey)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

function registerHotkey(accel: string | null): void {
  globalShortcut.unregisterAll()
  if (!accel) return
  try {
    globalShortcut.register(accel, () => {
      if (!win) return createWindow()
      if (win.isFocused()) win.hide()
      else {
        win.show()
        win.focus()
      }
    })
  } catch {
    // invalid accelerator or unsupported (e.g. some Wayland sessions)
  }
}

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('before-quit', () => {
  ptys.killAll()
  ssh.disconnectAll()
  vault.flushVault()
  context.closeContext()
  settings?.flush()
  layout?.flush()
  if (stores) Object.values(stores).forEach((s) => s.flush())
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
