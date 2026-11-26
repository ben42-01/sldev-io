// GitHub Workflows: two sections that start closed, take only the room their rows need and scroll on their own, and dispatching a workflow with typed inputs.
const fs = require('fs')
const path = require('path')

module.exports = async (h) => {
  const wf = path.join(h.fixture, '.github', 'workflows')
  fs.mkdirSync(wf, { recursive: true })
  fs.writeFileSync(
    path.join(wf, 'deploy.yml'),
    'on:\n  workflow_dispatch:\n    inputs:\n      environment:\n        description: Environment\n        type: choice\n        required: true\n        options: [staging, production]\n      migrate:\n        description: Run database migrations\n        type: boolean\n'
  )
  await h.openFixture({ rightPanelVisible: true, rightPanelTab: 'workflows', rightPanelWidth: 340 })
  const rect = (sel) => h.js(`(() => { const r = document.querySelector('${sel}')?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom } : null })()`)
  // both start closed: two headers with their counts, one under the other
  h.expect(await h.until(() => h.js(`/25/.test(document.querySelector('.wf-section.list .wf-section-header')?.textContent ?? '')`), 8000), 'the closed Workflows header counts the workflows (the list adds All workflows)')
  h.expect(await h.until(() => h.js(`/30/.test(document.querySelector('.wf-section.runs .wf-section-header')?.textContent ?? '')`), 8000), 'the closed Runs header counts the runs')
  h.expect(await h.js(`!document.querySelector('.wf-section-body')`), 'both sections start closed')
  const list0 = await rect('.wf-section.list')
  const runs0 = await rect('.wf-section.runs')
  h.expect(Math.abs(runs0.top - list0.bottom) <= 2, 'closed, Runs sits right under Workflows')
  await h.shot('0-closed')

  // Runs alone: right at the top, as tall as its rows, and scrolling inside
  await h.click('.wf-section.runs .wf-section-header')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.wf-section.runs .gh-run-row').length === 30`), 8000), 'runs section lists the runs')
  h.expect(Math.abs((await rect('.wf-section.runs')).top - runs0.top) <= 2, 'opening Runs keeps it where it was')
  await h.shot('1-runs')
  await h.click('.wf-section.runs .wf-section-header')
  await h.wait(200)

  // Workflows alone with a long list: the closed Runs header stays in view, not pushed to the bottom of the panel
  await h.click('.wf-section.list .wf-section-header')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.wf-section.list .wf-row').length === 26`), 8000), 'workflows section lists every workflow')
  h.expect(await h.js(`window.api.settings.get().then(s => s.assetGroups['workflows:list'] === true)`), 'an opened section is remembered')
  const body = await rect('.wf-section.list .wf-section-body')
  const runsHead = await rect('.wf-section.runs')
  h.expect(Math.abs(runsHead.top - body.bottom) <= 2, 'the Runs header follows the workflow list, with no gap')
  await h.shot('2-workflows')

  // both open: each scrolls on its own and the runs stay in the top half
  await h.click('.wf-section.runs .wf-section-header')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.wf-section.runs .gh-run-row').length === 30`), 8000), 'runs open again')
  const scrolls = await h.js(`[...document.querySelectorAll('.wf-section-body')].map(b => b.scrollHeight > b.clientHeight)`)
  h.expect(scrolls[0] && scrolls[1], 'both sections scroll on their own')
  h.expect(await h.js(`document.querySelector('.wf-section.runs').getBoundingClientRect().top < window.innerHeight / 2 + 100`), 'runs stay in view below a long workflow list')
  await h.shot('3-both')

  await h.js(`(() => { const row = [...document.querySelectorAll('.wf-row')].find(r => r.textContent.includes('Deploy')); row.querySelector('button').click() })()`)
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.inline-form option')].some(o => o.value === 'production')`), 4000), 'dispatch form shows the choice input')
  h.expect(await h.js(`[...document.querySelectorAll('.inline-form .check span')].some(s => s.textContent.includes('Run database migrations'))`), 'dispatch form shows the boolean input')
  await h.shot('2-dispatch')
  await h.click('.inline-form button[type="submit"]')
  h.expect(await h.until(() => fs.existsSync(path.join(h.fixture, 'gh-dispatch-marker.txt')), 4000), 'Run workflow dispatches it')
  const sent = fs.readFileSync(path.join(h.fixture, 'gh-dispatch-marker.txt'), 'utf8')
  h.expect(/workflow run 1 --ref \S+ -f environment=staging -f migrate=false/.test(sent), 'dispatch passes the branch and inputs')
}

module.exports.env = { FAKE_GH_AUTHED: '1' }
