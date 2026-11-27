import { describe, expect, it } from 'vitest'
import type { ClaudeAsset } from '@shared/types'
import { COLLAPSE_OVER, groupAssets, isGroupOpen } from '@renderer/lib/assets'
import { agentCommand as agentArgv, BUILTIN_AGENTS, commandText, cheapModelOf, customAgentDef, findAgent, skillPrompt, slugify, stageMode, withKindModel } from '@renderer/lib/agents'

const agent = (id: string) => findAgent(id)
const agentCommand = (...a: Parameters<typeof agentArgv>): string => commandText(agentArgv(...a))

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

  it('keeps the prompt and the session name as single, unquoted argv elements', () => {
    const prompt = 'I need you to "create" a doc\n& more %PATH%'
    expect(agentArgv(claude, {}, prompt, 'I need you')).toEqual(['claude', '-n', 'I need you', prompt])
  })

  it('passes the MCP config as one JSON argument', () => {
    const argv = agentArgv(claude, {}, 'hi', undefined, { mcp: { command: '/app/sldev', args: ['/u/mcp.cjs', '--mission', 'm1'], env: { ELECTRON_RUN_AS_NODE: '1' } } })
    expect(argv[1]).toBe('--mcp-config')
    expect(JSON.parse(argv[2]).mcpServers.sldev.args).toEqual(['/u/mcp.cjs', '--mission', 'm1'])
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
      ['codex', { permissionMode: 'full-auto', effort: 'high' }, undefined, "codex --sandbox workspace-write --ask-for-approval on-request -c model_reasoning_effort=high 'do it'"],
      ['codex', { permissionMode: 'full-auto', print: true }, undefined, "codex exec --sandbox workspace-write 'do it'"],
      ['codex', { print: true }, undefined, "codex exec 'do it'"],
      ['codex', {}, true, 'codex resume --last'],
      ['cursor', { permissionMode: 'force', model: 'gpt-5' }, undefined, "agent --model gpt-5 --force 'do it'"],
      ['cursor', { print: true }, undefined, "agent -p --trust 'do it'"],
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

  it('splits templates into words, so values never become extra arguments', () => {
    const tool = customAgentDef({ id: 'c2', name: 'Tool', command: 'tool --model {model} --title={name} {prompt}' })
    expect(agentArgv(tool, { model: 'big one', extraArgs: '--flag "x y"' }, 'do "it" now', 'My task')).toEqual(['tool', '--model', 'big one', '--title=My task', 'do "it" now', '--flag', 'x y'])
    expect(agentArgv(tool, {}, '', undefined)).toEqual(['tool', '--model', '--title='])
  })

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

describe('stageMode', () => {
  it('lets stages work alone unless settings say otherwise', () => {
    expect(stageMode(agent('claude'), {})).toBe('auto')
    expect(stageMode(agent('codex'), undefined)).toBe('full-auto')
    expect(stageMode(agent('opencode'), {})).toBeUndefined()
    expect(stageMode(agent('claude'), { claude: 'bypassPermissions' })).toBe('bypassPermissions')
    // '' = the CLI's own default
    expect(stageMode(agent('claude'), { claude: '' })).toBeUndefined()
  })
})

describe('cheap models', () => {
  const claude = findAgent('claude')
  const codex = findAgent('codex')
  it('are the agent’s own low-cost model unless settings change it', () => {
    expect(cheapModelOf(claude, undefined)).toBe('haiku')
    expect(cheapModelOf(claude, { claude: 'sonnet' })).toBe('sonnet')
    // '' = the agent's default model
    expect(cheapModelOf(claude, { claude: '' })).toBeUndefined()
    expect(cheapModelOf(codex, {})).toBeUndefined()
    expect(cheapModelOf(codex, { codex: 'small-model' })).toBe('small-model')
  })
  it('fill the model only for a cheap kind, and never over one the user picked', () => {
    expect(withKindModel({ agent: 'claude' }, { cheap: true }, claude, {})).toEqual({ agent: 'claude', model: 'haiku' })
    expect(withKindModel({ agent: 'claude', model: 'opus' }, { cheap: true }, claude, {})).toEqual({ agent: 'claude', model: 'opus' })
    expect(withKindModel({ agent: 'claude' }, { cheap: false }, claude, {})).toEqual({ agent: 'claude' })
    expect(withKindModel({ agent: 'claude' }, undefined, claude, {})).toEqual({ agent: 'claude' })
    expect(withKindModel({ agent: 'codex' }, { cheap: true }, codex, {})).toEqual({ agent: 'codex' })
    expect(agentArgv(claude, withKindModel({}, { cheap: true }, claude, {}), 'go', undefined)).toEqual(['claude', '--model', 'haiku', 'go'])
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
    expect(p).toMatch(/Arguments \(wherever the skill says \$ARGUMENTS\):\nthe auth module$/)
    expect(skillPrompt(agent('gemini'), skill, '')).not.toContain('Arguments')
  })
})

describe('groupAssets', () => {
  const asset = (name: string, source: ClaudeAsset['source'], plugin?: string): ClaudeAsset => ({ kind: 'skill', name, description: '', source, plugin, path: `/${source}/${plugin ?? ''}/${name}`, invocation: `/${name}` })
  const many = Array.from({ length: COLLAPSE_OVER + 1 }, (_, i) => asset(`s${i}`, 'synced'))
  const groups = groupAssets([asset('zeta', 'user'), ...many, asset('b', 'plugin', 'tools'), asset('a', 'plugin', 'docs'), asset('mine', 'project'), asset('alpha', 'user')])

  it('groups by where assets were found, project first and synced last', () => {
    expect(groups.map((g) => g.key)).toEqual(['project', 'user', 'plugin:docs', 'plugin:tools', 'synced'])
    expect(groups[1].assets.map((a) => a.name)).toEqual(['alpha', 'zeta'])
  })
  it('collapses large groups unless the user opened them or a filter is active', () => {
    const synced = groups.at(-1)!
    expect(isGroupOpen(synced, undefined, false)).toBe(false)
    expect(isGroupOpen(synced, true, false)).toBe(true)
    expect(isGroupOpen(synced, false, true)).toBe(true)
    expect(isGroupOpen(groups[1], undefined, false)).toBe(true)
  })
})

describe('skillPrompt outside .claude', () => {
  it('points even Claude Code at a SKILL.md it cannot know by name', () => {
    const skill = { name: 'spec', invocation: '/spec', path: '/repo/.sldev/skills/spec/SKILL.md' }
    expect(skillPrompt(findAgent('claude'), skill, 'x')).toContain('read /repo/.sldev/skills/spec/SKILL.md')
  })
})
