import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDiff } from '@shared/diff'
import { blastRadius, buildCockpit, changedNames, hunkFlags, hunksOf, parseGrep, signatureChanges } from '@shared/review'
import { uses } from '../src/main/git'

const file = (path: string, body: string, head = ''): string => `diff --git a/${path} b/${path}\n${head}--- a/${path}\n+++ b/${path}\n${body}`
const hunks = (d: string) => hunksOf(parseDiff(d))
const sigs = (path: string, body: string) => signatureChanges(hunks(file(path, body))[0]).map((s) => `${s.name}: ${s.why}`)

describe('signature changes', () => {
  it('sees a parameter added or removed', () => {
    expect(sigs('src/config.ts', '@@ -1,3 +1,3 @@\n-export function parseConfig(text: string) {\n+export function parseConfig(text: string, strict: boolean) {\n   return JSON.parse(text)\n')).toEqual(['parseConfig: a parameter added'])
    expect(sigs('src/config.ts', '@@ -1,3 +1,3 @@\n-export async function load(a, b, c) {\n+export async function load(a) {\n   return a\n')).toEqual(['load: 2 parameters removed'])
    expect(sigs('lib/x.py', '@@ -1,2 +1,2 @@\n-def fetch_all(url):\n+def fetch_all(url, timeout=5):\n     pass\n')).toEqual(['fetch_all: a parameter added'])
    expect(sigs('srv/x.go', '@@ -1,2 +1,2 @@\n-func (s *Server) Handle(w http.ResponseWriter) {\n+func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {\n }\n')).toEqual(['Handle: a parameter added'])
  })
  it('sees a retyped parameter and an arrow function', () => {
    expect(sigs('src/a.ts', '@@ -1,1 +1,1 @@\n-export const toUser = (row: Row) => row.name\n+export const toUser = (row: Row, opts?: Opts) => row.name\n')).toEqual(['toUser: a parameter added'])
    expect(sigs('src/a.ts', '@@ -1,1 +1,1 @@\n-export function ident(x: string): string {\n+export function ident(x: number): string {\n')).toEqual(['ident: its parameters changed'])
  })
  it('reads a parameter list over several lines', () => {
    expect(sigs('src/a.ts', '@@ -1,5 +1,6 @@\n export function make(\n   name: string,\n+  size: number,\n ) {\n   return name\n')).toEqual(['make: a parameter added'])
  })
  it("doesn't flag a body-only change, a reformat or a non-function", () => {
    const body = file('src/config.ts', '@@ -1,4 +1,4 @@ export function parseConfig(text: string) {\n   const v = JSON.parse(text)\n-  return v\n+  return { ...v, strict: true }\n }\n')
    expect(signatureChanges(hunks(body)[0])).toEqual([])
    expect(hunkFlags(hunks(body)[0]).map((f) => f.id)).not.toContain('signature')
    expect(sigs('src/a.ts', '@@ -1,1 +1,1 @@\n-export function f(a,b) {\n+export function f(a, b) {\n')).toEqual([])
    expect(sigs('src/a.ts', '@@ -1,1 +1,1 @@\n-export async function f(a) {\n+export function f(a) {\n')).toEqual([])
    expect(sigs('src/a.ts', '@@ -1,1 +1,1 @@\n-export const LIMIT = max(1)\n+export const LIMIT = max(2)\n')).toEqual([])
    expect(sigs('src/a.py', '@@ -1,1 +1,1 @@\n-class Foo(Base):\n+class Foo(Other):\n')).toEqual([])
  })
  it('is an amber flag on the part', () => {
    const c = buildCockpit(parseDiff(file('src/config.ts', '@@ -1,2 +1,2 @@\n-export function parseConfig(text: string) {\n+export function parseConfig(text: string, strict: boolean) {\n')), null, [])
    const f = c.parts[0].flags.find((x) => x.id === 'signature')
    expect(f?.label).toBe('Signature changed')
    expect(f?.why).toContain('parseConfig: a parameter added')
  })
})

