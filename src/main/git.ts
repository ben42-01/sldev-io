import { execFile } from 'child_process'

export function gitBranch(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 3000 }, (err, stdout) =>
      resolve(err ? null : stdout.trim() || null)
    )
  })
}
