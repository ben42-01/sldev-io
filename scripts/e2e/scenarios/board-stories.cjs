// Board stories: the board has its own tab and menu. An agent reads the code and writes well-defined
// stories (sldev_board_add) into Proposed; you approve them into Agent ready, one or all at once. A
// vague Backlog card is refined in place (sldev_board_update), and an agent without the sldev tools
// hands its stories back as a JSON file.
module.exports = async (h) => {
  await h.openFixture({ rightPanelVisible: false })

  const cards = (column) => h.js(`[...document.querySelectorAll('.board-column[data-column="${column}"] .board-card .board-title')].map(t => t.textContent)`)
  const card = (title) => `[...document.querySelectorAll('.board-card')].find(c => c.querySelector('.board-title')?.textContent === ${JSON.stringify(title)})`
  const missionsList = () => h.js(`window.api.store.get('missions').then(s => s.missions)`)

  // its own button on the activity bar
  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Board"]')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.board-panel') && document.querySelectorAll('.board-column').length === 6`), 3000), 'the Board opens in its own tab')
  h.expect(await h.js(`[...document.querySelectorAll('.board-column .mc-column-head')].map(c => c.childNodes[0].textContent).join()`) === 'Backlog,Proposed,Agent ready,In progress,Review,Done', 'Backlog → Proposed → Agent ready → In progress → Review → Done')
  h.expect(await h.js(`!!document.querySelector('[data-column="proposed"] .mc-column-empty .btn')`), 'an empty Proposed column offers to write stories')

  // the Board menu
  await h.click('.board-head-actions .btn', 'Board')
  await h.wait(250)
  const items = await h.js(`[...document.querySelectorAll('.ctx-menu .ctx-item')].map(i => i.textContent)`)
  h.expect(['New card', 'Write stories', 'Import GitHub issues', 'Approve all proposed', 'Check pull requests', 'Pick-up settings'].every((x) => items.some((i) => i.includes(x))), 'the Board menu has cards, stories, issues and pick-up')
  await h.wait(200)
  await h.shot('1-menu')
  await h.key('Escape')

  // Write stories: a feature in, a read-only mission out
  await h.click('.board-head-actions .btn.primary', 'Write stories')
  h.expect(await h.until(() => h.js(`document.querySelector('dialog[open] .modal-title')?.textContent === 'Write stories'`), 2000), 'the stories dialog opens')
  await h.setValue('dialog[open] .board-form textarea', 'Teams: users create a team, invite people by email, and owners remove members.')
  await h.until(() => h.js(`document.querySelector('dialog[open] .btn.primary')?.disabled === false`), 2000)
  await h.wait(200)
  await h.shot('2-write-stories')
  await h.click('dialog[open] .btn.primary', 'Write stories')
  h.expect(await h.until(() => h.js(`!!document.querySelector('[data-column="proposed"] .board-job')`), 5000), 'Proposed shows the agent writing')
  await h.wait(800)
  h.expect(await h.js(`document.querySelector('.board-panel')?.checkVisibility() === true`), 'the board stays in front')
  const m = (await missionsList()).find((x) => x.title.startsWith('Stories: Teams'))
  h.expect(!!m && m.kind?.id === 'stories' && m.worktree === undefined && m.prompt.includes('sldev_board_add') && m.prompt.includes('Acceptance criteria'), 'a read-only stories mission, in place, told to file with the tools')
  h.expect(await h.until(async () => (await cards('proposed')).length === 3, 15000), 'its three stories land in Proposed')
  h.expect(await h.until(() => h.js(`!document.querySelector('[data-column="proposed"] .board-job')`), 8000), 'and the writing row goes away when it reports')
  h.expect(await h.js(`${card('Create a team')}.querySelector('.board-by')?.textContent.includes('claude') && !!${card('Create a team')}.querySelector('.board-priority.high')`), 'cards say who wrote them, with their priority')
  h.expect(await h.until(() => h.js(`document.querySelector('.activity-btn[aria-label^="Board"]')?.getAttribute('aria-label') === 'Board: 3 to approve'`), 2000), 'the Board button counts what waits for approval')
  const story = (await h.js(`window.api.store.get('board')`)).items.find((i) => i.title === 'Create a team')
  h.expect(story?.column === 'proposed' && story.body.includes('**Acceptance criteria**') && !story.body.includes('Filed by'), 'each story has acceptance criteria')
  await h.wait(400)
  await h.shot('3-proposed')

  // approve one, then the rest at once
  await h.js(`[...${card('Create a team')}.querySelectorAll('.board-card-foot .btn')].find(b => b.textContent.includes('Approve')).click()`)
  h.expect(await h.until(async () => (await cards('ready')).includes('Create a team'), 2000), 'Approve moves a story to Agent ready')
  await h.click('[data-column="proposed"] .board-approve-all')
  h.expect(await h.until(async () => (await cards('ready')).length === 3 && !(await cards('proposed')).length, 2000), 'Approve all moves the rest')
  h.expect(JSON.stringify(await cards('ready')) === JSON.stringify(['Create a team', 'Invite people by email', 'Remove a member']), 'in the order they were approved')

  // refine a vague Backlog card in place
  await h.click('[data-column="backlog"] .board-add')
  await h.wait(200)
  await h.setValue('.board-quick input', 'Login is slow')
  await h.js(`document.querySelector('.board-quick').requestSubmit()`)
  await h.until(async () => (await cards('backlog')).includes('Login is slow'), 2000)
  await h.key('Escape')
  await h.js(`${card('Login is slow')}.querySelector('.icon-btn[aria-label="More"]').click()`)
  await h.wait(200)
  await h.click('.ctx-menu .ctx-item', 'Refine with an agent')
  h.expect(await h.until(() => h.js(`document.querySelector('dialog[open] .modal-title')?.textContent === 'Refine #4'`), 2000), 'Refine opens for the card')
  await h.click('dialog[open] .btn.primary', 'Refine')
  h.expect(await h.until(async () => (await cards('proposed')).includes('Cache the session lookup on login'), 15000), 'the agent rewrites the card in place, into Proposed (sldev_board_update)')
  h.expect(await h.until(async () => !(await h.js(`window.api.store.get('board')`)).items.find((i) => i.key === 4)?.refining, 8000), 'the card is no longer marked as being refined')
  const refined = (await h.js(`window.api.store.get('board')`)).items.find((i) => i.key === 4)
  h.expect(refined?.title === 'Cache the session lookup on login' && refined.labels.join() === 'perf,api', `same card, new title and labels (${JSON.stringify(refined && { t: refined.title, l: refined.labels })})`)
  await h.wait(400)
  await h.shot('4-refined')

  // an agent without the sldev tools hands its stories back as a file
  await h.wait(600)
  await h.openFixture({ rightPanelVisible: false, agentTools: false })
  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Board"]')
  await h.until(async () => (await cards('proposed')).includes('Cache the session lookup on login'), 3000)
  await h.js(`${card('Cache the session lookup on login')}.querySelector('.board-card-foot .btn').click()`)
  await h.until(async () => (await cards('ready')).includes('Cache the session lookup on login'), 2000)
  await h.click('.board-head-actions .btn.primary', 'Write stories')
  await h.until(() => h.js(`!!document.querySelector('dialog[open] .board-form textarea')`), 2000)
  await h.setValue('dialog[open] .board-form textarea', 'Teams again, from a file')
  await h.until(() => h.js(`document.querySelector('dialog[open] .btn.primary')?.disabled === false`), 2000)
  await h.click('dialog[open] .btn.primary', 'Write stories')
  const m2 = await h.until(async () => (await missionsList()).find((x) => x.title.startsWith('Stories: Teams again')), 5000)
  h.expect(!!m2 && m2.prompt.includes('the one file you may create') && !m2.prompt.includes('sldev_board_add'), 'without the tools, the agent is asked for a stories file')
  h.expect(await h.until(async () => (await h.js(`window.api.store.get('board')`)).jobs?.find((j) => j.mission === m2.id)?.done, 15000), 'the file is read when the agent stops')
  h.expect(!(await cards('proposed')).length && (await cards('ready')).length === 4, 'stories already on the board are not added twice')
}
