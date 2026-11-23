import { readFileSync } from 'fs'
import { join } from 'path'
import type { CustomAgent } from '@shared/types'

/**
 * The CLI's settings, `<data>/config.json`, edited by hand (`sldev config` shows where and what). The CLI
 * doesn't read the app's settings: the two are separate products that share code, not state.
 */
export interface CliConfig {
  /** editor id for `sldev open` and Ctrl-b e (cursor, vscode, zed, nvim…); null: the first one found */
  editor: string | null
  /** agent CLIs of your own, like the app's Settings → Agents → custom agents */
  customAgents: CustomAgent[]
  /** agents to continue on, in order, when one stops at its usage limit (used when failoverAuto is on) */
  failoverOrder: string[]
  /** continue on failoverOrder without being asked for every pane (`--failover` still wins) */
  failoverAuto: boolean
  /** permission mode per agent id for --print panes; missing: the agent's recommended one, "": the CLI's default */
  unattendedModes: Record<string, string>
  /** once a day, ask the npm registry whether a newer sldev is out and say so in the TUI */
  updateCheck: boolean
}

export const DEFAULT_CONFIG: CliConfig = { editor: null, customAgents: [], failoverOrder: [], failoverAuto: false, unattendedModes: {}, updateCheck: true }

export const configPath = (dataDir: string): string => join(dataDir, 'config.json')

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'

function customAgent(v: unknown): CustomAgent | null {
  if (!isObject(v) || !str(v.id) || !v.id.trim() || !str(v.command) || !v.command.trim()) return null
  return {
    id: v.id.trim(),
    name: str(v.name) && v.name.trim() ? v.name.trim() : v.id.trim(),
    command: v.command,
    ...(str(v.printCommand) ? { printCommand: v.printCommand } : {}),
    ...(str(v.resumeCommand) ? { resumeCommand: v.resumeCommand } : {})
  }
}

/** Every key checked on its own: a wrong value falls back to its default and the rest still count. */
export function parseConfig(raw: unknown): CliConfig {
  if (!isObject(raw)) return { ...DEFAULT_CONFIG }
  return {
    editor: str(raw.editor) && raw.editor.trim() ? raw.editor.trim() : null,
    customAgents: Array.isArray(raw.customAgents) ? raw.customAgents.map(customAgent).filter((a): a is CustomAgent => !!a) : [],
    failoverOrder: Array.isArray(raw.failoverOrder) ? raw.failoverOrder.filter(str).map((s) => s.trim()).filter(Boolean) : [],
    failoverAuto: raw.failoverAuto === true,
    unattendedModes: isObject(raw.unattendedModes)
      ? Object.fromEntries(Object.entries(raw.unattendedModes).filter((e): e is [string, string] => str(e[1])))
      : {},
    updateCheck: raw.updateCheck !== false
  }
}

/** A missing file or bad JSON means the defaults, never a crash; `problem` says what was wrong with it. */
export function readConfig(dataDir: string): CliConfig & { problem?: string } {
  let text: string
  try {
    text = readFileSync(configPath(dataDir), 'utf8')
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === 'ENOENT'
    return { ...DEFAULT_CONFIG, problem: missing ? 'not created yet, so the defaults apply' : `can't be read (${(e as Error).message}), so the defaults apply` }
  }
  try {
    return parseConfig(JSON.parse(text))
  } catch (e) {
    return { ...DEFAULT_CONFIG, problem: `not valid JSON (${(e as Error).message}), so the defaults apply` }
  }
}

/** What `sldev config` prints: where the file is, and the values in effect. */
export function describeConfig(dataDir: string): string {
  const c = readConfig(dataDir)
  const { problem, ...values } = c
  const where = `${configPath(dataDir)}${problem ? `: ${problem}` : ''}`
  return `${where}\n${JSON.stringify(values, null, 2)}\nEdit the file by hand; the keys are in the sldev README. The daemon reads it when it starts (sldev stop, then sldev).`
}
