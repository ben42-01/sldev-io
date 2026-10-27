import { describe, expect, it } from 'vitest'
import { missionSignal, needsYou, nodeSignal, processSignal, runSignal } from '@shared/status'

describe('status vocabulary', () => {
  it('gives each state one tone, and pulses only live activity', () => {
    expect(missionSignal('working')).toEqual({ tone: 'working', label: 'Working', pulse: true })
    expect(missionSignal('needs-input')).toMatchObject({ tone: 'attention', pulse: true })
    expect(missionSignal('waiting')).toMatchObject({ tone: 'review', pulse: false })
    expect(missionSignal('ended').pulse).toBe(false)
    expect(nodeSignal('done').tone).toBe('done')
  })

  it('counts attention and errors as needing the human', () => {
    expect(needsYou(missionSignal('needs-input'))).toBe(true)
    expect(needsYou(missionSignal('failed'))).toBe(true)
    expect(needsYou(missionSignal('waiting'))).toBe(false)
    expect(needsYou(runSignal('running', true))).toBe(true)
  })

  it('treats Ctrl+C as stopped, not failed', () => {
    expect(processSignal('exited', 130)).toMatchObject({ tone: 'neutral', label: 'Stopped' })
    expect(processSignal('exited', 2)).toMatchObject({ tone: 'error', label: 'Exited with code 2' })
    expect(processSignal('exited', 0).label).toBe('Finished')
  })
})
