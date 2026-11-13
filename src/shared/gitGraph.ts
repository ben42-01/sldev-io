/**
 * The commit graph: `git log --all --topo-order` parsed into commits, and a lane layout (a column per commit,
 * lines to its parents) for drawing it row by row. Pure, so it is unit-tested; src/main/git.ts runs git.
 */

/** NUL-separated so subjects and ref names can hold anything but NUL; one commit per line. */
export const GRAPH_LOG_FORMAT = '%H%x00%P%x00%D%x00%an%x00%at%x00%s'

export type GraphRefKind = 'head' | 'branch' | 'remote' | 'tag'

export interface GraphRef {
  kind: GraphRefKind
  name: string
}

export interface GraphCommit {
  sha: string
  parents: string[]
  refs: GraphRef[]
  author: string
  /** unix ms, author date */
  time: number
  subject: string
}

export interface GraphLog {
  commits: GraphCommit[]
  /** more commits exist past the limit */
  more: boolean
  /** https://github.com/owner/name when origin is on GitHub, for PR links without gh */
  githubUrl: string | null
}

/**
 * `%D`: "HEAD -> main, origin/main, tag: v1.0, origin/HEAD". A name under a known remote is a remote branch;
 * `origin/HEAD` says nothing new and is dropped. A detached HEAD shows as "HEAD".
 */
export function parseRefs(d: string, remotes: string[]): GraphRef[] {
  const refs: GraphRef[] = []
  for (const raw of d.split(', ')) {
    const r = raw.trim()
    if (!r) continue
    if (r.startsWith('HEAD -> ')) refs.push({ kind: 'head', name: r.slice(8) })
    else if (r === 'HEAD') refs.push({ kind: 'head', name: 'HEAD' })
    else if (r.startsWith('tag: ')) refs.push({ kind: 'tag', name: r.slice(5) })
    else if (remotes.some((rm) => r.startsWith(`${rm}/`))) {
      if (!r.endsWith('/HEAD')) refs.push({ kind: 'remote', name: r })
    } else refs.push({ kind: 'branch', name: r })
  }
  return refs
}

export function parseGraphLog(out: string, remotes: string[] = []): GraphCommit[] {
  const commits: GraphCommit[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [sha, parents, refs, author, at, ...subject] = line.split('\0')
    if (!sha || !/^[0-9a-f]{7,64}$/.test(sha)) continue
    commits.push({
      sha,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      refs: parseRefs(refs ?? '', remotes),
      author: author ?? '',
      time: Number(at) * 1000 || 0,
      subject: subject.join('\0')
    })
  }
  return commits
}

/** origin's URL as a GitHub web URL (https, scp-like ssh or ssh://), or null when it isn't on github.com. */
export function githubWebUrl(remote: string): string | null {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/\s]+@)github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remote.trim())
  return m ? `https://github.com/${m[1]}/${m[2]}` : null
}

/** The PR a commit landed: "Merge pull request #7 from …" (merge commits) or "Title (#12)" (squash merges). */
export function prNumber(subject: string): number | null {
  const m = /^Merge pull request #(\d+)\b/.exec(subject) ?? /\(#(\d+)\)\s*$/.exec(subject)
  return m ? Number(m[1]) : null
}

/** A lane's colour, as an index into the palette (cycled). */
export const LANE_COLORS = 6

export interface GraphRow {
  commit: GraphCommit
  /** the node's column */
  col: number
  color: number
  /** lanes passing straight through this row, top to bottom */
  through: { col: number; color: number }[]
  /** lanes ending at the node: from the top of `from` to the node (its own lane is one of them, from === col) */
  into: { from: number; color: number }[]
  /** lines from the node to the bottom of `to`, one per parent */
  out: { to: number; color: number }[]
  /** columns this row needs drawn (the widest of top and bottom) */
  width: number
}

/**
 * Lays commits out in lanes. Each lane waits for one commit (the parent its child expects); a commit takes
 * the leftmost lane waiting for it (or the leftmost free one, for a branch tip), any other lanes waiting for
 * it end there, its first parent continues its lane, and further parents (merges) join a lane already
 * waiting for them or open a new one. Lanes keep their column for their whole life, so nothing shifts
 * sideways; a freed column is reused. Commits must be in topological order (children before parents).
 */
export function layoutGraph(commits: GraphCommit[]): GraphRow[] {
  /** the sha each column waits for, or null when free */
  const lanes: (string | null)[] = []
  const colors: number[] = []
  let nextColor = 0
  const rows: GraphRow[] = []

  const free = (): number => {
    const i = lanes.indexOf(null)
    return i === -1 ? lanes.length : i
  }
  const open = (col: number, sha: string): void => {
    lanes[col] = sha
    colors[col] = nextColor++ % LANE_COLORS
  }

  for (const commit of commits) {
    const waiting: number[] = []
    lanes.forEach((s, i) => s === commit.sha && waiting.push(i))
    const topWidth = lanes.length
    let col: number
    const into: GraphRow['into'] = waiting.map((from) => ({ from, color: colors[from] }))
    if (waiting.length) {
      col = waiting[0]
      for (const i of waiting.slice(1)) lanes[i] = null
    } else {
      col = free()
      open(col, commit.sha)
    }
    const color = colors[col]
    const through = lanes.flatMap((s, i) => (s !== null && i !== col && !waiting.includes(i) ? [{ col: i, color: colors[i] }] : []))

    const out: GraphRow['out'] = []
    const [first, ...rest] = commit.parents
    // the first parent always continues straight down, even when another lane already waits for it (a
    // branch that forked from it): both run on and meet at that commit, which takes the leftmost of them,
    // so the main line keeps its column instead of jumping right to where a branch was waiting
    if (first === undefined) lanes[col] = null
    else {
      lanes[col] = first
      out.push({ to: col, color })
    }
    for (const p of rest) {
      const existing = lanes.indexOf(p)
      if (existing !== -1) out.push({ to: existing, color: colors[existing] })
      else {
        const c = free()
        open(c, p)
        out.push({ to: c, color: colors[c] })
      }
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    const width = Math.max(topWidth, lanes.length, col + 1, ...out.map((o) => o.to + 1))
    rows.push({ commit, col, color, through, into, out, width })
  }
  return rows
}
