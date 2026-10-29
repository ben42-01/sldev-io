// The Agents dashboard and the attention surfaces: a count on the sidebar icon, the board row, and
// "Next needs you" jumping to the agent that waits.
module.exports = async (h) => {
  await h.openFixture()
  await h.shot('0-welcome')
  h.key('3', ['control', 'shift'])
  await h.wait(500)
  await h.click('.btn', 'New mission')
  await h.wait(400)
  await h.setValue('.form select', 'codex', `e.querySelector('option[value=codex]')`)
  await h.setValue('.form textarea', 'Codex task', `e.placeholder.includes('pagination')`)
  await h.click('.form .btn.primary', 'Launch')
  h.expect(await h.until(() => h.js(`document.querySelector('.right-tab[aria-label^="Agent Missions"] .live-dot') !== null`), 6000), 'right sidebar tab shows a live dot while the agent works')
  await h.js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true }))`)
  await h.wait(300)
  h.type('agents dashboard')
  await h.wait(300)
  h.key('Return')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.agents-board .agent-row')`), 4000), 'dashboard lists the running agent')
  // the fake codex rings the bell after a while: needs you
  h.expect(await h.until(() => h.js(`document.querySelector('.right-tab[aria-label^="Agent Missions"] .count-bubble')?.textContent === '1'`), 20000), 'right sidebar tab counts 1 needing you')
  h.expect(await h.js(`document.querySelector('.agent-row.attention')?.textContent.includes('Needs you')`), 'board row is marked for attention')
  await h.shot('1-agents-board')
  await h.click('.agents-board .btn', 'Next')
  await h.wait(500)
  h.expect(await h.js(`document.querySelector('.dv-active-group .dv-active-tab')?.textContent.includes('Codex task')`), 'Next focuses the agent that needs you')
  await h.shot('2-next')
}
