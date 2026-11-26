// Blast radius: a function with two callers gets a new parameter and the change updates only one of them.
// The Review tab's walkthrough flags the signature change and lists the caller it left alone, which opens
// in the editor at its line. A body-only change to another function isn't flagged.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

module.exports = async (h) => {
  const f = h.fixture
  const w = (p, s) => fs.writeFileSync(path.join(f, p), s)
  w('src/config.js', 'export function parseConfig(text) {\n  return JSON.parse(text)\n}\n\nexport function defaults() {\n  return {}\n}\n')
  w('src/server.js', "import { parseConfig, defaults } from './config'\n\nexport const cfg = parseConfig(process.env.CFG)\nexport const d = defaults()\n")
  w('src/worker.js', "import { parseConfig } from './config'\n\nconst raw = '{}'\nexport const job = parseConfig(raw)\n")
  fs.mkdirSync(path.join(f, 'node_modules/dep'), { recursive: true })
  w('node_modules/dep/index.js', 'parseConfig("{}")\n')
  execSync('git add -A && git commit -qm config', { cwd: f })
  const base = execSync('git rev-parse HEAD', { cwd: f }).toString().trim()
  // the mission's change: a new parameter, one caller updated, and defaults() changed only inside
  w('src/config.js', 'export function parseConfig(text, strict) {\n  return JSON.parse(text)\n}\n\nexport function defaults() {\n  return { strict: false }\n}\n')
  w('src/server.js', "import { parseConfig, defaults } from './config'\n\nexport const cfg = parseConfig(process.env.CFG, true)\nexport const d = defaults()\n")
  const now = Date.now()
  await h.js(`window.api.store.set('missions', { missions: [${JSON.stringify({
    id: 'm-blast1', title: 'Strict config', prompt: 'Add a strict option to parseConfig', brief: 'Add a strict option to parseConfig',
    root: f, cwd: f, baseCommit: base, options: { agent: 'claude' }, status: 'ended', createdAt: now - 60000, updatedAt: now - 1000
  })}] })`)
  await h.openFixture({ rightPanelVisible: true })
  h.key('3', ['control', 'shift'])
  await h.wait(600)

  await h.js(`document.querySelector('.mission-card [aria-label="Review changes"]')?.click()`)
  h.expect(await h.until(() => h.js(`!!document.querySelector('.rc .rc-part')`), 8000), 'the Review tab opens on the walkthrough')
  h.expect(await h.js(`[...document.querySelectorAll('.rc-flag')].some(x => x.textContent.includes('Signature changed') && x.textContent.includes('parseConfig'))`), 'the signature change is flagged')
  const row = await h.until(() => h.js(`[...document.querySelectorAll('.rc-blast-name')].find(d => d.querySelector('code')?.textContent === 'parseConfig')?.querySelector('summary')?.textContent`), 8000)
  h.expect(/used in 2 other places, 1 changed/.test(row || ''), `parseConfig's callers are counted (${row})`)
  const listed = await h.js(`[...document.querySelectorAll('.rc-blast-name.risky .rc-blast-at')].map(x => x.textContent)`)
  h.expect(JSON.stringify(listed) === JSON.stringify(['src/worker.js:4']), `only the caller the change left alone is listed, not node_modules (${listed})`)
  h.expect(await h.js(`(() => { const d = [...document.querySelectorAll('.rc-blast-name')].find(d => d.querySelector('code')?.textContent === 'defaults'); return !d || (!d.classList.contains('risky') && !d.open) })()`), 'a body-only change is listed quietly, not as a risk')
  h.expect(await h.js(`[...document.querySelectorAll('.rc-flag')].filter(x => x.textContent.includes('Signature changed')).every(x => !x.textContent.includes('defaults'))`), 'and is not flagged as a signature change')
  await h.js(`document.querySelector('.rc-blast-name.risky')?.scrollIntoView({ block: 'center' })`)
  await h.wait(800)
  await h.shot('1-blast-radius')

  // stand in for the editor in main: the dev box's real editors must never open
  const { ipcMain } = require('electron')
  const opened = []
  for (const ch of ['editors:open', 'editors:terminalGoto', 'shell:openPath']) {
    ipcMain.removeHandler(ch)
    ipcMain.handle(ch, (_e, ...a) => (opened.push([ch, ...a]), ch === 'editors:terminalGoto' ? null : ''))
  }
  await h.js(`document.querySelector('.rc-blast-name.risky .rc-blast-use')?.click()`)
  h.expect(await h.until(() => opened.length > 0, 5000), 'a listed caller opens in the editor')
  const call = opened.find((c) => c[0] === 'editors:open') ?? opened[0] ?? []
  h.expect(call.includes(path.join(f, 'src/worker.js')) && (call[0] === 'shell:openPath' || call.includes(4)), `at its line (${JSON.stringify(call)})`)
}
