import { useEffect } from 'react'

export type CliPage = 'home' | 'commands'

/** The CLI's two pages on the sldev site: /cli/ and /cli/commands/. */
export function hrefTo(to: CliPage, hash = ''): string {
  return `${to === 'home' ? '/cli/' : '/cli/commands/'}${hash}`
}

/**
 * The pages are drawn by React after load, so the browser finds no element for a #hash it was opened with
 * (a feature card's link to commands/#review). Scroll to it once the page is there.
 */
export function useScrollToHash(): void {
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (!id) return
    const go = (): void => document.getElementById(id)?.scrollIntoView()
    go()
    // web fonts change line heights, so land again once they are in
    void document.fonts?.ready.then(go)
  }, [])
}
