import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppSettings, DirEntry, EditorInfo, PtyCreateOptions, PtyInfo, RuntimeDef, StoreFiles } from '../shared/types'

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
    pathForFile: (file: File): string => webUtils.getPathForFile(file)
  },
  editors: {
    list: (): Promise<EditorInfo[]> => ipcRenderer.invoke('editors:list'),
    open: (id: string, target: string): Promise<boolean> => ipcRenderer.invoke('editors:open', id, target),
    terminalCommand: (id: string): Promise<string | null> => ipcRenderer.invoke('editors:terminalCommand', id)
  },
  shell: {
    reveal: (p: string): Promise<void> => ipcRenderer.invoke('shell:reveal', p),
    openPath: (p: string): Promise<string> => ipcRenderer.invoke('shell:openPath', p),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url)
  },
  git: {
    branch: (cwd: string): Promise<string | null> => ipcRenderer.invoke('git:branch', cwd)
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
  layout: {
    load: (): Promise<unknown> => ipcRenderer.invoke('layout:load'),
    save: (data: unknown): Promise<void> => ipcRenderer.invoke('layout:save', data)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
