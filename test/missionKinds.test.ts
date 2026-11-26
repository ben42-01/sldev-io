import { describe, expect, it } from 'vitest'
import { BUILTIN_KINDS, findKind, kindDraft, parseKindFile, renderKind, syncStep } from '@shared/missionKinds'
import { missionPrompt } from '@shared/missionPrompt'

const kind = (id: string) => findKind(BUILTIN_KINDS, id)

describe('mission kinds', () => {
  it('keeps the Build prompt as it was', () => {
    const p = missionPrompt({ title: 'Users pagination', brief: 'Add pagination', criteria: 'npm test passes' })
    expect(p).toBe(renderKind(kind('build'), { title: 'Users pagination', brief: 'Add pagination', criteria: 'npm test passes' }))
    expect(p.split('\n')[0]).toBe('Mission: Users pagination')
  })

  it('never tells a research mission to report what it changed', () => {
    const p = renderKind(kind('research'), { title: 'Auth flow', brief: 'How does login work? Do not change anything.' })
    expect(p.startsWith('Research: Auth flow')).toBe(true)
    expect(p).not.toMatch(/what changed/)
    expect(p).toMatch(/Do not create, modify or delete any files/)
    expect(kind('research').readOnly).toBe(true)
    expect(kind('research').worktree).toBe(false)
  })

  it('sends a freeform prompt exactly as written', () => {
    expect(renderKind(kind('freeform'), { title: 'x', brief: '  just this\nand this  ' })).toBe('just this\nand this')
  })

  it('drops the lines of empty placeholders and appends the brief when the template has none', () => {
    expect(renderKind({ template: 'A\n\n{criteria}\n\nB' }, { title: 't', brief: 'b' })).toBe('A\n\nB\n\nb')
    expect(renderKind({ template: 'Role: auditor.' }, { title: 't', brief: 'check it', criteria: 'no secrets' })).toBe('Role: auditor.\n\ncheck it')
    expect(renderKind({ template: 'T: {title} / {brief}' }, { title: 'x', brief: 'y' })).toBe('T: x / y')
  })

  it('tells only worktree missions of kinds that change code to merge the base and re-run the checks', () => {
    const o = { title: 't', brief: 'b' }
    const inPlace = renderKind(kind('build'), o)
    expect(inPlace).not.toMatch(/git fetch|\{sync\}/)
    expect(inPlace.endsWith('Do not commit, push or merge unless the task explicitly asks.')).toBe(true)
    const wt = renderKind(kind('build'), { ...o, worktree: true, base: 'master' })
    expect(wt.startsWith(inPlace)).toBe(true)
    expect(wt.slice(inPlace.length)).toBe(`\n${syncStep('master')}`)
    expect(syncStep('master')).toMatch(/git fetch.*merge `master`.*resolve any conflicts, re-run the checks and commit the merge/)
    expect(syncStep('master')).toMatch(/never push/)
    expect(syncStep()).toContain('the branch this worktree was made from')
    for (const id of ['investigate', 'lead']) {
      expect(renderKind(kind(id), o)).not.toMatch(/git fetch|\{sync\}/)
      expect(renderKind(kind(id), { ...o, worktree: true })).toContain(syncStep())
    }
    for (const id of ['research', 'plan', 'review']) expect(renderKind(kind(id), { ...o, worktree: true, base: 'master' })).toBe(renderKind(kind(id), o))
    // a read-only custom kind that uses {sync} still gets nothing to merge
    expect(renderKind({ template: 'Go: {brief}\n{sync}', readOnly: true }, { ...o, worktree: true })).toBe('Go: b')
    expect(renderKind(kind('freeform'), { title: 'x', brief: ' just this ', worktree: true, base: 'master' })).toBe('just this')
    expect(renderKind(kind('map'), { ...o, worktree: true })).toBe(renderKind(kind('map'), o))
  })

  it('falls back to Build for an unknown kind', () => {
    expect(findKind(BUILTIN_KINDS, 'nope').id).toBe('build')
    expect(findKind(BUILTIN_KINDS, undefined).id).toBe('build')
  })

  it('reads a custom kind file and round-trips a draft', () => {
    const text = kindDraft(kind('research'), 'Security audit')
    const k = parseKindFile(text, '/p/.sldev/missions/security-audit.md', 'project')
    expect(k).toMatchObject({ name: 'Security audit', readOnly: true, worktree: false, scope: 'project', id: 'project:/p/.sldev/missions/security-audit.md' })
    // the help comment is for the person editing the file, not for the agent
    expect(k!.template).not.toContain('<!--')
    expect(renderKind(k!, { title: 't', brief: 'b' })).toBe(renderKind(kind('research'), { title: 't', brief: 'b' }))
    expect(parseKindFile('---\nname: x\n---\n', 'p', 'user')).toBeNull()
    expect(parseKindFile('no front matter', 'p', 'user')).toBeNull()
    expect(parseKindFile('---\nname: Write\naccess: write\nworktree: true\n---\nGo: {brief}', 'p', 'user')).toMatchObject({ readOnly: false, worktree: true })
  })
})
