// Agent profiles: a project profile from .sldev/agents, a new user profile, a mission run with one,
// and export as a Claude subagent.
const fs = require('fs')
const path = require('path')

module.exports = async (h) => {
  const dir = path.join(h.fixture, '.sldev', 'agents')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'reviewer.md'), '---\nname: Reviewer\ndescription: Reviews diffs, read-only\nagent: codex\nmode: read-only\n---\n\nYou review changes. Never edit files.\n')
  await h.openFixture()

  // Settings → Agents lists project, starter and (after saving) user profiles
  await h.click('.titlebar-version')
  await h.wait(600)
  const rows = () => h.js(`[...document.querySelectorAll('.profile-row')].map(r => r.querySelector('b').textContent + '|' + r.querySelector('.profile-scope').textContent)`)
  const listed = await rows()
  h.expect(listed.includes('Reviewer|project'), 'project profile from .sldev/agents is listed')
  h.expect(listed.includes('Implementer|starter') && listed.includes('Spec writer|starter'), 'starter profiles are listed')
  await h.click('.btn', 'New profile')
  await h.wait(200)
  await h.setValue('.profile-editor input', 'Docs writer', `e.placeholder === 'Reviewer'`)
  await h.setValue('.profile-editor textarea', 'You write and update docs only.')
  await h.js(`document.querySelector('.profile-editor')?.scrollIntoView({ block: 'center' })`)
  await h.shot('0-editor')
  await h.click('.profile-editor .btn.primary', 'Save')
  await h.wait(400)
  h.expect((await rows()).includes('Docs writer|yours'), 'a new profile is saved to your profiles')
  h.expect(await h.js(`window.api.settings.get().then(s => s.agentProfiles.some(p => p.name === 'Docs writer' && p.role.includes('docs only')))`), 'user profile persisted in settings')

  // export the project profile as a Claude subagent
  await h.click('.profile-row', 'Reviewer')
  await h.wait(200)
  await h.click('.profile-editor .btn', 'Export as Claude subagent')
  await h.wait(500)
  const exported = path.join(h.fixture, '.claude', 'agents', 'reviewer.md')
  h.expect(fs.existsSync(exported) && fs.readFileSync(exported, 'utf8').includes('Never edit files'), 'exported to .claude/agents/reviewer.md')
  await h.shot('1-settings')

  // a mission with the Reviewer profile runs Codex in read-only mode and keeps the prompt as typed
  h.key('3', ['control', 'shift'])
  await h.wait(500)
  await h.click('.btn', 'New mission')
  await h.wait(400)
  const reviewerId = await h.js(`[...document.querySelectorAll('.form select option')].find(o => o.textContent === 'Reviewer')?.value`)
  h.expect(await h.setValue('.form select', reviewerId, `e.querySelector('optgroup')`), 'pick the Reviewer profile')
  await h.wait(200)
  h.expect(await h.js(`[...document.querySelectorAll('.form select')].some(s => s.value === 'codex')`), 'the profile switches the agent to Codex')
  h.expect(await h.js(`[...document.querySelectorAll('.form select')].some(s => s.value === 'read-only')`), 'and sets its approval mode')
  await h.setValue('.form textarea', 'Review the last commit')
  await h.shot('2-mission-form')
  await h.click('.form .btn.primary', 'Launch')
  await h.wait(2500)
  const m = (await h.js(`window.api.store.get('missions')`)).missions[0]
  h.expect(m?.options.profile === reviewerId && m.options.agent === 'codex' && m.prompt === 'Review the last commit', 'mission stores the profile and the prompt as typed')
  h.expect(m?.history?.[0]?.status === 'starting', 'mission history starts with its launch')
  h.expect(await h.js(`document.querySelector('.mission-card .mission-agent')?.textContent === 'Reviewer · Codex'`), 'mission card shows the profile')
  await h.shot('3-mission')
}
