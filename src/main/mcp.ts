import { promises as fsp } from 'fs'
import { isAbsolute, join, relative, resolve } from 'path'
import type { McpEvent, Mission } from '@shared/types'
import { boardCardLines, storyDraft, type BoardColumn, type BoardItem } from '@shared/board'
import { diff } from './git'
import { remember } from './memory'
import { recall } from './context'
import { normalizePath, recallText } from '@shared/context'
import { checkSkillFile, checkText, DRAFTS_DIR } from '@shared/sldevSkills'

/** Tool calls from the sldev MCP server, answered here; status, output and done also go to the window. */

export interface McpRequest {
  mission: string
  tool: string
  args: Record<string, unknown>
  cwd: string
}

export interface McpDeps {
  missions: () => Mission[]
  send: (e: McpEvent) => void
  /** the app's work board; the CLI has none */
  board?: () => BoardItem[]
  /** Lead tools (sldev_delegate, wait, followup, integrate), answered by the window; the CLI has none */
  lead?: (r: McpRequest) => Promise<{ text?: string; error?: string }>
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** A path from an agent: absolute in its worktree or the project, or already relative. */
const projectPath = (self: Mission, p: string): string | undefined => normalizePath(p, self.cwd) ?? normalizePath(p, self.root)

export async function handleMcp(r: McpRequest, deps: McpDeps): Promise<{ text?: string; error?: string }> {
  const all = deps.missions()
  const self = all.find((m) => m.id === r.mission)
  if (!self) return { error: 'This session was not started by sldev-io, so it has no mission to report to.' }
  switch (r.tool) {
    case 'sldev_status': {
      const state = str(r.args.state)
      if (!['working', 'needs_input', 'done'].includes(state)) return { error: 'state must be working, needs_input or done' }
      deps.send({ mission: self.id, type: 'status', state: state as 'working' | 'needs_input' | 'done', text: str(r.args.message).slice(0, 600) || undefined })
      return { text: 'Status updated.' }
    }
    case 'sldev_output': {
      const markdown = str(r.args.markdown)
      if (!markdown.trim()) return { error: 'markdown is empty' }
      deps.send({ mission: self.id, type: 'output', text: markdown.slice(0, 200_000) })
      return { text: 'Saved.' }
    }
    case 'sldev_done':
      deps.send({ mission: self.id, type: 'done', text: str(r.args.summary).slice(0, 2000) || undefined })
      return { text: 'Marked as done. You can stop now.' }
    case 'sldev_missions': {
      const mine = all.filter((m) => m.root === self.root && m.id !== self.id).slice(0, 50)
      if (!mine.length) return { text: 'No other missions in this project.' }
      return { text: mine.map((m) => `${m.id} · ${m.options.agent ?? 'claude'} · ${m.status} · ${m.worktree?.branch ?? 'in place'} · ${m.title}`).join('\n') }
    }
    case 'sldev_mission_diff': {
      const m = all.find((x) => x.id === str(r.args.id) && x.root === self.root)
      if (!m) return { error: 'No mission with that id in this project. Use sldev_missions.' }
      const d = await diff(m.cwd, m.worktree?.base ?? m.baseCommit ?? 'HEAD').catch((e: Error) => `Could not read the diff: ${e.message}`)
      return { text: d.length > 60_000 ? `${d.slice(0, 60_000)}\n… diff cut at 60k characters` : d || 'No changes.' }
    }
    case 'sldev_remember': {
      const note = str(r.args.note)
      if (!note.trim()) return { error: 'note is empty' }
      const paths = Array.isArray(r.args.paths) ? r.args.paths.map((p) => (typeof p === 'string' ? projectPath(self, p) : undefined)).filter((p): p is string => !!p).slice(0, 12) : []
      await remember(self.root, note, `${self.options.agent ?? 'claude'}, mission "${self.title}"`, paths)
      return { text: 'Saved to the project memory.' }
    }
    case 'sldev_recall': {
      const query = str(r.args.query).slice(0, 500)
      const path = str(r.args.path).slice(0, 300)
      if (!query.trim() && !path.trim()) return { error: 'Give a query, a path, or both' }
      const { hits, related } = await recall(self.root, { query, path: path ? (projectPath(self, path) ?? path) : undefined })
      return { text: recallText(hits, self.root, related) }
    }
    case 'sldev_board': {
      if (!deps.board) return { error: 'The work board lives in the sldev-io app; this session has none.' }
      const column = str(r.args.column) as BoardColumn
      return { text: boardCardLines(deps.board().filter((i) => i.root === self.root), column || undefined) }
    }
    case 'sldev_board_add': {
      if (!deps.board) return { error: 'The work board lives in the sldev-io app; this session has none.' }
      const card = storyDraft(r.args)
      if (!card) return { error: 'title is empty' }
      const agent = self.options.agent ?? 'claude'
      // stories it was asked to write carry no footer; follow-up work it found says where it came from
      const footer = self.kind?.id === 'stories' ? '' : `Filed by ${agent} during mission "${self.title}".`
      deps.send({ mission: self.id, type: 'board-add', card: { title: card.title, body: [card.details, footer].filter(Boolean).join('\n\n'), labels: card.labels, priority: card.priority, after: card.after } })
      return { text: `Filed "${card.title}" in Proposed.` }
    }
    case 'sldev_board_update': {
      if (!deps.board) return { error: 'The work board lives in the sldev-io app; this session has none.' }
      const key = Number(r.args.key)
      const target = deps.board().find((i) => i.root === self.root && i.key === key)
      if (!target) return { error: `No card #${key} on this project's board. Use sldev_board.` }
      if (target.column !== 'backlog' && target.column !== 'proposed') return { error: `#${key} is in ${target.column}: only cards in Backlog or Proposed can be rewritten.` }
      const card = storyDraft(r.args)
      if (!card) return { error: 'title is empty' }
      deps.send({ mission: self.id, type: 'board-update', key, card: { title: card.title, body: card.details, labels: card.labels, priority: card.priority, after: card.after } })
      return { text: `Rewrote #${key}; it waits in Proposed for approval.` }
    }
    case 'sldev_delegate':
    case 'sldev_wait':
    case 'sldev_followup':
    case 'sldev_integrate': {
      if (!deps.lead) return { error: 'Lead missions live in the sldev-io app; this session cannot delegate.' }
      if (self.kind?.id !== 'lead') return { error: 'Only a Lead mission can delegate. Workers do their own part and report back.' }
      return deps.lead(r)
    }
    case 'sldev_rules': {
      for (const f of ['.sldev/rules.md', 'AGENTS.md']) {
        const text = await fsp.readFile(join(self.root, f), 'utf8').catch(() => null)
        if (text) return { text }
      }
      return { text: 'This project has no agent rules yet.' }
    }
    case 'sldev_check': {
      const given = str(r.args.path).trim()
      if (!given) return { error: 'Give the path of the file you wrote' }
      const file = isAbsolute(given) ? given : resolve(self.cwd, given)
      const src = await fsp.readFile(file, 'utf8').catch(() => null)
      if (src === null) return { error: `Could not read ${file}. Did you write it?` }
      const c = checkSkillFile(file, src)
      let text = checkText(given, c)
      // the app takes drafts in from the project root only: one left in a worktree is never seen
      const drafts = join(self.root, ...DRAFTS_DIR.split('/'))
      const rel = relative(drafts, resolve(file, '..'))
      if ((c.kind === 'mission' || c.kind === 'stories') && rel !== '') text += `\nBut: sldev-io reads drafts from ${drafts}, not from where this file is. Move it there.`
      return { text }
    }
  }
  return { error: `Unknown tool ${r.tool}` }
}
