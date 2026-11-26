// Lead: a mission that plans and delegates. The fake Lead starts two workers (Claude and Codex) with
// sldev_delegate; they run unattended in worktrees branched from the Lead's; sldev_wait brings their
// reports back; sldev_integrate merges both branches into the Lead's and runs a check. Workers show
// inside the Lead's card in Mission Control, and a Board card can start with a Lead. The Codex worker is
// delegated by role: the project's QA profile (.sldev/agents/qa.md) brings its agent, model and role text.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const os = require('os')
// Codex's session logs: an empty folder, never the real ~/.codex, so the Codex worker has its time only
const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sldev-e2e-codex-'))

module.exports = async (h) => {
  await h.openFixture({ rightPanelVisible: false })
  const store = (k) => h.js(`window.api.store.get('${k}')`)
  fs.mkdirSync(path.join(h.fixture, '.sldev', 'agents'), { recursive: true })
  fs.writeFileSync(path.join(h.fixture, '.sldev', 'agents', 'qa.md'), '---\nname: QA\ndescription: Tries the change like a user\nagent: codex\nmodel: o4-mini\n---\nYou are QA: you try the change like a user would.\n')

  // a Board card starts with a Lead
  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Board"]')
  await h.until(() => h.js(`document.querySelectorAll('.board-column').length === 6`), 3000)
  await h.click('[data-column="backlog"] .board-add')
  await h.wait(200)
  await h.setValue('.board-quick input', 'Ship the release notes')
  await h.js(`document.querySelector('.board-quick').requestSubmit()`)
  await h.key('Escape')
  const card = `[...document.querySelectorAll('.board-card')].find(c => c.querySelector('.board-title')?.textContent === 'Ship the release notes')`
  await h.until(() => h.js(`!!${card}`), 2000)
  await h.js(`${card}.querySelector('.icon-btn[aria-label="More"]').click()`)
  await h.wait(200)
  await h.click('.ctx-menu .ctx-item', 'Start with a Lead')

  const lead = await h.until(async () => (await store('missions')).missions.find((m) => m.kind?.id === 'lead'), 8000)
  h.expect(!!lead && !!lead.worktree && lead.lead?.maxWorkers === 6 && lead.prompt.startsWith('Lead: #1 Ship the release notes') && lead.prompt.includes('sldev_delegate'), 'the Lead mission starts in its own worktree, with its limits and method')
  h.expect(lead.prompt.includes('Roles you can give a worker') && lead.prompt.includes('- QA: Tries the change like a user (runs on codex o4-mini)') && lead.prompt.includes('- Reviewer:'), "the Lead is told the project's roles")

  const workers = async () => (await store('missions')).missions.filter((m) => m.delegate?.lead === lead.id)
  h.expect(await h.until(async () => (await workers()).length === 2, 20000), 'it delegates two tasks')
  const ws = await workers()
  const claude = ws.find((w) => w.options.agent === 'claude')
  const codex = ws.find((w) => w.options.agent === 'codex')
  h.expect(!!claude && !!codex && ws.every((w) => w.options.print && w.worktree && w.worktree.path !== lead.worktree.path), 'to Claude and Codex, unattended, each in its own worktree')
  h.expect(ws.every((w) => w.worktree.base === lead.worktree.branch), "branched from the Lead's branch")
  h.expect(claude.brief.includes('Acceptance criteria:\n- CHANGES.md says what changed') && claude.brief.includes('one part of a bigger goal'), 'a worker gets its task, criteria and the bigger goal')
  h.expect(claude.delegate.why === 'chosen by the Lead', 'and why it was chosen')
  h.expect(!claude.delegate.role && !claude.prompt.includes('Task:\n'), 'without a role, a worker is started as before')
  h.expect(codex.delegate.role === 'QA' && codex.options.model === 'o4-mini' && codex.delegate.why === "the QA role's agent", "by role: the QA profile's agent and model")
  h.expect(codex.prompt.startsWith('You are QA: you try the change like a user would.\n\n---\n\nTask:\nMission: Codex part'), 'with the role text before its task')
  h.expect(codex.options.print && !!codex.options.permissionMode && !!codex.worktree && codex.kind?.id === 'build', 'still print mode, unattended, in its own worktree')
  h.expect(!ws.some((w) => w.title === 'Design it'), 'an unknown role starts nothing')

  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Mission Control"]')
  await h.until(() => h.js(`!!document.querySelector('.mc')`), 3000)
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.mission-card .lead-worker').length === 2`), 5000), "the workers show inside the Lead's card")
  const org = await h.js(`[...document.querySelectorAll('.mission-card .lead-org-role')].map(g => g.dataset.role + ':' + [...g.querySelectorAll('.lead-worker')].map(w => w.dataset.worker).join(','))`)
  h.expect(JSON.stringify(org) === JSON.stringify([`QA:${codex.id}`, `No role:${claude.id}`]), `grouped by role, "No role" last (${JSON.stringify(org)})`)
  h.expect(await h.js(`!!document.querySelector('.mission-card .lead-org-lead .sdot') && document.querySelector('.mission-card .lead-org-lead .lead-branch')?.title === ${JSON.stringify(lead.worktree.branch)}`), 'the Lead heads the chart with its status and branch')
  h.expect(await h.js(`[...document.querySelectorAll('.mission-card .lead-worker')].every(w => w.querySelector('.sdot[class*="tone-"]') && w.querySelector('.lead-branch'))`), 'each worker has a status dot and its branch')
  h.expect(!(await h.js(`[...document.querySelectorAll('.mission-card > .mission-title')].some(t => t.textContent === 'Codex part')`)), 'not as missions of their own')
  await h.wait(400)
  await h.shot('1-delegating')

  h.expect(await h.until(async () => (await workers()).every((w) => w.delegate?.merged), 90000), 'both branches are merged into the Lead')
  h.expect(fs.existsSync(path.join(lead.worktree.path, 'CHANGES.md')) && fs.existsSync(path.join(lead.worktree.path, 'CODEX.md')), "the Lead's branch has both workers' work")
  h.expect(!fs.existsSync(path.join(h.fixture, 'CODEX.md')), 'and the project itself is untouched')
  const log = execSync('git log --oneline', { cwd: lead.worktree.path, encoding: 'utf8' })
  h.expect(/Merge branch/.test(log), 'merged as commits in the Lead branch')
  const done = await h.until(async () => (await store('missions')).missions.find((m) => m.id === lead.id && m.report), 20000)
  h.expect(!!done && done.report.includes('2 workers') && done.report.includes('passed'), `the Lead reports with the check result (${done?.report ?? ''})`)
  h.expect(/Refused: No role called "Designer"\. Roles: QA, .*Reviewer/.test(done.report), 'the unknown role was refused with the roles there are')
  h.expect(done.report.includes('Wait: names the QA role'), "sldev_wait names the worker's role")
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.mission-card .lead-merged').length === 2`), 5000), 'the card marks both as merged')

  // what each role took, measured when its workers finished: tokens from Claude's transcript, time only for Codex
  const spent = await h.until(async () => {
    const ws2 = await workers()
    return ws2.every((w) => w.spent) && ws2
  }, 10000)
  h.expect(!!spent, 'every worker is measured once it finishes')
  const cs = spent.find((w) => w.id === claude.id).spent
  const xs = spent.find((w) => w.id === codex.id).spent
  h.expect(cs.tokens === 45000 && cs.cost > 0 && cs.ms > 0, `the Claude worker's tokens come from its transcript (${JSON.stringify(cs)})`)
  h.expect(!xs.tokens && xs.ms > 0 && /no Codex log with tokens/.test(xs.noTokens), `the Codex worker without a log has its time only, and why (${JSON.stringify(xs)})`)
  const roleLine = (r) => `document.querySelector('.mission-card .lead-org-role[data-role="${r}"] .lead-spent')?.textContent ?? ''`
  h.expect(await h.until(() => h.js(`${roleLine('No role')}.includes('45k tokens')`), 5000), `the role shows its time and tokens (${await h.js(roleLine('No role'))})`)
  const qa = await h.js(roleLine('QA'))
  h.expect(qa.includes('time only') && qa.includes('no Codex log with tokens found for this run'), `a role without logs shows time only, with the reason (${qa})`)
  const total = await h.until(() => h.js(`(() => { const t = document.querySelector('.mission-card .lead-org-lead .lead-spent')?.textContent ?? ''; return t.startsWith('Total') && t })()`), 5000)
  h.expect(!!total && total.includes('45k tokens (1 time only)'), `the Lead shows a total (${total})`)
  await h.wait(400)
  await h.shot('2-integrated')

  // the board card follows its Lead to Review
  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Board"]')
  h.expect(await h.until(() => h.js(`!!document.querySelector('[data-column="review"] .board-card')`), 15000), 'the board card moves to Review when the Lead is done')
}

module.exports.env = { CODEX_HOME: codexHome }
