import { promptWithRole } from './profiles'
import type { AgentOptions, CustomAgent } from './types'
import { formatArgv, splitArgs } from './argv'

/**
 * The agent registry: how each CLI is started, resumed and watched. Shared by the app and the sldev CLI,
 * so it must stay free of Electron and the DOM.
 */

export interface AgentMode {
  value: string
  label: string
}

export interface AgentDef {
  id: string
  name: string
  /** executable looked up on PATH to tell whether it's installed */
  bin: string
  /** other names the same CLI is installed under; argv[0] becomes the first one on PATH */
  aliases?: string[]
  install?: string
  /** model suggestions; the field also accepts free text */
  models: string[]
  modelPlaceholder?: string
  /**
   * the agent's own low-cost model, for routine work (mission kinds with the `cheap` hint, like New project);
   * unset = the agent's default model. Settings → Agents can change it per agent (`cheapModels`).
   */
  cheapModel?: string
  /** approval / permission modes ('' = the agent's default) */
  modes: AgentMode[]
  /**
   * mode for Factory stages, which run with nobody there to approve anything; unset = the CLI's own
   * default (Cursor and OpenCode already act on their own in print mode, Copilot gets --allow-all-tools)
   */
  unattendedMode?: string
  efforts: string[]
  /** a mode that can read but not change anything, preselected for read-only mission kinds (Research, Plan, Review) */
  readOnlyMode?: string
  /**
   * the line an agent prints when it stops at its plan's usage limit; specific on purpose, since only
   * the last lines of output are checked and a false match would hand the work to another agent
   */
  usageLimit?: RegExp
  /**
   * what the agent shows when it waits for an approval; agents without hooks are "needs you" while it's on
   * screen (ASK_GENERIC in src/shared/attention.ts when unset). Checked after the prompt, near the bottom only.
   */
  asks?: RegExp
  /** reports status through Claude Code hooks; other agents are tracked from terminal activity */
  hooks: boolean
  /**
   * keeps a log on this machine that sldev reads token usage from (src/main/usage.ts: Claude's transcript, Codex's
   * session logs); for other agents only the time they took is known
   */
  tokenLog?: boolean
  /** runs skills and commands from ~/.claude and .claude as `/name` */
  claudeSkills?: boolean
  canPrint: boolean
  canResume: boolean
  /** takes a role as an extra system prompt; other agents get it at the top of the prompt */
  systemPrompt?: boolean
  /** flags that attach the sldev MCP server for one run; agents without one are tracked from the terminal */
  mcpArgs?: (server: McpServerCommand) => string[]
  /** argv, one element per argument: values are never quoted, the main process spawns it without a shell */
  build: (o: AgentOptions, prompt: string | undefined, name: string | undefined, extra: CommandExtra) => string[]
  custom?: boolean
}

export interface CommandExtra {
  /** Claude only: hooks settings file */
  settingsPath?: string
  /** session id to resume (Claude), or true to continue the most recent session */
  resume?: string | true
  /** agent profile role; a resumed session already has it */
  role?: string
  /** attach the sldev MCP server */
  mcp?: McpServerCommand
}

export interface McpServerCommand {
  command: string
  args: string[]
  env: Record<string, string>
}

/** The sldev MCP server for one mission. */
export const sldevMcp = (info: { command: string; script: string }, mission: string): McpServerCommand => ({
  command: info.command,
  args: [info.script, '--mission', mission],
  env: { ELECTRON_RUN_AS_NODE: '1' }
})

const tomlString = (s: string): string => JSON.stringify(s)

const flag = (cond: unknown, ...parts: string[]): string[] => (cond ? parts : [])
const extraArgs = (o: AgentOptions): string[] => splitArgs(o.extraArgs ?? '')
const promptArg = (prompt: string | undefined): string[] => flag(prompt?.trim(), prompt?.trim() ?? '')

