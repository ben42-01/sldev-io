// Tab layout setting: tabs on top (default) or a readable list down the left side of each group.
module.exports = async (h) => {
  await h.openFixture()
  h.key('T', ['control', 'shift'])
  await h.wait(1200)
  h.key('T', ['control', 'shift'])
  await h.wait(1200)
  h.expect(await h.js(`document.querySelectorAll('.dv-groupview-header-top').length > 0 && !document.querySelector('.dv-groupview-header-left')`), 'tabs start on top')
  await h.shot('0-top')

  h.key('P', ['control', 'shift'])
  await h.wait(300)
  h.type('Toggle tab layout')
  await h.wait(300)
  h.key('Enter')
  await h.wait(600)
  h.expect(await h.js(`!!document.querySelector('.dv-groupview-header-left') && !document.querySelector('.dv-groupview-header-top')`), 'palette command moves tabs to the side')
  h.expect(await h.js(`(() => { const t = document.querySelector('.dv-groupview-header-left .dv-tabs-container'); return getComputedStyle(t).writingMode === 'horizontal-tb' })()`), 'side tabs read horizontally')
  h.expect(await h.js(`document.querySelectorAll('.dv-groupview-header-left .dv-tab').length === 2`), 'both terminals are listed')
  h.expect(await h.js(`window.api.settings.get().then(s => s.tabLayout === 'side')`), 'tab layout is saved')
  await h.shot('1-side')

  // a split gets the side list too
  await h.click('.group-actions button[title="Split right"]')
  await h.wait(1200)
  h.expect(await h.js(`document.querySelectorAll('.dv-groupview-header-left').length === 2`), 'new groups follow the setting')
  await h.shot('2-side-split')

  // a sidebar drag that ends without a mouseup on the handle (window loses focus) must not leave the resize cursor stuck
  const r = await h.js(`(() => { const r = document.querySelector('.sidebar-resize').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 200) } })()`)
  h.mouse({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  h.mouse({ type: 'mouseMove', x: r.x + 30, y: r.y, button: 'left' })
  await h.wait(200)
  h.expect(await h.js(`document.body.classList.contains('resizing')`), 'dragging the sidebar edge shows the resize cursor')
  await h.js(`(window.dispatchEvent(new Event('blur')), true)`)
  await h.wait(100)
  h.expect(await h.js(`!document.body.classList.contains('resizing')`), 'losing focus mid-drag clears the resize cursor')
  h.mouse({ type: 'mouseUp', x: r.x + 30, y: r.y, button: 'left', clickCount: 1 })
}
