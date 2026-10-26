// Software Factory, when things go wrong: the worktree gets its setup before any stage, stages run
// with an unattended permission mode, a check that keeps failing can be sent back with a note,
// and an agent stage that writes no output fails instead of passing nothing on.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const RECIPE = `name: Recovery
setup: node -e "require('fs').appendFileSync('installed.txt', '1')"
stages:
  - id: build
    agent: claude
    prompt: Build it. {intent}
  - id: verify
    run: node verify.js
    onFail: { retry: build, max: 1 }
`

const SILENT = `name: Silent
setup: none
stages:
  - id: spec
    agent: claude
    prompt: NO_OUTPUT write a spec for {intent} to {out}
  - id: build
    agent: claude
    prompt: Build {spec.out}
`

module.exports = async (h) => {
  // passes only once the user's note reached the agent and setup ran
  fs.writeFileSync(path.join(h.fixture, 'verify.js'), `const fs = require('fs')\nif (!fs.existsSync('installed.txt')) { console.error('Cannot find module left-pad'); process.exit(1) }\nif (!fs.existsSync('USER-NOTES.md')) { console.error('test failed: feature missing'); process.exit(1) }\nconsole.log('green')\n`)
  execSync('git add verify.js && git commit -qm "add verify"', { cwd: h.fixture })
  fs.mkdirSync(path.join(h.fixture, '.sldev', 'factory'), { recursive: true })
  fs.writeFileSync(path.join(h.fixture, '.sldev', 'factory', 'recovery.yml'), RECIPE)
  fs.writeFileSync(path.join(h.fixture, '.sldev', 'factory', 'silent.yml'), SILENT)
  await h.openFixture()

  const start = async (name, intent) => {
    // the activity button toggles the sidebar, so only open it when the Factory view isn't showing
    if (!(await h.js(`[...document.querySelectorAll('.btn')].some(b => b.textContent.includes('New factory run'))`))) await h.click('.activitybar button[title^="Factory"]')
    await h.wait(600)
    await h.click('.btn', 'New factory run')
    await h.wait(400)
    const value = await h.js(`[...document.querySelectorAll('.factory-form select option')].find(o => o.textContent === '${name} (project)')?.value`)
    await h.setValue('.factory-form select', value)
    await h.setValue('.factory-form textarea', intent)
    await h.wait(200)
    await h.click('.factory-form .btn.primary', 'Start')
  }
  const node = (id) => h.js(`(() => { const n = document.querySelector('.pipeline-node[data-node="${id}"]'); return n ? [...n.classList].find(c => ['pending','running','approval','done','failed'].includes(c)) : null })()`)
  const runs = () => h.js(`window.api.store.get('factoryRuns').then(s => s.runs)`)
  const missions = () => h.js(`window.api.store.get('missions').then(s => s.missions ?? s)`)

  await start('Recovery', 'Add export')
  h.expect(await h.until(async () => (await runs())[0]?.status === 'failed', 60000), 'the check fails, the retry fails too, the run stops')
  let run = (await runs())[0]
  const wt = run.worktree.path
  h.expect(fs.readFileSync(path.join(wt, 'installed.txt'), 'utf8') === '1', 'setup ran once in the worktree, before the first stage')
  h.expect(fs.existsSync(path.join(wt, '.sldev', 'runs', '.setup-done')), 'setup is remembered for the worktree')
  const ms = (await missions()).filter((m) => m.factory?.run === run.id)
  h.expect(ms.length === 2 && ms.every((m) => m.options.permissionMode === 'auto'), 'print-mode stages run Claude in auto mode')
  h.expect(run.nodes.verify.feedback?.includes('feature missing'), 'the failed check keeps its log')
  h.expect(await h.js(`!!document.querySelector('.pipeline-node[data-node="verify"] button[title^="Open a terminal in the worktree"]')`), 'a failed stage offers a terminal in the worktree')
  h.expect(await h.js(`!!document.querySelector('.pipeline-node[data-node="build"] button[title^="Talk to it"]')`), 'a finished agent stage can be talked to')
  await h.shot('1-failed')

  await h.click('.pipeline-node[data-node="verify"] .btn', 'Send to build')
  await h.wait(200)
  await h.setValue('.pipeline-node[data-node="verify"] .pn-reject input', 'please add the feature')
  await h.shot('2-send-back')
  await h.click('.pipeline-node[data-node="verify"] .pn-reject .icon-btn')
  h.expect(await h.until(async () => (await runs())[0]?.status === 'done', 60000), 'sent back with a note, the build is redone and the check passes')
  h.expect(fs.readFileSync(path.join(wt, 'USER-NOTES.md'), 'utf8').includes('please add the feature'), 'the agent got your note')
  h.expect(fs.readFileSync(path.join(wt, 'installed.txt'), 'utf8') === '1', 'setup did not run again')
  await h.shot('3-done')

  await start('Silent', 'Add import')
  h.expect(await h.until(async () => (await node('spec')) === 'failed', 30000), 'an agent stage that writes no output fails')
  h.expect(await h.until(async () => (await runs())[0]?.nodes.spec?.note?.startsWith('Ended without writing'), 5000), 'and says why on the node')
  run = (await runs())[0]
  h.expect(run.nodes.build.status === 'pending', 'the next stage never starts on nothing')
  h.expect(!fs.existsSync(path.join(run.worktree.path, '.sldev', 'runs', '.setup-done')), 'setup: none skips the setup')
  h.expect(await h.js(`[...document.querySelectorAll('.pipeline-node[data-node="spec"] .btn')].some(b => b.textContent.includes('Try again'))`), 'a failed agent stage can be tried again')
  await h.shot('4-no-output')
}
