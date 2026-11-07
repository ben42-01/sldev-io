import { describe, expect, it } from 'vitest'
import { attemptStatus, cellTone, diffCheckResult, evalTemplate, judgePrompt, judgeResult, nextAttempts, parseEval, plannedAttempts, runCheckResult, scoreboard, scoreboardMarkdown, type EvalAttempt, type EvalRun } from '@shared/evals'

describe('parseEval', () => {
  it('reads a brief, a base and every kind of check', () => {
    const { spec, error } = parseEval(`name: Leap years
brief: |
  parseDate should accept Feb 29 in leap years.
base: main
timeout: 5
checks:
  - npm test
  - run: node check.js
    expect: ok
  - diff: 40
  - judge: Adds a test for 2024-02-29.
`, '/p/.sldev/evals/leap.yml')
    expect(error).toBeUndefined()
    expect(spec).toEqual({
      name: 'Leap years',
      description: undefined,
      brief: 'parseDate should accept Feb 29 in leap years.',
      base: 'main',
      setup: undefined,
      timeout: 5,
      checks: [{ type: 'run', command: 'npm test' }, { type: 'run', command: 'node check.js', expect: 'ok' }, { type: 'diff', maxLines: 40 }, { type: 'judge', rubric: 'Adds a test for 2024-02-29.' }],
      path: '/p/.sldev/evals/leap.yml'
    })
  })
  it('says what is missing or wrong', () => {
    expect(parseEval('brief: x\nchecks: [npm test]').error).toBe('name is missing')
    expect(parseEval('name: a\nchecks: [npm test]').error).toContain('brief is missing')
    expect(parseEval('name: a\nbrief: b').error).toContain('checks is missing')
    expect(parseEval('name: a\nbrief: b\nchecks:\n  - diff: -3').error).toContain('check 1: diff')
    expect(parseEval('name: a\nbrief: b\nchecks:\n  - lint: true').error).toContain('check 1: use run')
    expect(parseEval('name: [').error).toContain('Not valid YAML')
  })
  it('the template is a valid eval', () => {
    expect(parseEval(evalTemplate('Fix it', 'Line one\nline two')).spec).toMatchObject({ name: 'Fix it', brief: 'Line one\nline two', timeout: 20, checks: [{ type: 'run', command: 'npm test' }] })
  })
})

describe('checks', () => {
  it('a command passes on exit 0, with the expected output when given', () => {
    expect(runCheckResult({ type: 'run', command: 'npm test' }, { code: 0, output: 'ok\n' }).ok).toBe(true)
    expect(runCheckResult({ type: 'run', command: 'npm test' }, { code: 1, output: 'boom' })).toMatchObject({ ok: false, detail: 'Exited with 1\nboom' })
    expect(runCheckResult({ type: 'run', command: 'x', expect: 'ok' }, { code: 0, output: 'nope' }).detail).toContain('“ok” is not in the output')
    expect(runCheckResult({ type: 'run', command: 'x' }, { code: null, output: '', timedOut: true }).detail).toContain('Timed out')
  })
  it('a diff limit fails a big change and an empty one', () => {
    expect(diffCheckResult({ type: 'diff', maxLines: 50 }, { files: 2, lines: 30 }).ok).toBe(true)
    expect(diffCheckResult({ type: 'diff', maxLines: 50 }, { files: 2, lines: 80 }).ok).toBe(false)
    expect(diffCheckResult({ type: 'diff', maxLines: 50 }, { files: 0, lines: 0 })).toMatchObject({ ok: false, detail: 'No changes' })
  })
  it('the judge writes a verdict file', () => {
    expect(judgePrompt({ brief: 'Fix it' }, 'Adds a test', 'abc123', '/w/v.md')).toContain('VERDICT: PASS or VERDICT: FAIL')
    expect(judgeResult('VERDICT: PASS\nHas a test.')).toEqual({ label: 'judge', ok: true, detail: 'Has a test.' })
    expect(judgeResult('verdict: fail')).toMatchObject({ ok: false })
    expect(judgeResult('looks fine')).toMatchObject({ ok: false, detail: 'The judge gave no verdict' })
    expect(judgeResult(null).detail).toBe('The judge wrote nothing')
  })
  it('passes only when every check passed', () => {
    expect(attemptStatus([{ label: 'a', ok: true }, { label: 'b', ok: true }])).toBe('passed')
    expect(attemptStatus([{ label: 'a', ok: true }, { label: 'b', ok: false }])).toBe('failed')
    expect(attemptStatus([])).toBe('failed')
  })
})

