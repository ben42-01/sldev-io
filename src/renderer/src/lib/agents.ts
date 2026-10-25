import { promptWithRole } from '@shared/profiles'
import type { AgentOptions, CustomAgent } from '@shared/types'
import { shellQuote } from './paths'

export interface AgentMode {
  value: string
  label: string
}

export interface AgentDef {
  id: string
  name: string
  /** executable looked up on PATH to tell whether it's installed */
  bin: string
  install?: string
  /** model suggestions; the field also accepts free text */
  models: string[]
  modelPlaceholder?: string
  /** approval / permission modes ('' = the agent's default) */
  modes: AgentMode[]
  efforts: string[]
  /** reports status through Claude Code hooks; other agents are tracked from terminal activity */
  hooks: boolean
  /** runs skills and commands from ~/.claude and .claude as `/name` */
  claudeSkills?: boolean
  canPrint: boolean
  canResume: boolean
  /** takes a role as an extra system prompt; other agents get it at the top of the prompt */
  systemPrompt?: boolean
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
}

const q = (s: string): string => shellQuote(s)
const flag = (cond: unknown, ...parts: string[]): string[] => (cond ? parts : [])
const extraArgs = (o: AgentOptions): string[] => flag(o.extraArgs?.trim(), o.extraArgs?.trim() ?? '')
const promptArg = (prompt: string | undefined): string[] => flag(prompt?.trim(), q(prompt?.trim() ?? ''))

const claude: AgentDef = {
  id: 'claude',
  name: 'Claude Code',
  bin: 'claude',
  install: 'npm i -g @anthropic-ai/claude-code',
  models: ['opus', 'sonnet', 'haiku', 'fable'],
  modes: [
    { value: 'acceptEdits', label: 'Accept edits' },
    { value: 'plan', label: 'Plan' },
    { value: 'auto', label: 'Auto' },
    { value: 'dontAsk', label: "Don't ask" },
    { value: 'manual', label: 'Manual' },
    { value: 'bypassPermissions', label: 'Bypass permissions' }
  ],
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  hooks: true,
  claudeSkills: true,
  canPrint: true,
  canResume: true,
  systemPrompt: true,
  build: (o, prompt, name, { settingsPath, resume, role }) => [
    'claude',
    ...flag(settingsPath, '--settings', q(settingsPath ?? '')),
    ...(resume === true ? ['--continue'] : flag(resume, '--resume', q(String(resume)))),
    ...flag(o.print && !resume, '-p'),
    ...flag(o.model, '--model', q(o.model ?? '')),
    ...flag(o.permissionMode, '--permission-mode', o.permissionMode ?? ''),
    ...flag(o.effort, '--effort', o.effort ?? ''),
    ...flag(role?.trim() && !resume, '--append-system-prompt', q(role?.trim() ?? '')),
    ...flag(!o.print && name && !resume, '-n', q(name ?? '')),
    ...extraArgs(o),
    ...(resume ? [] : promptArg(prompt))
  ]
}

const codex: AgentDef = {
  id: 'codex',
  name: 'Codex',
  bin: 'codex',
  install: 'npm i -g @openai/codex',
  models: [],
  modelPlaceholder: 'default',
  modes: [
    { value: 'read-only', label: 'Read only' },
    { value: 'full-auto', label: 'Full auto (workspace write)' },
    { value: 'yolo', label: 'No sandbox, no approvals' }
  ],
  efforts: ['minimal', 'low', 'medium', 'high'],
  hooks: false,
  canPrint: true,
  canResume: true,
  build: (o, prompt, _name, { resume }) => [
    'codex',
    ...(resume ? ['resume', '--last'] : flag(o.print, 'exec')),
    ...flag(o.model, '--model', q(o.model ?? '')),
    ...flag(o.permissionMode === 'read-only', '--sandbox', 'read-only'),
    ...flag(o.permissionMode === 'full-auto', '--full-auto'),
    ...flag(o.permissionMode === 'yolo', '--dangerously-bypass-approvals-and-sandbox'),
    ...flag(o.effort, '-c', `model_reasoning_effort=${o.effort}`),
    ...extraArgs(o),
    ...(resume ? [] : promptArg(prompt))
  ]
}

