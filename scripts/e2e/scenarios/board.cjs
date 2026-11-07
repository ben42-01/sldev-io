// Work board: cards move Backlog → Agent ready → In progress → Review → Done. Auto pick-up starts
// Agent ready cards (highest priority first, one at a time) as missions; a card with its own recipe
// starts a factory run. Drag and drop, labels, requeue and delete.
const fs = require('fs')
const path = require('path')

const RECIPE = `name: Board quick
description: One agent stage and a check.
stages:
  - id: build
    agent: claude
    prompt: Do {intent}
  - id: check
    run: node -e "console.log('ok')"
`

module.exports = async (h) => {
  fs.mkdirSync(path.join(h.fixture, '.sldev', 'factory'), { recursive: true })
  fs.writeFileSync(path.join(h.fixture, '.sldev', 'factory', 'board.yml'), RECIPE)
  await h.openFixture({ rightPanelVisible: false })

  const cards = (column) => h.js(`[...document.querySelectorAll('.board-column[data-column="${column}"] .board-card .board-title')].map(t => t.textContent)`)
  const card = (title) => `[...document.querySelectorAll('.board-card')].find(c => c.querySelector('.board-title')?.textContent === ${JSON.stringify(title)})`

  // the palette opens the board in Mission Control
  h.key('P', ['control', 'shift'])
  await h.wait(300)
  await h.type('work board')
  await h.wait(200)
  await h.key('Enter')
  h.expect(await h.until(() => h.js(`document.querySelector('.mc-tab.on')?.textContent.includes('Board') && document.querySelectorAll('.board-column').length === 5`), 3000), 'the board opens with five columns')
  h.expect(await h.js(`document.querySelector('[data-column="ready"] .board-pickup')?.textContent === 'manual'`), 'Agent ready says pick-up is manual')

  // quick add in Backlog
  await h.click('[data-column="backlog"] .board-add')
  await h.wait(200)
  await h.setValue('.board-quick input', 'Write the README')
  await h.js(`document.querySelector('.board-quick').requestSubmit()`)
  h.expect(await h.until(async () => (await cards('backlog')).includes('Write the README'), 2000), 'quick add puts a card in Backlog')
  await h.key('Escape')

  // a full card, straight into Agent ready, high priority
  const newCard = async (title, body, labels, priority, column) => {
    await h.click('.board-page .btn.primary', 'New card')
    await h.until(() => h.js(`!!document.querySelector('dialog[open] .board-form')`), 2000)
    await h.setValue('dialog[open] .board-form input', title, `e.placeholder.startsWith('e.g.')`)
    await h.setValue('dialog[open] .board-form textarea', body)
    await h.setValue('dialog[open] .board-form input', labels, `e.placeholder === 'bug, api'`)
    await h.setValue('dialog[open] .board-form select', priority, `[...e.options].some(o => o.value === 'high')`)
    await h.setValue('dialog[open] .board-form select', column, `[...e.options].some(o => o.value === 'ready')`)
    // the button enables once React has the title; clicking before that does nothing
    await h.until(() => h.js(`document.querySelector('dialog[open] .btn.primary')?.disabled === false`), 2000)
    await h.click('dialog[open] .btn.primary', 'Add card')
    h.expect(await h.until(() => h.js(`!document.querySelector('dialog[open]')`), 3000), `"${title}" is added`)
  }
  await newCard('Fix login typo', 'The button says "Sing in".', 'bug, ui', 'normal', 'ready')
  await newCard('Rate-limit the API', 'Token bucket in front of /api, 429 when over.', 'api, backend', 'high', 'ready')
  h.expect(JSON.stringify(await cards('ready')) === JSON.stringify(['Fix login typo', 'Rate-limit the API']), 'both cards sit in Agent ready')
  h.expect(await h.js(`${card('Rate-limit the API')}.querySelector('.board-priority.high') !== null && ${card('Rate-limit the API')}.textContent.includes('backend')`), 'the card shows its priority and labels')
  await h.wait(300)
  await h.shot('1-planned')

  // labels filter the board
  await h.click('.board-labels .board-label', 'bug')
  h.expect(await h.until(async () => JSON.stringify(await cards('ready')) === JSON.stringify(['Fix login typo']), 1500), 'a label filters the cards')
  await h.click('.board-labels .board-label', 'bug')

  // pick-up setting: missions, one at a time (the default), then switch it on
  await h.click('.board-page .btn', 'at a time')
  h.expect(await h.until(() => h.js(`document.querySelector('dialog[open] .modal-title')?.textContent === 'Pick-up'`), 2000), 'pick-up settings open')
  await h.wait(500)
  await h.shot('2-pickup-settings')
  await h.click('dialog[open] .btn.primary', 'Save')
  await h.click('.board-page .chip-check input')
  h.expect(await h.until(() => h.js(`document.querySelector('[data-column="ready"] .board-pickup')?.textContent === 'auto'`), 2000), 'auto pick-up is on')

  // the high priority card goes first; the limit keeps the other one waiting
  h.expect(await h.until(async () => (await cards('progress')).includes('Rate-limit the API'), 8000), 'pick-up starts the high priority card first')
  h.expect((await cards('ready')).includes('Fix login typo'), 'and leaves the other in Agent ready (one at a time)')
  const mission = await h.until(() => h.js(`window.api.store.get('missions').then(s => s.missions.find(m => m.title.startsWith('#3 Rate-limit')))`), 5000)
  h.expect(!!mission && mission.prompt.includes('Token bucket in front of /api') && mission.prompt.includes('Labels: api, backend'), 'its mission gets the title, details and labels')
  await h.wait(500)
  await h.shot('3-picked-up')

  // the fake agent finishes its turn: the card moves to Review and the next card is picked up
  h.expect(await h.until(async () => (await cards('review')).includes('Rate-limit the API'), 15000), 'a finished mission moves its card to Review')
  h.expect(await h.until(async () => (await cards('progress')).includes('Fix login typo') || (await cards('review')).includes('Fix login typo'), 10000), 'then the next card is picked up')
  h.expect(await h.until(async () => (await cards('review')).length === 2, 15000), 'both end in Review')
  h.expect(await h.js(`${card('Rate-limit the API')}.querySelector('.board-work')?.textContent.includes('Build')`), 'the card names its mission')

  // a card with its own recipe starts a factory run instead
  await h.click('.board-page .chip-check input')
  await h.click('.board-page .btn.primary', 'New card')
  await h.until(() => h.js(`!!document.querySelector('dialog[open] .board-form')`), 2000)
  await h.setValue('dialog[open] .board-form input', 'Add a health check', `e.placeholder.startsWith('e.g.')`)
  // BOARD_MCP: the fake agent files a follow-up card through the sldev MCP tools
  await h.setValue('dialog[open] .board-form textarea', 'GET /health returns ok. BOARD_MCP')
  await h.click('dialog[open] .board-form .check input')
  await h.wait(200)
  await h.click('dialog[open] .board-form .seg button', 'Factory recipe')
  await h.wait(200)
  await h.setValue('dialog[open] .board-form select', 'Board quick', `[...e.options].some(o => o.value === 'Board quick')`)
  await h.until(() => h.js(`document.querySelector('dialog[open] .btn.primary')?.disabled === false`), 2000)
  await h.click('dialog[open] .btn.primary', 'Add card')
  await h.until(() => h.js(`!document.querySelector('dialog[open]')`), 3000)
  h.expect(await h.js(`!!${card('Add a health check')}.querySelector('.board-own')`), 'a card with its own recipe is marked')
  await h.js(`${card('Add a health check')}.querySelector('.board-card-foot .btn').click()`)
  h.expect(await h.until(async () => (await cards('progress')).includes('Add a health check'), 8000), 'Start moves it to In progress')
  h.expect(await h.until(() => h.js(`${card('Add a health check')}?.querySelector('.board-work')?.textContent.includes('Board quick')`), 8000), 'and shows its factory run')
  await h.wait(400)
  await h.shot('4-factory-run')
  h.expect(await h.until(async () => (await cards('review')).includes('Add a health check'), 40000), 'the finished run moves the card to Review')
  h.expect(await h.js(`${card('Add a health check')}.querySelector('.board-work')?.textContent.includes('2/2 stages')`), 'with its stages done')
  h.expect(await h.until(async () => (await cards('backlog')).includes('Add tests for the health check'), 3000), 'the agent filed a follow-up card in Backlog (sldev_board_add)')
  const filed = (await h.js(`window.api.store.get('board')`)).items.find((i) => i.title === 'Add tests for the health check')
  h.expect(filed?.priority === 'high' && filed.labels.join() === 'tests' && filed.body.includes('Filed by claude'), 'with its priority, labels and who filed it')

  // drag a reviewed card to Done
  const drag = (title, column) =>
    h.js(`(() => {
      const dt = new DataTransfer()
      const from = ${card(title)}
      const to = document.querySelector('.board-column[data-column="${column}"]')
      from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
      return true })()`)
  await drag('Rate-limit the API', 'done')
  h.expect(await h.until(async () => (await cards('done')).includes('Rate-limit the API'), 2000), 'drag and drop moves a card to Done')

  // back to Agent ready forgets the old work, so it can be picked up again
  await drag('Fix login typo', 'ready')
  h.expect(await h.until(async () => (await cards('ready')).includes('Fix login typo'), 2000), 'a card can go back to Agent ready')
  h.expect(await h.js(`!${card('Fix login typo')}.querySelector('.board-work') && !!${card('Fix login typo')}.querySelector('.board-card-foot .btn')`), 'without its old run, ready to start again')
  await h.wait(400)
  await h.shot('5-board')

  // delete asks first
  await h.js(`${card('Write the README')}.querySelector('.icon-btn[aria-label="More"]').click()`)
  await h.wait(200)
  await h.click('.ctx-menu .ctx-item', 'Delete card')
  h.expect(await h.until(() => h.js(`document.querySelector('dialog[open]')?.textContent.includes('Delete card #1?')`), 2000), 'deleting a card asks first')
  await h.click('dialog[open] .btn', 'Delete card')
  h.expect(await h.until(async () => !(await cards('backlog')).includes('Write the README'), 2000), 'and removes it')

  const stored = await h.until(() => h.js(`window.api.store.get('board')`).then((b) => b.items.length === 4 && b), 3000)
  h.expect(!!stored && stored.settings[0]?.pickup === false, 'the board and its pick-up setting are saved')
}
