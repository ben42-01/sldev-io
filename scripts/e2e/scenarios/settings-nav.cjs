// Settings section links scroll the settings page only. scrollIntoView used to scroll the app shell too, so a
// section near the end (Setup, Security) pushed the whole window up, with a blank strip below and the
// activity bar cut off.
const shifted = `(() => {
  const page = document.querySelector('.panel-page.settings')
  const out = []
  for (let p = page?.parentElement; p; p = p.parentElement) if (p.scrollTop || p.scrollLeft) out.push((p.className || p.tagName) + ':' + p.scrollTop)
  const root = document.scrollingElement
  if (root && root.scrollTop) out.push('document:' + root.scrollTop)
  return out
})()`

const { BrowserWindow } = require('electron')

module.exports = async (h) => {
  // a small window at the largest interface size leaves the least room, where the shift showed most
  await h.openFixture({ uiZoom: 1.25 })
  BrowserWindow.getAllWindows()[0].setSize(1000, 640)
  await h.wait(500)
  await h.click('.titlebar-version')
  await h.wait(600)
  const names = await h.js(`[...document.querySelectorAll('.settings-nav button')].map(b => b.textContent)`)
  h.expect(names.length > 3, `settings has section links (${names.join(', ')})`)
  for (const name of [...names].reverse()) {
    await h.js(`[...document.querySelectorAll('.settings-nav button')].find(b => b.textContent === ${JSON.stringify(name)}).click()`)
    await h.wait(700)
    const moved = await h.js(shifted)
    h.expect(moved.length === 0, `"${name}" scrolls only the settings page${moved.length ? ` (also moved ${moved.join(', ')})` : ''}`)
  }
  await h.js(`[...document.querySelectorAll('.settings-nav button')].find(b => b.textContent === 'Security').click()`)
  await h.wait(700)
  const visible = await h.js(`(() => {
    const h3 = [...document.querySelectorAll('.panel-page.settings > section > h3')].find(e => e.textContent === 'Security')
    const nav = document.querySelector('.settings-nav').getBoundingClientRect()
    return h3.getBoundingClientRect().top >= nav.bottom - 1
  })()`)
  h.expect(visible, 'the Security heading is not hidden under the sticky links')
  await h.shot('0-security')
}
