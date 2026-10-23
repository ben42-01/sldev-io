import type { ViewId } from '../state/workspace'

const PLANNED: Partial<Record<ViewId, string[]>> = {
  agents: ['Launch Claude Code missions (more agent CLIs later) from a prompt', 'Optional isolated git worktree per mission', 'Status: running · waiting for input · done · failed, with desktop notifications', 'Review the diff when a mission finishes'],
  skills: ['Lists skills from ~/.claude/skills, project .claude/skills and plugins', 'Create, edit, and run skills'],
  workflows: ['List GitHub Actions workflows via gh', 'Dispatch with inputs, watch runs live, re-run failed jobs, open logs'],
  notes: ['Markdown notes per project and global, stored as plain .md files', 'Send a note to an agent as a prompt'],
  remote: ['Saved SSH connections, jump hosts, ~/.ssh/config import', 'Reusable credentials (password, key, key + passphrase) in the OS keychain', 'Open remote terminals and browse remote files']
}

export function PlaceholderView({ view, title }: { view: ViewId; title: string }): React.JSX.Element {
  return (
    <div className="sidebar-body">
      <div className="sidebar-header">
        <span>{title}</span>
      </div>
      <div className="placeholder">
        <div className="badge">Coming soon</div>
        <ul>
          {(PLANNED[view] ?? []).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
