// "Needs you" from an approval prompt on screen: agents without hooks that wait in a dialog without
// a bell (OpenCode, full-screen Codex). The fake Codex draws one; answering it makes the mission work again.
const card = (h) => h.js(`(() => { const c = [...document.querySelectorAll('.mission-card')].find(c => c.textContent.includes('Run the tests')); return c ? c.querySelector('.mission-head .spill').textContent + ' | ' + c.textContent : '' })()`)

module.exports = async (h) => {
  await h.openFixture()
  h.key('3', ['control', 'shift'])
  await h.wait(500)
  await h.click('.btn', 'New mission')
  await h.wait(400)
  await h.setValue('.form select', 'codex', `e.querySelector('option[value=codex]')`)
  await h.setValue('.form textarea', 'Run the tests ASK_SCREEN')
  await h.wait(200)
  await h.click('.form .btn.primary', 'Launch')

  h.expect(await h.until(async () => (await card(h)).startsWith('Needs you'), 10000), 'approval dialog on screen, no bell → Needs you')
  h.expect((await card(h)).includes('Would you like to run'), 'the card shows the question')
  await h.shot('1-needs-you')

  await h.js(`document.querySelector('.xterm-helper-textarea')?.focus()`)
  await h.wait(200)
  h.type('1')
  h.key('Return')
  await h.wait(500)
  await h.shot('1b-answered')
  h.expect(await h.until(async () => (await card(h)).startsWith('Working'), 6000), 'answered → Working again')
  h.expect(await h.until(async () => (await card(h)).startsWith('Ready for you'), 12000), 'quiet after the tests → Ready for you')

  await h.click('.mission-title', 'Run the tests')
  await h.wait(600)
  const dialog = await h.js(`document.querySelector('dialog[open]')?.textContent ?? ''`)
  h.expect(dialog.includes("doesn't report its status") && dialog.includes('approval prompt'), 'details explain how the status is known')
  h.expect(dialog.includes('tests passed'), 'final screen has the output after the answer')
  await h.shot('2-details')
}