const claude: AgentDef = {
  id: 'claude',
  name: 'Claude Code',
  tokenLog: true,
  bin: 'claude',
  install: 'npm i -g @anthropic-ai/claude-code',
  models: ['opus', 'sonnet', 'haiku', 'fable'],
  cheapModel: 'haiku',
  modes: [
    { value: 'acceptEdits', label: 'Accept edits' },
    { value: 'plan', label: 'Plan' },
    { value: 'auto', label: 'Auto' },
    { value: 'dontAsk', label: "Don't ask" },
    { value: 'manual', label: 'Manual' },
    { value: 'bypassPermissions', label: 'Bypass permissions' }
  ],
  unattendedMode: 'auto',
  readOnlyMode: 'plan',
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  usageLimit: /(?:usage|session|weekly|5-hour|opus) limit reached|limit will reset at|you've hit your (?:usage|session|weekly) limit/i,
  hooks: true,
  claudeSkills: true,
  canPrint: true,
  canResume: true,
  systemPrompt: true,
  mcpArgs: (m) => ['--mcp-config', JSON.stringify({ mcpServers: { sldev: { type: 'stdio', command: m.command, args: m.args, env: m.env } } })],
  build: (o, prompt, name, { settingsPath, resume, role }) => [
    'claude',
    ...flag(settingsPath, '--settings', settingsPath ?? ''),
    ...(resume === true ? ['--continue'] : flag(resume, '--resume', String(resume))),
    ...flag(o.print && !resume, '-p'),
    ...flag(o.model, '--model', o.model ?? ''),
    ...flag(o.permissionMode, '--permission-mode', o.permissionMode ?? ''),
    ...flag(o.effort, '--effort', o.effort ?? ''),
    ...flag(role?.trim() && !resume, '--append-system-prompt', role?.trim() ?? ''),
    ...flag(!o.print && name && !resume, '-n', name ?? ''),
    ...extraArgs(o),
    ...(resume ? [] : promptArg(prompt))
  ]
}

const codex: AgentDef = {
  id: 'codex',
  name: 'Codex',
  tokenLog: true,
  bin: 'codex',
  install: 'npm i -g @openai/codex',
  models: [],
  modelPlaceholder: 'default',
  modes: [
    { value: 'read-only', label: 'Read only' },
    // the value stays 'full-auto' so saved settings keep working; Codex 0.16x removed the --full-auto flag
    { value: 'full-auto', label: 'Workspace write, no prompts' },
    { value: 'yolo', label: 'No sandbox, no approvals' }
  ],
  unattendedMode: 'full-auto',
  readOnlyMode: 'read-only',
  efforts: ['minimal', 'low', 'medium', 'high'],
  usageLimit: /you've hit your usage limit|usage limit (?:reached|exceeded)|rate limit reached for|last status: 429/i,
  asks: /Would you like to (?:run|make|apply)|Yes, proceed|Allow command|\[y\/N\]/i,
  hooks: false,
  canPrint: true,
  canResume: true,
  // -c takes a TOML value: an inline table for the server
  mcpArgs: (m) => [
    '-c',
    `mcp_servers.sldev={command=${tomlString(m.command)},args=[${m.args.map(tomlString).join(',')}],env={${Object.entries(m.env).map(([k, v]) => `${k}=${tomlString(v)}`).join(',')}}}`
  ],
  build: (o, prompt, _name, { resume }) => [
    'codex',
    ...(resume ? ['resume', '--last'] : flag(o.print, 'exec')),
    ...flag(o.model, '--model', o.model ?? ''),
    ...flag(o.permissionMode === 'read-only', '--sandbox', 'read-only'),
    // what --full-auto used to expand to; exec never asks, and only the TUI takes -a
    ...flag(o.permissionMode === 'full-auto', '--sandbox', 'workspace-write'),
    ...flag(o.permissionMode === 'full-auto' && !o.print, '--ask-for-approval', 'on-request'),
    ...flag(o.permissionMode === 'yolo', '--dangerously-bypass-approvals-and-sandbox'),
    ...flag(o.effort, '-c', `model_reasoning_effort=${o.effort}`),
    ...extraArgs(o),
    ...(resume ? [] : promptArg(prompt))
  ]
}

const cursor: AgentDef = {
  id: 'cursor',
  name: 'Cursor Agent',
  // `agent` since late 2025; older installs only have cursor-agent
  bin: 'agent',
  aliases: ['cursor-agent'],
  install: 'curl https://cursor.com/install -fsS | bash',
  models: [],
  modelPlaceholder: 'default',
  modes: [{ value: 'force', label: 'Auto-approve commands (--force)' }],
  efforts: [],
  usageLimit: /you've hit your usage limit|usage limit (?:reached|exceeded)/i,
  asks: /Run this command\?|Waiting for approval|Accept (?:changes|this)|\[y\/N\]|\(y\/n\)/i,
  hooks: false,
  canPrint: true,
  canResume: true,
  build: (o, prompt, _name, { resume }) => [
    'agent',
    ...flag(resume, 'resume'),
    // print mode can't answer the workspace-trust question, and factory worktrees are always new folders
    ...flag(o.print && !resume, '-p', '--trust'),
    ...flag(o.model, '--model', o.model ?? ''),
    ...flag(o.permissionMode === 'force', '--force'),
    ...extraArgs(o),
    ...(resume ? [] : promptArg(prompt))
  ]
}

