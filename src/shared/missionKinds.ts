import { parse, stringify } from 'yaml'
import { MAP_INSTRUCTIONS } from './context'
import { LEAD_METHOD } from './lead'

/**
 * What kind of work a mission is: it decides how the brief is framed, how the agent should end, and
 * the form's defaults. A research mission must not be told to "summarize what changed", or it will go
 * and change something. Custom kinds are Markdown files (front matter + template) in
 * `.sldev/missions/` (project, committable) or the app's user folder.
 */
export interface MissionKind {
  id: string
  name: string
  description: string
  /** the first message: {title} {brief} {criteria}; the brief is appended when the template has no {brief} */
  template: string
  /** isolate in a new worktree by default */
  worktree: boolean
  /** the agent shouldn't edit anything: its read-only mode is preselected where it has one */
  readOnly: boolean
  /** what the brief field suggests */
  placeholder?: string
  scope: 'builtin' | 'project' | 'user'
  /** the file a custom kind came from */
  path?: string
}

const WORK_HERE = 'Work only in your current working folder.'
const NO_EDITS = 'Do not create, modify or delete any files, and do not commit.'

export const BUILTIN_KINDS: MissionKind[] = [
  {
    id: 'build',
    name: 'Build',
    description: 'Change code: a feature, a fix, a refactor. Ends with a diff to review.',
    worktree: true,
    readOnly: false,
    placeholder: 'e.g. Add pagination to the /users endpoint and cover it with tests',
    scope: 'builtin',
    template: [
      'Mission: {title}',
      '{brief}',
      '{criteria}',
      `${WORK_HERE}\nWhen finished, summarize what changed, the checks you ran, and the remaining risks, for human review. Do not commit, push or merge unless the task explicitly asks.`
    ].join('\n\n')
  },
  {
    id: 'research',
    name: 'Research',
    description: 'Answer a question about the code, a library or an approach. Nothing is changed.',
    worktree: false,
    readOnly: true,
    placeholder: 'e.g. How does authentication flow from the login form to the API? Which parts would a switch to OAuth touch?',
    scope: 'builtin',
    template: [
      'Research: {title}',
      '{brief}',
      '{criteria}',
      `This is a research task. Read code, docs and, if you can, the web. ${NO_EDITS}`,
      'Answer in your final reply: the answer first, then the evidence (files and lines, links), then open questions and what you would look at next.'
    ].join('\n\n')
  },
  {
    id: 'investigate',
    name: 'Investigate',
    description: 'Find the root cause of a bug or odd behaviour, with evidence. Fixes only if asked.',
    worktree: false,
    readOnly: false,
    placeholder: 'e.g. Saving a profile sometimes returns 500. Find out why.',
    scope: 'builtin',
    template: [
      'Investigate: {title}',
      '{brief}',
      '{criteria}',
      `${WORK_HERE}\nFind the root cause before suggesting anything. Reproduce it if you can. Don't change project files unless the task asks for a fix; remove any temporary files or scripts you create.`,
      'End with: the cause, the evidence (commands you ran, files and lines), the fix you recommend, and how confident you are.'
    ].join('\n\n')
  },
  {
    id: 'plan',
    name: 'Plan',
    description: 'Write an implementation plan, no code. Hand it to a Build mission or a factory run.',
    worktree: false,
    readOnly: true,
    placeholder: 'e.g. Plan how to move settings from JSON files to SQLite',
    scope: 'builtin',
    template: [
      'Plan: {title}',
      '{brief}',
      '{criteria}',
      `Write a plan, not code. Read whatever you need. ${NO_EDITS}`,
      'Your final reply is the plan: goal, scope and non-goals, the approach, the files likely to change, the steps in order, risks, how to verify it, and open questions. Someone else will build from it, so be specific.'
    ].join('\n\n')
  },
  {
    id: 'review',
    name: 'Review',
    description: 'Review a branch, a diff or a part of the codebase. Read-only.',
    worktree: false,
    readOnly: true,
    placeholder: 'e.g. Review the changes on this branch against main (git diff main)',
    scope: 'builtin',
    template: [
      'Review: {title}',
      '{brief}',
      '{criteria}',
      `You review; ${NO_EDITS}`,
      'List findings, most important first: file and line, what goes wrong, and a concrete fix. Skip nits a formatter would catch. End with a one-line verdict.'
    ].join('\n\n')
  },
  {
    id: 'map',
    name: 'Map project',
    description: 'Write the reference docs in .sldev/context that later missions are pointed at.',
    worktree: false,
    readOnly: false,
    placeholder: 'Optional: what to focus on, e.g. the payment flow and how releases work',
    scope: 'builtin',
    template: ['Mission: {title}', '{brief}', '{criteria}', MAP_INSTRUCTIONS, 'End with: the files you wrote, and what you could not verify.'].join('\n\n')
  },
  {
    id: 'lead',
    name: 'Lead',
    description: 'Plans a big goal and delegates the parts to other agents in parallel, reviews and merges their work. Needs the sldev tools (Claude Code, Codex).',
    worktree: true,
    readOnly: false,
    placeholder: 'e.g. Teams: users create a team, invite people by email, share projects with it, and owners remove members',
    scope: 'builtin',
    template: ['Lead: {title}', '{brief}', '{criteria}', LEAD_METHOD].join('\n\n')
  },
  {
    id: 'freeform',
    name: 'Freeform',
    description: 'Your prompt exactly as you wrote it, with nothing added.',
    worktree: false,
    readOnly: false,
    placeholder: 'Anything: the agent gets exactly this text',
    scope: 'builtin',
    template: '{brief}'
  }
]

