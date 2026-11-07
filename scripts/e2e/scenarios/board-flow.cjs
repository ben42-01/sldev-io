// Board flow: stories that wait for each other (pick-up skips them until their blocker is Done), what a
// card's work took, Copy as PR description, a retro that saves a lesson to the project memory, release
// notes from Done, and the board shared through .sldev/board.json (a teammate's edit comes in on focus,
// conflict markers stop it).
const fs = require('fs')
const path = require('path')

module.exports = async (h) => {
  await h.openFixture({ rightPanelVisible: false })
  const cards = (column) => h.js(`[...document.querySelectorAll('.board-column[data-column="${column}"] .board-card .board-title')].map(t => t.textContent)`)
  const card = (title) => `[...document.querySelectorAll('.board-card')].find(c => c.querySelector('.board-title')?.textContent === ${JSON.stringify(title)})`
  const stored = async () => (await h.js(`window.api.store.get('board')`)).items
  const menuOf = async (title, item) => {
    await h.js(`${card(title)}.querySelector('.icon-btn[aria-label="More"]').click()`)
    await h.wait(200)
    await h.click('.ctx-menu .ctx-item', item)
  }

  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Board"]')
  await h.until(() => h.js(`document.querySelectorAll('.board-column').length === 6`), 3000)

  // stories that depend on each other: "Remove a member" waits for "Create a team"
  await h.click('.board-head-actions .btn.primary', 'Write stories')
  await h.until(() => h.js(`!!document.querySelector('dialog[open] .board-form textarea')`), 2000)
  await h.setValue('dialog[open] .board-form textarea', 'Teams: create a team, invite people, owners remove members.')
  await h.wait(200)
  await h.click('dialog[open] .btn.primary', 'Write stories')
  h.expect(await h.until(async () => (await cards('proposed')).length === 3, 15000), 'three stories land in Proposed')
  h.expect(await h.until(() => h.js(`${card('Remove a member')}?.querySelector('.board-waits')?.textContent.includes('#1')`), 3000), 'a story an agent filed "after" another waits for it (#1)')
  h.expect(await h.js(`${card('Create a team')}.querySelector('.board-waits.unblocks')?.textContent.includes('#3')`), 'and the one it waits for says what it unblocks')
  await h.click('[data-column="proposed"] .board-approve-all')
  await h.until(async () => (await cards('ready')).length === 3, 2000)
  h.expect(await h.js(`${card('Remove a member')}.querySelector('.board-card-foot .btn')?.disabled === true`), 'its Start button is off while it waits')

  // the edit dialog refuses a loop
  await h.js(`${card('Create a team')}.querySelector('.board-title').click()`)
  await h.until(() => h.js(`!!document.querySelector('dialog[open] input[aria-label="Waits for"]')`), 2000)
  await h.setValue('dialog[open] input[aria-label="Waits for"]', '#3')
  h.expect(await h.until(() => h.js(`document.querySelector('dialog[open] .field-hint.evals-error')?.textContent.includes('loop') && document.querySelector('dialog[open] .btn.primary').disabled`), 2000), 'waiting for a card that waits for this one is refused')
  await h.setValue('dialog[open] input[aria-label="Waits for"]', '')
  await h.click('dialog[open] .btn.ghost', 'Cancel')
  await h.wait(200)
  await h.shot('1-waits-for')

  // pick-up, three at a time: the blocked card stays in Agent ready
  await h.click('.board-page .btn', 'at a time')
  await h.until(() => h.js(`document.querySelector('dialog[open] .modal-title')?.textContent === 'Pick-up'`), 2000)
  await h.setValue('dialog[open] select', '3', `[...e.options].some(o => o.textContent === '3 cards')`)
  await h.click('dialog[open] .btn.primary', 'Save')
  await h.click('.board-page .chip-check input')
  h.expect(await h.until(async () => (await cards('progress')).length + (await cards('review')).length === 2, 10000), 'pick-up starts the two cards that can start')
  h.expect(JSON.stringify(await cards('ready')) === JSON.stringify(['Remove a member']), 'and leaves the one that waits')
  h.expect(await h.until(async () => (await cards('review')).length === 2, 20000), 'both finish into Review')
  h.expect(await h.until(() => h.js(`!!${card('Create a team')}.querySelector('.board-spent')?.textContent.match(/\\d+s|min/)`), 5000), 'a finished card says what its work took')
  const spent = await h.until(async () => (await stored()).find((i) => i.title === 'Create a team').spent, 3000)
  h.expect(!!spent && spent.missions === 1 && spent.ms > 0, `the time is saved on the card (${JSON.stringify(spent)})`)
  h.expect(await h.js(`[...${card('Create a team')}.querySelectorAll('.board-card-foot .btn')].some(b => b.textContent.includes('Review'))`), 'a card in Review opens the review cockpit from its Review button')
  await h.wait(300)
  await h.shot('2-review-spent')

  // Copy as PR description
  await menuOf('Create a team', 'Copy as PR description')
  h.expect(await h.until(() => h.js(`document.querySelector('.toast')?.textContent.includes('pull request description')`), 4000), 'a toast says it was copied')
  const pr = await h.js(`window.api.clipboard.readText()`)
  h.expect(pr.startsWith('## Create a team') && pr.includes('### What changed') && pr.includes('- [ ] POST /teams creates one') && pr.includes('### How to check') && pr.includes('Card #1'), `the description has the story, the report and criteria to tick:\n${pr}`)
  await h.shot('3-copied')

  // Done unblocks the waiting card, and pick-up takes it
  await menuOf('Create a team', 'Done')
  h.expect(await h.until(async () => !(await cards('ready')).includes('Remove a member'), 12000), 'once its blocker is Done, pick-up starts the waiting card')
  await h.click('.board-page .chip-check input')

  // a retro saves a lesson to the project memory
  await menuOf('Create a team', 'Retro')
  const retro = await h.until(() => h.js(`window.api.store.get('missions').then(s => s.missions.find(m => m.kind?.id === 'retro'))`), 5000)
  h.expect(!!retro && retro.prompt.startsWith('Retro: card #1') && retro.prompt.includes('sldev_remember') && retro.prompt.includes('What happened'), 'a read-only retro mission is told what happened')
  const memory = path.join(h.fixture, '.sldev', 'memory.md')
  h.expect(await h.until(async () => fs.existsSync(memory) && fs.readFileSync(memory, 'utf8').includes('Teams live in src/teams.js'), 15000), 'its lesson is in .sldev/memory.md')
  h.expect(await h.until(() => h.js(`${card('Create a team')}.querySelector('.board-by .lucide-brain') && ${card('Create a team')}.textContent.includes('1')`), 8000), 'the card shows the lesson it left')

  // release notes from Done
  await menuOf('Invite people by email', 'Done')
  await h.wait(300)
  await h.click('[data-column="done"] .icon-btn[aria-label="Release notes"]')
  await h.until(() => h.js(`document.querySelector('dialog[open] .modal-title')?.textContent === 'Release notes'`), 2000)
  await h.setValue('dialog[open] input[aria-label="Version"]', '1.4.0')
  await h.wait(200)
  const notes = await h.js(`document.querySelector('dialog[open] textarea').value`)
  h.expect(notes.startsWith('## 1.4.0') && notes.includes('### New') && notes.includes('- Create a team') && notes.includes('- Invite people by email'), `release notes list the Done cards:\n${notes}`)
  await h.shot('4-release-notes')
  await h.click('dialog[open] .btn.primary', 'mark released')
  h.expect(await h.until(async () => (await stored()).filter((i) => i.released === '1.4.0').length === 2, 3000), 'marking them released stamps the cards')
  h.expect((await h.js(`window.api.clipboard.readText()`)).startsWith('## 1.4.0'), 'and the notes are on the clipboard')
  await h.click('[data-column="done"] .icon-btn[aria-label="Release notes"]')
  h.expect(await h.until(() => h.js(`document.querySelector('dialog[open] .mc-column-empty')?.textContent.includes('Nothing in Done')`), 2000), 'the next notes start after them')
  await h.click('dialog[open] .btn.ghost', 'Cancel')

  // the board in git
  const file = path.join(h.fixture, '.sldev', 'board.json')
  await h.click('.board-head-actions .btn', 'Board')
  await h.wait(200)
  await h.click('.ctx-menu .ctx-item', 'Share the board through git')
  await h.until(() => h.js(`!!document.querySelector('dialog[open]')`), 2000)
  await h.shot('5-share')
  await h.click('dialog[open] .btn.primary', 'Share the board')
  h.expect(await h.until(async () => fs.existsSync(file), 4000), '.sldev/board.json is written')
  const shared = JSON.parse(fs.readFileSync(file, 'utf8'))
  h.expect(shared.cards.length === 3 && shared.cards[2].blockedBy?.[0] === 1 && !fs.readFileSync(file, 'utf8').includes('"started"') && !fs.readFileSync(file, 'utf8').includes('"root"'), 'it has the cards and what they wait for, not this machine’s runs')
  h.expect(await h.js(`document.querySelector('.board-panel .mc-head .muted').textContent.includes('shared in git')`), 'the header says the board is shared')

  // a teammate's change arrives with a pull
  shared.cards[1].title = 'Invite people by email or link'
  shared.cards[1].updatedAt = Date.now() + 1000
  shared.cards.push({ id: 'teammate-1', key: 7, title: 'Audit log for team changes', body: '', column: 'backlog', labels: ['feature'], priority: 'normal', createdAt: 1, updatedAt: Date.now(), order: 1 })
  fs.writeFileSync(file, JSON.stringify(shared, null, 2))
  await h.js(`window.dispatchEvent(new Event('focus'))`)
  h.expect(await h.until(async () => (await cards('backlog')).includes('Audit log for team changes') && (await cards('done')).includes('Invite people by email or link'), 5000), 'a teammate’s new card and edit come in when the window gets focus')
  await h.wait(300)
  await h.shot('6-teammate')

  // a merge conflict stops the sync until it's resolved
  const good = fs.readFileSync(file, 'utf8')
  fs.writeFileSync(file, `<<<<<<< HEAD\n${good}=======\n${good}>>>>>>> theirs\n`)
  await h.js(`window.dispatchEvent(new Event('focus'))`)
  h.expect(await h.until(() => h.js(`document.querySelector('.board-page .error-banner, .board-page [role="alert"]')?.textContent.includes('merge conflicts')`), 5000), 'conflict markers show on the board instead of being overwritten')
  h.expect(fs.readFileSync(file, 'utf8').startsWith('<<<<<<<'), 'and the file is left alone')
  await h.shot('7-conflict')
  fs.writeFileSync(file, good)
  await h.js(`window.dispatchEvent(new Event('focus'))`)
  h.expect(await h.until(() => h.js(`!document.querySelector('.board-page .error-banner, .board-page [role="alert"]')`), 5000), 'resolved, the board syncs again')
}