const cursor: AgentDef = {
  id: 'cursor',
  name: 'Cursor Agent',
  bin: 'cursor-agent',
  install: 'curl https://cursor.com/install -fsS | bash',
  models: [],
  modelPlaceholder: 'default',
  modes: [{ value: 'force', label: 'Auto-approve commands (--force)' }],
  efforts: [],
  hooks: false,
  canPrint: true,
  canResume: true,
  build: (o, prompt, _name, { resume }) => [
    'cursor-agent',
    ...flag(resume, 'resume'),
    ...flag(o.print && !resume, '-p'),
    ...flag(o.model, '--model', q(o.model ?? '')),
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
  hooks: false,
  canPrint: true,
  canResume: true,
  build: (o, prompt, _name, { resume }) => [
    'copilot',
    ...flag(resume, '--continue'),
    ...flag(o.model, '--model', q(o.model ?? '')),
    // non-interactive runs can't stop to ask, so they need tools pre-approved
    ...flag(o.permissionMode === 'allow-all-tools' || (o.print && !resume), '--allow-all-tools'),
    ...extraArgs(o),
    ...(resume || !prompt?.trim() ? [] : [o.print ? '-p' : '-i', q(prompt.trim())])
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
  efforts: [],
  hooks: false,
  canPrint: true,
  canResume: true,
  build: (o, prompt, _name, { resume }) => [
    'opencode',
    ...flag(o.print && !resume, 'run'),
    ...flag(resume, '--continue'),
    ...flag(o.model, '--model', q(o.model ?? '')),
    ...flag(o.permissionMode, '--agent', o.permissionMode ?? ''),
    ...extraArgs(o),
    ...(resume || !prompt?.trim() ? [] : o.print ? [q(prompt.trim())] : ['--prompt', q(prompt.trim())])
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
  efforts: [],
  hooks: false,
  canPrint: true,
  canResume: true,
  build: (o, prompt, _name, { resume }) => [
    'gemini',
    ...flag(resume, '--resume', 'latest'),
    ...flag(o.model, '--model', q(o.model ?? '')),
    ...flag(o.permissionMode, '--approval-mode', o.permissionMode ?? ''),
    ...extraArgs(o),
    ...(resume || !prompt?.trim() ? [] : [o.print ? '-p' : '-i', q(prompt.trim())])
  ]
}

export const BUILTIN_AGENTS: AgentDef[] = [claude, codex, cursor, copilot, opencode, gemini]

/** Fill a user-defined command template: {prompt}, {model}, {name}. The prompt is appended when the template has no {prompt}. */
function fillTemplate(template: string, o: AgentOptions, prompt: string | undefined, name: string | undefined): string[] {
  const p = prompt?.trim() ? q(prompt.trim()) : ''
  let out = template
    .replace(/\{model\}/g, o.model ? q(o.model) : '')
    .replace(/\{name\}/g, name ? q(name) : '')
  out = out.includes('{prompt}') ? out.replace(/\{prompt\}/g, p) : [out, p].filter(Boolean).join(' ')
  return [out.replace(/\s+/g, ' ').trim(), ...extraArgs(o)]
}

export function customAgentDef(c: CustomAgent): AgentDef {
  return {
    id: c.id,
    name: c.name,
    bin: c.command.trim().split(/\s+/)[0] ?? '',
    models: [],
    modelPlaceholder: c.command.includes('{model}') ? 'model' : undefined,
    modes: [],
    efforts: [],
    hooks: false,
    canPrint: !!c.printCommand?.trim(),
    canResume: !!c.resumeCommand?.trim(),
    custom: true,
    build: (o, prompt, name, { resume }) => {
      if (resume && c.resumeCommand?.trim()) return [c.resumeCommand.trim()]
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

/** The command line that starts (or resumes) an agent session. */
export function agentCommand(agent: AgentDef, o: AgentOptions, prompt: string | undefined, name: string | undefined, extra: CommandExtra = {}): string {
  const role = extra.resume ? undefined : extra.role?.trim()
  const p = role && !agent.systemPrompt ? promptWithRole(role, prompt) : prompt
  return agent.build(o, p, name, agent.hooks ? { ...extra, role } : { resume: extra.resume }).join(' ')
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'mission'
}

/**
 * Prompt that runs a skill. Claude Code knows the skill by its slash invocation; any other agent
 * is pointed at the SKILL.md (skills are plain Markdown plus files next to it).
 */
export function skillPrompt(agent: AgentDef, skill: { name: string; invocation: string; path: string }, args: string): string {
  if (agent.claudeSkills) return `${skill.invocation} ${args.trim()}`.trim()
  const task = args.trim() ? `\n\nTask: ${args.trim()}` : ''
  return `Use the "${skill.name}" skill: read ${skill.path} and follow its instructions (files it mentions are relative to that folder).${task}`
}
