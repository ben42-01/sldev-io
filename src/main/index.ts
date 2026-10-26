import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, shell, type MenuItemConstructorOptions } from 'electron'
import { existsSync, renameSync } from 'fs'
import { arch, homedir, release, type as osType } from 'os'
import { basename, join } from 'path'
import { DEFAULT_SETTINGS, type AppInfo, type AppSettings, type PtyCreateOptions, type StoreFiles } from '@shared/types'
import { PtyManager, setShellOverride } from './pty'
import { DirWatchers, existingFiles, readDir, walkFiles } from './fs'
import { detectEditors, findOnPath, openInEditor, terminalEditorCommand, terminalEditorGoto } from './editors'
import * as git from './git'
import * as gh from './github'
import * as notes from './notes'
import * as profiles from './profiles'
import * as rules from './rules'
import * as factory from './factory'
import { missionTokens, type UsageRequest } from './usage'
import * as vault from './vault'
import { createSkill, listClaudeAssets, listMcpServers } from './claudeAssets'
import { hookInfo, startHookServer } from './hooks'
import { importSshConfig, SshManager } from './ssh'
import type { AgentProfile, CredentialInput, DockerAction, PortForward, SshConnection, WorktreeInfo } from '@shared/types'
import { JsonStore } from './store'
import { detectRuntimes } from './runtimes'
import { loadShellEnv } from './shellEnv'
import { betaStatus, refreshBeta, startBetaChecks } from './beta'
import { checkSetup } from './setup'
import { containerAction, listContainers } from './docker'
import { checkForUpdates, installUpdate, startUpdateChecks, updateStatus } from './updater'
import { activateLicense, deactivateLicense, licenseStatus, refreshLicense, startLicenseChecks } from './license'

const isMac = process.platform === 'darwin'

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
const BG = '#0a0a0a'

