import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, patchMission, pushStatus } from '@shared/missionHistory'
import type { Mission } from '@shared/types'

const mission: Mission = {
  id: 'm1',
  title: 'Fix it',
  prompt: 'Fix it',
  root: '/p',
  cwd: '/p',
  options: { agent: 'claude' },
  status: 'starting',
  createdAt: 0,
  updatedAt: 0,
  history: [{ status: 'starting', at: 0 }]
}

describe('patchMission', () => {
  it('records a status change with its time', () => {
    const m = patchMission(mission, { status: 'working' }, 10)
    expect(m.history).toEqual([
      { status: 'starting', at: 0 },
      { status: 'working', at: 10 }
    ])
    expect(m.updatedAt).toBe(10)
  })

  it('leaves the history alone when the status stays the same', () => {
    const m = patchMission(mission, { status: 'starting', activity: 'Read a.ts' }, 10)
    expect(m.history).toHaveLength(1)
    expect(m.activity).toBe('Read a.ts')
  })

  it('starts a history for missions saved before it existed', () => {
    const m = patchMission({ ...mission, history: undefined }, { status: 'ended' }, 5)
    expect(m.history).toEqual([{ status: 'ended', at: 5 }])
  })
})

describe('pushStatus', () => {
  it('drops the oldest entries past the limit', () => {
    const long = Array.from({ length: HISTORY_LIMIT }, (_, i) => ({ status: 'working' as const, at: i }))
    const out = pushStatus(long, 'waiting', 9999)
    expect(out).toHaveLength(HISTORY_LIMIT)
    expect(out[0].at).toBe(1)
    expect(out.at(-1)).toEqual({ status: 'waiting', at: 9999 })
  })
})
