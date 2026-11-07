import { parse } from 'yaml'

/**
 * Evals: small, repeatable tasks with checks, run against agents (and models) to see which does the
 * work best on this repository. An eval is a YAML file in `.sldev/evals/`: a brief, the commit to start
 * from, and checks (commands that must pass, output they must print, a limit on the diff, and an
 * optional judge agent with a rubric). Each attempt runs in its own worktree, like a factory run, and
 * nothing is pushed. This file is the pure part: the format, how a check passes, and the scoreboard.
 */

export type EvalCheck =
  | { type: 'run'; command: string; expect?: string }
  | { type: 'diff'; maxLines: number }
  | { type: 'judge'; rubric: string }

export interface EvalSpec {
  name: string
  description?: string
  brief: string
  /** branch or commit to start from; empty = the project's HEAD when the suite starts */
  base?: string
  /** installs dependencies in the attempt's worktree; default: the factory's detection */
  setup?: string
  /** minutes the agent gets before the attempt is stopped */
  timeout: number
  checks: EvalCheck[]
  /** the file it came from */
  path?: string
}

export const DEFAULT_TIMEOUT = 20

/** Reads an eval file. Errors say what's wrong in words the file's author can fix. */
export function parseEval(text: string, path?: string): { spec?: EvalSpec; error?: string } {
  let raw: unknown
  try {
    raw = parse(text)
  } catch (e) {
    return { error: `Not valid YAML: ${(e as Error).message.split('\n')[0]}` }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'An eval is a YAML mapping with name, brief and checks' }
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  const brief = typeof r.brief === 'string' ? r.brief.trim() : ''
  if (!name) return { error: 'name is missing' }
  if (!brief) return { error: 'brief is missing: what the agent is asked to do' }
  if (!Array.isArray(r.checks) || !r.checks.length) return { error: 'checks is missing: at least one way to tell a good result from a bad one' }
  const checks: EvalCheck[] = []
  for (const [n, c] of r.checks.entries()) {
    const at = `check ${n + 1}`
    if (typeof c === 'string') {
      checks.push({ type: 'run', command: c })
      continue
    }
    if (!c || typeof c !== 'object') return { error: `${at}: use run, diff or judge` }
    const o = c as Record<string, unknown>
    if (typeof o.run === 'string' && o.run.trim()) checks.push({ type: 'run', command: o.run.trim(), expect: o.expect === undefined ? undefined : String(o.expect) })
    else if (o.diff !== undefined) {
      const max = typeof o.diff === 'number' ? o.diff : Number((o.diff as Record<string, unknown>)?.max_lines)
      if (!Number.isFinite(max) || max <= 0) return { error: `${at}: diff takes the most changed lines allowed, e.g. diff: 80` }
      checks.push({ type: 'diff', maxLines: Math.round(max) })
    } else if (typeof o.judge === 'string' && o.judge.trim()) checks.push({ type: 'judge', rubric: o.judge.trim() })
    else return { error: `${at}: use run (a command), diff (most changed lines) or judge (a rubric)` }
  }
  const timeout = r.timeout === undefined ? DEFAULT_TIMEOUT : Number(r.timeout)
  if (!Number.isFinite(timeout) || timeout <= 0) return { error: 'timeout is in minutes, e.g. timeout: 20' }
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined)
  return { spec: { name, description: str(r.description), brief, base: str(r.base), setup: str(r.setup), timeout, checks, path } }
}

/** A starting point for a new eval file. */
export function evalTemplate(name = 'My first eval', brief = 'Describe the task exactly as you would give it to an agent.'): string {
  const indent = brief.trim().split('\n').map((l) => `  ${l}`).join('\n')
  return [
    `name: ${JSON.stringify(name)}`,
    'description: What this eval tells you about an agent',
    'brief: |',
    indent,
    '# base: main          # a branch or commit to start from (default: HEAD when the suite starts)',
    '# setup: npm ci       # dependencies (default: detected, like factory runs)',
    'timeout: 20           # minutes before the attempt is stopped',
    'checks:',
    '  - run: npm test     # must exit 0',
    '  # - run: node scripts/check.js',
    '  #   expect: ok      # and print this',
    '  # - diff: 120       # at most this many changed lines',
    '  # - judge: The change keeps the public API and adds a test for the bug.',
    ''
  ].join('\n')
}

export const slugifyEval = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'eval'

// ── contestants and attempts ─────────────────────────────────────────

/** who takes the eval: an agent, optionally with a model */
export interface Contestant {
  agent: string
  model?: string
}

