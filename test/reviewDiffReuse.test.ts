import { beforeEach, describe, expect, it, vi } from 'vitest'

// the resolver alone: the missions store, the dock and settings pull in the whole renderer
vi.mock('../src/renderer/src/state/missions', () => ({ getMission: vi.fn(), isLive: vi.fn(), missionBase: vi.fn(), refreshStats: vi.fn(), update: vi.fn(), useMission: vi.fn() }))
vi.mock('../src/renderer/src/dock/dockApi', () => ({ openPanel: vi.fn() }))
vi.mock('../src/renderer/src/state/workspace', () => ({ updateSettings: vi.fn(), workspace: { get: () => ({}) } }))

const prReview = vi.fn()
const api = window.api as unknown as Record<string, unknown>
api.gh = { prReview }
api.store = { get: vi.fn(async () => ({ reviews: [] })), set: vi.fn(async () => undefined) }
api.git = { findPrWorktree: vi.fn(async () => null) }

const { readReviewDiff, readReviewDiffAt } = await import('../src/renderer/src/state/reviewTargets')

const t = { kind: 'pr' as const, number: 128, root: '/repo' }
const meta = (head: string, diff: string) => ({ number: 128, title: 'T', body: '', url: '', head, branch: 'b', base: 'main', commits: [head], issues: [], diff })

describe('the diff a helper is given', () => {
  beforeEach(() => {
    prReview.mockReset()
  })
  it("reuses the diff the tab read while the PR is at that head, and reads again once it moved", async () => {
    prReview.mockResolvedValueOnce(meta('aaa', 'DIFF A'))
    expect(await readReviewDiff(t)).toBe('DIFF A')
    expect(await readReviewDiffAt(t, 'aaa')).toBe('DIFF A')
    expect(prReview).toHaveBeenCalledTimes(1)
    prReview.mockResolvedValueOnce(meta('bbb', 'DIFF B'))
    expect(await readReviewDiffAt(t, 'bbb')).toBe('DIFF B')
    expect(prReview).toHaveBeenCalledTimes(2)
    // no head known: read
    prReview.mockResolvedValueOnce(meta('bbb', 'DIFF B'))
    expect(await readReviewDiffAt(t)).toBe('DIFF B')
    expect(prReview).toHaveBeenCalledTimes(3)
  })
})
