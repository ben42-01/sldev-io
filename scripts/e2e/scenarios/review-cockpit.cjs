// Review cockpit: the Review tab opens on a walkthrough of the change instead of a file list. Without an
// agent it groups by folder, folds the noise (lockfile, whitespace-only) and flags new code nothing uses.
// "Explain the change" has an agent split it by purpose (asked for / not asked for, a simpler way), a part
// gets a verdict from the keyboard, "Ask why" answers about one part, and the parts sent back go to the
// agent as one follow-up. The helper missions stay off the missions list.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

module.exports = async (h) => {
  const f = h.fixture
  // a file to reformat later: committed before the mission's base
  fs.writeFileSync(path.join(f, 'src/fmt.js'), 'const  greeting = { text: "hi" }\nmodule.exports = greeting\n')
  execSync('git add -A && git commit -qm fmt', { cwd: f })
  const base = execSync('git rev-parse HEAD', { cwd: f }).toString().trim()
  // the mission's work: the asked change, a helper nobody uses, a lockfile and a whitespace-only edit
  fs.writeFileSync(path.join(f, 'src/app.js'), "console.log('hello there, friend')\n")
  fs.writeFileSync(path.join(f, 'src/helper.js'), 'export function makeGreeterFactory(name) {\n  return () => `hi ${name}`\n}\n')
  fs.writeFileSync(path.join(f, 'package-lock.json'), JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: { '': { name: 'fixture' } } }, null, 2) + '\n')
  fs.writeFileSync(path.join(f, 'src/fmt.js'), 'const greeting = {text: "hi"}\nmodule.exports = greeting\n')
  const now = Date.now()
  await h.js(`window.api.store.set('missions', { missions: [${JSON.stringify({
    id: 'm-cockpit1', title: 'Friendlier greeting', prompt: 'Make the greeting friendlier', brief: 'Make the greeting friendlier',
    criteria: '- The greeting says friend', root: f, cwd: f, baseCommit: base, options: { agent: 'claude' }, status: 'ended',
    report: 'Changed the greeting in src/app.js.', createdAt: now - 60000, updatedAt: now - 1000
  })}] })`)
  await h.openFixture({ rightPanelVisible: true })
  h.key('3', ['control', 'shift'])
  await h.wait(600)

  await h.js(`document.querySelector('.mission-card [aria-label="Review changes"]')?.click()`)
  h.expect(await h.until(() => h.js(`!!document.querySelector('.rc .rc-part')`), 8000), 'the Review tab opens on the walkthrough')
  const parts = () => h.js(`[...document.querySelectorAll('.rc-part-item:not(.noise) .rc-part-title')].map(t => t.textContent)`)
  h.expect(JSON.stringify(await parts()) === JSON.stringify(['Changes in src']), `unexplained, the code is grouped by folder (${await parts()})`)
  h.expect(await h.js(`document.querySelector('.rc-part-item.noise')?.textContent.includes('2 files')`), 'the lockfile and the whitespace-only edit are folded as noise')
  h.expect(await h.js(`[...document.querySelectorAll('.rc-flag')].some(f => f.textContent.includes('Unused new code') && f.textContent.includes('makeGreeterFactory'))`), 'new code nothing uses is flagged')
  h.expect(await h.js(`document.querySelector('.rc-criteria li')?.textContent.includes('The greeting says friend')`), 'the acceptance criteria are on top')
  await h.wait(400)
  await h.shot('1-before-walkthrough')

  // an agent explains it
  await h.click('.rc-explain .btn.primary', 'Explain the change')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.rc-writing')`), 5000), 'it says the agent is writing the walkthrough')
  h.expect(await h.until(async () => JSON.stringify(await parts()) === JSON.stringify(['The asked change', 'A helper for later']), 20000), `the agent's parts replace the folders (${await parts()})`)
  h.expect(await h.js(`document.querySelector('.rc-summary')?.textContent.includes('The first is what was asked')`), 'with its summary')
  h.expect(await h.js(`document.querySelector('.rc-criteria li.met') !== null`), 'and which criteria are met')
  h.expect(await h.js(`!!document.querySelector('.rc-bar-seg.asked') && !!document.querySelector('.rc-bar-seg.extra') && document.querySelector('.rc-key.extra')?.textContent.includes('not asked for')`), 'the scope bar shows what was not asked for')
  h.expect(await h.js(`document.querySelector('.rc-callout.risk')?.textContent.includes('Callers that pass nothing')`), 'a part says what could break')
  const mlist = async () => (await h.js(`window.api.store.get('missions')`)).missions
  h.expect((await mlist()).some((m) => m.explains?.mission === 'm-cockpit1' && m.options.print), 'the walkthrough ran as a print-mode helper of the mission')
  h.expect(await h.js(`![...document.querySelectorAll('.mission-card, .mission-row')].some(c => c.textContent.includes('Walkthrough:'))`), 'and stays off the missions list')
  await h.wait(400)
  await h.shot('2-walkthrough')

  // A: looks good, on to the next part
  await h.js(`document.querySelector('.rc').focus()`)
  h.key('a')
  h.expect(await h.until(() => h.js(`document.querySelector('.rc-part-h')?.textContent === 'A helper for later'`), 2000), 'A marks a part as good and moves on')
  h.expect(await h.js(`document.querySelector('.rc-num.ok') !== null && /Reviewed [1-9]\\d* of/.test(document.querySelector('.rc-foot-text')?.textContent ?? '')`), 'the counter goes up')
  h.expect(await h.js(`document.querySelector('.rc-callout.simpler')?.textContent.includes('Leave it out')`), 'a part nobody asked for says the simpler way')

  // ask about it
  await h.click('.rc-actions .btn', 'Ask why')
  await h.setValue('.rc-form input', 'Does anything call this?')
  await h.click('.rc-form .btn.primary', 'Ask')
  h.expect(await h.until(() => h.js(`document.querySelector('.rc-a')?.textContent.includes('nothing calls it')`), 20000), 'the answer shows under the part')
  const ask = (await mlist()).find((m) => m.explains && m.prompt.startsWith('Question about'))
  h.expect(!!ask && ask.prompt.includes('+export function makeGreeterFactory'), 'the question quotes the part')
  await h.wait(300)
  await h.shot('3-ask-why')

  // cut it, and send it back
  await h.click('.rc-actions .btn', 'Cut it')
  h.expect(await h.js(`document.querySelector('.rc-form textarea')?.value.startsWith('Remove this part')`), 'Cut it writes the note')
  await h.click('.rc-form .btn.primary', 'Save note')
  h.expect(await h.until(() => h.js(`document.querySelector('.rc-foot .btn.primary')?.textContent.includes('Send 1 part back to Claude Code')`), 2000), 'the footer collects what goes back')
  // saving a note moves on; back to the part to see it
  await h.js(`document.querySelector('.rc').focus()`)
  h.key('k')
  h.expect(await h.until(() => h.js(`document.querySelector('.rc-note')?.textContent.includes('Remove this part')`), 2000), 'the note shows on the part')
  await h.wait(300)
  await h.shot('4-send-back')
  await h.click('.rc-foot .btn.primary')
  const follow = await h.until(async () => (await mlist()).find((m) => m.parent?.id === 'm-cockpit1' && m.parent.kind === 'follow-up'), 8000)
  h.expect(!!follow && follow.prompt.includes('1. A helper for later (src/helper.js): Remove this part'), 'one follow-up to the same agent, with the part and its note')
  h.expect(await h.until(async () => (await mlist()).find((m) => m.id === 'm-cockpit1')?.review?.sent?.parts === 1, 3000), 'the review remembers it was sent back')

  // the plain file list is still one click away
  await h.js(`void (document.querySelector('.diff-panel') || document.querySelector('.mission-card [aria-label="Review changes"]')?.click())`)
  await h.until(() => h.js(`!!document.querySelector('.diff-toolbar')`), 3000)
  await h.click('.diff-toolbar .seg button', 'All files')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.diff-section').length >= 4`), 3000), 'All files lists every changed file')
  await h.click('.diff-toolbar .seg button', 'Walkthrough')
}