const copilot: AgentDef = {
  id: 'copilot',
  name: 'GitHub Copilot',
  bin: 'copilot',
  install: 'npm i -g @github/copilot',
  models: [],
  modelPlaceholder: 'default',
  modes: [{ value: 'allow-all-tools', label: 'Allow all tools' }],
  efforts: [],
  usageLimit: /quota exceeded|exceeded your .{0,40}(?:allowance|quota)|rate limit exceeded/i,
  asks: /Do you want to (?:run|edit|create|make|allow)|don't ask again|\[y\/N\]/i,
  hooks: false,
  canPrint: true,
  canResume: true,
  build: (o, prompt, _name, { resume }) => [
    'copilot',
    ...flag(resume, '--continue'),
    ...flag(o.model, '--model', o.model ?? ''),
    // non-interactive runs can't stop to ask, so they need tools pre-approved
    ...flag(o.permissionMode === 'allow-all-tools' || (o.print && !resume), '--allow-all-tools'),
    ...extraArgs(o),
    ...(resume || !prompt?.trim() ? [] : [o.print ? '-p' : '-i', prompt.trim()])
  ]
}

const opencode: AgentDef = {
  id: 'opencode',
  name: 'OpenCode',
  bin: 'opencode',
  install: 'npm i -g opencode-ai',
  models: [],
  modelPlaceholder: 'provider/model',
  modes: [
    { value: 'build', label: 'Build agent' },
    { value: 'plan', label: 'Plan agent' }
  ],
  readOnlyMode: 'plan',
  efforts: [],
  usageLimit: /usage limit (?:reached|exceeded)|quota exceeded|rate limit exceeded|429 Too Many Requests/i,
  // OpenCode 2's permission dialog: "Permission required", then Allow once / Always allow / Reject
  asks: /Permission required|Allow once|Always allow/,
  hooks: false,
  canPrint: true,
  canResume: true,
  build: (o, prompt, _name, { resume }) => [
    'opencode',
    ...flag(o.print && !resume, 'run'),
    ...flag(resume, '--continue'),
    ...flag(o.model, '--model', o.model ?? ''),
    ...flag(o.permissionMode, '--agent', o.permissionMode ?? ''),
    ...extraArgs(o),
    ...(resume || !prompt?.trim() ? [] : o.print ? [prompt.trim()] : ['--prompt', prompt.trim()])
  ]
}

const gemini: AgentDef = {
  id: 'gemini',
  name: 'Gemini CLI',
  bin: 'gemini',
  install: 'npm i -g @google/gemini-cli',
  models: [],
  modelPlaceholder: 'default',
  modes: [
    { value: 'auto_edit', label: 'Auto-accept edits' },
    { value: 'yolo', label: 'YOLO (approve everything)' }
  ],
  unattendedMode: 'auto_edit',
  efforts: [],
  usageLimit: /quota exceeded|RESOURCE_EXHAUSTED|usage limit reached/i,
  asks: /Allow execution|Apply this change\?|Yes, allow (?:once|always)|\[y\/N\]/i,
  hooks: false,
  canPrint: true,
  canResume: true,
  build: (o, prompt, _name, { resume }) => [
    'gemini',
    ...flag(resume, '--resume', 'latest'),
    ...flag(o.model, '--model', o.model ?? ''),
    ...flag(o.permissionMode, '--approval-mode', o.permissionMode ?? ''),
    ...extraArgs(o),
    ...(resume || !prompt?.trim() ? [] : [o.print ? '-p' : '-i', prompt.trim()])
  ]
}

export const BUILTIN_AGENTS: AgentDef[] = [claude, codex, cursor, copilot, opencode, gemini]

/**
 * Fill a user-defined command template: {prompt}, {model}, {name}. The template is split into words
 * first, so a value fills its word and never becomes more arguments. A word that is only a
 * placeholder disappears when the value is empty; the prompt is appended when there is no {prompt}.
 */
function fillTemplate(template: string, o: AgentOptions, prompt: string | undefined, name: string | undefined): string[] {
  const values: Record<string, string> = { prompt: prompt?.trim() ?? '', model: o.model?.trim() ?? '', name: name?.trim() ?? '' }
  const words = splitArgs(template)
  const out = words.flatMap((w) => {
    const filled = w.replace(/\{(prompt|model|name)\}/g, (_m, k: string) => values[k])
    return /^\{(prompt|model|name)\}$/.test(w) && !filled ? [] : [filled]
  })
  if (!words.some((w) => w.includes('{prompt}')) && values.prompt) out.push(values.prompt)
  return [...out, ...extraArgs(o)]
}

export function customAgentDef(c: CustomAgent): AgentDef {
  return {
    id: c.id,
    name: c.name,
    bin: splitArgs(c.command)[0] ?? '',
    models: [],
    modelPlaceholder: c.command.includes('{model}') ? 'model' : undefined,
    modes: [],
    efforts: [],
    hooks: false,
    canPrint: !!c.printCommand?.trim(),
    canResume: !!c.resumeCommand?.trim(),
    custom: true,
    build: (o, prompt, name, { resume }) => {
      if (resume && c.resumeCommand?.trim()) return splitArgs(c.resumeCommand)
      return fillTemplate(o.print && c.printCommand?.trim() ? c.printCommand : c.command, o, prompt, name)
    }
  }
}

