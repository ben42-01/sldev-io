import { describe, expect, it } from 'vitest'
import { clipReport, followUpBrief, handoffText, missionPrompt, REPORT_LIMIT, secondOpinionBrief } from '@shared/missionPrompt'

describe('mission prompts', () => {
  it('puts the title first, then the brief, criteria and the closing instruction', () => {
    const p = missionPrompt({ title: 'Users pagination', brief: 'Add pagination\nto /users', criteria: 'npm test passes' })
    expect(p.split('\n')[0]).toBe('Mission: Users pagination')
    expect(p).toContain('Add pagination\nto /users')
    expect(p).toContain('Acceptance criteria:\nnpm test passes')
    expect(p).toMatch(/summarize what changed, the checks you ran, and the remaining risks/)
    expect(missionPrompt({ title: 't', brief: 'b' })).not.toContain('Acceptance criteria')
  })

  it('hands over the human notes before the agent report', () => {
    expect(handoffText({ handoff: 'Fix the 500', report: 'All done' })).toBe('Handoff notes from the reviewer:\nFix the 500')
    expect(handoffText({ report: 'All done' })).toBe('Final report from the previous agent:\nAll done')
    expect(handoffText({})).toBe('No handoff notes were recorded.')
  })

  it('builds follow-up and second-opinion briefs from the original task', () => {
    const prev = { title: 'Pagination', brief: 'Add pagination', prompt: 'Mission: Pagination\n\nAdd pagination', criteria: 'tests pass', report: 'Done' }
    const f = followUpBrief(prev, 'Now add a test')
    expect(f.startsWith('Now add a test')).toBe(true)
    expect(f).toContain('Original task:\nAdd pagination')
    expect(f).toContain('Final report from the previous agent:\nDone')
    const s = secondOpinionBrief(prev, 'Claude Code', 'main')
    expect(s).toContain('git diff main')
    expect(s).toContain('Acceptance criteria:\ntests pass')
    expect(s).toMatch(/Do not edit any files\.$/)
  })

  it('caps the stored report', () => {
    expect(clipReport('x'.repeat(REPORT_LIMIT + 5))).toMatch(/\[truncated\]$/)
    expect(clipReport('short')).toBe('short')
  })
})
