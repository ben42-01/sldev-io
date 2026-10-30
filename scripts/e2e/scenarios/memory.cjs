// Project memory: a note from mission details lands in .sldev/memory.md, and later missions are
// pointed at it (Freeform ones excepted).
const fs = require('fs')
const path = require('path')

module.exports = async (h) => {
  await h.openFixture()
  const file = path.join(h.fixture, '.sldev', 'memory.md')
  h.key('3', ['control', 'shift'])
  await h.wait(500)
  const preview = async (kind, brief) => {
    await h.click('.btn', 'New mission')
    await h.wait(400)
    await h.click('.kind-picker button', kind)
    await h.setValue('.form textarea', brief)
    await h.wait(600)
    await h.click('.prompt-preview summary')
    await h.wait(200)
    return h.js(`document.querySelector('.prompt-preview pre').textContent`)
  }

  let p = await preview('Build', 'Add a health endpoint')
  h.expect(p.includes('sldev_remember') && !p.includes('Project memory:'), 'before any memory exists, Claude is only told how to add to it')
  await h.click('.form .btn.primary', 'Launch')
  await h.wait(1500)

  await h.click('.mission-title')
  await h.wait(400)
  await h.setValue('input[aria-label="Note for the project memory"]', 'Tests need the DB: docker compose up db')
  await h.click('.remember-row .btn', 'Remember')
  h.expect(await h.until(async () => fs.existsSync(file), 5000), 'the note creates .sldev/memory.md')
  const text = fs.readFileSync(file, 'utf8')
  h.expect(text.startsWith('# Project memory') && /- \d{4}-\d\d-\d\d: Tests need the DB: docker compose up db \(Claude Code, mission "Add a health endpoint"\)/.test(text), 'with a dated line and where it came from')
  await h.shot('1-remember')
  await h.js(`document.querySelector('dialog .btn.ghost, dialog [aria-label="Close"]')?.click()`)
  h.key('Escape')
  await h.wait(400)

  p = await preview('Research', 'Where is the router?')
  h.expect(p.includes(`Project memory: earlier agents and the team recorded what they learned about this project in ${file}`), 'the next mission is pointed at the memory file')
  await h.shot('2-preview')
  p = await preview('Freeform', 'just this')
  h.expect(p.trim() === 'just this', 'a Freeform prompt stays exactly as written')
}
