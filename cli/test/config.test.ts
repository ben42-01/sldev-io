import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { configPath, DEFAULT_CONFIG, describeConfig, parseConfig, readConfig } from '../src/config'
import { preferredEditor } from '../src/editor'
import { removeTemp } from './fakePath'

const tmp = mkdtempSync(join(tmpdir(), 'sldev-config-'))
let n = 0
afterAll(() => removeTemp(tmp))

/** a data folder with `text` as its config.json (none when undefined) */
function folder(text?: string): string {
  const d = join(tmp, `d${++n}`)
  mkdirSync(d, { recursive: true })
  if (text !== undefined) writeFileSync(configPath(d), text)
  return d
}

describe('the CLI config file', () => {
  it('is <data>/config.json, and the defaults when it is missing', () => {
    const d = folder()
    expect(configPath(d)).toBe(join(d, 'config.json'))
    expect(readConfig(d)).toEqual({ ...DEFAULT_CONFIG, problem: 'not created yet, so the defaults apply' })
    expect(preferredEditor(d)).toBeNull()
  })

  it('falls back to the defaults on bad JSON, never a crash', () => {
    const d = folder('{ "editor": "zed", ')
    const c = readConfig(d)
    expect(c.editor).toBeNull()
    expect(c.problem).toMatch(/not valid JSON/)
    expect(describeConfig(d)).toContain(`${configPath(d)}: not valid JSON`)
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG)
    expect(parseConfig([1, 2])).toEqual(DEFAULT_CONFIG)
  })

  it('reads every key', () => {
    const d = folder(
      JSON.stringify({
        editor: 'zed',
        customAgents: [{ id: 'aider', name: 'Aider', command: 'aider --message {prompt}', printCommand: 'aider --yes -m {prompt}' }],
        failoverOrder: ['codex', 'gemini'],
        failoverAuto: true,
        unattendedModes: { claude: 'acceptEdits', codex: '' }
      })
    )
    expect(readConfig(d)).toEqual({
      editor: 'zed',
      customAgents: [{ id: 'aider', name: 'Aider', command: 'aider --message {prompt}', printCommand: 'aider --yes -m {prompt}' }],
      failoverOrder: ['codex', 'gemini'],
      failoverAuto: true,
      unattendedModes: { claude: 'acceptEdits', codex: '' }
    })
    expect(preferredEditor(d)).toBe('zed')
    expect(describeConfig(d)).toMatch(/^.*config\.json\n\{\n {2}"editor": "zed"/)
  })

  it('drops a wrong value on its own and keeps the rest', () => {
    const c = parseConfig({
      editor: 3,
      customAgents: [{ id: 'x' }, { id: 'ok', command: 'ok {prompt}' }, 'nope'],
      failoverOrder: 'codex',
      failoverAuto: 'yes',
      unattendedModes: { claude: 1, codex: 'full-auto' }
    })
    expect(c).toEqual({ editor: null, customAgents: [{ id: 'ok', name: 'ok', command: 'ok {prompt}' }], failoverOrder: [], failoverAuto: false, unattendedModes: { codex: 'full-auto' } })
  })
})
