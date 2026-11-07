import { spawn } from 'child_process'
import { promises as fsp } from 'fs'
import { basename, dirname, join, resolve } from 'path'

/** Eval files (.sldev/evals/*.yml) and the commands that check an attempt. Parsing is in src/shared/evals.ts. */

const evalsDir = (root: string): string => join(root, '.sldev', 'evals')

export async function listEvals(root: string): Promise<Array<{ path: string; text: string }>> {
  const dir = evalsDir(root)
  const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => /\.ya?ml$/.test(f)).sort()
  return Promise.all(files.map(async (f) => ({ path: join(dir, f), text: await fsp.readFile(join(dir, f), 'utf8') })))
}

/** A new eval file (never over an existing one); returns its path. */
export async function saveEval(root: string, slug: string, text: string): Promise<string> {
  const dir = evalsDir(root)
  await fsp.mkdir(dir, { recursive: true })
  const safe = slug.replace(/[^a-z0-9-]/g, '') || 'eval'
  let p = join(dir, `${safe}.yml`)
  for (let i = 2; await fsp.stat(p).then(() => true, () => false); i++) p = join(dir, `${safe}-${i}.yml`)
  await fsp.writeFile(p, text)
  return p
}

/** Only a .yml directly inside a project's .sldev/evals may be changed from the window. */
export async function writeEval(p: string, text: string): Promise<void> {
  const abs = resolve(p)
  if (!/\.ya?ml$/.test(abs) || basename(dirname(abs)) !== 'evals' || basename(dirname(dirname(abs))) !== '.sldev') throw new Error('Not an eval file')
  await fsp.writeFile(abs, text)
}

const promptsDir = (root: string): string => join(evalsDir(root), 'prompts')

/** Prompt variants: Markdown files whose text goes before an eval's brief, to compare instructions. */
export async function listPrompts(root: string): Promise<Array<{ path: string; name: string; text: string }>> {
  const dir = promptsDir(root)
  const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => /\.md$/.test(f)).sort()
  return Promise.all(files.map(async (f) => ({ path: join(dir, f), name: f.replace(/\.md$/, ''), text: await fsp.readFile(join(dir, f), 'utf8') })))
}

export async function savePrompt(root: string, slug: string, text: string): Promise<string> {
  const dir = promptsDir(root)
  await fsp.mkdir(dir, { recursive: true })
  const safe = slug.replace(/[^a-z0-9-]/g, '') || 'prompt'
  let p = join(dir, `${safe}.md`)
  for (let i = 2; await fsp.stat(p).then(() => true, () => false); i++) p = join(dir, `${safe}-${i}.md`)
  await fsp.writeFile(p, text)
  return p
}

export interface CheckRun {
  code: number | null
  output: string
  timedOut?: boolean
}

/**
 * Runs one check command in an attempt's worktree through the platform shell, like a task, and
 * returns its exit code and the end of its output. Killed after `timeoutMs`.
 */
export function runCheck(cwd: string, command: string, timeoutMs: number): Promise<CheckRun> {
  return new Promise((done) => {
    // its own process group on Unix, so a timeout kills what the shell started too
    const child = spawn(command, { cwd, shell: true, detached: process.platform !== 'win32', env: { ...process.env, CI: '1' }, windowsHide: true })
    let out = ''
    const keep = (b: Buffer): void => {
      out = (out + b.toString()).slice(-64_000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      done({ code: null, output: `${out}${e.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ code, output: out, timedOut: timedOut || undefined })
    })
  })
}
