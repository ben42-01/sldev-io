/**
 * Failover: when an agent stops at its plan's usage limit, the work continues on another agent with a
 * handoff instead of waiting hours for the limit to reset. Which text means "limit" is per agent
 * (`usageLimit` in src/shared/agents.ts); this file is the agent-neutral part.
 */

/** Only the end of the output counts: a limit message is the last thing an agent prints. */
export const LIMIT_TAIL_LINES = 40

/** Terminal rows to read for that: the screen's empty rows below the cursor count as rows too. */
export const TAIL_ROWS = 200

/** The line that says the agent hit its limit, or null. Only the last lines are checked. */
export function limitLine(text: string, pattern: RegExp | undefined): string | null {
  if (!pattern || !text) return null
  const lines = text.split('\n').slice(-LIMIT_TAIL_LINES)
  for (let i = lines.length - 1; i >= 0; i--) if (pattern.test(lines[i])) return lines[i].trim().slice(0, 200)
  return null
}

/** The first agent in the user's order that is installed and isn't the one that stopped. */
export function nextAgent(order: string[], current: string, installed: (id: string) => boolean): string | undefined {
  return order.find((id) => id !== current && installed(id))
}

/** The same agent spec on another CLI: "Implementer@claude" → "Implementer@codex", "claude" → "codex". */
export function respec(spec: string, agent: string, agentIds: string[]): string {
  const [name, cli] = spec.split('@')
  if (cli) return `${name}@${agent}`
  return agentIds.includes(name) ? agent : `${name}@${agent}`
}

/** What the next agent is told: where the work stands and how to pick it up. */
export function failoverNote(prevAgent: string, tail: string, limit?: RegExp): string {
  // the limit line itself is left out: the next agent echoes its prompt, and that line would flag it too
  const lines = tail.trim().split('\n').slice(-30).map((l) => (limit?.test(l) ? '[usage limit message]' : l))
  const out = lines.join('\n').slice(-3000)
  return [
    `${prevAgent} stopped at its usage limit before finishing. Its work so far is in this folder, including uncommitted changes.`,
    'Before you continue, check where it stands: run `git status` and `git diff`, and read the files it touched. Then finish the task; do not start over.',
    out ? `Its last output:\n\`\`\`\n${out}\n\`\`\`` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The brief of the mission that takes over: the original task, the handoff, and the note above. */
export function failoverBrief(m: { title: string; brief?: string; prompt: string; handoff?: string }, prevAgent: string, tail: string, limit?: RegExp): string {
  return [`Continue the mission "${m.title}".`, failoverNote(prevAgent, tail, limit), `Original task:\n${(m.brief ?? m.prompt).trim()}`, m.handoff?.trim() ? `Notes from the reviewer:\n${m.handoff.trim()}` : '']
    .filter(Boolean)
    .join('\n\n')
}
