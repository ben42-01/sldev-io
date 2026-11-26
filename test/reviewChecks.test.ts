import { describe, expect, it } from 'vitest'
import { checkLabel, checksState, checksSummary, endCheck, staleReason } from '../src/shared/reviewChecks'
import type { ReviewCheck, ReviewChecks } from '../src/shared/types'

const HEAD = 'a'.repeat(40)
const NEW = 'b'.repeat(40)
const check = (o: Partial<ReviewCheck> = {}): ReviewCheck => ({ name: 'test', command: 'npm run test', status: 'passed', code: 0, ...o })
const run = (o: Partial<ReviewChecks> = {}): ReviewChecks => ({ head: HEAD, diff: '3:10', path: '/w/pr-1', at: 1, status: 'done', results: [check({ name: 'typecheck', command: 'npm run typecheck' }), check()], skipped: [], ...o })

describe('checksState', () => {
  it('is none before the first click', () => expect(checksState(undefined, HEAD, '3:10', false)).toBe('none'))
  it('passes and fails on the results', () => {
    expect(checksState(run(), HEAD, '3:10', false)).toBe('passed')
    expect(checksState(run({ results: [check(), check({ name: 'typecheck', status: 'failed', code: 2 })] }), HEAD, '3:10', false)).toBe('failed')
    expect(checksState(run({ setup: { command: 'npm ci', ok: false } }), HEAD, '3:10', false)).toBe('failed')
    expect(checksState(run({ error: 'no such PR' }), HEAD, '3:10', false)).toBe('failed')
  })
  it('a run left by a restart is interrupted, one in this window is running', () => {
    expect(checksState(run({ status: 'running' }), HEAD, '3:10', true)).toBe('running')
    expect(checksState(run({ status: 'running' }), HEAD, '3:10', false)).toBe('interrupted')
  })
  it('a new commit makes it stale, even a failed one', () => {
    expect(checksState(run(), NEW, '3:10', false)).toBe('stale')
    expect(checksState(run({ results: [check({ status: 'failed', code: 1 })] }), NEW, '3:10', false)).toBe('stale')
  })
  it('new uncommitted edits make it stale too', () => expect(checksState(run(), HEAD, '4:12', false)).toBe('stale'))
  it('a head not known yet, or short, is not stale', () => {
    expect(checksState(run(), '', '3:10', false)).toBe('passed')
    expect(checksState(run(), HEAD.slice(0, 7), '3:10', false)).toBe('passed')
  })
})

describe('staleReason', () => {
  it('names both commits', () => expect(staleReason(run(), NEW, undefined)).toBe('Ran on aaaaaaa; the review is at bbbbbbb now'))
  it('null when current', () => expect(staleReason(run(), HEAD, '3:10')).toBeNull())
})

describe('endCheck', () => {
  const running = check({ status: 'running', code: undefined })
  it('passes only on exit 0', () => {
    expect(endCheck(running, { code: 0, output: 'ok' })).toMatchObject({ status: 'passed', code: 0, tail: 'ok' })
    expect(endCheck(running, { code: 1, output: 'boom\n' })).toMatchObject({ status: 'failed', code: 1, tail: 'boom' })
  })
  it('a timeout or a closed terminal fails, whatever the code', () => {
    const t = endCheck(running, { code: 0, timedOut: true })
    expect(t).toMatchObject({ status: 'failed', timedOut: true })
    expect(checkLabel(t)).toBe('timed out after 15 min')
    expect(checkLabel(endCheck(running, { closed: true }))).toBe('terminal closed')
  })
  it('leaves out the terminal\'s exit notice', () =>
    expect(endCheck(running, { code: 1, output: '$ npm test\nboom\n\n[npm test exited with code 1. Press Enter to run again]' }).tail).toBe('$ npm test\nboom'))
  it('keeps the end of a long output', () => {
    const t = endCheck(running, { code: 1, output: 'x'.repeat(10_000) + 'END' }).tail!
    expect(t.length).toBeLessThan(4100)
    expect(t.endsWith('END') && t.startsWith('…')).toBe(true)
  })
})

describe('checksSummary', () => {
  it('says what failed and on which commit', () => {
    const s = checksSummary(run({ results: [check({ name: 'typecheck', status: 'failed', code: 2 }), check()] }), 'failed', HEAD)
    expect(s.signal.tone).toBe('error')
    expect(s.line).toBe('typecheck failed, test passed on aaaaaaa')
  })
  it('passed', () => expect(checksSummary(run(), 'passed', HEAD).line).toBe('typecheck and test passed on aaaaaaa'))
  it('stale says why and what it was', () => {
    const s = checksSummary(run(), 'stale', NEW)
    expect(s.signal).toMatchObject({ tone: 'attention', label: 'Stale' })
    expect(s.line).toBe('Ran on aaaaaaa; the review is at bbbbbbb now. typecheck and test passed')
  })
  it('installing first, then the running check', () => {
    const waiting = run({ status: 'running', setup: { command: 'npm ci', ok: true }, results: [check({ status: 'waiting' })] })
    expect(checksSummary(waiting, 'running', HEAD).line).toBe('Installing dependencies (npm ci) on aaaaaaa…')
    expect(checksSummary(run({ status: 'running', results: [check({ status: 'running' })] }), 'running', HEAD).line).toBe('Running test on aaaaaaa…')
  })
  it('a project without checks', () => expect(checksSummary(run({ results: [], skipped: ['typecheck', 'test'] }), 'passed', HEAD).line).toBe('No typecheck or test in this project'))
})
