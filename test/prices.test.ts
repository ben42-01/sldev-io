import { describe, expect, it } from 'vitest'
import { costOf, priceFor } from '@shared/prices'

describe('price table', () => {
  it('matches model ids, the specific ones first', () => {
    expect(priceFor('claude-opus-5-5')?.input).toBe(4)
    expect(priceFor('claude-opus-5')?.input).toBe(5)
    expect(priceFor('claude-fable-5-1')?.cacheRead).toBe(0.25)
    expect(priceFor('claude-sonnet-4-5-20250929')?.output).toBe(15)
    expect(priceFor('claude-haiku-5-5')?.output).toBe(0.5)
    expect(priceFor('gpt-5.3-codex')?.output).toBe(14)
    expect(priceFor('gpt-5-codex')?.cacheWrite).toBe(0)
  })

  it('has no price for a model it does not know, rather than a guess', () => {
    expect(priceFor('gpt-5-mini')).toBeNull()
    expect(priceFor('claude-opus-4-1')).toBeNull()
    expect(priceFor(undefined)).toBeNull()
  })

  it('prices a million tokens of each kind', () => {
    expect(costOf({ input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }, priceFor('claude-sonnet-4-6')!)).toBeCloseTo(3 + 15 + 0.3 + 3.75)
  })
})
