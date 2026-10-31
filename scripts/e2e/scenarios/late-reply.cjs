// Claude sometimes writes its last reply just after the Stop hook fires (seen after a plan-mode Research
// mission): the report must still be caught, and Build from this must open a mission from it.
module.exports = async (h) => {
  await h.openFixture()
  h.key('3', ['control', 'shift'])
  await h.wait(500)
  await h.click('.btn', 'New mission')
  await h.wait(400)
  await h.click('.kind-picker button', 'Research')
  await h.wait(200)
  await h.setValue('.form textarea', 'Survey the parser LATE_REPLY')
  await h.wait(200)
  await h.click('.form .btn.primary', 'Launch')

  const mission = () => h.js(`window.api.store.get('missions').then(s => s.missions[0])`)
  h.expect(await h.until(async () => (await mission())?.report?.includes('Findings: the parser'), 15000), 'the reply written after the Stop hook becomes the report')
  const build = `document.querySelector('.mission-card [aria-label="Build from this"]')`
  h.expect(await h.until(() => h.js(`${build} && !${build}.disabled`), 3000), 'Build from this is enabled')
  await h.js(`${build}.click()`)
  await h.wait(600)
  h.expect(await h.js(`document.querySelector('.kind-picker button.on')?.textContent === 'Build'`), 'Build opens a Build mission')
  h.expect(await h.js(`[...document.querySelectorAll('.form textarea')].some(t => t.value.includes('Findings: the parser allocates per token'))`), "the research report is the new mission's brief")
  await h.shot('1-build-from-research')
}
