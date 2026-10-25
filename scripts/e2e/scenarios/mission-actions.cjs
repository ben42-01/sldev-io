// Mission actions: start from a GitHub issue, run one prompt on two agents (a bake-off), and have
// another agent review a mission's changes.
const menuItem = (h, label) => h.js(`(() => { const i = [...document.querySelectorAll('.ctx-item')].find(e => e.textContent.trim() === ${JSON.stringify(label)}); i?.click(); return !!i })()`)

module.exports = async (h) => {
  await h.openFixture()
  h.key('3', ['control', 'shift'])
  await h.wait(500)
  await h.click('.btn', 'New mission')
  await h.wait(400)

  // from an issue: the fake gh lists two
  await h.click('.issue-btn')
  await h.wait(800)
  h.expect(await h.js(`document.querySelectorAll('.issue-row').length === 2`), 'open issues are listed')
  await h.click('.issue-row', '#42')
  await h.wait(200)
  h.expect(await h.js(`document.querySelector('.form textarea').value.startsWith('Login button does nothing on Safari (#42)\\n\\nClicking Log in')`), 'the issue fills the prompt')

  // compare: Claude (the default) plus Codex
  await h.js(`[...document.querySelectorAll('.compare-list label')].find(l => l.textContent === 'Codex')?.querySelector('input').click()`)
  await h.wait(200)
  h.expect(await h.js(`document.querySelector('.form .btn.primary').textContent.includes('Launch on 2 agents')`), 'the launch button says how many agents')
  await h.shot('0-form')
  await h.click('.form .btn.primary', 'Launch on 2 agents')
  const runs = () => h.js(`window.api.store.get('factoryRuns').then(s => s.runs)`)
  h.expect(await h.until(async () => (await runs())[0]?.nodes.compare?.status === 'approval', 30000), 'both agents ran as a bake-off')
  const run = (await runs())[0]
  h.expect(run.recipe.name === 'Compare agents' && run.issue === 42, 'the run remembers the issue, so its PR closes it')
  h.expect(run.nodes.compare.candidates.map((c) => c.spec).join(',') === 'claude,codex', 'Claude and Codex each made a version')
  await h.shot('1-compare')

  // review with another agent, from the mission card menu
  h.key('3', ['control', 'shift'])
  await h.wait(500)
  const before = (await h.js(`window.api.store.get('missions')`)).missions.length
  await h.js(`(() => { const c = [...document.querySelectorAll('.mission-card')].find(c => c.querySelector('.mission-agent')?.textContent === 'Claude Code'); c?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 })) })()`)
  await h.wait(300)
  h.expect(await h.js(`[...document.querySelectorAll('.ctx-item')].some(e => e.textContent.trim() === 'Codex')`), 'the menu offers other agents to review')
  await h.shot('2-menu')
  h.expect(await menuItem(h, 'Codex'), 'pick Codex')
  await h.wait(1500)
  const list = (await h.js(`window.api.store.get('missions')`)).missions
  const review = list[0]
  h.expect(list.length === before + 1 && review.title.startsWith('Review: ') && review.options.agent === 'codex' && review.options.profile === 'builtin:reviewer', 'a Codex review mission starts with the Reviewer profile')
  h.expect(review.prompt.includes('git diff') && review.prompt.includes('Login button does nothing'), 'the review prompt points at the diff and the original task')
  const reviewed = list.find((m) => m.options.agent === 'claude' && m.factory)
  h.expect(review.cwd === reviewed?.cwd, 'the reviewer works in the same folder')
}
