import { describe, expect, it } from 'vitest'
import { failoverBrief, failoverNote, limitLine, nextAgent, respec } from '@shared/failover'
import { findAgent } from '@renderer/lib/agents'

const pat = (id: string) => findAgent(id).usageLimit

describe('usage limits', () => {
  it('spots each agent’s limit message at the end of its output', () => {
    expect(limitLine('working…\nClaude usage limit reached. Your limit will reset at 3pm (Europe/Berlin).', pat('claude'))).toMatch(/limit reached/)
    expect(limitLine('⎿ 5-hour limit reached ∙ resets 3pm', pat('claude'))).toMatch(/5-hour/)
    expect(limitLine("■ You've hit your usage limit. Upgrade to Pro or try again in 2 hours.", pat('codex'))).toMatch(/hit your usage limit/)
    expect(limitLine('[API Error: Quota exceeded for quota metric', pat('gemini'))).toMatch(/Quota exceeded/)
  })

  it('ignores ordinary talk about limits and anything but the last lines', () => {
    expect(limitLine('I added a rate limiter to the API and a usage limit setting.', pat('claude'))).toBeNull()
    expect(limitLine(['Claude usage limit reached', ...Array(60).fill('later output')].join('\n'), pat('claude'))).toBeNull()
    expect(limitLine('usage limit reached', undefined)).toBeNull()
  })

  it('picks the next installed agent, never the one that stopped', () => {
    const installed = (id: string): boolean => id !== 'gemini'
    expect(nextAgent(['claude', 'gemini', 'codex'], 'claude', installed)).toBe('codex')
    expect(nextAgent(['claude'], 'claude', installed)).toBeUndefined()
    expect(nextAgent([], 'claude', installed)).toBeUndefined()
  })

  it('moves a stage spec to another CLI, keeping its profile', () => {
    const ids = ['claude', 'codex']
    expect(respec('Implementer@claude', 'codex', ids)).toBe('Implementer@codex')
    expect(respec('claude', 'codex', ids)).toBe('codex')
    expect(respec('Reviewer', 'codex', ids)).toBe('Reviewer@codex')
  })

  it('tells the next agent where the work stands', () => {
    const b = failoverBrief({ title: 'Pagination', brief: 'Add pagination', prompt: 'x', handoff: 'Keep the API stable' }, 'Claude Code', 'edited users.ts\nClaude usage limit reached')
    expect(b).toMatch(/^Continue the mission "Pagination"\./)
    expect(b).toContain('Claude Code stopped at its usage limit')
    expect(b).toContain('git status')
    expect(b).toContain('Original task:\nAdd pagination')
    expect(b).toContain('Notes from the reviewer:\nKeep the API stable')
    expect(failoverNote('Codex', '')).not.toContain('last output')
    // the next agent echoes its prompt: the limit line in it would flag that agent too
    const note = failoverNote('Claude Code', 'edited a.ts\nClaude usage limit reached', pat('claude'))
    expect(note).toContain('edited a.ts\n[usage limit message]')
    expect(limitLine(note, pat('codex'))).toBeNull()
  })
})
