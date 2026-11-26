import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import type { RuntimeDef } from '@shared/types'
import { addRuntime, checkName, findRuntime, listRuntimes, nameFrom, readSaved, removeRuntime, runtimesFile } from '../src/runtimes'
import { removeTemp } from './fakePath'

const tmp = mkdtempSync(join(tmpdir(), 'sldev-runtimes-'))
afterAll(() => removeTemp(tmp))

const repo = (name: string): string => {
  const dir = join(tmp, name)
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  return dir
}

describe('runtime names', () => {
  it('takes one from the command, skipping runners and flags', () => {
    expect(nameFrom('ls -lrt')).toBe('ls')
    expect(nameFrom('npm run dev')).toBe('dev')
    expect(nameFrom('pnpm run build:web')).toBe('build:web')
    expect(nameFrom('./scripts/deploy.sh --prod')).toBe('deploy.sh')
    expect(nameFrom('   ')).toBe('runtime')
  })

  it('refuses names you could not type after sldev runtime start', () => {
    expect(checkName('ls')).toBeNull()
    expect(checkName('web:dev')).toBeNull()
    expect(checkName('')).toMatch(/needs a name/)
    expect(checkName('two words')).toMatch(/no spaces/)
  })
})

describe('saved runtimes', () => {
  it('adds, replaces by name, keeps a subfolder relative, and removes', async () => {
    const root = repo('saved')
    mkdirSync(join(root, 'web'))
    expect(await addRuntime(root, { name: 'ls', command: 'ls -lrt' })).toMatchObject({ replaced: false, runtime: { name: 'ls', command: 'ls -lrt' } })
    expect(await addRuntime(root, { name: 'dev', command: 'npm run dev', cwd: join(root, 'web') })).toMatchObject({ runtime: { cwd: 'web' } })
    expect((await addRuntime(root, { name: 'ls', command: 'ls -la' })).replaced).toBe(true)
    expect(await readSaved(root)).toEqual([{ name: 'ls', command: 'ls -la' }, { name: 'dev', command: 'npm run dev', cwd: 'web' }])
    // the CLI's folder is git-ignored as a whole
    expect(readFileSync(join(root, '.sldev-cli', '.gitignore'), 'utf8')).toContain('*')
    await expect(addRuntime(root, { name: 'x', command: 'ls', cwd: tmp })).rejects.toThrow(/isn't inside the project/)
    await expect(addRuntime(root, { name: 'x', command: 'one\ntwo' })).rejects.toThrow(/one line/)
    expect(await removeRuntime(root, 'ls')).toBe(true)
    expect(await removeRuntime(root, 'ls')).toBe(false)
    expect((await readSaved(root)).map((r) => r.name)).toEqual(['dev'])
  })

  it('says where a broken file is, and skips entries it cannot use', async () => {
    const root = repo('broken')
    mkdirSync(join(root, '.sldev-cli'))
    writeFileSync(runtimesFile(root), '{ nope')
    await expect(readSaved(root)).rejects.toThrow(/runtimes\.json isn't valid JSON/)
    writeFileSync(runtimesFile(root), JSON.stringify({ runtimes: [{ name: 'ok', command: 'ls' }, { name: 'bad name', command: 'ls' }, { name: 'empty', command: '' }, 'junk'] }))
    expect(await readSaved(root)).toEqual([{ name: 'ok', command: 'ls' }])
  })
})

describe('listing and finding runtimes', () => {
  const detected = (root: string): RuntimeDef[] => [
    { id: 'npm::dev', name: 'dev', command: 'npm run dev', cwd: root, source: 'npm', group: 'package.json', detail: 'vite' },
    { id: 'npm:web:dev', name: 'dev', command: 'npm run dev', cwd: join(root, 'web'), source: 'npm', group: 'web/package.json' },
    { id: 'make::test', name: 'test', command: 'make test', cwd: root, source: 'make', group: 'Makefile' }
  ]

  it('lists added ones first, then the project scripts, and finds them by name or folder:name', async () => {
    const root = repo('listing')
    await addRuntime(root, { name: 'test', command: 'ls -lrt' })
    const list = await listRuntimes(root, async (r) => detected(r))
    expect(list.map((r) => [r.name, r.saved, r.group ?? ''])).toEqual([
      ['test', true, ''],
      ['dev', false, 'package.json'],
      ['dev', false, 'web/package.json'],
      ['test', false, 'Makefile']
    ])
    expect(list[1].detail).toBe('vite')
    // an added one wins over a script of the same name
    expect(findRuntime(list, 'test')).toMatchObject({ saved: true, command: 'ls -lrt' })
    expect(findRuntime(list, 'web:dev')?.cwd).toBe(join(root, 'web'))
    expect(findRuntime(list, 'web/package.json:dev')?.cwd).toBe(join(root, 'web'))
    expect(findRuntime(list, 'dev')?.cwd).toBe(root)
    expect(findRuntime(list, 'nope')).toBeUndefined()
  })

  it('finds package.json scripts with the real detector', async () => {
    const root = repo('real')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite', lint: 'eslint .' } }))
    const list = await listRuntimes(root)
    expect(list.map((r) => [r.name, r.command])).toEqual([
      ['dev', 'npm run dev'],
      ['lint', 'npm run lint']
    ])
  })
})