export function allAgents(custom: CustomAgent[] = []): AgentDef[] {
  return [...BUILTIN_AGENTS, ...custom.filter((c) => c.name.trim() && c.command.trim()).map(customAgentDef)]
}

export function findAgent(id: string | undefined, custom: CustomAgent[] = []): AgentDef {
  return allAgents(custom).find((a) => a.id === (id || 'claude')) ?? claude
}

/**
 * The permission mode a Factory stage runs with when its profile sets none: Settings → Factory, else
 * the agent's unattendedMode. '' in settings means the CLI's own default.
 */
export function stageMode(agent: AgentDef, settings: Record<string, string> | undefined): string | undefined {
  const picked = settings?.[agent.id]
  return (picked === undefined ? agent.unattendedMode : picked) || undefined
}

/**
 * The model a `cheap` mission kind runs on: Settings → Agents (`cheapModels`), else the agent's cheapModel.
 * '' in settings means the agent's default model; undefined back means the same.
 */
export function cheapModelOf(agent: AgentDef, settings: Record<string, string> | undefined): string | undefined {
  const picked = settings?.[agent.id]
  return (picked === undefined ? agent.cheapModel : picked)?.trim() || undefined
}

/** Options for a mission of this kind: a cheap kind fills in the agent's cheap model unless a model was picked. */
export function withKindModel(o: AgentOptions, kind: { cheap?: boolean } | undefined, agent: AgentDef, settings: Record<string, string> | undefined): AgentOptions {
  if (!kind?.cheap || o.model?.trim()) return o
  const model = cheapModelOf(agent, settings)
  return model ? { ...o, model } : o
}

let onPath: string[] | null = null

/** Executables found on PATH (state/agents.ts), so an agent starts under whichever name is installed. */
export function setInstalledBins(bins: string[]): void {
  onPath = bins
}

/** The installed name of an agent's CLI: its bin, else the first installed alias. */
export function installedBin(agent: AgentDef): string | undefined {
  return [agent.bin, ...(agent.aliases ?? [])].find((b) => onPath?.includes(b))
}

/** The argv that starts (or resumes) an agent session; the prompt is one element. */
export function agentCommand(agent: AgentDef, o: AgentOptions, prompt: string | undefined, name: string | undefined, extra: CommandExtra = {}): string[] {
  const role = extra.resume ? undefined : extra.role?.trim()
  const p = role && !agent.systemPrompt ? promptWithRole(role, prompt) : prompt
  const parts = agent.build(o, p, name, agent.hooks ? { ...extra, role } : { resume: extra.resume })
  // right after the executable: global options come before subcommands like `codex exec`
  if (extra.mcp && agent.mcpArgs) parts.splice(1, 0, ...agent.mcpArgs(extra.mcp))
  const bin = installedBin(agent)
  if (bin && parts[0] === agent.bin) parts[0] = bin
  return parts
}

/** How a mission's status is known for this agent, in one sentence for the mission details. */
export function statusSource(a: AgentDef): string {
  if (a.hooks) return `Status comes from ${a.name} itself: its hooks report every prompt, tool, approval and finish.`
  const tools = a.mcpArgs ? ` ${a.name} can also report its own status through the sldev tools.` : ''
  return `${a.name} doesn't report its status, so sldev-io watches its terminal: output means working, 5 seconds of quiet means ready for you, and an approval prompt on screen or a bell means it needs you.${tools}`
}

/** A command as one readable line: shell commands as typed, argv quoted for that platform's shell. Display only. */
export function commandLine(command: string | string[] | undefined, platform: string): string {
  return Array.isArray(command) ? formatArgv(command, platform) : (command ?? '')
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'mission'
}

/**
 * Prompt that runs a skill. Claude Code knows the skill by its slash invocation; any other agent
 * is pointed at the SKILL.md (skills are plain Markdown plus files next to it).
 */
export function skillPrompt(agent: AgentDef, skill: { name: string; invocation: string; path: string }, args: string): string {
  // Claude Code only knows skills under a .claude folder (project, user, plugins) by their slash name
  if (agent.claudeSkills && /[\\/]\.claude[\\/]/.test(skill.path)) return `${skill.invocation} ${args.trim()}`.trim()
  return [
    `Use the "${skill.name}" skill for this task: read ${skill.path} completely and follow its instructions.`,
    'Files and scripts it mentions are relative to that folder; keep working in your current folder.',
    ...(args.trim() ? [`Arguments (wherever the skill says $ARGUMENTS):\n${args.trim()}`] : [])
  ].join('\n\n')
}
