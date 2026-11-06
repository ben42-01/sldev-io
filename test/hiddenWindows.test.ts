import { describe, expect, it } from 'vitest'
import { hideForkedWindows } from '../src/main/pty'

/** On Windows, node-pty's kill() forks a helper; from a process without a console that flashed a window. */
describe('hidden helper windows', () => {
  it('makes forks hidden by default, in both call shapes, and keeps an explicit choice', () => {
    const calls: unknown[][] = []
    const cp = { fork: ((...a: unknown[]) => (calls.push(a), {})) as never }
    hideForkedWindows(cp)
    hideForkedWindows(cp)
    ;(cp.fork as (...a: unknown[]) => unknown)('agent.js', ['42'])
    ;(cp.fork as (...a: unknown[]) => unknown)('agent.js', { silent: true })
    ;(cp.fork as (...a: unknown[]) => unknown)('agent.js', ['1'], { windowsHide: false })
    expect(calls).toEqual([
      ['agent.js', ['42'], { windowsHide: true }],
      ['agent.js', { windowsHide: true, silent: true }],
      ['agent.js', ['1'], { windowsHide: false }]
    ])
  })
})
