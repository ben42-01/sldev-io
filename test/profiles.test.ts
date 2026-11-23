import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { applyProfile, claudeSubagentFile, installSummary, parseProfileFile, promptWithRole, serializeProfile, STARTER_PROFILES, TEAM_TEMPLATES, teamFiles } from '@shared/profiles'
import { installTeam, listProfiles } from '../src/main/profiles'
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

describe('team templates', () => {
  const software = TEAM_TEMPLATES.find((t) => t.id === 'software')!

  it('the Software team has the six roles, each with a name, description and role', () => {
    expect(software.profiles.map((p) => p.name)).toEqual(['Product owner', 'Tech lead', 'Implementer', 'Reviewer', 'QA', 'Release manager'])
    for (const p of software.profiles) {
      expect(p.description.trim()).not.toBe('')
      expect(p.role.trim()).not.toBe('')
      expect(p.agent).toBeUndefined()
    }
  })

  it('every template file reads back unchanged', () => {
    for (const t of TEAM_TEMPLATES) {
      const { write, skipped } = teamFiles(t, [])
      expect(skipped).toEqual([])
      expect(new Set(write.map((f) => f.path)).size).toBe(t.profiles.length)
      for (const f of write) {
        expect(f.path).toMatch(/^\.sldev\/agents\/[a-z0-9-]+\.md$/)
        const back = parseProfileFile(f.text, `/p/${f.path}`)!
        const { id: _i, scope: _s, path: _p, ...rest } = back
        const { id: _i2, scope: _s2, ...want } = f.profile
        expect(rest).toEqual({ ...want, agent: undefined, model: undefined, permissionMode: undefined, effort: undefined })
        expect(serializeProfile(back)).toBe(f.text)
      }
    }
  })

  it('team files record the team, so its roles can be grouped', () => {
    for (const f of teamFiles(software, []).write) {
      expect(f.text).toContain('team: Software team')
      expect(parseProfileFile(f.text, `/p/${f.path}`)?.team).toBe('Software team')
    }
    expect(parseProfileFile('---\nname: Solo\n---\n\nYou work alone.\n', '/p/solo.md')).not.toHaveProperty('team')
  })

  it('the install toast names the files it kept', () => {
    expect(installSummary('Software team', ['/p/a.md', '/p/b.md'], [])).toBe('Installed Software team: 2 roles in .sldev/agents')
    expect(installSummary('Software team', ['/p/a.md'], ['/p/.sldev/agents/reviewer.md', 'C:\\p\\qa.md'])).toBe('Installed Software team: 1 role in .sldev/agents · kept reviewer.md, qa.md (already there)')
    expect(installSummary('Software team', [], ['/p/x.md'])).toBe('Software team is already installed: kept x.md (already there)')
  })

  it('skips roles whose file already exists', () => {
    const { write, skipped } = teamFiles(software, ['reviewer.md', '/p/.sldev/agents/qa.md', 'notes.md'])
    expect(skipped.map((f) => f.path)).toEqual(['.sldev/agents/reviewer.md', '.sldev/agents/qa.md'])
    expect(write.map((f) => f.path)).toEqual([
      '.sldev/agents/product-owner.md',
      '.sldev/agents/tech-lead.md',
      '.sldev/agents/implementer.md',
      '.sldev/agents/release-manager.md'
    ])
  })

  it('no role tells an agent to push, merge or approve cards', () => {
    for (const t of TEAM_TEMPLATES)
      for (const p of t.profiles)
        for (const sentence of p.role.split(/(?<=[.:;])\s+|\n/)) {
          if (/\b(push|pushes|merge|merges|approve|approves|publish)\b/i.test(sentence)) expect(sentence, p.name).toMatch(/\b(never|not|don't)\b/i)
          if (/\bAgent ready\b/.test(sentence)) expect(sentence, p.name).toMatch(/\bperson\b/)
        }
  })
})

describe('installTeam', () => {
  it('writes the missing roles and leaves existing files untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'team-'))
    try {
      const dir = join(root, '.sldev', 'agents')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'reviewer.md'), 'hand edited')
      const r = await installTeam(root, 'software')
      expect(r.skipped).toEqual([join(dir, 'reviewer.md')])
      expect(r.written).toHaveLength(5)
      expect(await readFile(join(dir, 'reviewer.md'), 'utf8')).toBe('hand edited')
      expect((await listProfiles(root)).map((p) => p.name).sort()).toEqual(['Implementer', 'Product owner', 'QA', 'Release manager', 'Tech lead'])
      const again = await installTeam(root, 'software')
      expect(again.written).toEqual([])
      expect(again.skipped).toHaveLength(6)
      expect((await listProfiles(root)).filter((p) => p.team === 'Software team')).toHaveLength(5)
      await expect(installTeam(root, 'nope')).rejects.toThrow('Unknown team template')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
