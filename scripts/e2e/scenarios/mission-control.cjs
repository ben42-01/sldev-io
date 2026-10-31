// Mission Control: the dock tab for agent work. Opened from the left activity bar, missions by status column,
// grid and list layouts, factory runs and usage as tabs; the right sidebar's compact rows.
async function launch(h, agent, prompt) {
  await h.click('.btn', 'New mission')
  await h.wait(400)
  await h.setValue('.form select', agent, `e.querySelector('option[value=${agent}]')`)
  await h.setValue('.form textarea', prompt)
  await h.wait(200)
  await h.click('.form .btn.primary', 'Launch')
}

const columnCounts = (h) =>
  h.js(`Object.fromEntries([...document.querySelectorAll('.mc-column')].map(c => [c.dataset.column, c.querySelectorAll('.mission-card').length]))`)

module.exports = async (h) => {
  const now = Date.now()
  const min = 60000
  const ended = (id, title, ago, extra = {}) => ({
    id, title, prompt: title, root: h.fixture, cwd: h.fixture, options: { agent: 'claude' }, status: 'ended',
    createdAt: now - ago - 20 * min, updatedAt: now - ago, history: [{ status: 'working', at: now - ago - 20 * min }, { status: 'ended', at: now - ago }],
    lastMessage: 'Done. Tests pass.', ...extra
  })
  const seeded = [
    ended('s1', 'Add rate limiting to the API', 30 * min, { stats: { files: 4, insertions: 120, deletions: 12 } }),
    ended('s2', 'Research: why is checkout slow', 90 * min, { kind: { id: 'research', name: 'Research', readOnly: true } }),
    ended('s3', 'Fix flaky login test', 3 * 60 * min, { status: 'failed', options: { agent: 'codex' } })
  ]
  await h.js(`window.api.store.set('missions', ${JSON.stringify({ missions: seeded })})`)
  await h.openFixture({ rightPanelVisible: true })

  // missions start from the right sidebar as before
  await h.click('.right-tab[aria-label^="Agent Missions"]')
  await h.wait(300)
  await launch(h, 'claude', 'Claude task')
  const status = (title) => h.js(`window.api.store.get('missions').then(s => s.missions.find(m => m.title === ${JSON.stringify(title)})?.status)`)
  h.expect(await h.until(async () => (await status('Claude task')) === 'waiting', 12000), 'claude mission reaches Ready')
  await launch(h, 'codex', 'Codex task')
  h.expect(await h.until(async () => (await status('Codex task')) === 'working', 6000), 'codex mission is working')

  // the left bar opens Mission Control as a tab in the main area
  const btn = '.activitybar:not(.right) .activity-btn[aria-label^="Mission Control"]'
  h.expect(await h.js(`!!document.querySelector('${btn}')`), 'the left activity bar has a Mission Control button')
  await h.click(btn)
  h.expect(await h.until(() => h.js(`!!document.querySelector('.mc')`), 3000), 'Mission Control opens in the dock')
  h.expect(await h.until(() => h.js(`document.querySelector('${btn}').classList.contains('active')`), 2000), 'its button shows it is the active tab')
  // columns are the default layout
  const cols = await columnCounts(h)
  h.log(JSON.stringify(cols))
  h.expect(cols.working === 1 && cols.ready === 1 && cols.finished === 3 && cols.needs === 0, 'missions sit in the column of their status')
  h.expect(await h.js(`document.querySelector('[data-column="needs"] .mc-column-empty')?.textContent.includes('Nothing is waiting')`), 'an empty column says so')
  await h.wait(400)
  await h.shot('1-columns')

  // codex rings the bell: it moves to Needs you and the left button counts it
  h.expect(await h.until(async () => (await columnCounts(h)).needs === 1, 20000), 'codex moves to Needs you on its bell')
  h.expect(await h.js(`document.querySelector('${btn} .count-bubble')?.textContent === '1'`), 'the Mission Control button counts what needs you')
  await h.wait(400)
  await h.shot('2-needs-you')

  await h.click('.mc .seg button', 'Grid')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.mc .mission-grid .mission-card.large').length === 5`), 2000), 'grid layout shows large cards')
  await h.wait(400)
  await h.shot('3-grid')
  await h.click('.mc .seg button', 'List')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.mc .mc-list .mission-row').length === 5`), 2000), 'list layout shows one row per mission')
  h.expect(await h.js(`document.querySelector('.mc .mc-list .mission-row')?.classList.contains('needs-input')`), 'needs you comes first in the list')
  await h.wait(400)
  await h.shot('4-list')
  h.expect(await h.until(async () => (await h.js(`window.api.settings.get()`))?.missionLayout === 'list', 2000), 'the layout choice is saved')

  await h.click('.mc-tab', 'Factory runs')
  h.expect(await h.until(() => h.js(`document.querySelector('.mc-body')?.textContent.includes('No factory runs yet')`), 2000), 'factory runs tab: empty state')
  await h.click('.mc-tab', 'Usage')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.mc-body .dash-tile').length > 0`), 3000), 'usage tab shows the dashboard')
  await h.wait(400)
  await h.shot('5-usage')

  // the palette's usage command switches the open Mission Control to its Usage tab
  await h.click('.mc-tab', 'Missions')
  h.key('P', ['control', 'shift'])
  await h.wait(300)
  await h.type('usage dashboard')
  await h.wait(200)
  await h.key('Enter')
  h.expect(await h.until(() => h.js(`document.querySelector('.mc-tab.on')?.textContent.includes('Usage')`), 2000), 'the usage command opens the Usage tab')
  h.expect(await h.js(`document.querySelectorAll('.mc').length === 1`), 'and reuses the one Mission Control tab')

  // right sidebar: compact rows instead of cards
  await h.click('.right-tab[aria-label^="Agent Missions"]')
  await h.wait(300)
  await h.click('.icon-btn[aria-label="Show missions as compact rows"]')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.rightpanel .mission-row').length === 5 && !document.querySelector('.rightpanel .mission-card')`), 2000), 'the sidebar shows compact rows')
  await h.wait(400)
  await h.shot('6-sidebar-compact')

  // with the right sidebar closed the dock is wide enough for the four columns side by side
  await h.click('.icon-btn[aria-label="Hide right sidebar"]')
  await h.click(btn)
  await h.click('.mc-tab', 'Missions')
  await h.click('.mc .seg button', 'Columns')
  h.expect(await h.until(() => h.js(`(() => { const c = [...document.querySelectorAll('.mc-column')]; return c.length === 4 && new Set(c.map(e => Math.round(e.getBoundingClientRect().top))).size === 1 })()`), 2000), 'wide dock: the four columns sit in one row')
  await h.wait(400)
  await h.shot('7-wide-columns')

  // New mission is a dialog: it works with the right sidebar closed
  await h.click('.mc .btn.primary', 'New mission')
  h.expect(await h.until(() => h.js(`!!document.querySelector('dialog[open] .mission-form')`), 2000), 'New mission opens as a dialog')
  h.expect(await h.js(`document.activeElement?.tagName === 'TEXTAREA' && document.activeElement.closest('.field')?.textContent.includes('What should')`), 'with the brief focused')
  await h.setValue('dialog[open] .form textarea', 'Dialog task')
  await h.wait(400)
  await h.shot('8-new-mission-dialog')
  await h.click('dialog[open] .form .btn.primary', 'Launch')
  h.expect(await h.until(() => h.js(`!document.querySelector('dialog[open]') && [...document.querySelectorAll('.mc .mission-title')].some(t => t.textContent === 'Dialog task')`), 6000), 'the dialog closes and the mission shows on the board')
  h.expect(!(await h.js(`!!document.querySelector('.rightpanel')`)), 'the right sidebar stayed closed')

  await h.click('.mc-tab', 'Factory runs')
  await h.click('.mc .btn.primary', 'New factory run')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('dialog[open] .factory-form select option').length > 0`), 3000), 'New factory run opens as a dialog with the recipes loaded')
  await h.wait(400)
  await h.shot('9-new-run-dialog')
  await h.click('dialog[open] .factory-form .btn', 'Cancel')
  h.expect(await h.until(() => h.js(`!document.querySelector('dialog[open]')`), 2000), 'Cancel closes it')
}
