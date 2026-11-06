/**
 * Scrolls `el` to the top of its nearest scrolling container, and only that one. Element.scrollIntoView
 * also scrolls every ancestor, the app shell's overflow:hidden ones too: a section near the end of a page
 * can't reach the top, so the rest of the distance shifted the whole window and left a blank strip below.
 * Anything sticky at the top of the container (the settings section links) is kept clear of.
 */
export function scrollToTop(el: Element | null | undefined, behavior: ScrollBehavior = 'auto'): void {
  if (!el) return
  const box = scroller(el)
  if (!box) return
  const sticky = [...box.children].find((c) => c !== el && getComputedStyle(c).position === 'sticky')
  const offset = sticky ? sticky.getBoundingClientRect().height : 0
  const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - offset
  box.scrollTo({ top: Math.max(0, top), behavior })
}

function scroller(el: Element): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if (overflowY === 'auto' || overflowY === 'scroll') return p
  }
  return null
}