export const DEFAULT_KIND = 'build'

/** The first message of a mission of this kind. Empty placeholders drop their line. */
export function renderKind(kind: Pick<MissionKind, 'template'>, o: { title: string; brief: string; criteria?: string }): string {
  const criteria = o.criteria?.trim() ? `Acceptance criteria:\n${o.criteria.trim()}` : ''
  const values: Record<string, string> = { title: o.title.trim(), brief: o.brief.trim(), criteria }
  let text = kind.template.includes('{brief}') ? kind.template : `${kind.template.trim()}\n\n{brief}`
  // a line holding only a placeholder that is empty goes away with its line break
  text = text.replace(/^[ \t]*\{(title|brief|criteria)\}[ \t]*$/gm, (m, k: string) => (values[k] ? m : '\u0000'))
  text = text.replace(/\u0000\n?/g, '')
  text = text.replace(/\{(title|brief|criteria)\}/g, (_m, k: string) => values[k])
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

export function findKind(kinds: MissionKind[], id: string | undefined): MissionKind {
  return kinds.find((k) => k.id === id) ?? kinds.find((k) => k.id === DEFAULT_KIND) ?? BUILTIN_KINDS[0]
}

// ── files ────────────────────────────────────────────────────────

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseKindFile(text: string, path: string, scope: 'project' | 'user'): MissionKind | null {
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
  // the help comment a new kind file starts with is for the person editing it, not the agent
  const template = m[2].replace(/<!--[\s\S]*?-->/g, '').trim()
  if (!name || !template) return null
  return {
    id: `${scope}:${path}`,
    name,
    description: str('description') ?? '',
    template,
    worktree: meta.worktree === true,
    readOnly: meta.readOnly === true || meta.access === 'read',
    placeholder: str('placeholder'),
    scope,
    path
  }
}

export function serializeKind(k: Pick<MissionKind, 'name' | 'description' | 'template' | 'worktree' | 'readOnly' | 'placeholder'>): string {
  const meta: Record<string, unknown> = { name: k.name, description: k.description || undefined, worktree: k.worktree, access: k.readOnly ? 'read' : 'write', placeholder: k.placeholder || undefined }
  for (const key of Object.keys(meta)) if (meta[key] === undefined) delete meta[key]
  const help = '<!-- The first message a mission of this kind sends. {title}, {brief} and {criteria} are filled in; without {brief} the brief goes at the end. -->'
  return `---\n${stringify(meta).trimEnd()}\n---\n\n${help}\n\n${k.template.trim()}\n`
}

/** A starting point for a new custom kind: a copy of the one picked. */
export function kindDraft(from: MissionKind, name: string): string {
  return serializeKind({ ...from, name, description: from.scope === 'builtin' ? `Based on ${from.name}` : from.description })
}

export function kindSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'kind'
}
