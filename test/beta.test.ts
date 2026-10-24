import { describe, expect, it } from 'vitest'
import { betaPhase, parseBetaConfig } from '../src/shared/beta'

const at = (iso: string): number => Date.parse(iso)

describe('parseBetaConfig', () => {
  it('keeps valid dates and drops anything else', () => {
    expect(parseBetaConfig({ startsAt: '2026-11-01', endsAt: '2026-12-31' })).toEqual({ startsAt: '2026-11-01', endsAt: '2026-12-31' })
    expect(parseBetaConfig({ startsAt: 'soon', endsAt: 20261231 })).toEqual({ startsAt: null, endsAt: null })
    expect(parseBetaConfig(null)).toEqual({ startsAt: null, endsAt: null })
    expect(parseBetaConfig({ endsAt: '2026-13-45' }).endsAt).toBeNull()
  })
})

describe('betaPhase', () => {
  const cfg = { startsAt: '2026-11-01', endsAt: '2026-12-31' }

  it('never limits a stable build', () => {
    expect(betaPhase(cfg, at('2027-06-01T00:00:00Z'), false).phase).toBe('off')
  })

  it('runs without limit when no end date is set', () => {
    expect(betaPhase({ startsAt: null, endsAt: null }, Date.now())).toEqual({ phase: 'active', daysLeft: null })
  })

  it('walks through upcoming → active → ending → ended', () => {
    expect(betaPhase(cfg, at('2026-10-20T12:00:00Z')).phase).toBe('upcoming')
    expect(betaPhase(cfg, at('2026-11-10T12:00:00Z'))).toEqual({ phase: 'active', daysLeft: 52 })
    expect(betaPhase(cfg, at('2026-12-20T12:00:00Z'))).toEqual({ phase: 'ending', daysLeft: 12 })
    expect(betaPhase(cfg, at('2026-12-31T23:00:00Z'))).toEqual({ phase: 'ending', daysLeft: 1 })
    expect(betaPhase(cfg, at('2027-01-01T00:00:01Z'))).toEqual({ phase: 'ended', daysLeft: 0 })
  })

  it('treats the end date as the last free day, through midnight UTC', () => {
    expect(betaPhase({ startsAt: null, endsAt: '2026-12-31' }, at('2026-12-31T23:59:59Z')).phase).toBe('ending')
  })
})
