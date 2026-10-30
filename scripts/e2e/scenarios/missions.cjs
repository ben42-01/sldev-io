// A Claude mission (hooks) and a Codex mission (terminal heuristics) through every status.
const pills = (h) =>
  h.js(`Object.fromEntries([...document.querySelectorAll('.mission-card')].map(c => [c.querySelector('.mission-title').textContent, c.querySelector('.mission-head .spill').textContent + ' / ' + c.querySelector('.mission-agent').textContent]))`)

async function launch(h, agent, prompt) {
  await h.click('.btn', 'New mission')
  await h.wait(400)
  await h.setValue('.form select', agent, `e.querySelector('option[value=${agent}]')`)
  await h.setValue('.form textarea', prompt)
  await h.wait(200)
  await h.click('.form .btn.primary', 'Launch')
}

module.exports = async (h) => {
  await h.openFixture()
  h.key('3', ['control', 'shift'])
  await h.wait(500)

  await launch(h, 'claude', 'Claude task')
  // each fake hook spawns Electron-as-Node, so wait for the transitions instead of fixed times
  const claude = (want) => h.until(async () => (await pills(h))['Claude task'] === want, 10000)
  h.expect(await claude('Needs you / Claude Code'), 'claude: permission notification → Needs you')
  h.expect(await claude('Ready for you / Claude Code'), 'claude: Stop hook → Ready for you')
  await h.shot('1-claude-ready')

  await launch(h, 'codex', 'Codex task')
  await h.wait(3000)
  h.expect((await pills(h))['Codex task'] === 'Working / Codex', 'codex: output → Working')
  await h.wait(8000)
  h.expect((await pills(h))['Codex task'] === 'Ready for you / Codex', 'codex: silence → Ready for you')
  await h.wait(4500)
  h.expect((await pills(h))['Codex task'] === 'Needs you / Codex', 'codex: bell → Needs you')
  await h.shot('2-codex-needs-you')
  h.expect(await h.js(`document.querySelector('.mission-card .stats')?.textContent.includes('1 file')`), 'diff stats counted for the worktree')

  // Codex doesn't report back here, so its report is its terminal when it went quiet
  const codexMission = () => h.js(`window.api.store.get('missions').then(s => s.missions.find(m => m.title === 'Codex task'))`)
  h.expect(await h.until(async () => (await codexMission())?.reportFrom === 'terminal', 4000), 'codex: terminal screen stored as the report')
  h.expect((await codexMission())?.report?.includes('done editing'), "codex: the report has the agent's last output")
  await h.click('.mission-title', 'Codex task')
  const dialog = () => h.js(`document.querySelector('dialog[open]')?.textContent ?? ''`)
  h.expect(await h.until(async () => (await dialog()).includes('Final screen'), 4000), 'details: "Final screen" with the terminal snapshot')
  h.expect((await dialog()).includes("doesn't report back"), 'details: says where the report came from')
  await h.wait(500)
  await h.shot('3-codex-final-screen')
  h.key('Escape')
}
