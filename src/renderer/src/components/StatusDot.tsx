import type { Run } from '../state/runs'

// Ctrl+C (SIGINT) exits: 130 on POSIX shells, STATUS_CONTROL_C_EXIT on Windows. Shown as "stopped", not failed.
const INTERRUPTED = new Set([130, 0xc000013a, -1073741510])

export function StatusDot({ run }: { run: Run | undefined }): React.JSX.Element {
  let cls = 'idle'
  let title = 'Not running'
  if (run?.status === 'running') [cls, title] = ['running', 'Running']
  else if (run?.status === 'starting') [cls, title] = ['starting', 'Starting']
  else if (run?.status === 'exited' && run.exitCode !== undefined && run.exitCode !== 0 && !INTERRUPTED.has(run.exitCode)) [cls, title] = ['failed', `Exited with code ${run.exitCode}`]
  else if (run?.status === 'exited') [cls, title] = ['done', run.exitCode === 0 ? 'Finished' : 'Stopped']
  return <span className={`status-dot ${cls}`} title={title} />
}
