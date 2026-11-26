import { describe, expect, it } from 'vitest'
import { checklist, prAsk, prCriteria } from '@shared/review'

describe('a pull request’s criteria', () => {
  it('come from a checklist in its description', () => {
    const body = 'Adds a limiter.\n\n- [ ] 429 after 10 requests\n- [x] Documented in README\n\nNot a list item'
    expect(checklist(body)).toEqual(['429 after 10 requests', 'Documented in README'])
    expect(prCriteria(body)).toEqual(['429 after 10 requests', 'Documented in README'])
  })
  it('an "Acceptance criteria" section wins over other checklists', () => {
    const body = '## Tasks\n- [ ] write code\n\n## Acceptance criteria\n- The API returns 429\n- Limits per key'
    expect(prCriteria(body)).toEqual(['The API returns 429', 'Limits per key'])
  })
  it('add the ones of the issues it closes, each once', () => {
    const issues = [{ number: 42, title: 'Too many requests', body: 'Bots.\n\n## Acceptance criteria\n- [ ] The API returns 429\n- [ ] Limits are per API key' }]
    expect(prCriteria('- [ ] the api returns 429', issues)).toEqual(['the api returns 429', 'Limits are per API key'])
    expect(prCriteria('', issues)).toEqual(['The API returns 429', 'Limits are per API key'])
  })
  it('none at all is an empty list', () => {
    expect(prCriteria('Just a fix.', [{ number: 1, title: 't', body: '' }])).toEqual([])
  })
  it('the ask names the issues it closes, with their text', () => {
    const ask = prAsk('Rate limit', 'Adds a limiter.', [{ number: 42, title: 'Too many requests', body: 'Bots hammer the API.' }])
    expect(ask).toBe('Adds a limiter.\n\nCloses #42: Too many requests\nBots hammer the API.')
    expect(prAsk('Rate limit', '')).toBe('Rate limit')
  })
})
