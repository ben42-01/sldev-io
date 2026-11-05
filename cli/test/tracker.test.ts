import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findAgent } from '@shared/agents'
import { patchMission } from '@shared/missionHistory'
import type { Mission } from '@shared/types'
import { IDLE_MS, Tracker } from '../src/tracker'

function setup(agentId: string, screenText = '') {
  let m: Mission = { id: '1', title: 'Fix it', prompt: 'fix the failing test please', root: '/r', cwd: '/r', options: { agent: agentId }, status: 'starting', createdAt: 0, updatedAt: 0 }
  const screen = { text: screenText, cursor: { line: 0, alt: false } }
  const notes: string[] = []
  const limits: string[] = []
  const t = new Tracker({
    agent: findAgent(agentId),
    get: () => m,
    update: (p) => (m = patchMission(m, p, Date.now())),
    notify: (title) => notes.push(title),
    limited: (line) => limits.push(line),
    screen: { tail: () => screen.text, cursor: () => screen.cursor }
  })
  return { t, screen, notes, limits, get: () => m }
}

describe('Tracker', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }))
  afterEach(() => vi.useRealTimers())

  it('follows Claude through its hooks', () => {
    const s = setup('claude')
    s.t.hook({ mission: '1', type: 'session-start', sessionId: 'abc' })
    expect(s.get().status).toBe('working')
    expect(s.get().sessionId).toBe('abc')
    s.t.hook({ mission: '1', type: 'notification', text: 'Claude needs your permission to use Bash' })
    expect(s.get().status).toBe('needs-input')
    expect(s.notes).toEqual(['Fix it needs you'])
    s.t.hook({ mission: '1', type: 'stop', text: 'Done: fixed it.' })
    expect(s.get().status).toBe('waiting')
    expect(s.get().report).toBe('Done: fixed it.')
    // output from a hooks agent never moves its status
    s.t.output()
    vi.advanceTimersByTime(IDLE_MS + 100)
    expect(s.get().status).toBe('waiting')
  })

  it('watches agents without hooks: output is working, quiet is ready, and the screen becomes the report', () => {
    const s = setup('codex', 'fix the failing test please\nAll tests pass now.')
    s.t.output()
    expect(s.get().status).toBe('working')
    vi.advanceTimersByTime(IDLE_MS + 10)
    expect(s.get().status).toBe('waiting')
    expect(s.get().report).toBe('All tests pass now.')
    expect(s.get().reportFrom).toBe('terminal')
  })

  it('takes an approval prompt on screen as needs-you, and typing as the answer', () => {
    const s = setup('codex', 'fix the failing test please\nAllow command `rm -rf build`? [y/N]')
    s.t.output()
    vi.advanceTimersByTime(500)
    expect(s.get().status).toBe('needs-input')
    expect(s.get().notification).toContain('rm -rf build')
    s.t.input()
    expect(s.get().status).toBe('working')
  })

  it('a bell means needs-you', () => {
    const s = setup('codex')
    s.t.output()
    s.t.attention()
    expect(s.get().status).toBe('needs-input')
    expect(s.notes).toEqual(['Fix it needs you'])
  })

  it('stops guessing once the agent reports through the sldev tools', () => {
    const s = setup('codex', 'fix the failing test please\nthinking')
    s.t.mcp({ mission: '1', type: 'status', state: 'working', text: 'Reading the tests' })
    s.t.output()
    vi.advanceTimersByTime(IDLE_MS + 10)
    expect(s.get().status).toBe('working')
    s.t.mcp({ mission: '1', type: 'done', text: 'Fixed the parser.' })
    expect(s.get().report).toBe('Fixed the parser.')
  })

  it('flags a usage limit once the output settles, only once', () => {
    const s = setup('claude', 'Claude usage limit reached. Your limit will reset at 3pm.')
    s.t.output()
    vi.advanceTimersByTime(3100)
    expect(s.limits).toHaveLength(1)
    expect(s.get().limited?.text).toContain('usage limit reached')
    s.t.output()
    vi.advanceTimersByTime(3100)
    expect(s.limits).toHaveLength(1)
  })

  it('an exit ends the pane; a non-zero exit fails it', () => {
    const a = setup('codex')
    a.t.output()
    a.t.exit(0)
    expect(a.get().status).toBe('ended')
    const b = setup('codex')
    b.t.output()
    b.t.exit(2)
    expect(b.get().status).toBe('failed')
  })
})
