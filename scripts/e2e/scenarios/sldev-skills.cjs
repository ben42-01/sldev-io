// sldev skills: Skills → "Add to this project" writes sldev's own skills (draft a mission, board stories, a
// recipe, an eval) into .claude/skills and .agents/skills. An agent that uses them leaves drafts in
// .sldev/drafts; the open app takes them in: a mission becomes a saved mission marked with who drafted it,
// stories land in Proposed with their order. Nothing launches until you press Launch.
const fs = require('fs')
const path = require('path')

module.exports = async (h) => {
  const f = h.fixture
  await h.openFixture({ rightPanelVisible: true })
  await h.click('.right-tab[title^="Skills"]')
  h.expect(await h.until(() => h.js(`document.querySelector('.sldev-skills')?.dataset.state === 'todo'`), 5000), 'the Skills tab offers the sldev skills')
  await h.wait(300)
  await h.shot('0-offer')

  await h.click('.sldev-skills .btn.primary', 'Add to this project')
  h.expect(await h.until(() => h.js(`document.querySelector('.sldev-skills')?.dataset.state === 'done'`), 5000), 'then says they are in this project')
  for (const dir of ['.claude/skills', '.agents/skills']) {
    h.expect(['sldev-mission', 'sldev-stories', 'sldev-recipe', 'sldev-eval'].every((n) => fs.existsSync(path.join(f, dir, n, 'SKILL.md'))), `written to ${dir}`)
  }
  h.expect(fs.readFileSync(path.join(f, '.sldev/drafts/.gitignore'), 'utf8') === '*\n', 'the drafts folder stays out of git')
  const rows = await h.until(async () => {
    const names = await h.js(`[...document.querySelectorAll('.asset-group[data-group="project"] .asset-row .rt-name')].map(r => r.textContent.trim())`)
    return names.filter((n) => n.startsWith('sldev-')).length ? names : null
  }, 5000)
  h.expect(rows && rows.filter((n) => n === 'sldev-mission').length === 1 && rows.filter((n) => n.startsWith('sldev-')).length === 4, `each skill is listed once, though it is in two folders (${rows})`)
  await h.wait(300)
  await h.shot('1-installed')

  // what an agent following the skills leaves behind
  const drafts = path.join(f, '.sldev/drafts')
  const old = Date.now() / 1000 - 30
  const put = (name, text) => (fs.writeFileSync(path.join(drafts, name), text), fs.utimesSync(path.join(drafts, name), old, old))
  put('mission-cache-plan.md', '---\ntitle: Plan a cache for the greeting\nkind: plan\nby: codex\nagent: codex\ncriteria:\n  - Says where the cache lives\n  - Names what invalidates it\n---\nThe greeting is computed on every request. Plan a cache for it; don\'t write code.\n')
  put('stories-login.json', JSON.stringify({ by: 'claude', stories: [
    { title: 'Store login attempts per IP', details: '**Why** brute force', labels: ['api'], priority: 'high' },
    { title: 'Rate-limit the login route', details: '**Why** brute force', labels: ['api'], after: ['Store login attempts per IP'] }
  ] }))
  put('mission-broken.md', '---\ntitle: [oops\n---\nbrief')

  h.key('3', ['control', 'shift'])
  h.expect(await h.until(() => h.js(`document.querySelector('.mission-row.saved.drafted .mission-row-sub')?.textContent.startsWith('Drafted by Codex')`), 10000), 'the mission draft is a saved mission, drafted by Codex')
  h.expect(await h.js(`[...document.querySelectorAll('.toast')].length > 0`), 'and the app says so')
  // saved missions are written a moment after they change
  const m = await h.until(async () => (await h.js(`window.api.store.get('savedMissions')`))?.saved?.find((s) => s.draftedBy === 'codex'), 3000)
  h.expect(m && m.kind === 'plan' && m.options.agent === 'codex' && m.options.permissionMode === 'read-only' && m.worktree === false && m.criteria === '- Says where the cache lives\n- Names what invalidates it', `with its kind, agent, read-only mode and criteria (${JSON.stringify(m)})`)
  h.expect(((await h.js(`window.api.store.get('missions')`))?.missions?.length ?? 0) === 0, 'nothing was launched')
  h.expect(await h.until(() => fs.readdirSync(drafts).sort().join() === '.gitignore,mission-broken.md.bad', 5000), `taken drafts leave the folder, a broken one is kept as .bad (${fs.readdirSync(drafts)})`)
  await h.wait(500)
  await h.shot('2-drafted-mission')

  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Board"]')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.board-column[data-column="proposed"] .board-card')`), 5000), 'the Board opens')
  const proposed = await h.js(`[...document.querySelectorAll('.board-column[data-column="proposed"] .board-card .board-title')].map(t => t.textContent)`)
  h.expect(['Store login attempts per IP', 'Rate-limit the login route'].every((t) => proposed.includes(t)), `the stories wait in Proposed (${proposed})`)
  const items = (await h.js(`window.api.store.get('board')`)).items
  const first = items.find((i) => i.title === 'Store login attempts per IP')
  const second = items.find((i) => i.title === 'Rate-limit the login route')
  h.expect(first?.by === 'claude' && second?.blockedBy?.includes(first.key), 'written by Claude, the second waiting for the first')
  await h.wait(400)
  await h.shot('3-proposed-stories')

  // launching is still yours
  h.key('3', ['control', 'shift'])
  await h.until(() => h.js(`!!document.querySelector('.mission-row.saved.drafted')`), 3000)
  await h.click('.mission-row.saved.drafted .btn', 'Launch')
  const started = await h.until(async () => (await h.js(`window.api.store.get('missions')`))?.missions?.find((x) => x.title === 'Plan a cache for the greeting'), 8000)
  h.expect(started && started.options.agent === 'codex' && started.kind?.id === 'plan', 'Launch starts it as drafted')
}