export const contestantKey = (c: Contestant): string => (c.model ? `${c.agent}/${c.model}` : c.agent)

export interface CheckResult {
  /** what was checked, in words: "npm test", "diff ≤ 80 lines", "judge" */
  label: string
  ok: boolean
  /** the end of the output, or why it failed */
  detail?: string
}

export type AttemptStatus = 'queued' | 'running' | 'checking' | 'passed' | 'failed' | 'error' | 'stopped'

export interface EvalAttempt {
  id: string
  eval: string
  contestant: Contestant
  status: AttemptStatus
  /** the agent's mission, and the worktree it worked in */
  mission?: string
  worktree?: { path: string; branch: string; base: string; repo: string }
  checks: CheckResult[]
  startedAt?: number
  /** how long the agent took (checks not included) */
  agentMs?: number
  diff?: { files: number; lines: number }
  /** why it couldn't run (setup failed, timed out, the agent crashed) */
  note?: string
}

export interface EvalRun {
  id: string
  root: string
  /** the evals as they were when the run started */
  specs: EvalSpec[]
  contestants: Contestant[]
  /** attempts per eval and contestant: agents aren't deterministic */
  repeat: number
  /** the commit HEAD was on when it started, the default base */
  head: string
  attempts: EvalAttempt[]
  /** how many attempts run at once */
  parallel: number
  createdAt: number
  finishedAt?: number
  /** a restart stops what was running; the user starts a new run */
  stopped?: boolean
}

/** Every attempt of a run, eval by eval, contestant by contestant, in the order they run. */
export function plannedAttempts(specs: EvalSpec[], contestants: Contestant[], repeat: number, newId: () => string): EvalAttempt[] {
  const out: EvalAttempt[] = []
  // round by round, so an early stop still gives every contestant a fair share
  for (let r = 0; r < repeat; r++)
    for (const s of specs)
      for (const c of contestants) out.push({ id: newId(), eval: s.name, contestant: c, status: 'queued', checks: [] })
  return out
}

export const attemptDone = (a: EvalAttempt): boolean => a.status === 'passed' || a.status === 'failed' || a.status === 'error' || a.status === 'stopped'

/** The attempts to start now: queued ones, as many as the run's limit leaves room for. */
export function nextAttempts(run: EvalRun): EvalAttempt[] {
  if (run.stopped) return []
  const busy = run.attempts.filter((a) => a.status === 'running' || a.status === 'checking').length
  return run.attempts.filter((a) => a.status === 'queued').slice(0, Math.max(0, run.parallel - busy))
}

/** A command check: exit 0, and the expected text in its output when there is one. */
export function runCheckResult(check: Extract<EvalCheck, { type: 'run' }>, r: { code: number | null; output: string; timedOut?: boolean }): CheckResult {
  const label = check.expect ? `${check.command} → “${check.expect}”` : check.command
  const tail = r.output.trim().split('\n').slice(-12).join('\n').slice(-1500)
  if (r.timedOut) return { label, ok: false, detail: `Timed out\n${tail}` }
  if (r.code !== 0) return { label, ok: false, detail: `Exited with ${r.code ?? 'a signal'}\n${tail}` }
  if (check.expect && !r.output.includes(check.expect)) return { label, ok: false, detail: `“${check.expect}” is not in the output\n${tail}` }
  return { label, ok: true, detail: tail || undefined }
}

export function diffCheckResult(check: Extract<EvalCheck, { type: 'diff' }>, stat: { files: number; lines: number }): CheckResult {
  return { label: `diff ≤ ${check.maxLines} lines`, ok: stat.lines <= check.maxLines && stat.lines > 0, detail: stat.lines ? `${stat.lines} lines in ${stat.files} file${stat.files === 1 ? '' : 's'}` : 'No changes' }
}

/** What the judge agent is told: read the diff against the rubric, and write a verdict to a file. */
export function judgePrompt(spec: Pick<EvalSpec, 'brief'>, rubric: string, base: string, file: string): string {
  return [
    'Judge: does this change meet the rubric?',
    `Another agent was given this task:\n\n${spec.brief.trim()}`,
    `Its work is the diff from ${base} to the current state of this folder (git diff ${base}). Read the diff and whatever code you need. Do not change any files except the verdict below.`,
    `Rubric:\n${rubric.trim()}`,
    `Write your verdict to ${file}: the first line is exactly VERDICT: PASS or VERDICT: FAIL, then two or three lines of reasons. Pass only if every point of the rubric is met.`
  ].join('\n\n')
}

