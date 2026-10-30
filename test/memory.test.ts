import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { Mission } from '@shared/types'
import { MEMORY_HEADER, memoryEntry, memoryPointer, withMemory } from '@shared/memory'
import { handleMcp } from '../src/main/mcp'
import { memoryInfo, remember } from '../src/main/memory'

describe('project memory', () => {
  it('keeps entries to one dated line', () => {
    expect(memoryEntry('  Tests need\nPostgres  ', 'codex, mission "x"', new Date(2026, 9, 30))).toBe('- 2026-10-30: Tests need Postgres (codex, mission "x")')
    expect(memoryEntry('x'.repeat(600), '', new Date(2026, 0, 1)).length).toBe('- 2026-01-01: '.length + 500)
  })

  it('points missions at the file once it exists, and tells agents with the tools how to add to it', () => {
    expect(memoryPointer('/p/.sldev/memory.md', true, false)).toMatch(/recorded what they learned about this project in \/p\/\.sldev\/memory\.md/)
    expect(memoryPointer('/p/.sldev/memory.md', true, false)).not.toContain('sldev_remember')
    expect(memoryPointer('/p/.sldev/memory.md', false, true)).toMatch(/^If you learn something.*sldev_remember/)
    expect(memoryPointer('/p/.sldev/memory.md', false, false)).toBe('')
    expect(withMemory('Do it\n', '')).toBe('Do it\n')
    expect(withMemory('Do it\n', 'Memory.')).toBe('Do it\n\nMemory.')
  })

  it('writes the file with its header on the first note, through sldev_remember', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sldev-mem-'))
    expect(await memoryInfo(root)).toMatchObject({ exists: false, entries: 0 })
    const self = { id: 'a', root, title: 'Fix login', options: { agent: 'codex' } } as unknown as Mission
    const r = await handleMcp({ mission: 'a', tool: 'sldev_remember', args: { note: 'Run npm run db:up before tests' }, cwd: root }, { missions: () => [self], send: () => undefined })
    expect(r.text).toBe('Saved to the project memory.')
    await remember(root, 'Second', 'you')
    const text = readFileSync(join(root, '.sldev', 'memory.md'), 'utf8')
    expect(text.startsWith(MEMORY_HEADER)).toBe(true)
    expect(text).toMatch(/- \d{4}-\d\d-\d\d: Run npm run db:up before tests \(codex, mission "Fix login"\)\n- \d{4}-\d\d-\d\d: Second \(you\)\n$/)
    expect(await memoryInfo(root)).toMatchObject({ exists: true, entries: 2 })
    expect((await handleMcp({ mission: 'a', tool: 'sldev_remember', args: { note: ' ' }, cwd: root }, { missions: () => [self], send: () => undefined })).error).toBe('note is empty')
  })
})
