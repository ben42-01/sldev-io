import type { GitStatus } from '@shared/types'

/** What the Git view and its toasts say; pure, so it is unit-tested. */

const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`

/** The toast after a fetch, from the status read right after it. */
export function fetchOutcome(after: GitStatus | null): string {
  if (!after?.upstream) return 'Fetched'
  if (after.behind) return `Fetched · ${plural(after.behind, 'new commit')} to pull from ${after.upstream}`
  return `Fetched · up to date with ${after.upstream}`
}

/** The toast after a fast-forward pull; `behindBefore` is how far behind the branch was before it. */
export function pullOutcome(output: string, behindBefore: number, upstream: string | null): string {
  if (/already up.to.date/i.test(output) || !behindBefore) return 'Already up to date'
  return `Pulled ${plural(behindBefore, 'commit')}${upstream ? ` from ${upstream}` : ''}`
}

/** The line of git's error worth a toast ("fatal: Not possible to fast-forward, aborting." → that sentence); the view shows the whole message. */
export function gitErrorLine(message: string): string {
  const lines = message.split('\n').map((l) => l.trim()).filter(Boolean)
  const line = lines.find((l) => /^(fatal|error):/i.test(l)) ?? lines.find((l) => !/^hint:/i.test(l)) ?? lines[0] ?? 'git failed'
  return line.replace(/^(fatal|error):\s*/i, '')
}

/** "2 staged · 1 modified · 3 untracked · 1 conflict", or null when the working tree is clean. */
export function changeSummary(s: GitStatus): string | null {
  const parts = [
    s.conflicted && plural(s.conflicted, 'conflict'),
    s.staged && `${s.staged} staged`,
    s.unstaged && `${s.unstaged} modified`,
    s.untracked && `${s.untracked} untracked`
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}
