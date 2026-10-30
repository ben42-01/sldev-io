import { describe, expect, it } from 'vitest'
import { SCREEN_REPORT_LINES, screenReport } from '@shared/screenReport'
import { handoffText } from '@shared/missionPrompt'

describe('screenReport', () => {
  it('strips the panels a full-screen agent draws and keeps its reply', () => {
    const screen = [
      '┌────────────────────────────────────┐',
      '│ The cache is invalidated twice:    │',
      '│                                    │',
      '│ 1. on save                         │',
      '│ 2. in the worker                   │',
      '└────────────────────────────────────┘',
      '',
      '',
      '  ⠋ build · claude-sonnet          ',
      ''
    ].join('\n')
    expect(screenReport(screen)).toBe(['The cache is invalidated twice:', '', '1. on save', '2. in the worker', '', ' build · claude-sonnet'].join('\n'))
  })

  it('keeps plain output as it is, without the trailing blank rows', () => {
    expect(screenReport('thinking 1\ndone editing\n\n\n\n')).toBe('thinking 1\ndone editing')
  })

  it('keeps the end of a long screen', () => {
    const screen = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')
    const out = screenReport(screen).split('\n')
    expect(out).toHaveLength(SCREEN_REPORT_LINES)
    expect(out.at(-1)).toBe('line 199')
  })

  it('starts after the echoed prompt, even when the terminal wrapped it', () => {
    const prompt = 'Fix the cache\n\nWork only in your current working folder. When finished, summarize what changed.'
    const screen = [
      "$ opencode --prompt 'Fix the cache",
      '',
      'Work only in your current working folder. When finished, summarize what c',
      "hanged.'",
      '│ Work only in your current working folder. When finished, summarize │',
      '│ what changed.                                                       │',
      '│ The cache was invalidated twice; I removed the worker call.        │'
    ].join('\n')
    expect(screenReport(screen, prompt)).toBe('The cache was invalidated twice; I removed the worker call.')
  })

  it('keeps the whole screen when the prompt scrolled away', () => {
    expect(screenReport('Done: removed the worker call.', 'Fix the cache in the worker please')).toBe('Done: removed the worker call.')
  })

  it('is empty for an empty screen', () => {
    expect(screenReport('\n\n  │  │\n')).toBe('')
  })
})

describe('handoffText', () => {
  it('says when the report is only the terminal screen', () => {
    expect(handoffText({ report: 'done', reportFrom: 'terminal' })).toBe("The previous agent's terminal when it finished (it wrote no report):\ndone")
    expect(handoffText({ report: 'done' })).toBe('Final report from the previous agent:\ndone')
  })
})
