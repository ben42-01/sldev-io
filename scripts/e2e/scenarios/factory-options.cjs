// Factory run options: a feature/fix branch name from the intent, a model and interactive mode per stage,
// the stage's prompt and output in a dialog, and "Talk to it" resuming a finished print-mode stage in place.
const fs = require('fs')
const os = require('os')
const path = require('path')

// every fake CLI start appends its argv here
const argvLog = path.join(os.tmpdir(), `sldev-e2e-factory-options-${process.pid}.jsonl`)

const RECIPE = `name: E2E options
stages:
  - id: spec
    agent: claude
    prompt: Write a spec for {intent}. SLOW_STEP
    gate: approve
  - id: build
    agent: claude
    prompt: Build {intent} from {spec.out}
`

module.exports = async (h) => {
  fs.mkdirSync(path.join(h.fixture, '.sldev', 'factory'), { recursive: true })
  fs.writeFileSync(path.join(h.fixture, '.sldev', 'factory', 'options.yml'), RECIPE)
  fs.writeFileSync(path.join(h.fixture, '.sldev', 'factory', 'race.yml'), 'name: E2E race\nstages:\n  - id: race\n    agent: [claude, codex]\n    prompt: Build {intent}\n')
  await h.openFixture()
  await h.click('.activitybar button[title^="Factory"]')
  await h.wait(500)
  await h.click('.btn', 'New factory run')
  await h.wait(400)
  // a bake-off stage gets a model (and effort, where the CLI has one) per agent
  await h.setValue('.factory-form select', 'E2E options', `e.querySelector('option')?.textContent === 'E2E options (project)'`)
  const pickRecipe = (name) => h.js(`(() => { const s = document.querySelector('.factory-form select'); const o = [...s.options].find(o => o.textContent === '${name} (project)'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  await pickRecipe('E2E race')
  await h.wait(300)
  h.expect(await h.js(`!!document.querySelector('.factory-form [aria-label="Model for race claude"]') && !!document.querySelector('.factory-form [aria-label="Model for race codex"]') && !!document.querySelector('.factory-form select[aria-label="Effort for race claude"]')`), 'a bake-off offers model and effort per agent')
  await h.shot('0-bakeoff-form')
  await pickRecipe('E2E options')
  await h.wait(300)
  await h.setValue('.factory-form textarea', 'Fix the crash when the terminal resizes')
  await h.wait(200)
  const branchField = () => h.js(`[...document.querySelectorAll('.factory-form .field')].find(f => f.textContent.startsWith('New branch'))?.querySelector('input')?.value`)
  h.expect((await branchField()) === 'fix/crash-terminal-resizes', 'the branch is named fix/… from the intent')
  await h.setValue('.factory-form [aria-label="Model for spec"]', 'opus')
  await h.click('.factory-form input[aria-label="Interactive build"]')
  await h.wait(200)
  h.expect(await h.js(`(() => { const c = document.querySelector('.factory-form .stage-all'); return !!c && !c.closest('details') && c.getBoundingClientRect().height > 0 })()`), 'the "run every stage interactively" switch is visible without opening Stages')
  await h.shot('0-form')
  await h.click('.factory-form .btn.primary', 'Start')

  // a running print-mode stage's terminal says why it is quiet and shows what the agent is doing
  h.expect(await h.until(() => h.js(`!!document.querySelector('.pipeline-node[data-node="spec"].running button[title="Open its terminal"]')`), 15000), 'spec runs in print mode')
  await h.click('.pipeline-node[data-node="spec"] button[title="Open its terminal"]')
  h.expect(await h.until(() => h.js(`document.querySelector('.terminal-print-strip')?.textContent.includes('Print mode')`), 5000), 'its terminal explains print mode')
  h.expect(await h.until(() => h.js(`document.querySelector('.terminal-print-activity')?.textContent.includes('npm test') || document.querySelector('.terminal-print-activity')?.textContent.includes('test suite')`), 5000), 'and shows the current step')
  await h.shot('0-print-terminal')

  const runs = () => h.js(`window.api.store.get('factoryRuns').then(s => s.runs)`)
  const missions = async () => (await h.js(`window.api.store.get('missions')`)).missions
  const node = (id) => h.js(`(() => { const n = document.querySelector('.pipeline-node[data-node="${id}"]'); return n ? [...n.classList].find(c => ['pending','running','approval','done','failed'].includes(c)) : null })()`)
  h.expect(await h.until(async () => (await node('spec')) === 'approval', 20000), 'spec runs, then waits for approval')
  const run = (await runs())[0]
  h.expect(run.worktree.branch === 'fix/crash-terminal-resizes', `the run's branch is ${run.worktree.branch}`)
  const spec = (await missions()).find((m) => m.factory?.node === 'spec')
  h.expect(spec.options.model === 'opus' && spec.options.print === true, 'the spec stage ran in print mode on the chosen model')
  const cardWidth = await h.js(`document.querySelector('.pipeline-node[data-node="spec"]').getBoundingClientRect().width`)
  h.expect(cardWidth >= 270, `stage cards are wide (${Math.round(cardWidth)}px)`)
  await h.shot('1-approval')

  await h.click('.pipeline-node[data-node="spec"] button[title="Prompt and output"]')
  await h.wait(400)
  h.expect(await h.js(`document.querySelector('.stage-details .stage-text')?.textContent.includes('Output from fake claude')`), 'the dialog shows the stage output')
  await h.click('.stage-details .seg button', 'Prompt')
  await h.wait(200)
  h.expect(await h.js(`document.querySelector('.stage-details .stage-text')?.textContent.includes('Write a spec for Fix the crash')`), 'and the exact prompt the agent got')
  await h.shot('2-details')
  await h.click('.modal-footer .btn', 'Talk to it')
  h.expect(await h.until(async () => ['starting', 'working', 'waiting', 'needs-input'].includes((await missions()).find((m) => m.id === spec.id)?.status), 10000), 'Talk to it brings the finished stage back to life')
  const starts = () => (fs.existsSync(argvLog) ? fs.readFileSync(argvLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])
  h.expect(await h.until(() => starts().some((a) => a.includes('--resume') && a.includes('sess-123') && !a.includes('-p')), 8000), 'by resuming its session interactively, not re-running the prompt')
  h.expect((await h.js(`document.querySelectorAll('.dv-tab').length`)) === 2, 'in the same terminal tab')
  await h.shot('3-talking')

  await h.click('.pipeline-node[data-node="spec"] .btn.primary', 'Approve')
  h.expect(await h.until(async () => (await node('build')) === 'running', 20000), 'build starts')
  const build = await h.until(async () => (await missions()).find((m) => m.factory?.node === 'build'), 5000)
  h.expect(build && !build.options.print, 'the interactive stage runs as a normal session')
  h.expect(build?.prompt.includes('The user is watching'), 'and its prompt invites questions')
  await h.shot('4-interactive')
}

module.exports.env = { SLDEV_E2E_ARGV: argvLog }
