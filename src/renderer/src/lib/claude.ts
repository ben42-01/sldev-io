import type { ClaudeTaskOptions } from '@shared/types'
import { shellQuote } from './paths'

/** Build a `claude …` command line. Kept in one place so tasks, missions and previews agree. */
export function claudeCommand(
  o: ClaudeTaskOptions,
  prompt: string | undefined,
  name: string | undefined,
  extra: { settingsPath?: string; resume?: string } = {}
): string {
  const parts = ['claude']
  if (extra.settingsPath) parts.push('--settings', shellQuote(extra.settingsPath))
  if (extra.resume) parts.push('--resume', shellQuote(extra.resume))
  if (o.print && !extra.resume) parts.push('-p')
  if (o.model) parts.push('--model', shellQuote(o.model))
  if (o.permissionMode) parts.push('--permission-mode', o.permissionMode)
  if (o.effort) parts.push('--effort', o.effort)
  if (!o.print && name && !extra.resume) parts.push('-n', shellQuote(name))
  if (o.extraArgs?.trim()) parts.push(o.extraArgs.trim())
  if (prompt?.trim() && !extra.resume) parts.push(shellQuote(prompt.trim()))
  return parts.join(' ')
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'mission'
}
