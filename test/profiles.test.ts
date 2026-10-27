import { describe, expect, it } from 'vitest'
import { applyProfile, claudeSubagentFile, parseProfileFile, promptWithRole, serializeProfile, STARTER_PROFILES } from '@shared/profiles'
import type { AgentProfile } from '@shared/types'
import { agentCommand as agentArgv, commandText, findAgent } from '@renderer/lib/agents'

const agentCommand = (...a: Parameters<typeof agentArgv>): string => commandText(agentArgv(...a))

const reviewer: AgentProfile = {
  id: 'user:r',
  name: 'Reviewer',
  description: 'Reviews diffs',
  agent: 'gemini',
  permissionMode: 'auto_edit',
  role: 'You review. Never edit.',
  scope: 'user'
}

describe('roles reach the agent', () => {
  it('as a system prompt for Claude Code', () => {
    expect(agentCommand(findAgent('claude'), {}, 'check it', 'Check', { role: 'Be brief.' })).toBe(
      "claude --append-system-prompt 'Be brief.' -n Check 'check it'"
    )
  })

  it('at the top of the prompt for agents without a system prompt flag', () => {
    const cmd = agentCommand(findAgent('codex'), {}, 'check it', undefined, { role: 'Be brief.' })
    expect(cmd).toBe(`codex ${"'Be brief.\n\n---\n\nTask:\ncheck it'"}`)
  })

  it('not again when a session is resumed', () => {
    expect(agentCommand(findAgent('claude'), {}, undefined, 'n', { resume: 'abc', role: 'Be brief.' })).toBe('claude --resume abc')
    expect(agentCommand(findAgent('codex'), {}, undefined, undefined, { resume: true, role: 'Be brief.' })).toBe('codex resume --last')
  })

  it('without a prompt, asks the agent to wait for the task', () => {
    expect(promptWithRole('Be brief.', '  ')).toBe('Be brief.\n\nWait for my first task.')
  })
})

describe('applyProfile', () => {
  it('takes the profile agent and its options', () => {
    expect(applyProfile({ agent: 'claude', model: 'opus', worktree: true }, reviewer)).toEqual({
      agent: 'gemini',
      model: undefined,
      permissionMode: 'auto_edit',
      effort: undefined,
      worktree: true,
      profile: 'user:r'
    })
  })

  it('keeps the picked agent for profiles that work with any', () => {
    const o = applyProfile({ agent: 'codex', model: 'gpt-5' }, STARTER_PROFILES[0])
    expect(o.agent).toBe('codex')
    expect(o.model).toBe('gpt-5')
    expect(o.profile).toBe(STARTER_PROFILES[0].id)
  })

  it('clears the profile', () => {
    expect(applyProfile({ agent: 'codex', profile: 'x' }, undefined)).toEqual({ agent: 'codex', profile: undefined })
  })
})

describe('profile files', () => {
  it('round-trip through front matter', () => {
    const text = serializeProfile(reviewer)
    expect(text).toContain('mode: auto_edit')
    const back = parseProfileFile(text, '/p/.sldev/agents/reviewer.md')
    expect(back).toMatchObject({ name: 'Reviewer', agent: 'gemini', permissionMode: 'auto_edit', role: 'You review. Never edit.', scope: 'project' })
  })

  it('skips files without a name or front matter', () => {
    expect(parseProfileFile('just text', 'a.md')).toBeNull()
    expect(parseProfileFile('---\ndescription: x\n---\nrole', 'a.md')).toBeNull()
    expect(parseProfileFile('---\n: [bad\n---\nrole', 'a.md')).toBeNull()
  })

  it('export to Claude only keeps model aliases', () => {
    expect(claudeSubagentFile({ ...reviewer, agent: 'claude', model: 'opus' })).toContain('model: opus')
    expect(claudeSubagentFile({ ...reviewer, agent: 'claude', model: 'claude-opus-5-5' })).not.toContain('model:')
    expect(claudeSubagentFile(reviewer)).toContain('name: reviewer')
  })
})
