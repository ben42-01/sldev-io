/**
 * The report of an agent that doesn't report back (no hooks, no sldev_done call): its terminal
 * screen when it went quiet or exited. Full-screen agents draw panels with box characters, so
 * those are stripped and the blank space they leave is collapsed; what remains is its last reply,
 * with whatever else was on screen.
 */

import { clipReport } from './missionPrompt'

/** Lines of the screen kept: the end of the reply matters more than the start of the scrollback. */
export const SCREEN_REPORT_LINES = 80

// box drawing, block elements and the braille spinners TUIs draw with
const CHROME = /[─-▟⠀-⣿]/g

/**
 * The screen after the agent's prompt: agents echo it (and sldev-io shows the command line first),
 * so the reply starts below its last appearance. The terminal wraps lines anywhere, so the match
 * ignores whitespace. Unchanged when the prompt isn't on screen any more.
 */
export function afterPrompt(screen: string, prompt: string): string {
  const tail = prompt.replace(/\s+/g, '').slice(-60)
  if (tail.length < 12) return screen
  const lines = screen.split('\n')
  const flat = lines.map((l) => l.replace(/\s+/g, ''))
  const at = flat.join('').lastIndexOf(tail)
  if (at < 0) return screen
  const end = at + tail.length
  let seen = 0
  for (let i = 0; i < lines.length; i++) {
    seen += flat[i].length
    if (seen >= end) return lines.slice(i + 1).join('\n')
  }
  return screen
}

export function screenReport(screen: string, prompt?: string): string {
  const lines = (prompt ? afterPrompt(screen.replace(CHROME, ' '), prompt) : screen)
    .split('\n')
    .map((l) => l.replace(CHROME, ' ').replace(/\s+$/, ''))
    // side-by-side panels leave long runs of spaces; keep the text, not the layout
    .map((l) => l.replace(/ {4,}/g, '   '))
  const out: string[] = []
  for (const l of lines) {
    if (!l.trim()) {
      if (out.length && out[out.length - 1] !== '') out.push('')
      continue
    }
    out.push(l)
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  const kept = out.slice(-SCREEN_REPORT_LINES)
  // a common indent (a panel's left border) is noise too
  const indent = Math.min(...kept.filter(Boolean).map((l) => l.length - l.trimStart().length))
  return clipReport(kept.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n').trim())
}
