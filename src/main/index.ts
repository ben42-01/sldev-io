import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { DEFAULT_SETTINGS, type AppSettings, type PtyCreateOptions, type StoreFiles } from '@shared/types'
import { PtyManager } from './pty'
import { DirWatchers, readDir } from './fs'
import { detectEditors, openInEditor, terminalEditorCommand } from './editors'
import { gitBranch } from './git'
import { JsonStore } from './store'
import { detectRuntimes } from './runtimes'
import { loadShellEnv } from './shellEnv'

const isMac = process.platform === 'darwin'
const BG = '#141414'

let win: BrowserWindow | null = null
const ptys = new PtyManager()
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
    title: 'sldev',
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
  wc.on('destroyed', () => ptys.killOwnedBy(wc))
  wc.on('render-process-gone', () => ptys.killOwnedBy(wc))
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
  ipcMain.on('pty:write', (_e, id: string, data: string) => ptys.write(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows))
  ipcMain.on('pty:ack', (_e, id: string, bytes: number) => ptys.ack(id, bytes))
  ipcMain.on('pty:kill', (_e, id: string) => ptys.kill(id))

  // filesystem
  ipcMain.handle('fs:readDir', (_e, dir: string) => readDir(dir))
  ipcMain.handle('fs:home', () => homedir())
  ipcMain.handle('fs:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.on('fs:watch', (_e, dir: string) => watchers.watch(dir))
  ipcMain.on('fs:unwatch', (_e, dir: string) => watchers.unwatch(dir))

  // editors & OS integration
  ipcMain.handle('editors:list', () => detectEditors())
  ipcMain.handle('editors:open', (_e, id: string, target: string) => openInEditor(id, target))
  ipcMain.handle('editors:terminalCommand', (_e, id: string) => terminalEditorCommand(id))
  ipcMain.handle('shell:reveal', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('shell:openPath', (_e, p: string) => shell.openPath(p))
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('git:branch', (_e, cwd: string) => gitBranch(cwd))

  // persistence
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => settings.set(patch))
  ipcMain.handle('layout:load', () => layout.get().layout)
  ipcMain.handle('layout:save', (_e, data: unknown) => void layout.set({ layout: data }))
  ipcMain.handle('store:get', (_e, name: keyof StoreFiles) => (Object.hasOwn(stores, name) ? stores[name].get() : null))
  ipcMain.handle('store:set', (_e, name: keyof StoreFiles, data: object) => {
    if (Object.hasOwn(stores, name)) (stores[name] as JsonStore<object>).set(data)
  })

  // runtimes
  ipcMain.handle('runtimes:detect', (_e, root: string) => detectRuntimes(root))
}

app.whenReady().then(async () => {
  settings = new JsonStore('settings', DEFAULT_SETTINGS)
  layout = new JsonStore<{ layout: unknown }>('layout', { layout: null })
  stores = {
    tasks: new JsonStore<StoreFiles['tasks']>('tasks', { tasks: [] }),
    runtimes: new JsonStore<StoreFiles['runtimes']>('runtimes', { custom: {} })
  }
  await loadShellEnv()
  buildMenu()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  ptys.killAll()
  settings?.flush()
  layout?.flush()
  if (stores) Object.values(stores).forEach((s) => s.flush())
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
