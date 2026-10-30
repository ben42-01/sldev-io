/**
 * "Needs you" for agents without hooks: the approval prompt on their screen. Full-screen agents
 * (OpenCode, Codex, Gemini) draw a dialog and wait without a bell, so the bell alone misses them.
 * What a prompt looks like is per agent (`asks` in lib/agents.ts); this is the agent-neutral part.
 */

import { afterPrompt } from './screenReport'

/** A dialog sits near the bottom of the screen; older prompts scrolled up don't count. */
export const ASK_TAIL_LINES = 25

/** For custom agents and as a fallback: the usual shapes of a CLI asking for a yes. */
export const ASK_GENERIC =
  /\[y\/N\]|\(y\/n\)|Allow once|Yes, allow|Permission required|Allow (?:command|execution)|Do you want to (?:run|allow|proceed|make|edit|apply|create)|Would you like to (?:run|make|apply)/i

/**
 * The approval line on screen, or null: the first match near the bottom, which is the dialog's question
 * rather than its buttons. Only what came after the mission's prompt counts, so a prompt that mentions
 * "allow once" doesn't flag its own mission.
 */
export function askLine(screen: string, pattern: RegExp, prompt?: string): string | null {
  const text = prompt ? afterPrompt(screen, prompt) : screen
  const line = text.split('\n').slice(-ASK_TAIL_LINES).find((l) => pattern.test(l))
  // borders, markers and the selection arrow in front of the text
  return line ? line.replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}$[(]+/u, '').trim().slice(0, 200) : null
}
