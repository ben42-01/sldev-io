import { describe, expect, it } from 'vitest'
import { claudeTranscriptUsage, codexSessionUsage, median, responseTimes, segments, timeIn, timeTicks } from '@shared/usage'
import type { Mission } from '@shared/types'

const m = (history: Mission['history'], status: Mission['status'] = 'ended', updatedAt = 100): Mission => ({
  id: 'm',
  title: 't',
  prompt: 'p',
  root: '/p',
  cwd: '/p',
  options: {},
  status,
  createdAt: 0,
  updatedAt,
  history
})

describe('segments', () => {
  it('turns status changes into spans, ending at the last change', () => {
    const s = segments(m([{ status: 'starting', at: 0 }, { status: 'working', at: 10 }, { status: 'needs-input', at: 40 }, { status: 'working', at: 55 }, { status: 'ended', at: 90 }]), 1000)
    expect(s).toEqual([
      { status: 'starting', from: 0, to: 10 },
      { status: 'working', from: 10, to: 40 },
      { status: 'needs-input', from: 40, to: 55 },
      { status: 'working', from: 55, to: 90 }
    ])
  })
  it('a live mission runs until now', () => {
    expect(segments(m([{ status: 'working', at: 10 }], 'working'), 70).at(-1)).toEqual({ status: 'working', from: 10, to: 70 })
  })
  it('missions from before the history existed show nothing rather than a guess', () => {
    expect(segments(m(undefined, 'ended'), 50)).toEqual([])
  })
})

describe('time totals', () => {
  const ms = [m([{ status: 'working', at: 0 }, { status: 'needs-input', at: 30 }, { status: 'working', at: 50 }, { status: 'ended', at: 60 }])]
  it('sums time per status inside a range', () => {
    expect(timeIn(ms, 'working', 0, 100, 100)).toBe(40)
    expect(timeIn(ms, 'working', 40, 100, 100)).toBe(10)
    expect(timeIn(ms, 'needs-input', 0, 100, 100)).toBe(20)
  })
  it('measures how long a "needs you" waited for an answer', () => {
    expect(responseTimes(ms, 0, 100, 100)).toEqual([20])
    expect(median([5, 1, 9])).toBe(5)
    expect(median([])).toBeNull()
  })
})

describe('Claude transcripts', () => {
  it('sums usage once per message', () => {
    const line = (id: string, input: number, output: number) => JSON.stringify({ type: 'assistant', message: { id, usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } } })
    const text = [line('a', 5, 1), line('a', 5, 20), JSON.stringify({ type: 'user', message: {} }), line('b', 3, 7), '{"type":"assis'].join('\n')
    // no model in the log: counted, but not priced
    expect(claudeTranscriptUsage(text)).toEqual({ input: 8, output: 27, cacheRead: 200, cacheWrite: 20, cost: 0, unpriced: 255 })
  })
  it('prices each message with its own model', () => {
    const line = (id: string, model: string) => JSON.stringify({ type: 'assistant', message: { id, model, usage: { input_tokens: 5, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } } })
    const u = claudeTranscriptUsage([line('a', 'claude-opus-5-5'), line('b', 'mystery-model')].join('\n'))!
    // opus 5.5: 5 × $4 + 20 × $20 + 100 × $0.20 + 10 × $5 per million
    expect(u.cost).toBeCloseTo(490 / 1e6, 12)
    expect(u.unpriced).toBe(135)
  })
  it('null when there is nothing to count', () => {
    expect(claudeTranscriptUsage('')).toBeNull()
  })
})

describe('Codex sessions', () => {
  it('reads the cwd, start and the last running total', () => {
    const text = [
      JSON.stringify({ type: 'session_meta', payload: { cwd: '/wt', timestamp: '2026-10-25T10:00:00.000Z' } }),
      JSON.stringify({ type: 'turn_context', payload: { cwd: '/wt', model: 'gpt-5-codex' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10, reasoning_output_tokens: 5 } } } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 300, cached_input_tokens: 100, output_tokens: 30, reasoning_output_tokens: 5 } } } })
    ].join('\n')
    expect(codexSessionUsage(text)).toEqual({ cwd: '/wt', startedAt: Date.parse('2026-10-25T10:00:00.000Z'), usage: { input: 200, output: 35, cacheRead: 100, cacheWrite: 0, cost: (200 * 1.25 + 35 * 10 + 100 * 0.125) / 1e6, unpriced: 0 } })
  })
})

describe('timeTicks', () => {
  it('picks a step that gives a handful of ticks', () => {
    const start = Date.parse('2026-10-25T08:07:00')
    const ticks = timeTicks(start, start + 6 * 3600000)
    expect(ticks.length).toBeGreaterThan(2)
    expect(ticks.length).toBeLessThanOrEqual(6)
    expect(new Date(ticks[0]).getMinutes()).toBe(0)
  })
})
