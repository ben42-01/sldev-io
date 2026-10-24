import { describe, expect, it } from 'vitest'
import { agentCommand, BUILTIN_AGENTS, customAgentDef, findAgent, skillPrompt, slugify } from '@renderer/lib/agents'

const agent = (id: string) => findAgent(id)

describe('Claude Code', () => {
  const claude = agent('claude')

  it('builds an interactive session command', () => {
    expect(agentCommand(claude, { model: 'opus', permissionMode: 'plan' }, 'fix the bug', 'Fix bug')).toBe(
      "claude --model opus --permission-mode plan -n 'Fix bug' 'fix the bug'"
    )
  })

  it('passes the hooks file and resumes by session id without re-sending the prompt', () => {
    expect(agentCommand(claude, { print: true }, 'ignored', 'n', { resume: 'abc', settingsPath: '/tmp/s.json' })).toBe(
      'claude --settings /tmp/s.json --resume abc'
    )
  })

  it('escapes single quotes in prompts', () => {
    expect(agentCommand(claude, { print: true }, "don't", undefined)).toBe(`claude -p 'don'\\''t'`)
  })
})

describe('other agents', () => {
  it('never get the Claude hooks settings', () => {
    for (const a of BUILTIN_AGENTS.filter((x) => !x.hooks)) {
      expect(agentCommand(a, {}, 'hi', 'n', { settingsPath: '/tmp/s.json' })).not.toContain('--settings')
    }
  })

  it('build interactive, non-interactive and resume commands', () => {
    const cases: Array<[string, Parameters<typeof agentCommand>[1], string | true | undefined, string]> = [
      ['codex', { permissionMode: 'full-auto', effort: 'high' }, undefined, "codex --full-auto -c model_reasoning_effort=high 'do it'"],
      ['codex', { print: true }, undefined, "codex exec 'do it'"],
      ['codex', {}, true, 'codex resume --last'],
      ['cursor', { permissionMode: 'force', model: 'gpt-5' }, undefined, "cursor-agent --model gpt-5 --force 'do it'"],
      ['cursor', { print: true }, undefined, "cursor-agent -p 'do it'"],
      ['copilot', {}, undefined, "copilot -i 'do it'"],
      ['copilot', { print: true }, undefined, "copilot --allow-all-tools -p 'do it'"],
      ['copilot', {}, true, 'copilot --continue'],
      ['opencode', { model: 'anthropic/claude-sonnet', permissionMode: 'plan' }, undefined, "opencode --model anthropic/claude-sonnet --agent plan --prompt 'do it'"],
      ['opencode', { print: true }, undefined, "opencode run 'do it'"],
      ['gemini', { permissionMode: 'yolo' }, undefined, "gemini --approval-mode yolo -i 'do it'"],
      ['gemini', {}, true, 'gemini --resume latest']
    ]
    for (const [id, o, resume, expected] of cases) expect(agentCommand(agent(id), o, 'do it', 'Do it', { resume })).toBe(expected)
  })

  it('start a bare session without a prompt', () => {
    expect(agentCommand(agent('copilot'), {}, '', undefined)).toBe('copilot')
    expect(agentCommand(agent('opencode'), {}, undefined, undefined)).toBe('opencode')
  })
})

describe('custom agents', () => {
  const aider = customAgentDef({ id: 'c1', name: 'Aider', command: 'aider', printCommand: 'aider --message {prompt} --yes', resumeCommand: 'aider --restore-chat-history' })

  it('appends the prompt or fills placeholders', () => {
    expect(agentCommand(aider, { extraArgs: '--no-git' }, 'add tests', 'x')).toBe("aider 'add tests' --no-git")
    expect(agentCommand(aider, { print: true }, 'add tests', 'x')).toBe("aider --message 'add tests' --yes")
    expect(agentCommand(aider, {}, 'add tests', 'x', { resume: true })).toBe('aider --restore-chat-history')
    expect(aider.bin).toBe('aider')
  })

  it('falls back to Claude for unknown ids', () => {
    expect(findAgent('nope').id).toBe('claude')
    expect(findAgent('c1', [{ id: 'c1', name: 'Aider', command: 'aider' }]).name).toBe('Aider')
  })
})

describe('slugify', () => {
  it('makes branch-safe slugs', () => {
    expect(slugify('  Add OAuth login (v2)! ')).toBe('add-oauth-login-v2')
    expect(slugify('!!!')).toBe('mission')
    expect(slugify('x'.repeat(80))).toHaveLength(40)
  })
})

describe('skillPrompt', () => {
  const skill = { name: 'review', invocation: '/review', path: '/home/u/.claude/skills/review/SKILL.md' }
  it('uses the slash invocation for Claude Code', () => {
    expect(skillPrompt(agent('claude'), skill, ' the auth module ')).toBe('/review the auth module')
  })
  it('points other agents at the SKILL.md', () => {
    const p = skillPrompt(agent('codex'), skill, 'the auth module')
    expect(p).toContain('read /home/u/.claude/skills/review/SKILL.md')
    expect(p).toMatch(/Task: the auth module$/)
    expect(skillPrompt(agent('gemini'), skill, '')).not.toContain('Task:')
  })
})
