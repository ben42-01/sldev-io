/**
 * The opening prompt of a mission started from the New mission form, and the briefs of the
 * missions that continue one (follow-up, second opinion). The closing lines are deliberate: they
 * make the agent's last reply a usable report, which becomes the handoff to whoever comes next.
 */

import { BUILTIN_KINDS, DEFAULT_KIND, findKind, renderKind, type MissionKind } from './missionKinds'

export const REPORT_LIMIT = 6000

/** A mission's first message; without a kind it is a Build mission. */
export function missionPrompt(o: { title: string; brief: string; criteria?: string }, kind: Pick<MissionKind, 'template'> = findKind(BUILTIN_KINDS, DEFAULT_KIND)): string {
  return renderKind(kind, o)
}

/** What the next agent gets from a finished mission: the human's notes win over the agent's own report. */
export function handoffText(m: { handoff?: string; report?: string; reportFrom?: 'terminal'; lastMessage?: string }): string {
  if (m.handoff?.trim()) return `Handoff notes from the reviewer:\n${m.handoff.trim()}`
  const report = m.report?.trim() || m.lastMessage?.trim()
  if (report && m.report?.trim() && m.reportFrom === 'terminal') return `The previous agent's terminal when it finished (it wrote no report):\n${report}`
  if (report) return `Final report from the previous agent:\n${report}`
  return 'No handoff notes were recorded.'
}

interface Previous {
  title: string
  brief?: string
  prompt: string
  criteria?: string
  handoff?: string
  report?: string
  reportFrom?: 'terminal'
  lastMessage?: string
}

const originalTask = (m: Previous): string => (m.brief ?? m.prompt).trim()

/** Continue a mission's work in the same folder with a new instruction. */
export function followUpBrief(m: Previous, next: string): string {
  return [next.trim(), `This continues the mission "${m.title}". Its work is already in this folder.`, `Original task:\n${originalTask(m)}`, handoffText(m)].join('\n\n')
}

/** A second agent reviews a mission's changes without editing anything. */
export function secondOpinionBrief(m: Previous, agentName: string, base: string): string {
  return [
    `Review the work ${agentName} did for the mission "${m.title}": run \`git diff ${base}\` and look at untracked files too.`,
    `Original task:\n${originalTask(m)}`,
    ...(m.criteria?.trim() ? [`Acceptance criteria:\n${m.criteria.trim()}`] : []),
    handoffText(m),
    'List your findings, most important first, and say whether the acceptance criteria are met. Do not edit any files.'
  ].join('\n\n')
}

export function clipReport(text: string): string {
  return text.length > REPORT_LIMIT ? `${text.slice(0, REPORT_LIMIT)}\n[truncated]` : text
}