let win: BrowserWindow | null = null
const ptys = new PtyManager()
const ssh = new SshManager(() => stores.connections.get().connections)
const watchers = new DirWatchers(() => win?.webContents ?? null)
let settings: JsonStore<AppSettings>
let layout: JsonStore<{ layout: unknown }>
let stores: { [K in keyof StoreFiles]: JsonStore<StoreFiles[K]> }

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 480,
    show: false,
    backgroundColor: BG,
    title: 'sldev-io',
    // macOS and Windows take the icon from the app bundle / exe
    ...(process.platform === 'linux' ? { icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icons/512x512.png') } : {}),
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 12, y: 12 } }
      : { titleBarOverlay: { color: BG, symbolColor: '#9a9a9a', height: 36 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  win.once('ready-to-show', () => win?.show())
  const wc = win.webContents
  const cleanup = (): void => {
    ptys.killOwnedBy(wc)
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
  ipcMain.handle('pty:create', (e, id: string, opts: PtyCreateOptions) => ptys.create(e.sender, id, opts))
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
  ipcMain.handle('fs:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('fs:existingFiles', (_e, paths: string[]) => existingFiles(paths))
  ipcMain.handle('fs:listFiles', async (_e, root: string) => ((await git.isRepo(root)) ? git.listFiles(root) : walkFiles(root)))
  ipcMain.on('fs:watch', (_e, dir: string) => watchers.watch(dir))
  ipcMain.on('fs:unwatch', (_e, dir: string) => watchers.unwatch(dir))

  // editors & OS integration
  ipcMain.handle('editors:list', () => detectEditors())
  ipcMain.handle('agents:installed', (_e, bins: string[]) => bins.filter((b) => !!b && findOnPath(b)))
  ipcMain.handle('editors:open', (_e, id: string, target: string, line?: number, col?: number) => openInEditor(id, target, line, col))
  ipcMain.handle('editors:terminalCommand', (_e, id: string) => terminalEditorCommand(id))
  ipcMain.handle('editors:terminalGoto', (_e, id: string, file: string, line: number) => terminalEditorGoto(id, file, line))
  ipcMain.handle('shell:reveal', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('shell:openPath', (_e, p: string) => shell.openPath(p))
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
    os: `${osType()} ${release()}`
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
  ipcMain.handle('git:removeWorktree', (_e, wt: WorktreeInfo, del: boolean) => git.removeWorktree(wt, del))
  ipcMain.handle('git:diff', (_e, cwd: string, base: string) => git.diff(cwd, base))
  ipcMain.handle('git:diffStat', (_e, cwd: string, base: string) => git.diffStat(cwd, base))
  ipcMain.handle('git:commitAll', (_e, cwd: string, msg: string) => git.commitAll(cwd, msg))
  ipcMain.handle('git:merge', (_e, repo: string, branch: string) => git.merge(repo, branch))
  ipcMain.handle('git:push', (_e, cwd: string, branch: string) => git.push(cwd, branch))
  ipcMain.handle('git:pushAndPr', (_e, cwd: string, branch: string, base: string, title: string, body?: string) => git.pushAndCreatePr(cwd, branch, base, title, body))

  // missions (Claude Code hooks)
  ipcMain.handle('missions:hookInfo', () => hookInfo())

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
  ipcMain.handle('gh:issues', (_e, cwd: string) => gh.listIssues(cwd))
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
  ipcMain.handle('profiles:remove', (_e, root: string, path: string) => profiles.removeProfile(root, path))
  ipcMain.handle('usage:tokens', (_e, reqs: UsageRequest[]) => missionTokens(reqs))
  ipcMain.handle('factory:recipes', (_e, root: string) => factory.listRecipes(root))
  ipcMain.handle('factory:saveRecipe', (_e, root: string, slug: string, text: string) => factory.saveRecipe(root, slug, text))
  ipcMain.handle('factory:prepare', (_e, dir: string) => factory.prepareRunDir(dir))
  ipcMain.handle('factory:read', (_e, p: string) => factory.readRunFile(p))
  ipcMain.handle('factory:write', (_e, p: string, text: string) => factory.writeRunFile(p, text))
  ipcMain.handle('factory:copy', (_e, from: string, to: string) => factory.copyRunFile(from, to))
  ipcMain.handle('factory:setupPlan', (_e, dir: string, command: string | false | undefined) => factory.setupPlan(dir, command))
  ipcMain.handle('factory:setup', (_e, dir: string, command: string) => factory.runSetup(dir, command))
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
  ipcMain.handle('layout:load', () => layout.get().layout)
  ipcMain.handle('layout:save', (_e, data: unknown) => void layout.set({ layout: data }))
  ipcMain.handle('store:get', (_e, name: keyof StoreFiles) => (Object.hasOwn(stores, name) ? stores[name].get() : null))
  ipcMain.handle('store:set', (_e, name: keyof StoreFiles, data: object) => {
    if (Object.hasOwn(stores, name)) (stores[name] as JsonStore<object>).set(data)
  })

  // runtimes
  ipcMain.handle('runtimes:detect', (_e, root: string) => detectRuntimes(root))

  // first-run setup check
  ipcMain.handle('setup:check', (_e, reloadEnv: boolean) => checkSetup(!!reloadEnv))
}

app.whenReady().then(async () => {
  settings = new JsonStore('settings', DEFAULT_SETTINGS)
  layout = new JsonStore<{ layout: unknown }>('layout', { layout: null })
  stores = {
    tasks: new JsonStore<StoreFiles['tasks']>('tasks', { tasks: [] }),
    runtimes: new JsonStore<StoreFiles['runtimes']>('runtimes', { custom: {} }),
    missions: new JsonStore<StoreFiles['missions']>('missions', { missions: [] }),
    connections: new JsonStore<StoreFiles['connections']>('connections', { connections: [] as SshConnection[] }),
    factoryRuns: new JsonStore<StoreFiles['factoryRuns']>('factory-runs', { runs: [] })
  }
  vault.initVault()
  setShellOverride(settings.get().shell)
  // runs alongside startup; the renderer awaits the first result before showing the app
  startBetaChecks((s) => win?.webContents.send('beta:changed', s))
  startUpdateChecks((s) => win?.webContents.send('update:changed', s))
  startLicenseChecks((s) => win?.webContents.send('license:changed', s))
  await startHookServer(() => win?.webContents ?? null, { missions: () => stores.missions.get().missions })
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
  settings?.flush()
  layout?.flush()
  if (stores) Object.values(stores).forEach((s) => s.flush())
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
