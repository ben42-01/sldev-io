import { mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { completePath, expandPath, parentFolder, projectList, readRecent, rememberProject, subfolders } from '../src/folders'
import { removeTemp } from './fakePath'

const tmp = mkdtempSync(join(tmpdir(), 'sldev-folders-'))
for (const d of ['alpha/.git', 'alpine', 'beta', '.hidden', 'Zeta']) mkdirSync(join(tmp, d), { recursive: true })
afterAll(() => removeTemp(tmp))

describe('folders for New tab', () => {
  it('lists folders by name, hidden ones left out, git repos marked', () => {
    expect(subfolders(tmp).map((f) => `${f.name}${f.git ? ' git' : ''}`)).toEqual(['alpha git', 'alpine', 'beta', 'Zeta'])
    expect(subfolders(join(tmp, 'nope'))).toEqual([])
    expect(parentFolder(join(tmp, 'alpha'))).toBe(tmp)
    expect(parentFolder(parentFolder(tmp)!.split(sep)[0] + sep)).toBeNull()
  })

  it('completes a typed folder as far as the matches agree, with a separator once there is one', () => {
    expect(completePath('al', tmp)).toBe('alp')
    expect(completePath('alph', tmp)).toBe(`alpha${sep}`)
    expect(completePath(`${tmp}${sep}be`, tmp)).toBe(`${tmp}${sep}beta${sep}`)
    expect(completePath('zz', tmp)).toBe('zz')
    expect(completePath('~/x', tmp, tmp)).toBe('~/x')
    expect(completePath('~/b', tmp, tmp)).toBe(`~/beta${sep}`)
    expect(expandPath('~/beta', '/', tmp)).toBe(join(tmp, 'beta'))
    expect(expandPath('beta', tmp)).toBe(join(tmp, 'beta'))
  })

  it('offers the projects tabs work in, then recent ones, once each and only while they exist', () => {
    const [a, b, c] = ['alpha', 'beta', 'gone'].map((d) => join(tmp, d))
    expect(projectList([b, a, b], [c, a, join(tmp, 'Zeta')], 3)).toEqual([b, a, join(tmp, 'Zeta')])
    const data = join(tmp, 'data')
    mkdirSync(data)
    expect(readRecent(data)).toEqual([])
    rememberProject(data, a)
    rememberProject(data, b)
    rememberProject(data, a)
    expect(readRecent(data)).toEqual([a, b])
    // no data folder (the TUI's tests): nothing is kept
    rememberProject('', a)
    expect(readRecent('')).toEqual([])
  })
})
