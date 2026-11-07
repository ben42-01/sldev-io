// Evals: eval files in .sldev/evals run against two agents. Each attempt works in its own worktree in
// print mode, then its checks run (a command, a diff limit, a judge agent). Mission Control → Evals
// shows the matrix and a leaderboard; the scoreboard copies as Markdown; deleting a run removes its worktrees.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// fake claude writes CHANGES.md in print mode, fake codex writes CODEX.md
const NOTE = `name: Leave a note
description: Writes down what it changed
brief: Write down what you change in CHANGES.md.
timeout: 2
checks:
  - run: node -e "require('fs').statSync('CHANGES.md')"
`
const SMALL = `name: Small change
brief: Make a small change.
timeout: 2
checks:
  - diff: 10
  - judge: The change is small and focused.
`
const BROKEN = `name: Broken
checks: [npm test]
`

module.exports = async (h) => {
  const dir = path.join(h.fixture, '.sldev', 'evals')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'note.yml'), NOTE)
  fs.writeFileSync(path.join(dir, 'small.yml'), SMALL)
  fs.writeFileSync(path.join(dir, 'broken.yml'), BROKEN)
  execSync('git add -A && git commit -qm evals', { cwd: h.fixture })
  await h.openFixture({ rightPanelVisible: false })

  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Mission Control"]')
  await h.until(() => h.js(`!!document.querySelector('.mc')`), 3000)
  await h.click('.mc-tab', 'Evals')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.evals-file').length === 3`), 3000), 'the eval files are listed')
  h.expect(await h.js(`document.querySelector('.evals-file.broken')?.textContent.includes('brief is missing')`), 'a broken file says what is wrong')
  h.expect(await h.js(`[...document.querySelectorAll('.evals-file')].some(f => f.textContent.includes('judge') && f.textContent.includes('diff ≤ 10'))`), 'each eval shows its checks')

  // run both good evals against Claude and Codex
  await h.click('.evals-page .btn.primary', 'Run evals')
  h.expect(await h.until(() => h.js(`document.querySelector('dialog[open] .modal-title')?.textContent === 'Run evals'`), 2000), 'the run dialog opens')
  h.expect(await h.js(`document.querySelectorAll('dialog[open] .board-import-list')[0].querySelectorAll('li').length === 2`), 'only the valid evals are offered')
  await h.setValue('dialog[open] .evals-contestant select', 'claude', `e === document.querySelectorAll('dialog[open] .evals-contestant select')[0]`)
  await h.setValue('dialog[open] .evals-contestant input', 'opus', `e === document.querySelectorAll('dialog[open] .evals-contestant input')[0]`)
  await h.setValue('dialog[open] .evals-contestant select', 'codex', `e === document.querySelectorAll('dialog[open] .evals-contestant select')[1]`)
  await h.wait(300)
  h.expect(await h.js(`document.querySelector('dialog[open] .btn.primary').textContent.includes('Run 4 attempts')`), '2 evals × 2 agents = 4 attempts')
  await h.shot('1-run-dialog')
  await h.click('dialog[open] .btn.primary', 'Run')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.evals-run.live')`), 5000), 'the run starts')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.evals-attempt[data-status="running"], .evals-attempt[data-status="checking"]')`), 15000), 'an attempt is running')
  h.expect(await h.js(`!!document.querySelector('.mc-tab.on')?.textContent.includes('Evals')`), 'Mission Control stays in front')
  await h.wait(500)
  await h.shot('2-running')

  const run = async () => (await h.js(`window.api.store.get('evals')`)).runs[0]
  h.expect(await h.until(async () => !!(await run())?.finishedAt, 120000), 'every attempt finishes')
  const r = await run()
  const by = (ev, agent) => r.attempts.find((a) => a.eval === ev && a.contestant.agent === agent)
  h.expect(by('Leave a note', 'claude').status === 'passed' && by('Leave a note', 'codex').status === 'failed', `the command check tells them apart (${by('Leave a note', 'claude').status}/${by('Leave a note', 'codex').status} ${JSON.stringify(by('Leave a note', 'codex').checks)})`)
  h.expect(by('Leave a note', 'claude').contestant.model === 'opus', 'the model is part of the contestant')
  const small = by('Small change', 'claude')
  h.expect(small.checks.length === 2 && small.checks[0].ok && small.checks[1].label === 'judge' && small.checks[1].ok, `the diff limit and the judge ran (${JSON.stringify(small.checks)} ${small.note ?? ''})`)
  h.expect(r.attempts.every((a) => a.worktree && a.worktree.path !== h.fixture && a.agentMs > 0), 'each attempt worked in its own worktree')
  h.expect(!fs.existsSync(path.join(h.fixture, 'CHANGES.md')), 'nothing changed in the project itself')
  const missions = (await h.js(`window.api.store.get('missions')`)).missions
  h.expect(missions.some((m) => m.eval?.judge) && missions.filter((m) => m.eval).length === 6, 'four agent missions and two judges')

  await h.until(() => h.js(`!!document.querySelector('.evals-leaderboard')`), 3000)
  h.expect(await h.js(`document.querySelector('.evals-cell[data-eval="Leave a note"][data-agent="claude/opus"]')?.textContent === '1/1' && document.querySelector('.evals-cell[data-eval="Leave a note"][data-agent="codex"]')?.textContent === '0/1'`), 'the matrix shows each eval per agent')
  h.expect(await h.js(`document.querySelector('.evals-leaderboard tbody tr .evals-who')?.textContent.includes('Claude')`), 'the leaderboard puts the best agent first')
  await h.wait(400)
  await h.shot('3-scoreboard')

  // Mission Control → Missions doesn't fill up with eval attempts
  await h.click('.mc-tab', 'Missions')
  await h.wait(300)
  h.expect(!(await h.js(`[...document.querySelectorAll('.mission-card')].some(c => c.textContent.includes('Eval:'))`)), 'eval attempts stay out of the missions board')
  await h.click('.mc-tab', 'Evals')
  await h.until(() => h.js(`!!document.querySelector('.evals-run')`), 2000)

  // copy the scoreboard
  await h.click('.evals-run .btn', 'Copy')
  const md = await h.until(async () => { const t = await h.js(`window.api.clipboard.readText()`); return typeof t === 'string' && t.startsWith('## Eval scoreboard') && t }, 2000)
  h.expect(!!md && md.includes('| Claude Code · opus | 100% (2/2)'), 'the scoreboard copies as Markdown')

  // a new eval from the template
  await h.click('.evals-page .btn', 'New eval')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.evals-file').length === 4`), 3000), 'New eval adds a file from the template')

  // deleting the run removes its worktrees
  const wts = r.attempts.map((a) => a.worktree.path)
  await h.click('.evals-run .icon-btn[aria-label="Delete run"]')
  h.expect(await h.until(() => h.js(`document.querySelector('dialog[open]')?.textContent.includes('worktrees')`), 2000), 'deleting a run asks first and says what goes')
  await h.click('dialog[open] .btn', 'Delete run')
  h.expect(await h.until(() => h.js(`!document.querySelector('.evals-run')`), 10000), 'the run is gone')
  h.expect(await h.until(() => wts.every((p) => !fs.existsSync(p)), 5000), 'and so are its worktrees')

  // prompt variants: the same eval with and without extra instructions, side by side
  fs.mkdirSync(path.join(dir, 'prompts'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'prompts', 'terse.md'), 'PROMPT_MARK Keep every change tiny.\n')
  await h.click('.evals-page .btn.primary', 'Run evals')
  await h.until(() => h.js(`document.querySelector('dialog[open] .modal-title')?.textContent === 'Run evals'`), 2000)
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('dialog[open] .board-import-title')].some(t => t.textContent === 'terse')`), 3000), 'prompt variants in .sldev/evals/prompts are offered')
  // one eval, one agent
  await h.js(`[...document.querySelectorAll('dialog[open] .board-import-list')[0].querySelectorAll('li')].filter(li => /Small change|My first eval/.test(li.textContent)).forEach(li => li.querySelector('input').click())`)
  await h.js(`document.querySelectorAll('dialog[open] .evals-contestant .icon-btn[aria-label="Remove"]')[1]?.click()`)
  await h.js(`[...document.querySelectorAll('dialog[open] .board-import-list li')].find(li => li.textContent.includes('terse')).querySelector('input').click()`)
  // a new variant from the template, created from the dialog
  await h.click('dialog[open] .btn', 'New prompt variant')
  await h.setValue('dialog[open] input[aria-label="Prompt name"]', 'tests first')
  await h.click('dialog[open] .btn', 'Create and edit')
  h.expect(await h.until(() => fs.existsSync(path.join(dir, 'prompts', 'tests-first.md')), 3000), 'New prompt variant writes a file from the template')
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('dialog[open] .board-import-list li')].find(li => li.textContent.includes('tests-first'))?.querySelector('input').checked`), 3000), 'and picks it')
  h.expect(await h.until(() => h.js(`document.querySelector('dialog[open] .btn.primary').textContent.includes('Run 3 attempts')`), 2000), '1 eval × 1 agent × 3 prompts (as written, terse, tests first) = 3 attempts')
  await h.wait(300)
  await h.shot('4-prompt-variants')
  await h.click('dialog[open] .btn.primary', 'Run')
  h.expect(await h.until(async () => !!(await run())?.finishedAt, 120000), 'the variant run finishes')
  const pr = await run()
  h.expect(JSON.stringify(pr.contestants.map((c) => c.prompt?.name ?? '')) === JSON.stringify(['', 'terse', 'tests-first']), `each variant is a contestant (${JSON.stringify(pr.contestants)})`)
  const vm = (await h.js(`window.api.store.get('missions')`)).missions.filter((m) => m.eval?.run === pr.id && !m.eval.judge)
  h.expect(vm.some((m) => m.prompt.includes('PROMPT_MARK Keep every change tiny.') && m.prompt.indexOf('PROMPT_MARK') < m.prompt.indexOf('Write down what you change')) && vm.some((m) => !m.prompt.includes('PROMPT_MARK') && !m.prompt.includes('read the tests next to')), 'the variant goes before the brief; as written gets the brief alone')
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.evals-leaderboard .evals-who')].some(t => t.textContent.includes('terse')) && !!document.querySelector('.evals-copy-prompt')`), 3000), 'the leaderboard ranks prompts too, with a copy button')
  await h.wait(300)
  await h.shot('5-prompt-scoreboard')
}
