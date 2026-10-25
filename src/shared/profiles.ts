import { parse, stringify } from 'yaml'
import type { AgentOptions, AgentProfile } from './types'

/** Ready-made roles; they work with any CLI, so they leave the agent to whoever picks them. */
export const STARTER_PROFILES: AgentProfile[] = [
  {
    id: 'builtin:implementer',
    name: 'Implementer',
    description: 'Builds the change end to end and commits it',
    scope: 'builtin',
    role: [
      'You implement the task you are given, end to end.',
      '- Read the surrounding code first and match its style.',
      '- Keep the change focused: no unrelated refactors.',
      '- Run the project checks (typecheck, tests, lint) and fix what fails.',
      '- Commit when done with a short imperative message.'
    ].join('\n')
  },
  {
    id: 'builtin:spec-writer',
    name: 'Spec writer',
    description: 'Turns an intent into a short spec; never edits code',
    scope: 'builtin',
    role: [
      'You write specs, not code. Do not edit source files.',
      'Read the codebase as needed, then write a short spec: goal, scope and non-goals, the files',
      'likely to change, the approach, edge cases, and how to verify it (tests to add or run).',
      'Keep it under a page. If a decision is genuinely open, list it under "Open questions".'
    ].join('\n')
  },
  {
    id: 'builtin:reviewer',
    name: 'Reviewer',
    description: 'Reviews a diff for bugs and risks; read-only',
    scope: 'builtin',
    role: [
      'You review changes; you never edit files.',
      'Look for correctness bugs, missed edge cases, security issues, broken invariants and missing',
      'tests. Skip style nits a formatter would catch. For each finding give the file and line, what',
      'goes wrong and a concrete fix. End with a one-line verdict: ship, ship with fixes, or rework.'
    ].join('\n')
  },
  {
    id: 'builtin:test-writer',
    name: 'Test writer',
    description: 'Adds tests that pin down behaviour',
    scope: 'builtin',
    role: [
      'You write tests. Follow the project test framework and conventions.',
      'Cover the behaviour that matters, including edge cases and failure paths. When asked to',
      'reproduce a bug, write a test that fails for the reported reason before any fix exists.',
      'Run the tests and report what passes and fails.'
    ].join('\n')
  },
  {
    id: 'builtin:fixer',
    name: 'Fixer',
    description: 'Makes failing checks pass with the smallest correct change',
    scope: 'builtin',
    role: [
      'You fix failures: failing tests, type errors, lint errors or a broken CI run.',
      'Find the root cause before changing anything. Make the smallest correct fix; never delete or',
      'weaken a test to make it pass. Re-run the failing check until it is green.'
    ].join('\n')
  }
]

/** The options a profile sets; fields it leaves out keep what was picked. */
export function applyProfile(o: AgentOptions, p: AgentProfile | undefined): AgentOptions {
  if (!p) return { ...o, profile: undefined }
  return {
    ...o,
    profile: p.id,
    agent: p.agent ?? o.agent,
    model: p.agent ? p.model : (p.model ?? o.model),
    permissionMode: p.agent ? p.permissionMode : (p.permissionMode ?? o.permissionMode),
    effort: p.agent ? p.effort : (p.effort ?? o.effort)
  }
}

/** For agents without a system-prompt flag the role travels in the prompt. */
export function promptWithRole(role: string, prompt: string | undefined): string {
  const task = prompt?.trim()
  return task ? `${role.trim()}\n\n---\n\nTask:\n${task}` : `${role.trim()}\n\nWait for my first task.`
}

// ── files: front matter plus the role as the body ───────────────

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseProfileFile(text: string, path: string): AgentProfile | null {
  const m = FRONT.exec(text)
  if (!m) return null
  let meta: Record<string, unknown>
  try {
    meta = (parse(m[1]) as Record<string, unknown>) ?? {}
  } catch {
    return null
  }
  const str = (k: string): string | undefined => (typeof meta[k] === 'string' && (meta[k] as string).trim() ? (meta[k] as string).trim() : undefined)
  const name = str('name')
  if (!name) return null
  return {
    id: `project:${path}`,
    name,
    description: str('description') ?? '',
    agent: str('agent'),
    model: str('model'),
    permissionMode: str('mode'),
    effort: str('effort'),
    role: m[2].trim(),
    scope: 'project',
    path
  }
}

const clean = (o: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string>

export function serializeProfile(p: AgentProfile): string {
  const meta = clean({ name: p.name, description: p.description, agent: p.agent, model: p.model, mode: p.permissionMode, effort: p.effort })
  return `---\n${stringify(meta).trimEnd()}\n---\n\n${p.role.trim()}\n`
}

/** Claude Code subagent (.claude/agents/<slug>.md). Its model field takes aliases only. */
export function claudeSubagentFile(p: AgentProfile): string {
  const model = p.agent === 'claude' && p.model && /^(opus|sonnet|haiku|fable|inherit)$/.test(p.model) ? p.model : undefined
  const meta = clean({ name: profileSlug(p.name), description: p.description || p.name, model })
  return `---\n${stringify(meta).trimEnd()}\n---\n\n${p.role.trim()}\n`
}

/** OpenCode agent (.opencode/agent/<slug>.md). */
export function opencodeAgentFile(p: AgentProfile): string {
  const meta = clean({ description: p.description || p.name, mode: 'subagent', model: p.agent === 'opencode' ? p.model : undefined })
  return `---\n${stringify(meta).trimEnd()}\n---\n\n${p.role.trim()}\n`
}

export function profileSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'agent'
}
