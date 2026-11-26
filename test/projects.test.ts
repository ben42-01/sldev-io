import { describe, expect, it } from 'vitest'
import { projectMenu, projectWork, workLabel } from '../src/shared/projects'

const m = (root: string, status: string): { root: string; status: string } => ({ root, status })

describe('projectWork', () => {
  it('counts what each project has going', () => {
    const work = projectWork(
      [m('/a', 'needs-input'), m('/a', 'working'), m('/b', 'starting'), m('/b', 'waiting'), m('/c', 'ended'), m('/c', 'failed')],
      [
        { root: '/c', status: 'running', nodes: { x: { status: 'approval' } } },
        { root: '/d', status: 'running', nodes: { x: { status: 'running' } } },
        { root: '/e', status: 'done', nodes: {} }
      ]
    )
    expect(work.get('/a')).toEqual({ root: '/a', needs: 1, working: 1, ready: 0 })
    expect(work.get('/b')).toEqual({ root: '/b', needs: 0, working: 1, ready: 1 })
    expect(work.get('/c')).toEqual({ root: '/c', needs: 1, working: 0, ready: 0 })
    expect(work.get('/d')?.working).toBe(1)
    expect(work.has('/e')).toBe(false)
  })
})

describe('projectMenu', () => {
  it('puts the open project first, then those that need you, then working ones, then recent', () => {
    const work = projectWork([m('/w', 'working'), m('/n', 'needs-input'), m('/r', 'waiting'), m('/open', 'needs-input')])
    expect(projectMenu('/open', work, ['/old', '/w', '/open'])).toEqual(['/open', '/n', '/w', '/r', '/old'])
  })

  it('works without an open project and stops at max', () => {
    expect(projectMenu(null, new Map(), ['/a', '/b', '/c'], 2)).toEqual(['/a', '/b'])
  })
})

describe('workLabel', () => {
  it('says what is going in a few words', () => {
    expect(workLabel({ root: '/a', needs: 2, working: 1, ready: 0 })).toBe('2 need you · 1 working')
    expect(workLabel({ root: '/a', needs: 1, working: 0, ready: 3 })).toBe('1 needs you · 3 ready')
    expect(workLabel(undefined)).toBe('')
  })
})
