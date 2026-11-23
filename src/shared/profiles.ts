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

const starter = (id: string): AgentProfile => {
  const p = STARTER_PROFILES.find((s) => s.id === `builtin:${id}`)
  if (!p) throw new Error(`no starter profile ${id}`)
  return p
}

/** A set of profiles installed together into `.sldev/agents/`, one file per role. */
export interface TeamTemplate {
  id: string
  name: string
  description: string
  profiles: AgentProfile[]
}

/**
 * Ready-made teams. Roles stay agent-agnostic and inside the app's rules: nobody pushes, stories an
 * agent writes land in Proposed, and a person decides what is picked up and what ships.
 */
export const TEAM_TEMPLATES: TeamTemplate[] = [
  {
    id: 'software',
    name: 'Software team',
    description: 'Product owner, tech lead, implementer, reviewer, QA and release manager; you stay in charge',
    profiles: [
      {
        id: 'team:software:product-owner',
        name: 'Product owner',
        description: 'Turns goals into small stories with acceptance criteria; read-only',
        scope: 'builtin',
        role: [
          'You are the product owner. You write stories, not code: do not edit source files.',
          'Read the codebase and the request, then split the work into small stories a single agent can finish.',
          'Each story has a title, why it matters, what to do (files and approach), acceptance criteria as a',
          'checklist, and how to check it. Stories that touch the same files depend on each other: chain them',
          'with `after` so they run one at a time.',
          'File stories with the sldev board tools when you have them; otherwise write them as a JSON file under',
          '`.sldev/runs/`. Either way they land in Proposed, and a person decides which go to Agent ready.'
        ].join('\n')
      },
      {
        id: 'team:software:tech-lead',
        name: 'Tech lead',
        description: 'Plans the work and delegates it; edits only to resolve conflicts',
        scope: 'builtin',
        role: [
          'You are the tech lead. You plan and delegate; you do not implement.',
          '- Read the brief and the code, then break the work into independent pieces with clear boundaries.',
          '- Hand each piece to a worker with a precise brief: goal, files, constraints and how to check it.',
          "- Review each worker's result against its brief and send it back with concrete fixes when it falls short.",
          "- Edit files only to resolve conflicts when workers' branches come together, then run the project checks.",
          '- Do not push or open pull requests: end with a summary of what was done, what was checked and the',
          '  remaining risks, for a person to review.'
        ].join('\n')
      },
      { ...starter('implementer'), id: 'team:software:implementer' },
      { ...starter('reviewer'), id: 'team:software:reviewer' },
      {
        id: 'team:software:qa',
        name: 'QA',
        description: 'Runs the checks and adds the ones that are missing',
        scope: 'builtin',
        role: [
          starter('test-writer').role,
          'You are QA: run the build, typecheck, tests and any end-to-end checks the project has, and report',
          'each result with the command and the failing output. Where behaviour is untested, add the checks',
          'that pin it down. Change only test and check files; report product bugs instead of fixing them.'
        ].join('\n')
      },
      {
        id: 'team:software:release-manager',
        name: 'Release manager',
        description: 'Drafts release notes and PR descriptions; never pushes',
        scope: 'builtin',
        role: [
          'You are the release manager. You write; you never push, tag or publish anything.',
          'Read the commits and the diff since the last release (or of the branch you are given) and draft:',
          '- release notes grouped as added, changed and fixed, in plain words for users;',
          '- a PR description: what changed and why, how it was checked, and the risks for the reviewer.',
          'Do not edit source files. Return the drafts as Markdown for a person to use.'
        ].join('\n')
      }
    ]
  }
]

/** The team template that has a role for every one of these agent specs ("QA", "QA@codex"), if one does. */
export function teamProviding(specs: string[]): TeamTemplate | undefined {
  const names = specs.map((s) => s.split('@')[0].trim().toLowerCase())
  if (!names.length) return undefined
  return TEAM_TEMPLATES.find((t) => names.every((n) => t.profiles.some((p) => p.name.toLowerCase() === n)))
}

/** A file a team install writes, relative to the project root. */
export interface TeamFile {
  path: string
  profile: AgentProfile
  text: string
}

/**
 * The `.sldev/agents/<slug>.md` files a team needs. `existing` are the file names (or paths) already in
 * `.sldev/agents`; a role whose file is there is skipped, so hand-edited copies are never overwritten.
 */
export function teamFiles(template: TeamTemplate, existing: Iterable<string>): { write: TeamFile[]; skipped: TeamFile[] } {
  const have = new Set([...existing].map((f) => f.split(/[\\/]/).pop()!.toLowerCase()))
  const write: TeamFile[] = []
  const skipped: TeamFile[] = []
  for (const role of template.profiles) {
    const profile = { ...role, team: template.name }
    const name = `${profileSlug(profile.name)}.md`
    const file = { path: `.sldev/agents/${name}`, profile, text: serializeProfile(profile) }
    if (have.has(name)) skipped.push(file)
    else {
      write.push(file)
      have.add(name)
    }
  }
  return { write, skipped }
}

/** What a team install did, for a toast: how many roles were written and, by name, which files were kept. */
export function installSummary(team: string, written: string[], skipped: string[]): string {
  const name = (p: string): string => p.split(/[\\/]/).pop() ?? p
  const kept = skipped.length ? `kept ${skipped.map(name).join(', ')} (already there)` : ''
  if (!written.length) return `${team} is already installed: ${kept}`
  return `Installed ${team}: ${written.length} role${written.length === 1 ? '' : 's'} in .sldev/agents${kept ? ` · ${kept}` : ''}`
}

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
    path,
    ...(str('team') ? { team: str('team') } : {})
  }
}

const clean = (o: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string>

export function serializeProfile(p: AgentProfile): string {
  const meta = clean({ name: p.name, description: p.description, agent: p.agent, model: p.model, mode: p.permissionMode, effort: p.effort, team: p.team })
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