describe('runs', () => {
  const spec = (name: string) => ({ name, brief: 'b', timeout: 20, checks: [] })
  let n = 0
  const id = () => `a${++n}`
  it('plans round by round, so every agent gets a fair share', () => {
    const plan = plannedAttempts([spec('x'), spec('y')], [{ agent: 'claude' }, { agent: 'codex' }], 2, id)
    expect(plan.map((a) => `${a.eval}:${a.contestant.agent}`)).toEqual(['x:claude', 'x:codex', 'y:claude', 'y:codex', 'x:claude', 'x:codex', 'y:claude', 'y:codex'])
  })
  it('starts only what the limit leaves room for, nothing once stopped', () => {
    const attempts = plannedAttempts([spec('x')], [{ agent: 'claude' }, { agent: 'codex' }, { agent: 'gemini' }], 1, id)
    attempts[0].status = 'running'
    const run = { attempts, parallel: 2, stopped: false } as EvalRun
    expect(nextAttempts(run).map((a) => a.contestant.agent)).toEqual(['codex'])
    expect(nextAttempts({ ...run, stopped: true })).toEqual([])
  })
})

describe('scoreboard', () => {
  const at = (agent: string, ev: string, status: EvalAttempt['status'], agentMs: number, lines: number, checks = [true]): EvalAttempt => ({ id: `${agent}${ev}${agentMs}`, eval: ev, contestant: { agent, model: agent === 'claude' ? 'opus' : undefined }, status, agentMs, diff: { files: 1, lines }, checks: checks.map((ok, i) => ({ label: `c${i}`, ok })) })
  const attempts = [
    at('claude', 'x', 'passed', 60_000, 20),
    at('claude', 'y', 'failed', 120_000, 40, [true, false]),
    at('codex', 'x', 'passed', 30_000, 10),
    at('codex', 'y', 'passed', 50_000, 12),
    at('codex', 'y', 'stopped', 1, 1),
    at('gemini', 'x', 'error', 0, 0, [])
  ]
  it('ranks by pass rate, with partial credit, time and diff size', () => {
    const s = scoreboard(attempts)
    expect(s.map((x) => x.key)).toEqual(['codex', 'claude/opus', 'gemini'])
    expect(s[0]).toMatchObject({ attempts: 2, passed: 2, medianMs: 40_000, medianLines: 11, byEval: { x: { passed: 1, attempts: 1 }, y: { passed: 1, attempts: 1 } } })
    expect(s[1]).toMatchObject({ passed: 1, attempts: 2, checkRate: 2 / 3 })
    expect(s[2]).toMatchObject({ passed: 0, attempts: 1 })
  })
  it('tones a cell and writes a Markdown table', () => {
    expect([cellTone({ passed: 2, attempts: 2 }), cellTone({ passed: 1, attempts: 3 }), cellTone({ passed: 0, attempts: 1 }), cellTone(undefined)]).toEqual(['done', 'attention', 'error', 'neutral'])
    const md = scoreboardMarkdown({ specs: [{ name: 'x', brief: '', timeout: 1, checks: [] }, { name: 'y', brief: '', timeout: 1, checks: [] }], attempts, repeat: 1 }, (c) => c.agent)
    expect(md.split('\n')[0]).toBe('## Eval scoreboard (2 evals × 1 attempt)')
    expect(md).toContain('| codex | 100% (2/2) | 100% | 40s | 11 lines | 1/1 | 1/1 |')
  })
})
