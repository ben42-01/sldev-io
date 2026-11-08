import { startDrafts } from './drafts'
import { loadSaved } from './savedMissions'
import type { AppSettings, EditorInfo, RightTab } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { createStore } from './store'
import { loadRuntimes } from './runtimes'
import { loadTasks } from './tasks'
import { loadMissions } from './missions'
import { loadProjectProfiles } from './profiles'
import { loadFactory, loadRecipes } from './factory'
import { loadAutomations } from './automations'
import { loadBoard } from './board'
import { loadEvals } from './evals'
// answers Lead missions' sldev_delegate, wait, followup and integrate calls
import './lead'

export type ViewId = 'explorer' | 'runtimes' | 'factory' | 'tasks' | 'notes' | 'remote' | RightTab

const RIGHT_TABS: RightTab[] = ['overview', 'agents', 'skills', 'context', 'workflows']
/** Views that live in the right sidebar; the rest are in the left one. */
export const isRightView = (v: ViewId): v is RightTab => (RIGHT_TABS as string[]).includes(v)

export interface WorkspaceState extends AppSettings {
  ready: boolean
  activeView: ViewId
  editors: EditorInfo[]
  terminalCount: number
  broadcastCount: number
  branch: string | null
}

export const workspace = createStore<WorkspaceState>({
  ...DEFAULT_SETTINGS,
  ready: false,
  activeView: 'explorer',
  editors: [],
  terminalCount: 0,
  broadcastCount: 0,
  branch: null
})

/** Update settings in the store and persist them. */
export function updateSettings(patch: Partial<AppSettings>): void {
  workspace.set(patch)
  void window.api.settings.set(patch)
}

export async function initWorkspace(): Promise<void> {
  const [settings, editors] = await Promise.all([window.api.settings.get(), window.api.editors.list()])
  workspace.set({ ...settings, editors, ready: true })
  if (settings.rootFolder) void refreshBranch()
  void loadTasks()
  void loadMissions()
  void loadRuntimes(settings.rootFolder)
  void loadProjectProfiles(settings.rootFolder)
  void loadFactory()
  void loadRecipes(settings.rootFolder)
  void loadAutomations()
  const boardLoaded = loadBoard()
  void loadEvals()
  // drafts go into the board and the saved missions: only once both are loaded, or they'd be overwritten
  void Promise.all([boardLoaded, loadSaved()]).then(startDrafts)
}

export async function refreshBranch(): Promise<void> {
  const root = workspace.get().rootFolder
  workspace.set({ branch: root ? await window.api.git.branch(root) : null })
}

export function setRootFolder(folder: string): void {
  const recent = [folder, ...workspace.get().recentFolders.filter((f) => f !== folder)].slice(0, 12)
  updateSettings({ rootFolder: folder, recentFolders: recent })
  void refreshBranch()
  void loadRuntimes(folder)
  void loadProjectProfiles(folder)
  void loadRecipes(folder)
}

/** Open a project: the picker starts in the current project, or in the home folder when none is open. */
export async function pickRootFolder(): Promise<void> {
  const folder = await window.api.fs.pickFolder(workspace.get().rootFolder ?? undefined)
  if (folder) setRootFolder(folder)
}

export function preferredEditor(): EditorInfo | undefined {
  const { editors, preferredEditor } = workspace.get()
  return editors.find((e) => e.id === preferredEditor) ?? editors.find((e) => e.kind === 'gui') ?? editors[0]
}
