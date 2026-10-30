// GitHub Workflows in a repo without Actions: an empty state, not a JSON parse error.
module.exports = async (h) => {
  await h.openFixture({ rightPanelVisible: true, rightPanelTab: 'workflows', rightPanelWidth: 340 })
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.wf-section.list .muted-note')].some(n => n.textContent.includes('No workflows'))`), 8000), 'says the repo has no workflows')
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.wf-section.runs .muted-note')].some(n => n.textContent.includes('No runs yet'))`), 4000), 'says there are no runs')
  h.expect(await h.js(`!document.querySelector('.rightpanel .form-error')`), 'no error is shown')
  h.expect(await h.js(`!/JSON|syntax/i.test(document.querySelector('.rightpanel').textContent)`), 'no JSON error text anywhere')
  await h.shot('0-empty')
}

module.exports.env = { FAKE_GH_AUTHED: '1', FAKE_GH_NO_WORKFLOWS: '1' }