export function judgeResult(text: string | null): CheckResult {
  const m = text ? /VERDICT:\s*(PASS|FAIL)/i.exec(text) : null
  if (!m) return { label: 'judge', ok: false, detail: text ? 'The judge gave no verdict' : 'The judge wrote nothing' }
  const reasons = text!.slice(m.index + m[0].length).trim().split('\n').slice(0, 4).join('\n')
  return { label: 'judge', ok: m[1].toUpperCase() === 'PASS', detail: reasons || undefined }
}

/** Passed only when every check passed. */
export const attemptStatus = (checks: CheckResult[]): 'passed' | 'failed' => (checks.length && checks.every((c) => c.ok) ? 'passed' : 'failed')

// ── the scoreboard ───────────────────────────────────────────────────

export interface Score {
  key: string
  contestant: Contestant
  /** finished attempts (an error counts as a fail; stopped ones don't count) */
  attempts: number
  passed: number
  /** checks passed over checks run: partial credit */
  checkRate: number
  /** median agent time and diff size of the attempts that got that far */
  medianMs?: number
  medianLines?: number
  /** per eval: passed / attempts */
  byEval: Record<string, { passed: number; attempts: number }>
}

const median = (xs: number[]): number | undefined => {
  if (!xs.length) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

/**
 * One row per contestant, best first: pass rate, then partial credit (checks passed), then speed.
 * Works over one run or many (the project's leaderboard).
 */
export function scoreboard(attempts: EvalAttempt[]): Score[] {
  const rows = new Map<string, { c: Contestant; list: EvalAttempt[] }>()
  for (const a of attempts) {
    if (a.status !== 'passed' && a.status !== 'failed' && a.status !== 'error') continue
    const k = contestantKey(a.contestant)
    if (!rows.has(k)) rows.set(k, { c: a.contestant, list: [] })
    rows.get(k)!.list.push(a)
  }
  const scores = [...rows].map(([key, { c, list }]): Score => {
    const checks = list.flatMap((a) => a.checks)
    const byEval: Score['byEval'] = {}
    for (const a of list) {
      const e = (byEval[a.eval] ??= { passed: 0, attempts: 0 })
      e.attempts++
      if (a.status === 'passed') e.passed++
    }
    return {
      key,
      contestant: c,
      attempts: list.length,
      passed: list.filter((a) => a.status === 'passed').length,
      checkRate: checks.length ? checks.filter((x) => x.ok).length / checks.length : 0,
      medianMs: median(list.map((a) => a.agentMs).filter((x): x is number => x !== undefined)),
      medianLines: median(list.map((a) => a.diff?.lines).filter((x): x is number => x !== undefined)),
      byEval
    }
  })
  const rate = (s: Score): number => (s.attempts ? s.passed / s.attempts : 0)
  return scores.sort((a, b) => rate(b) - rate(a) || b.checkRate - a.checkRate || (a.medianMs ?? Infinity) - (b.medianMs ?? Infinity) || a.key.localeCompare(b.key))
}

/** "2/3" and a tone for a cell of the matrix */
export function cellTone(c: { passed: number; attempts: number } | undefined): 'done' | 'attention' | 'error' | 'neutral' {
  if (!c || !c.attempts) return 'neutral'
  return c.passed === c.attempts ? 'done' : c.passed ? 'attention' : 'error'
}

/** The run as Markdown, to paste into a PR or a team channel. */
export function scoreboardMarkdown(run: Pick<EvalRun, 'specs' | 'attempts' | 'repeat'>, label: (c: Contestant) => string): string {
  const rows = scoreboard(run.attempts)
  const evals = run.specs.map((s) => s.name)
  const pct = (s: Score): string => `${Math.round((s.attempts ? s.passed / s.attempts : 0) * 100)}%`
  const mins = (ms?: number): string => (ms === undefined ? '–' : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 60_000).toFixed(1)}m`)
  const head = ['Agent', 'Pass rate', 'Checks', 'Median time', 'Median diff', ...evals]
  const lines = [
    `## Eval scoreboard (${evals.length} eval${evals.length === 1 ? '' : 's'} × ${run.repeat} attempt${run.repeat === 1 ? '' : 's'})`,
    '',
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((s) => `| ${[label(s.contestant), `${pct(s)} (${s.passed}/${s.attempts})`, `${Math.round(s.checkRate * 100)}%`, mins(s.medianMs), s.medianLines === undefined ? '–' : `${s.medianLines} line${s.medianLines === 1 ? '' : 's'}`, ...evals.map((e) => (s.byEval[e] ? `${s.byEval[e].passed}/${s.byEval[e].attempts}` : '–'))].join(' | ')} |`)
  ]
  return lines.join('\n')
}
