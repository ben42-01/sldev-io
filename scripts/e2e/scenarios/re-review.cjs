// Re-review: after a verdict on every part, one part goes back to the agent; its follow-up changes it and
// the fix is committed. The Review tab says "1 new commit since you reviewed", the untouched part keeps its
// ✓, the changed one says it changed, and "Since last review" shows only what is new.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

module.exports = async (h) => {
  const f = h.fixture
  const base = execSync('git rev-parse HEAD', { cwd: f }).toString().trim()
  // the mission's work, committed: the asked change in src, a helper in lib
  fs.mkdirSync(path.join(f, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(f, 'src/app.js'), "console.log('hello there')\n")
  fs.writeFileSync(path.join(f, 'lib/util.js'), 'module.exports = { twice: (s) => s + s }\n')
  execSync('git add -A && git commit -qm work', { cwd: f })
  const first = execSync('git rev-parse HEAD', { cwd: f }).toString().trim()
  const now = Date.now()
  await h.js(`window.api.store.set('missions', { missions: [${JSON.stringify({
    id: 'm-rerev', title: 'Friendlier greeting', prompt: 'Make the greeting friendlier', brief: 'Make the greeting friendlier',
    root: f, cwd: f, baseCommit: base, options: { agent: 'claude' }, status: 'ended', report: 'Changed the greeting.', createdAt: now - 60000, updatedAt: now - 1000
  })}] })`)
  await h.openFixture({ rightPanelVisible: true })
  h.key('3', ['control', 'shift'])
  await h.wait(600)
  await h.js(`document.querySelector('.mission-card [aria-label="Review changes"]')?.click()`)
  h.expect(await h.until(() => h.js(`!!document.querySelector('.rc .rc-part')`), 8000), 'the Review tab opens on the walkthrough')
  const items = () => h.js(`[...document.querySelectorAll('.rc-part-item:not(.noise)')].map(b => ({ t: b.querySelector('.rc-part-title').textContent, ok: !!b.querySelector('.rc-num.ok'), back: !!b.querySelector('.rc-num.back'), changed: !!b.querySelector('.rc-changed') }))`)
  const titles = async () => (await items()).map((i) => i.t)
  h.expect(JSON.stringify(await titles()) === JSON.stringify(['Changes in lib', 'Changes in src']) || JSON.stringify(await titles()) === JSON.stringify(['Changes in src', 'Changes in lib']), `two parts by folder (${await titles()})`)
  h.expect(!(await h.js(`!!document.querySelector('.rc-since')`)), 'no banner before the first verdict')

  // lib looks good; src goes back with a note
  const pick = (t) => h.js(`[...document.querySelectorAll('.rc-part-item')].find(b => b.textContent.includes(${JSON.stringify(t)}))?.click()`)
  await pick('Changes in lib')
  await h.click('.rc-actions .btn', 'Looks good')
  await pick('Changes in src')
  await h.click('.rc-actions .btn', 'Send back')
  await h.setValue('.rc-form textarea', 'Say friend, and log it twice')
  await h.click('.rc-form .btn.primary', 'Save note')
  const mission = async () => (await h.js(`window.api.store.get('missions')`)).missions.find((m) => m.id === 'm-rerev')
  h.expect(await h.until(async () => {
    const r = (await mission())?.review
    return r?.marks?.['auto:code-lib']?.hunks?.length === 1 && r?.marks?.['auto:code-src']?.note && r?.seen?.head === first
  }, 3000), 'each mark keeps the hunks it was made on, and the review its head commit')
  h.expect(!(await h.js(`!!document.querySelector('.rc-since')`)), 'still no banner: nothing changed')

  // Send back: the follow-up edits src/app.js (fakebin/claude); the agent's fix gets committed
  await h.click('.rc-foot .btn.primary')
  h.expect(await h.until(() => fs.readFileSync(path.join(f, 'src/app.js'), 'utf8').includes('hello from mission'), 15000), 'the follow-up changed src/app.js')
  await h.wait(1500)
  execSync('git add -A && git commit -qm fix', { cwd: f })
  // the follow-up's terminal took the front; back to the Review tab
  await h.js(`[...document.querySelectorAll('.dv-tab')].find(t => t.textContent.includes('Review: Friendlier greeting'))?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))`)
  await h.js(`[...document.querySelectorAll('.dv-tab')].find(t => t.textContent.includes('Review: Friendlier greeting'))?.click()`)
  await h.wait(400)
  await h.click('.diff-toolbar [aria-label="Refresh"]')
  h.expect(await h.until(() => h.js(`document.querySelector('.rc-since')?.textContent.includes('1 new commit since you reviewed')`), 8000), `the banner counts the new commit (${await h.js(`document.querySelector('.rc-since')?.textContent`)})`)
  const after = await items()
  const lib = after.find((i) => i.t === 'Changes in lib')
  const src = after.find((i) => i.t === 'Changes in src')
  h.expect(!!lib?.ok && !lib.changed, `the untouched part keeps its ✓ (${JSON.stringify(lib)})`)
  h.expect(!!src && !src.ok && !src.back && src.changed, `the changed part lost its mark and says so (${JSON.stringify(src)})`)
  h.expect(!(await h.js(`[...document.querySelectorAll('.rc-foot .btn.primary')].some(b => b.textContent.includes('Send'))`)), 'the old note is not offered to send back again')
  await pick('Changes in src')
  h.expect(await h.until(() => h.js(`document.querySelector('.rc-changed-note')?.textContent.includes('Changed since you sent it back')`), 2000), 'the part says it changed since it was sent back')
  await h.wait(1500)
  await h.until(() => h.js(`!!document.querySelector('.rc-since') && !!document.querySelector('.rc-changed-note')`), 5000)
  await h.shot('1-banner')

  // Since last review: only what is new
  await h.click('.rc-since .btn', 'Since last review')
  h.expect(await h.until(async () => !(await titles()).includes('Changes in lib') && (await titles()).includes('Changes in src'), 2000), `only the changed parts are listed (${await titles()})`)
  h.expect(await h.js(`document.querySelector('.rc-since .btn')?.getAttribute('aria-pressed') === 'true'`), 'the toggle is on')
  await h.wait(1500)
  await h.shot('2-since-last-review')

  // a verdict on each new part catches up: the banner goes, the whole change is back with every ✓
  for (const t of await titles()) {
    await pick(t)
    await h.click('.rc-actions .btn', 'Looks good')
    await h.wait(200)
  }
  h.expect(await h.until(() => h.js(`!document.querySelector('.rc-since')`), 3000), 'caught up: no banner')
  h.expect(await h.until(async () => (await items()).every((i) => i.ok) && (await titles()).includes('Changes in lib'), 3000), `the whole change again, every part ✓ (${JSON.stringify(await items())})`)
  const second = execSync('git rev-parse HEAD', { cwd: f }).toString().trim()
  h.expect(await h.until(async () => (await mission())?.review?.seen?.head === second, 3000), 'the review is now at the new head')
  await h.wait(1500)
  await h.shot('3-caught-up')
}
