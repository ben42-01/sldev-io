import { execFileSync } from 'child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { githubWebUrl, layoutGraph, parseGraphLog, parseRefs, prNumber, type GraphCommit, type GraphRow } from '@shared/gitGraph'
import { graphLog, showCommit } from '../src/main/git'

const c = (sha: string, ...parents: string[]): GraphCommit => ({ sha, parents, refs: [], author: 'a', time: 0, subject: sha })

/** Every lane leaving the bottom of a row enters the top of the next one, and nothing appears from nowhere. */
function expectContinuous(rows: GraphRow[]): void {
  for (let i = 0; i < rows.length - 1; i++) {
    const below = new Set([...rows[i].through.map((t) => t.col), ...rows[i].out.map((o) => o.to)])
    const above = new Set([...rows[i + 1].through.map((t) => t.col), ...rows[i + 1].into.map((t) => t.from)])
    expect([...above].sort(), `between ${rows[i].commit.sha} and ${rows[i + 1].commit.sha}`).toEqual([...below].sort())
  }
  // the first row starts with nothing above it, the last with nothing below (its parents are all drawn)
  expect(rows[0].into).toEqual([])
  for (const r of rows) {
    // a node never sits on a line passing through it
    expect(r.through.some((t) => t.col === r.col)).toBe(false)
    expect(r.width).toBeGreaterThan(Math.max(r.col, ...r.through.map((t) => t.col), ...r.out.map((o) => o.to), ...r.into.map((o) => o.from)))
  }
}

describe('layoutGraph', () => {
  it('lays linear history in one column', () => {
    const rows = layoutGraph([c('d', 'c'), c('c', 'b'), c('b', 'a'), c('a')])
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0, 0])
    expect(rows.every((r) => r.through.length === 0 && r.width === 1)).toBe(true)
    expect(rows[3].out).toEqual([])
    expect(new Set(rows.map((r) => r.color)).size).toBe(1)
    expectContinuous(rows)
  })

  it('puts an unmerged feature branch in its own lane that joins its fork point', () => {
    // main: m2 → m1 → base; feature: f2 → f1 → base
    const rows = layoutGraph([c('m2', 'm1'), c('f2', 'f1'), c('m1', 'base'), c('f1', 'base'), c('base')])
    const col = Object.fromEntries(rows.map((r) => [r.commit.sha, r.col]))
    expect(col).toEqual({ m2: 0, f2: 1, m1: 0, f1: 1, base: 0 })
    expect(rows[1].through).toEqual([{ col: 0, color: rows[0].color }])
    // both lanes run on to base and meet there
    expect(rows[3].out).toEqual([{ to: 1, color: rows[3].color }])
    expect(rows[4].into.map((i) => i.from)).toEqual([0, 1])
    expect(rows[4].out).toEqual([])
    expect(rows[1].color).not.toBe(rows[0].color)
    expectContinuous(rows)
  })

  it('draws a merge: the second parent opens a lane that ends where the branch forked', () => {
    // M merges f2 into main (m1); the branch forked at base
    const rows = layoutGraph([c('M', 'm1', 'f2'), c('f2', 'f1'), c('f1', 'base'), c('m1', 'base'), c('base')])
    const by = Object.fromEntries(rows.map((r) => [r.commit.sha, r]))
    expect(by.M.col).toBe(0)
    expect(by.M.out.map((o) => o.to)).toEqual([0, 1])
    expect([by.f2.col, by.f1.col, by.m1.col, by.base.col]).toEqual([1, 1, 0, 0])
    expect(by.f2.through.map((t) => t.col)).toEqual([0])
    // base is waited for by both lanes; they meet at it, and main keeps column 0 all the way
    expect(by.base.into.map((i) => i.from)).toEqual([0, 1])
    expect(by.m1.through.map((t) => t.col)).toEqual([1])
    expectContinuous(rows)
  })

  it('merges lanes that wait for the same commit', () => {
    // two branch tips with the same parent, both shown before it
    const rows = layoutGraph([c('x', 'p'), c('y', 'p'), c('p')])
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0])
    expect(rows[2].into.map((i) => i.from)).toEqual([0, 1])
    expect(rows[2].width).toBe(2)
    expectContinuous(rows)
  })

  it('reuses a freed column for the next branch', () => {
    const rows = layoutGraph([c('M', 'a', 'b1'), c('b1', 'a'), c('a', 'r'), c('t', 'r'), c('r')])
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0, 1, 0])
    expectContinuous(rows)
  })

  it('handles an octopus merge and roots of unrelated histories', () => {
    const rows = layoutGraph([c('O', 'a', 'b', 'c'), c('c'), c('b'), c('a')])
    expect(rows[0].out.map((o) => o.to)).toEqual([0, 1, 2])
    expect(rows.slice(1).map((r) => r.col)).toEqual([2, 1, 0])
    expectContinuous(rows)
  })

  it('lets lanes run off the bottom when parents are past the loaded page', () => {
    const rows = layoutGraph([c('M', 'a', 'b'), c('a', 'older')])
    expect(rows[1].through.map((t) => t.col)).toEqual([1])
    expect(rows[1].out).toEqual([{ to: 0, color: rows[0].color }])
    expectContinuous(rows)
  })

  it('stays fast on long histories', () => {
    const commits: GraphCommit[] = []
    for (let i = 0; i < 5000; i++) {
      const parents = [`c${i + 1}`]
      if (i % 10 === 0) parents.push(`b${i}`)
      commits.push(c(`c${i}`, ...parents))
      if (i % 10 === 0) commits.push(c(`b${i}`, `c${i + 3}`))
    }
    const t = performance.now()
    const rows = layoutGraph(commits)
    expect(performance.now() - t).toBeLessThan(500)
    expect(Math.max(...rows.map((r) => r.width))).toBeLessThan(6)
  })
})

