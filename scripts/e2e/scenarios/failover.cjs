// Usage-limit failover: a Claude mission stops at its limit, the card offers to continue on Codex,
// and a factory stage moves on to Codex by itself when that's switched on.
const fs = require('fs')
const path = require('path')

const RECIPE = `name: Limits
stages:
  - id: build
    agent: claude
    prompt: Build it HIT_LIMIT
`

module.exports = async (h) => {
  fs.mkdirSync(path.join(h.fixture, '.sldev', 'factory'), { recursive: true })
  fs.writeFileSync(path.join(h.fixture, '.sldev', 'factory', 'limits.yml'), RECIPE)
  await h.openFixture({ failoverOrder: ['codex'], failoverAuto: false })
  const missionsList = () => h.js(`window.api.store.get('missions').then(s => s?.missions ?? [])`)

  h.key('3', ['control', 'shift'])
  await h.wait(500)
  await h.click('.btn', 'New mission')
  await h.wait(400)
  await h.click('.kind-picker button', 'Freeform')
  await h.setValue('.form textarea', 'Refactor the parser HIT_LIMIT')
  await h.wait(200)
  await h.click('.form .btn.primary', 'Launch')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.mission-alert.limit')`), 15000), 'the card says Claude hit its usage limit')
  h.expect(await h.js(`document.querySelector('.mission-alert.limit .btn').textContent === 'Continue on Codex'`), 'it offers the next agent from Settings')
  await h.wait(500)
  await h.shot('1-limit-card')
  await h.click('.mission-alert.limit .btn', 'Continue on Codex')
  h.expect(await h.until(async () => (await missionsList()).some((m) => m.parent?.kind === 'failover'), 10000), 'a Codex mission takes over')
  const list = await missionsList()
  const next = list.find((m) => m.parent?.kind === 'failover')
  const first = list.find((m) => m.id === next.parent.id)
  h.expect(next.options.agent === 'codex' && next.cwd === first.cwd, 'on Codex, in the same folder')
  h.expect(next.prompt.includes('Claude Code stopped at its usage limit') && next.prompt.includes('Refactor the parser'), 'with the original task and where it stopped')
  h.expect(next.prompt.includes('fake claude') && !next.prompt.includes('usage limit reached'), "with Claude's last output, minus the limit line")
  h.expect(first.continuedBy === next.id, 'the first mission points at the one that took over')
  await h.wait(800)
  await h.shot('2-continued')

  // factory: continue automatically
  await h.js(`window.api.settings.set({ failoverAuto: true })`)
  await h.openFixture({ failoverOrder: ['codex'], failoverAuto: true })
  await h.click('.activitybar button[title^="Factory"]')
  await h.wait(600)
  await h.click('.btn', 'New factory run')
  await h.wait(400)
  await h.setValue('.factory-form select', '0', `e.querySelector('option')?.textContent === 'Limits (project)'`)
  await h.setValue('.factory-form textarea', 'Parser')
  await h.wait(200)
  await h.click('.factory-form .btn.primary', 'Start')
  const runs = () => h.js(`window.api.store.get('factoryRuns').then(s => s?.runs ?? [])`)
  h.expect(await h.until(async () => (await runs())[0]?.status === 'done', 40000), 'the run finishes on Codex')
  const run = (await runs())[0]
  h.expect(run.nodes.build.missionIds.length === 2 && /Continued on Codex/.test(run.nodes.build.note ?? ''), `the stage says it moved to Codex (note: ${run.nodes.build.note})`)
  h.expect(fs.readFileSync(path.join(run.worktree.path, 'PARTIAL.md'), 'utf8').includes('half done'), "Claude's partial work stayed for Codex")
  h.expect(await h.js(`document.querySelectorAll('.mission-alert.limit').length === 0`), 'no Continue button is left on missions that were continued')
  await h.shot('3-factory-continued')
}
