import type { GhPrComment } from './types'

/** The number at the end of a pull request URL (what `gh pr create` prints). */
export function prNumber(url: string): number | null {
  const m = /\/pull\/(\d+)\/?$/.exec(url.trim())
  return m ? Number(m[1]) : null
}

/** Comments written after the last time an agent was given them, oldest first. */
export function unaddressed(comments: GhPrComment[], since: number | undefined): GhPrComment[] {
  return comments.filter((c) => c.body.trim() && (!since || Date.parse(c.createdAt) > since)).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

/** The prompt for the agent that addresses review feedback; agent-agnostic, plain text. */
export function feedbackPrompt(intent: string, pr: number, comments: GhPrComment[]): string {
  const list = comments.map((c, i) => {
    const where = c.path ? ` on ${c.path}${c.line ? `:${c.line}` : ''}` : ''
    return `${i + 1}. ${c.author}${where}:\n${c.body.trim().replace(/^/gm, '   ')}`
  })
  return [
    `Pull request #${pr} ("${intent}") got review feedback. Address each comment below in this worktree.`,
    'Change the code where a comment asks for it; if you disagree with one, leave the code and explain why in your final message.',
    'Commit when done. Do not push: the user pushes the update.',
    '',
    ...list
  ].join('\n')
}