describe('changed names', () => {
  it('finds signature, body and removed changes, not new names or tests', () => {
    const d = [
      file('src/config.ts', '@@ -1,2 +1,2 @@\n-export function parseConfig(text: string) {\n+export function parseConfig(text: string, strict: boolean) {\n'),
      file('src/load.ts', '@@ -10,3 +10,3 @@ export function loadAll(dir: string) {\n   const a = 1\n-  return a\n+  return a + 1\n'),
      file('src/old.ts', '@@ -1,1 +0,0 @@\n-export function legacyThing() {}\n'),
      file('src/new.ts', '@@ -0,0 +1,1 @@\n+export function brandNew() {}\n', 'new file mode 100644\n'),
      file('test/x.test.ts', '@@ -1,1 +1,1 @@\n-export function helperForTests(a) {}\n+export function helperForTests(a, b) {}\n')
    ].join('')
    expect(changedNames(hunks(d)).map((n) => `${n.name}:${n.kind}`).sort()).toEqual(['legacyThing:removed', 'loadAll:body', 'parseConfig:signature'])
  })
})

describe('blast radius', () => {
  const d = file('src/config.ts', '@@ -1,2 +1,2 @@\n-export function parseConfig(text: string) {\n+export function parseConfig(text: string, strict: boolean) {\n') + file('src/a.ts', '@@ -3,1 +3,1 @@\n-parseConfig(x)\n+parseConfig(x, true)\n')
  it('counts the other places, the changed ones and lists the rest', () => {
    const grep = ['src/config.ts\x001\x00export function parseConfig(text: string, strict: boolean) {', 'src/a.ts\x003\x00parseConfig(x, true)', 'src/b.ts\x007\x00  const c = parseConfig(raw)', 'src/c.ts\x002\x00parseConfigFile()'].join('\n')
    const found = parseGrep(grep)
    expect(found).toHaveLength(4)
    const h = hunks(d)
    const [r] = blastRadius(changedNames(h), h, found)
    expect(r).toMatchObject({ name: 'parseConfig', kind: 'signature', uses: 2, changed: 1 })
    expect(r.untouched).toEqual([{ path: 'src/b.ts', line: 7, text: '  const c = parseConfig(raw)' }])
  })
})

describe('uses (git grep)', () => {
  let tmp = ''
  beforeAll(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sldev blast ')))
    const g = (...a: string[]) => execFileSync('git', a, { cwd: tmp })
    g('init', '-q')
    mkdirSync(join(tmp, 'src'))
    mkdirSync(join(tmp, 'node_modules/dep'), { recursive: true })
    mkdirSync(join(tmp, 'dist'))
    writeFileSync(join(tmp, 'src/a.ts'), 'import { parseConfig } from "./config"\nparseConfig(x)\nparseConfigFile()\n')
    writeFileSync(join(tmp, 'node_modules/dep/i.js'), 'parseConfig()\n')
    writeFileSync(join(tmp, 'dist/out.js'), 'parseConfig()\n')
    g('add', '-A', '-f')
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
    writeFileSync(join(tmp, 'src/new.ts'), 'parseConfig(y)\n')
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))
  it('finds whole words in tracked and untracked files, skipping node_modules and dist', async () => {
    const r = await uses(tmp, ['parseConfig'])
    expect(r.capped).toBe(false)
    expect(r.uses.map((u) => `${u.path}:${u.line}`).sort()).toEqual(['src/a.ts:1', 'src/a.ts:2', 'src/new.ts:1'])
  })
  it('answers nothing for no names, odd names or no matches', async () => {
    expect(await uses(tmp, [])).toEqual({ uses: [], capped: false })
    expect(await uses(tmp, ['-e', '--all'])).toEqual({ uses: [], capped: false })
    expect(await uses(tmp, ['nothingNamedThis'])).toEqual({ uses: [], capped: false })
  })
})

describe('imports', () => {
  it("aren't callers, unless the name was removed", () => {
    const sig = hunks(file('src/config.ts', '@@ -1,1 +1,1 @@\n-export function parseConfig(a) {\n+export function parseConfig(a, b) {\n'))
    const gone = hunks(file('src/config.ts', '@@ -1,1 +0,0 @@\n-export function parseConfig(a) {}\n'))
    const found = parseGrep(['src/a.ts\x001\x00import { parseConfig } from "./config"', 'src/b.py\x001\x00from config import parseConfig', 'src/a.ts\x004\x00parseConfig(x)'].join('\n'))
    expect(blastRadius(changedNames(sig), sig, found)[0].uses).toBe(1)
    expect(blastRadius(changedNames(gone), gone, found)[0]).toMatchObject({ kind: 'removed', uses: 3 })
  })
})
