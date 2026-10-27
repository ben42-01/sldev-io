// A mission's data path: acceptance criteria in the prompt, the agent's final report stored on the
// mission, human handoff notes, and a follow-up whose prompt carries the original task and the notes.
const fs = require('fs')
const os = require('os')
const path = require('path')

const log = path.join(os.tmpdir(), `sldev-e2e-handoff-${process.pid}.jsonl`)
const dialog = (h) => h.js(`document.querySelector('dialog[open]')?.textContent ?? ''`)
const argvs = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])

module.exports = async (h) => {
  fs.rmSync(log, { force: true })
  await h.openFixture()
  h.key('3', ['control', 'shift'])
  await h.wait(500)
  await h.click('.btn', 'New mission')
  await h.wait(400)
  await h.setValue('.form select', 'claude', `e.querySelector('option[value=claude]')`)
  await h.setValue('.form textarea', 'Paginate users', `e.placeholder.includes('pagination')`)
  await h.setValue('.form textarea', 'npm test passes', `e.placeholder.includes('GET /users')`)
  await h.wait(200)
  await h.js(`document.querySelector('.prompt-preview').open = true`)
  const preview = await h.js(`document.querySelector('.prompt-preview pre')?.textContent ?? ''`)
  h.expect(preview.includes('Acceptance criteria:\nnpm test passes') && preview.includes('summarize what changed'), 'prompt preview shows criteria and the closing instruction')
  await h.shot('1-new-mission')
  await h.click('.form .btn.primary', 'Launch')
  h.expect(await h.until(async () => (await h.js(`document.querySelector('.mission-card')?.textContent ?? ''`)).includes('Ready for you'), 15000), 'mission ready')
  h.expect(argvs()[0]?.at(-1)?.includes('Acceptance criteria:\nnpm test passes'), 'the agent received the criteria')

  await h.click('.mission-card .mission-title')
  await h.until(async () => (await dialog(h)).includes('Final report'), 4000)
  h.expect((await dialog(h)).includes('Done! I updated src/app.js:1'), 'final report stored from the transcript')
  await h.setValue('dialog[open] textarea', 'Looks good; also handle page 0', `e.placeholder.includes('empty-page')`)
  await h.js(`document.querySelector('dialog[open] textarea').dispatchEvent(new FocusEvent('blur'))`)
  await h.wait(300)
  await h.shot('2-details')
  await h.click('dialog[open] .btn', 'Follow-up')
  await h.wait(300)
  await h.setValue('dialog[open] textarea', 'Handle page 0 too')
  await h.click('dialog[open] .btn', 'Start follow-up')
  h.expect(await h.until(async () => argvs().length >= 2, 10000), 'follow-up started')
  const sent = argvs()[1].at(-1)
  h.expect(sent.startsWith('Mission: Handle page 0 too'), 'follow-up prompt leads with the new instruction')
  h.expect(sent.includes('Original task:\nPaginate users') && sent.includes('Handoff notes from the reviewer:\nLooks good; also handle page 0'), `follow-up carries the task and the handoff (${JSON.stringify(sent).slice(0, 300)})`)
  await h.wait(1500)
  await h.shot('3-follow-up')
}

module.exports.env = { SLDEV_E2E_ARGV: log }
