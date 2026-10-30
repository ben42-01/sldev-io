import { describe, expect, it } from 'vitest'
import { ASK_GENERIC, askLine } from '@shared/attention'

const opencode = /Permission required|Allow once|Always allow/

describe('askLine', () => {
  it("finds OpenCode's permission dialog near the bottom of the screen", () => {
    const screen = ['I need to run the tests first.', '', '┃ △ Permission required', '┃ $ npm test', '┃', '┃ Allow once   Always allow   Reject', ''].join('\n')
    expect(askLine(screen, opencode)).toBe('Permission required')
  })

  it('ignores a prompt that scrolled up', () => {
    const screen = ['Allow command `rm`? [y/N] y', ...Array.from({ length: 40 }, (_, i) => `step ${i}`)].join('\n')
    expect(askLine(screen, ASK_GENERIC)).toBeNull()
  })

  it("doesn't flag the mission's own prompt", () => {
    const prompt = 'Explain when the CLI shows Allow once and when it asks Do you want to run'
    expect(askLine(`$ opencode --prompt '${prompt}'\nIt shows the dialog for every shell command.`, opencode, prompt)).toBeNull()
  })

  it('knows the usual shapes for custom agents', () => {
    for (const l of ['Overwrite file? [y/N]', 'Do you want to run this command?', 'Would you like to make the following edits?', 'Allow execution of: npm test?']) {
      expect(askLine(`working…\n${l}`, ASK_GENERIC)).toBe(l)
    }
    expect(askLine('All tests pass. Do you want me to open a PR next time?', ASK_GENERIC)).toBeNull()
  })
})
