// The New project dialog's clone step: what a pasted repository means, the folder it clones into, and git's progress.

/** one of the user's repositories, from `gh repo list` */
export interface GhRepoItem {
  nameWithOwner: string
  description: string
  isPrivate: boolean
  updatedAt: string
  /** what git clones: the repository's https URL */
  url: string
}

/** `error` instead of a throw: no gh, or not signed in; a pasted URL still clones with git */
export interface GhRepoList {
  repos: GhRepoItem[]
  error?: string
}

export const REPO_LIST_LIMIT = 200
export const REPO_LIST_FIELDS = 'nameWithOwner,description,isPrivate,updatedAt,url'

/** gh's answer as list items, newest first; anything without a name is dropped */
export function parseRepoList(json: unknown): GhRepoItem[] {
  if (!Array.isArray(json)) return []
  return json
    .flatMap((r): GhRepoItem[] => {
      if (!r || typeof r !== 'object') return []
      const o = r as Record<string, unknown>
      const name = typeof o.nameWithOwner === 'string' ? o.nameWithOwner : ''
      if (!name) return []
      return [
        {
          nameWithOwner: name,
          description: typeof o.description === 'string' ? o.description : '',
          isPrivate: o.isPrivate === true,
          updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
          url: typeof o.url === 'string' && o.url ? o.url : `https://github.com/${name}`
        }
      ]
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** the list filtered by what was typed: every word must be in the name or the description */
export function filterRepos(repos: GhRepoItem[], query: string): GhRepoItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return repos
  return repos.filter((r) => {
    const hay = `${r.nameWithOwner} ${r.description}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

export interface CloneSource {
  /** what `git clone` is given */
  url: string
  /** the folder name it suggests */
  name: string
}

const OWNER_NAME = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/

/**
 * A pasted repository: an https/ssh/git/file URL, scp-style `git@host:owner/name`, a local path, or GitHub's
 * `owner/name` shorthand (cloned over https). null when it doesn't look like one, so typing stays a search.
 */
export function parseCloneInput(input: string): CloneSource | null {
  const text = input.trim()
  if (!text || /\s/.test(text)) return null
  let url: string | null = null
  if (/^(https?|ssh|git|file):\/\//i.test(text)) url = text
  else if (/^[\w.-]+@[\w.-]+:.+/.test(text)) url = text
  else if (/^(\/|~\/|[A-Za-z]:[\\/]|\\\\)/.test(text)) url = text
  else if (/^github\.com\/[^/]+\/[^/]+/i.test(text)) url = `https://${text}`
  else if (OWNER_NAME.test(text) && !text.endsWith('.')) url = `https://github.com/${text.replace(/\.git$/, '')}`
  if (!url) return null
  const name = repoFolderName(url)
  return name ? { url, name } : null
}

/** the last path part of a repository URL without .git: the folder `git clone` would make */
export function repoFolderName(url: string): string {
  const path = url.replace(/[?#].*$/, '').replace(/[\\/]+$/, '')
  const last = path.split(/[\\/:]/).pop() ?? ''
  return last.replace(/\.git$/i, '')
}

/** why a folder name can't be used, or null */
export function folderNameProblem(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Give the folder a name.'
  if (n === '.' || n === '..') return 'Pick another folder name.'
  if (/[\\/]/.test(n)) return 'The folder name can’t contain a slash; set the parent folder above instead.'
  if (/[<>:"|?*\u0000-\u001f]/.test(n)) return 'The folder name has a character folders can’t have.'
  return null
}

export interface CloneProgress {
  /** "Receiving objects", "Resolving deltas", … */
  phase: string
  /** 0–100 within that phase, or null when git gave no number */
  percent: number | null
}

/**
 * The latest progress line in what `git clone --progress` printed so far (it redraws lines with \r).
 * null before git said anything that looks like progress.
 */
export function cloneProgress(output: string): CloneProgress | null {
  const lines = output.split(/[\r\n]+/).map((l) => l.replace(/^remote:\s*/, '').trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^([A-Z][A-Za-z ]+?):\s+(\d{1,3})%/.exec(lines[i])
    if (m) return { phase: m[1], percent: Math.min(100, Number(m[2])) }
    if (/^Cloning into/.test(lines[i])) return { phase: 'Connecting', percent: null }
  }
  return null
}

/** the last few lines of git's output, for an error */
export function cloneError(output: string): string {
  const lines = output.split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l && !/^Cloning into/.test(l) && !/:\s+\d{1,3}%/.test(l))
  return lines.slice(-4).join('\n') || 'git clone failed.'
}

// ── Start from scratch ─────────────────────────────────────────────

export const NEW_PROJECT_LICENSES = ['Apache-2.0', 'MIT'] as const
export type NewProjectLicense = (typeof NEW_PROJECT_LICENSES)[number]

const FILLER = new Set(['a', 'an', 'the', 'that', 'which', 'with', 'for', 'and', 'or', 'of', 'to', 'in', 'on', 'my', 'our', 'simple', 'small', 'new', 'build', 'create', 'make', 'write', 'app', 'i', 'want', 'we', 'need'])

/**
 * The folder a project from scratch gets when no name is given: a few words of its description in kebab-case
 * ("A command-line weather app in Rust" → command-line-weather-rust). The agent may still suggest a better
 * repository name; the folder stays.
 */
export function projectSlug(description: string): string {
  const words = description
    .toLowerCase()
    .split('\n')[0]
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
  const slug = words.slice(0, 3).join('-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '')
  return slug || 'new-project'
}

/** What a New project mission is told: the description as written, then the name and license picked in the dialog. */
export function newProjectBrief(o: { description: string; name?: string; license: string }): string {
  const lines = [o.name?.trim() ? `Name: ${o.name.trim()} (use it as the repository name)` : 'Name: none given; suggest one (kebab-case).', `License: ${o.license}`]
  return `${o.description.trim()}\n\n${lines.join('\n')}`
}

// ── Create the repository on GitHub ───────────────────────────────

export type RepoVisibility = 'private' | 'public'

/** what the Create repository dialog asks main to do, on its click only */
export interface CreateRepoRequest {
  /** the project folder: its git repository becomes the new repository's first push */
  dir: string
  owner: string
  name: string
  visibility: RepoVisibility
  description: string
}

/** the accounts a repository can be created under: the signed-in user first, then their organizations */
export interface RepoOwners {
  owners: string[]
  /** no gh, or not signed in */
  error?: string
}

/** what the push will carry, for the dialog to say before the click */
export interface RepoPushPlan {
  branch: string | null
  commits: number
  /** the `origin` already set, if any (then nothing is created) */
  origin: string | null
}

/** why a repository name can't be used on GitHub, or null */
export function repoNameProblem(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Give the repository a name.'
  if (n.length > 100) return 'GitHub repository names are at most 100 characters.'
  if (n === '.' || n === '..') return 'Pick another repository name.'
  if (!/^[A-Za-z0-9._-]+$/.test(n)) return 'Use only letters, digits, “-”, “_” and “.” in the name.'
  return null
}

/** the signed-in login and their organizations, without duplicates or blanks, the login first */
export function repoOwners(login: string, orgs: unknown): string[] {
  const names = Array.isArray(orgs) ? orgs.map((o) => (o && typeof o === 'object' ? (o as Record<string, unknown>).login : o)) : []
  const all = [login, ...names].filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
  return [...new Set(all)]
}

/** `gh repo create`'s argv: the repository from the folder, `origin` set to it, and the current branch pushed */
export function createRepoArgs(r: CreateRepoRequest): string[] {
  const args = ['repo', 'create', `${r.owner.trim()}/${r.name.trim()}`, r.visibility === 'public' ? '--public' : '--private', '--source', r.dir, '--remote', 'origin', '--push']
  return r.description.trim() ? [...args, '--description', r.description.trim().replace(/\s+/g, ' ')] : args
}

/** gh's "no such repository" answer to `gh repo view`, as opposed to a failure to ask at all */
export function isRepoNotFound(stderr: string): boolean {
  return /could not resolve to a repository|HTTP 404/i.test(stderr)
}

/** the repository's URL in what `gh repo create` printed, or the plain github.com one */
export function createdRepoUrl(stdout: string, owner: string, name: string): string {
  return /https:\/\/\S+/.exec(stdout)?.[0].replace(/\.git$/, '') ?? `https://github.com/${owner}/${name}`
}
