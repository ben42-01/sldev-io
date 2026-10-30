// Automations: a CI failure starts a recipe run, labelled issues start one mission at a time, and a
// schedule made in the form runs on "Run now". GitHub is the fake gh (logged in, with failed runs).
const fs = require('fs')
const path = require('path')

const RECIPE = `name: Quick fix
stages:
  - id: fix
    agent: claude
    prompt: "{intent}"
`

module.exports = async (h) => {
  fs.mkdirSync(path.join(h.fixture, '.sldev', 'factory'), { recursive: true })
  fs.writeFileSync(path.join(h.fixture, '.sldev', 'factory', 'quick.yml'), RECIPE)
  const since = Date.parse('2026-01-01T00:00:00Z')
  await h.js(`window.api.store.set('automations', { automations: [
    { id: 'a-ci', name: 'Fix main', root: ${JSON.stringify(h.fixture)}, enabled: true, createdAt: ${since}, trigger: { type: 'ci-failed', branch: 'main' }, action: { type: 'recipe', recipe: 'Quick fix', intent: 'Make CI green' } },
    { id: 'a-issues', name: 'Triage', root: ${JSON.stringify(h.fixture)}, enabled: true, createdAt: ${since}, trigger: { type: 'issue-label', label: 'sldev' }, action: { type: 'mission', kind: 'investigate', brief: 'Find the cause.', agent: 'claude' } }
  ] })`)
  await h.openFixture()
  const store = () => h.js(`window.api.store.get('automations').then(s => s.automations)`)
  const runs = () => h.js(`window.api.store.get('factoryRuns').then(s => s?.runs ?? [])`)
  const missionList = () => h.js(`window.api.store.get('missions').then(s => s?.missions ?? [])`)

  h.expect(await h.until(async () => (await runs()).some((r) => r.intent.includes('gh run view 505')), 25000), 'a CI failure on main starts the recipe with the failing run')
  const ci = (await store()).find((a) => a.id === 'a-ci')
  h.expect([505, 510, 515, 520, 525].every((id) => ci.seen.includes(id)) && /Started Quick fix/.test(ci.lastNote), 'every current failure counts as handled; one run for them')
  h.expect((await runs()).filter((r) => r.recipe.name === 'Quick fix').length === 1, 'only one run is started')

  h.expect(await h.until(async () => (await missionList()).some((m) => m.title === 'Login button does nothing on Safari'), 15000), 'a labelled issue starts a mission')
  await h.wait(1500)
  const ms = await missionList()
  const issueMission = ms.find((m) => m.title === 'Login button does nothing on Safari')
  h.expect(issueMission.kind?.id === 'investigate' && issueMission.prompt.includes('Find the cause.') && issueMission.prompt.includes('#42'), 'the mission gets the brief and the issue')
  h.expect(!ms.some((m) => m.title === 'Add CSV export'), 'the next issue waits while that mission is live')

  // a schedule made in the form; "Run now" starts it straight away
  await h.click('.activitybar button[title^="Factory"]')
  await h.wait(600)
  await h.click('.icon-btn[aria-label="New automation"]')
  await h.wait(300)
  await h.setValue('.automation-form input', 'Morning review')
  await h.click('.automation-form .seg button', 'Start a mission')
  await h.wait(100)
  await h.setValue('.automation-form select', 'review', `e.querySelector('option[value=review]')`)
  await h.setValue('.automation-form textarea', 'Review the commits from the last day')
  await h.wait(200)
  await h.shot('1-form')
  await h.click('.automation-form .btn.primary', 'Create')
  await h.wait(500)
  h.expect(await h.js(`[...document.querySelectorAll('.automation-row .automation-when')].some(e => e.textContent.includes('Every weekday at 09:00'))`), 'the schedule is listed')
  const morning = (await store()).find((a) => a.name === 'Morning review')
  h.expect(morning && morning.trigger.type === 'schedule' && morning.action.kind === 'review', 'the automation is saved')
  await h.js(`[...document.querySelectorAll('.automation-row')].find(r => r.textContent.includes('Morning review')).querySelector('[aria-label="Run now"]').click()`)
  h.expect(await h.until(async () => (await missionList()).some((m) => m.title === 'Morning review' && m.kind?.id === 'review'), 10000), 'Run now starts the review mission')
  await h.wait(800)
  await h.shot('2-list')
}

module.exports.env = { FAKE_GH_AUTHED: '1' }
