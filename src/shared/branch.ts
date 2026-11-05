/**
 * Branch names for missions and factory runs: `<type>/<short-slug>`, e.g. "Add a dark mode toggle to
 * the settings page" → feature/dark-mode-toggle-settings. The type comes from the brief's wording, the
 * slug from its first few meaningful words, never the whole description.
 */

export const BRANCH_TYPES = ['feature', 'fix', 'refactor', 'docs', 'test', 'chore', 'perf'] as const
export type BranchType = (typeof BRANCH_TYPES)[number]

const TYPE_WORDS: [BranchType, RegExp][] = [
  ['fix', /^(fix|fixes|fixed|bug|bugs|bugfix|broken|crash|crashes|error|errors|repair|regression|hotfix|wrong)$/],
  ['docs', /^(docs?|documentation|readme|changelog|guide)$/],
  ['test', /^(tests?|testing|e2e|coverage|spec|specs)$/],
  ['refactor', /^(refactor|refactoring|restructure|rename|cleanup|clean|simplify|extract|reorganize)$/],
  ['perf', /^(perf|performance|faster|speed|slow|optimi[sz]e)$/],
  ['chore', /^(chore|bump|upgrade|deps|dependencies|ci|lint|config|release)$/]
]

/** words that say nothing about the change */
const FILLER = new Set(
  `a an the to of in on for and or with without from into by at as is are be it its this that these those our my your we i you
  please can could should would will need needs make makes add adds added implement implements create creates build builds
  support supports allow allows let lets new use using so when then also just some all any page pages
  fix fixes fixed bug bugs refactor docs doc test tests chore update updates`.split(/\s+/)
)

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[`'’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** The conventional type a brief reads as; "feature" unless its first words say otherwise. */
export function branchType(text: string): BranchType {
  const first = words(text.split('\n')[0]).slice(0, 6)
  for (const w of first) for (const [type, re] of TYPE_WORDS) if (re.test(w)) return type
  return 'feature'
}

/** "feature/dark-mode-toggle-settings": at most `max` words, at most 40 characters after the slash. */
export function branchName(text: string, opts: { type?: BranchType; max?: number } = {}): string {
  const line = text.trim().split('\n').find((l) => l.trim()) ?? ''
  const all = words(line)
  const kept = all.filter((w) => !FILLER.has(w) && w.length > 1)
  const pick = (kept.length ? kept : all).slice(0, opts.max ?? 4)
  let slug = ''
  for (const w of pick) {
    const next = slug ? `${slug}-${w}` : w
    if (next.length > 40) break
    slug = next
  }
  return `${opts.type ?? branchType(text)}/${slug || 'work'}`
}

/** A branch name the user typed, made safe for git (spaces, `..`, a leading dash, a trailing .lock or slash). */
export function cleanBranchName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[~^:?*[\\\]@{}"'<>|]+/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/\/{2,}/g, '/')
    .replace(/^[-./]+|[-./]+$/g, '')
    .replace(/\.lock$/i, '')
    .split('/')
    .map((part) => part.replace(/^\.+/, ''))
    .filter(Boolean)
    .join('/')
}
