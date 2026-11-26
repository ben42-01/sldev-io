import { resolveRun } from '@shared/factory'
import { CHECK_TAIL, endCheck, REVIEW_CHECK_TIMEOUT_MS, REVIEW_CHECKS } from '@shared/reviewChecks'
import { tailOutput } from '@shared/ship'
import type { ReviewCheck, ReviewChecks, ReviewTarget } from '@shared/types'
import { openTerminal } from '../dock/dockApi'
import { onTerminalEvent, stopTerminal, terminalInfo, terminalTail } from '../lib/terminals'
import { checkFolder, getReviewSource, patchReview } from './reviewTargets'
import { createStore } from './store'

/**
 * Run checks, from the review cockpit and only on its click: get the folder with exactly the code under review
 * (a PR's worktree at its head, a mission's folder), install its dependencies once if it's a worktree of its own,
 * then run the project's typecheck and test there, one after the other, each in its own terminal (the full log),
 * killed after the timeout. The result goes on the review, keyed by the commit, so a new one makes it stale.
 * Nothing is committed or pushed.
 */

/** the reviews (source keys) whose checks are running in this window */
export const runningChecks = createStore<{ keys: Record<string, true> }>({ keys: {} })

/** a check's output is still being written into xterm when the process exits */
const SETTLE_MS = 300

export async function runChecks(t: ReviewTarget, diff: string | undefined): Promise<void> {
  const src = getReviewSource(t)
  if (!src) throw new Error('That review is gone')
  const key = src.key
  if (runningChecks.get().keys[key]) return
  runningChecks.set((s) => ({ keys: { ...s.keys, [key]: true } }))
  const put = (c: ReviewChecks): void => patchReview(t, (r) => ({ ...r, checks: c }))
  let c: ReviewChecks = { head: src.head ?? '', diff, path: src.cwd, at: Date.now(), status: 'running', results: [], skipped: [] }
  try {
    put(c)
    const folder = await checkFolder(t)
    c = { ...c, head: folder.head, path: folder.path }
    const detected = await window.api.runtimes.detect(folder.path).catch(() => [])
    const refs = detected.map((d) => ({ name: d.name, command: d.command, rel: d.cwd === folder.path ? '' : d.cwd.slice(folder.path.length + 1) }))
    const results: ReviewCheck[] = []
    const skipped: string[] = []
    for (const entry of REVIEW_CHECKS) {
      const { command, skipped: none } = resolveRun([entry], refs)
      skipped.push(...none)
      if (command) results.push({ name: entry.replace(/\?$/, ''), command, status: 'waiting' })
    }
    c = { ...c, results, skipped }
    // once per worktree (a marker in its .sldev/runs), and never in the user's own checkout
    const setup = results.length && folder.worktree ? await window.api.factory.setupPlan(folder.path, undefined).catch(() => null) : null
    if (setup) {
      put((c = { ...c, setup: { command: setup, ok: true } }))
      const r = await window.api.factory.setup(folder.path, setup)
      c = { ...c, setup: { command: setup, ok: r.ok, ...(r.ok ? {} : { tail: tailOutput(r.log, CHECK_TAIL) }) } }
      if (!r.ok) return put((c = { ...c, status: 'done' }))
    }
    put(c)
    let ref: string | undefined
    for (let i = 0; i < c.results.length; i++) {
      const check = c.results[i]
      // the user may have closed the first one: then the next opens below the review again
      if (ref && !terminalInfo(ref)) ref = undefined
      const panelId = openTerminal({
        cwd: folder.path,
        title: `${check.name} · ${src.title}`.slice(0, 60),
        command: check.command,
        // test runners would otherwise wait in watch mode in a terminal
        env: { CI: '1' },
        ...(ref ? { referencePanel: ref } : { direction: 'below' as const })
      })
      if (!panelId) throw new Error('No dock to open the terminal in')
      ref ??= panelId
      put((c = withResult(c, i, { ...check, status: 'running', panelId })))
      const end = await commandEnd(panelId)
      put((c = withResult(c, i, endCheck({ ...check, panelId }, end))))
    }
    put((c = { ...c, status: 'done' }))
  } catch (e) {
    put({ ...c, status: 'done', error: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
  } finally {
    runningChecks.set((s) => {
      const keys = { ...s.keys }
      delete keys[key]
      return { keys }
    })
  }
}

const withResult = (c: ReviewChecks, i: number, r: ReviewCheck): ReviewChecks => ({ ...c, results: c.results.map((x, j) => (j === i ? r : x)) })

/** The command in terminal `id` exited, timed out (then it is stopped) or its terminal was closed. */
function commandEnd(id: string): Promise<{ code?: number | null; timedOut?: boolean; closed?: boolean; output?: string }> {
  return new Promise((done) => {
    let timedOut = false
    const finish = (end: { code?: number | null; closed?: boolean }): void => {
      off()
      window.clearTimeout(timer)
      window.setTimeout(() => done({ ...end, ...(timedOut ? { timedOut } : {}), output: end.closed ? '' : terminalTail(id, 200) }), SETTLE_MS)
    }
    const off = onTerminalEvent((e) => {
      if (e.id !== id) return
      if (e.type === 'status' && e.status === 'exited') finish({ code: e.exitCode ?? null })
      else if (e.type === 'closed') finish({ closed: true })
    })
    const timer = window.setTimeout(() => {
      timedOut = true
      if (terminalInfo(id)?.status === 'running') stopTerminal(id)
      else finish({ code: null })
    }, REVIEW_CHECK_TIMEOUT_MS)
  })
}
