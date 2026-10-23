import { promises as fsp } from 'fs'
import { join } from 'path'
import { parse as parseYaml } from 'yaml'
import type { GhPr, GhRepoInfo, GhRun, GhWorkflow, GhWorkflowInput } from '@shared/types'
import { run } from './git'

const gh = (args: string[], cwd: string, timeout = 30000): ReturnType<typeof run> => run('gh', args, cwd, timeout)

async function ghJson<T>(args: string[], cwd: string): Promise<T> {
  const r = await gh(args, cwd)
  if (r.code !== 0) throw new Error(r.stderr.trim() || `gh ${args.join(' ')} failed`)
  return JSON.parse(r.stdout) as T
}

export async function repoInfo(cwd: string): Promise<GhRepoInfo> {
  const auth = await gh(['auth', 'status'], cwd)
  if (auth.code !== 0) {
    const missing = /ENOENT|not found/i.test(auth.stderr)
    return { authed: false, repo: null, url: null, defaultBranch: null, error: missing ? 'The GitHub CLI (gh) is not installed.' : 'Not logged in to GitHub. Run `gh auth login`.' }
  }
  try {
    const r = await ghJson<{ nameWithOwner: string; url: string; defaultBranchRef: { name: string } | null }>(['repo', 'view', '--json', 'nameWithOwner,url,defaultBranchRef'], cwd)
    return { authed: true, repo: r.nameWithOwner, url: r.url, defaultBranch: r.defaultBranchRef?.name ?? null }
  } catch (e) {
    return { authed: true, repo: null, url: null, defaultBranch: null, error: 'This folder is not a GitHub repository.' + (e instanceof Error ? ` (${e.message.split('\n')[0]})` : '') }
  }
}

export const listWorkflows = (cwd: string): Promise<GhWorkflow[]> => ghJson(['workflow', 'list', '--all', '--json', 'id,name,path,state'], cwd)

export const listRuns = (cwd: string, workflow?: string): Promise<GhRun[]> =>
  ghJson(['run', 'list', '--limit', '30', ...(workflow ? ['--workflow', workflow] : []), '--json', 'databaseId,displayTitle,workflowName,status,conclusion,headBranch,event,createdAt,url,number'], cwd)

/** Inputs declared under `on.workflow_dispatch.inputs` in the local workflow file. null = not dispatchable. */
export async function workflowInputs(cwd: string, path: string): Promise<GhWorkflowInput[] | null> {
  const text = await fsp.readFile(join(cwd, path), 'utf8').catch(() => null)
  if (!text) return null
  let doc: Record<string | number, unknown>
  try {
    doc = parseYaml(text) ?? {}
  } catch {
    return null
  }
  const on = (doc.on ?? doc['true']) as unknown
  if (on === 'workflow_dispatch' || (Array.isArray(on) && on.includes('workflow_dispatch'))) return []
  const wd = on && typeof on === 'object' && !Array.isArray(on) ? (on as Record<string, unknown>).workflow_dispatch : undefined
  if (wd === undefined) return null
  const inputs = (wd && typeof wd === 'object' ? (wd as Record<string, unknown>).inputs : null) as Record<string, Record<string, unknown>> | null
  return Object.entries(inputs ?? {}).map(([name, v]) => ({
    name,
    description: typeof v?.description === 'string' ? v.description : undefined,
    required: !!v?.required,
    default: v?.default !== undefined ? String(v.default) : undefined,
    type: typeof v?.type === 'string' ? v.type : 'string',
    options: Array.isArray(v?.options) ? v.options.map(String) : undefined
  }))
}

export async function dispatchWorkflow(cwd: string, id: number, ref: string, inputs: Record<string, string>): Promise<void> {
  const args = ['workflow', 'run', String(id), '--ref', ref]
  for (const [k, v] of Object.entries(inputs)) if (v !== '') args.push('-f', `${k}=${v}`)
  const r = await gh(args, cwd)
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'gh workflow run failed')
}

export async function rerun(cwd: string, runId: number, failedOnly: boolean): Promise<void> {
  const r = await gh(['run', 'rerun', String(runId), ...(failedOnly ? ['--failed'] : [])], cwd)
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'gh run rerun failed')
}

export async function cancelRun(cwd: string, runId: number): Promise<void> {
  const r = await gh(['run', 'cancel', String(runId)], cwd)
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'gh run cancel failed')
}

export async function currentPr(cwd: string): Promise<GhPr | null> {
  const r = await gh(['pr', 'view', '--json', 'number,title,state,url,isDraft,statusCheckRollup'], cwd)
  if (r.code !== 0) return null
  const pr = JSON.parse(r.stdout)
  const checks = { passed: 0, failed: 0, pending: 0 }
  for (const c of pr.statusCheckRollup ?? []) {
    const v = String(c.conclusion || c.state || c.status || '').toUpperCase()
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(v)) checks.passed++
    else if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(v)) checks.failed++
    else checks.pending++
  }
  return { number: pr.number, title: pr.title, state: pr.state, url: pr.url, isDraft: pr.isDraft, checks }
}