describe('parsing', () => {
  it('reads refs into chips', () => {
    expect(parseRefs('HEAD -> main, origin/main, origin/HEAD, tag: v1.0, feature/x', ['origin'])).toEqual([
      { kind: 'head', name: 'main' },
      { kind: 'remote', name: 'origin/main' },
      { kind: 'tag', name: 'v1.0' },
      { kind: 'branch', name: 'feature/x' }
    ])
    expect(parseRefs('HEAD', [])).toEqual([{ kind: 'head', name: 'HEAD' }])
    expect(parseRefs('', ['origin'])).toEqual([])
  })

  it('parses the log format', () => {
    const sha = 'a'.repeat(40)
    const p1 = 'b'.repeat(40)
    const out = `${sha}\0${p1} ${'c'.repeat(40)}\0HEAD -> main\0Ann\x001700000000\0Merge pull request #7 from x/y\n${p1}\0\0\0Bob\x001600000000\0first\n`
    const [m, root] = parseGraphLog(out, ['origin'])
    expect(m.parents).toHaveLength(2)
    expect(m.refs).toEqual([{ kind: 'head', name: 'main' }])
    expect(m.time).toBe(1700000000000)
    expect(root).toMatchObject({ parents: [], refs: [], author: 'Bob', subject: 'first' })
  })

  it('finds PR numbers in merge and squash subjects', () => {
    expect(prNumber('Merge pull request #7 from ben/feature')).toBe(7)
    expect(prNumber('Add a stats panel (#12)')).toBe(12)
    expect(prNumber('Fix #3 in the parser')).toBeNull()
    expect(prNumber("Merge branch 'main'")).toBeNull()
  })

  it('turns origin URLs into GitHub links', () => {
    expect(githubWebUrl('git@github.com:acme/shop.git')).toBe('https://github.com/acme/shop')
    expect(githubWebUrl('https://github.com/acme/shop.git\n')).toBe('https://github.com/acme/shop')
    expect(githubWebUrl('https://token@github.com/acme/shop')).toBe('https://github.com/acme/shop')
    expect(githubWebUrl('ssh://git@github.com/acme/shop.git')).toBe('https://github.com/acme/shop')
    expect(githubWebUrl('git@gitlab.com:acme/shop.git')).toBeNull()
    expect(githubWebUrl('/tmp/remote.git')).toBeNull()
  })
})

describe('graphLog against a real repo', () => {
  let dir = ''
  const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.email=t@e.st', '-c', 'user.name=T', ...args], { cwd: dir, encoding: 'utf8' }).trim()
  const commit = (f: string, msg: string): void => {
    writeFileSync(join(dir, f), `${f}\n`)
    git('add', '.')
    git('commit', '-qm', msg)
  }

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'sldev-graph-')))
    git('init', '-q', '-b', 'main')
    commit('a', 'first')
    git('switch', '-qc', 'feature')
    commit('b', 'on feature')
    git('switch', '-q', 'main')
    commit('c', 'on main')
    git('merge', '-q', '--no-ff', '-m', 'Merge pull request #7 from me/feature', 'feature')
    git('tag', 'v1')
    git('remote', 'add', 'origin', 'git@github.com:acme/shop.git')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reads every branch in topo order with refs and the GitHub URL', async () => {
    const log = await graphLog(dir, 10)
    expect(log.more).toBe(false)
    expect(log.githubUrl).toBe('https://github.com/acme/shop')
    expect(log.commits.map((c) => c.subject)).toEqual(['Merge pull request #7 from me/feature', 'on feature', 'on main', 'first'])
    expect(log.commits[0].refs).toEqual([
      { kind: 'head', name: 'main' },
      { kind: 'tag', name: 'v1' }
    ])
    expect(log.commits[1].refs).toEqual([{ kind: 'branch', name: 'feature' }])
    const rows = layoutGraph(log.commits)
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0, 0])
    expectContinuous(rows)
  })

  it('says when there are more commits than the limit', async () => {
    const log = await graphLog(dir, 2)
    expect(log.commits).toHaveLength(2)
    expect(log.more).toBe(true)
  })

  it("shows a commit's own diff, a merge against its first parent", async () => {
    const [merge, feature] = (await graphLog(dir, 2)).commits
    expect(await showCommit(dir, feature.sha)).toContain('+++ b/b')
    const d = await showCommit(dir, merge.sha)
    expect(d).toContain('+++ b/b')
    expect(d).not.toContain('+++ b/c')
    await expect(showCommit(dir, '--all')).rejects.toThrow('Not a commit')
  })
})
