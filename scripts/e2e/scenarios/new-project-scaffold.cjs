// New project → Start from scratch: describe a project, the agent defaults to its low-cost model, the empty folder is
// created and opened, and a New project mission runs the sldev-new-project skill in place. The fake claude sets up a
// small project and writes .sldev/runs/new-project.json, which the mission card shows; a broken or missing result says
// so. The low-cost model is editable in Settings → Agents. Nothing gets a remote.
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const log = path.join(os.tmpdir(), `sldev-e2e-scaffold-${process.pid}.jsonl`)

module.exports = async (h) => {
  fs.rmSync(log, { force: true })
  const projects = path.join(path.dirname(h.fixture), 'projects')
  fs.mkdirSync(path.join(projects, 'taken'), { recursive: true })
  fs.writeFileSync(path.join(projects, 'taken', 'mine.txt'), 'keep me')
  await h.openFixture()
  h.key('3', ['control', 'shift'])
  await h.wait(400)

  const open = async () => {
    await h.click('.titlebar-project')
    await h.wait(300)
    h.expect(await h.click('.ctx-item', 'New project…'), 'the title bar menu has New project…')
    h.expect(await h.until(() => h.js(`!!document.querySelector('.np-choices')`), 4000), 'the dialog opens')
    h.expect(await h.click('.np-choice', 'Start from scratch'), 'Start from scratch can be picked')
    h.expect(await h.until(() => h.js(`!!document.querySelector('.np-describe')`), 2000), 'it asks for a description')
  }
  const startBtn = () => h.js(`(() => { const b = document.querySelector('.modal-footer .btn.primary'); return b ? { disabled: b.disabled, text: b.textContent } : null })()`)
  const hint = () => h.js(`document.querySelector('.np-name .field-hint')?.textContent ?? ''`)
  const card = (title) => `[...document.querySelectorAll('.mission-card')].find(c => c.querySelector('.mission-title')?.textContent === ${JSON.stringify(title)})`
  const argvs = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])

  // 1. a project with a name: Claude on its low-cost model
  await open()
  h.expect(await h.js(`document.querySelector('.np-choice.on')?.textContent.includes('Start from scratch')`), 'Start from scratch is selected')
  h.expect(await h.js(`document.querySelector('.np-model input').value`) === 'haiku', 'the model defaults to Claude’s low-cost one (haiku)')
  h.expect(await h.js(`document.querySelector('.np-model .field-hint').textContent.includes('low-cost model')`), 'and says why')
  h.expect((await startBtn()).disabled, 'Create and start waits for a description')
  await h.setValue('.np-describe', 'A tiny adder library in Node.js')
  await h.setValue('.np-parent input', projects)
  await h.setValue('.np-name input', 'taken')
  h.expect(await h.until(async () => (await hint()).includes('isn’t empty'), 2000), `a folder that isn't empty is refused (${await hint()})`)
  h.expect((await startBtn()).disabled, 'and nothing can start there')
  await h.setValue('.np-name input', 'adder')
  await h.setValue('.np-license select', 'MIT')
  const dest = path.join(projects, 'adder')
  h.expect(await h.until(async () => (await hint()).includes(dest), 2000), `the hint says where it goes (${await hint()})`)
  h.expect(await h.until(async () => !(await startBtn()).disabled, 2000), 'Create and start is enabled')
  await h.wait(400)
  await h.shot('1-scratch-form')
  await h.click('.modal-footer .btn.primary')
  h.expect(await h.until(() => h.js(`!document.querySelector('.np-choices')`), 8000), 'the dialog closes')
  h.expect(await h.until(async () => (await h.js(`window.api.settings.get()`)).rootFolder === dest, 4000), 'the new folder opens as the project')
  h.expect(fs.readFileSync(path.join(projects, 'taken', 'mine.txt'), 'utf8') === 'keep me', 'the refused folder is untouched')
  h.expect(fs.existsSync(path.join(dest, '.agents/skills/sldev-new-project/SKILL.md')) && fs.existsSync(path.join(dest, '.claude/skills/sldev-new-project/SKILL.md')), 'the skill is installed in the new folder')
  h.expect(await h.until(() => argvs().length >= 1, 10000), 'the agent started')
  const a1 = argvs()[0]
  const mi = a1.indexOf('--model')
  h.expect(mi >= 0 && a1[mi + 1] === 'haiku', `it runs on haiku (got ${JSON.stringify(a1.slice(0, 8))})`)
  const p1 = a1[a1.length - 1]
  h.expect(p1.startsWith('New project: adder\n\nA tiny adder library in Node.js'), 'the prompt is a New project mission with the description')
  h.expect(p1.includes('License: MIT') && p1.includes('Name: adder'), 'with the name and license picked')
  h.expect(p1.includes('.agents/skills/sldev-new-project/SKILL.md'), 'and points at the skill')
  const m1 = async () => (await h.js(`window.api.store.get('missions')`)).missions.find((m) => m.root === dest)
  h.expect(await h.until(async () => (await m1())?.kind?.id === 'new-project', 4000), 'the mission is of the New project kind')
  h.expect((await m1()).options.model === 'haiku' && !(await m1()).worktree && (await m1()).cwd === dest, 'in place, in the new folder, on haiku')
  h.expect(await h.until(() => h.js(`${card('adder')}?.querySelector('.mission-kind')?.textContent === 'New project'`), 6000), 'the card shows the kind')
  h.expect(await h.js(`${card('adder')}?.querySelector('.mission-model')?.textContent.includes('haiku')`), 'and the model')
  h.expect(await h.until(() => h.js(`${card('adder')}?.querySelector('.np-result')?.textContent.includes('npm test')`), 15000), 'the result is shown once it finishes')
  const shown = await h.js(`${card('adder')}.querySelector('.np-result').textContent`)
  h.expect(shown.includes('adder') && shown.includes('Node.js (npm)') && shown.includes('npm run build') && shown.includes('MIT'), `name, stack, build, test and license (${shown})`)
  for (const f of ['README.md', 'LICENSE', '.gitignore', 'test.js', '.github/workflows/ci.yml', '.sldev/rules.md']) h.expect(fs.existsSync(path.join(dest, f)), `${f} was written`)
  h.expect(execFileSync('git', ['-C', dest, 'log', '--oneline']).toString().includes('Initial project setup'), 'with a first commit')
  h.expect(execFileSync('git', ['-C', dest, 'remote']).toString().trim() === '', 'and no remote')
  await h.wait(600)
  await h.shot('2-result-card')

  // 2. no name, another model, a broken result
  await open()
  await h.setValue('.np-describe', 'Pet store API BAD_RESULT')
  await h.setValue('.np-model input', 'sonnet')
  h.expect(await h.until(() => h.js(`document.querySelector('.np-model .field-hint').textContent.includes('Instead of')`), 2000), 'another model says it replaces the low-cost one')
  h.expect(await h.until(async () => (await hint()).includes(path.join(projects, 'pet-store-api')), 2000), `without a name the folder comes from the description (${await hint()})`)
  await h.click('.modal-footer .btn.primary')
  const dest2 = path.join(projects, 'pet-store-api')
  h.expect(await h.until(async () => (await h.js(`window.api.settings.get()`)).rootFolder === dest2, 6000), 'it opens as the project')
  h.expect(await h.until(() => argvs().length >= 2, 10000), 'the second agent started')
  const a2 = argvs()[1]
  h.expect(a2[a2.indexOf('--model') + 1] === 'sonnet', 'on the model picked')
  h.expect(a2[a2.length - 1].includes('Name: none given; suggest one'), 'and is asked to suggest a name')
  h.expect(await h.until(() => h.js(`${card('pet-store-api')}?.querySelector('.np-result-missing')?.textContent.includes('can’t be read')`), 15000), 'a broken result says so')
  h.expect(await h.js(`${card('pet-store-api')}?.querySelector('.mission-model')?.textContent.includes('sonnet')`), 'the card shows sonnet')

  // 3. no result at all
  await open()
  await h.setValue('.np-describe', 'Notes app NO_RESULT')
  await h.setValue('.np-name input', 'notes')
  h.expect(await h.until(async () => !(await startBtn()).disabled, 2000), 'ready')
  await h.click('.modal-footer .btn.primary')
  h.expect(await h.until(() => h.js(`${card('notes')}?.querySelector('.np-result-missing')?.textContent.includes('new-project.json')`), 15000), 'a missing result says so')
  await h.wait(600)
  await h.shot('3-missing-and-bad')

  // 4. Settings → Agents: the low-cost model per agent
  await h.click('.titlebar-version')
  h.expect(await h.until(() => h.js(`document.querySelector('input[aria-label="Claude Code low-cost model"]')?.value === 'haiku'`), 4000), 'Settings → Agents shows Claude’s low-cost model')
  await h.setValue('input[aria-label="Codex low-cost model"]', 'codex-small')
  await h.js(`document.querySelector('input[aria-label="Codex low-cost model"]').dispatchEvent(new FocusEvent('focusout', { bubbles: true }))`)
  h.expect(await h.until(async () => (await h.js(`window.api.settings.get()`)).cheapModels?.codex === 'codex-small', 3000), 'and saves another agent’s')
  await h.js(`document.querySelector('.cheap-models')?.scrollIntoView({ block: 'center' })`)
  await h.wait(800)
  await h.shot('4-settings-cheap-models')
}

module.exports.env = { SLDEV_E2E_ARGV: log }
