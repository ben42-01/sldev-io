import { reviewOrder, type OpenPrList } from '@shared/prs'
import { ago } from '../components/MissionCard'
import { showPicker, type PickItem } from './picker'
import { openPrReview } from './reviewTargets'
import { createStore } from './store'
import { workspace } from './workspace'

/**
 * The open pull requests of the project, as last read through gh. Only asked for while the Workflows tab's
 * Pull requests section is on screen (and once when the palette's "Review a pull request…" opens), never
 * in the background; the last answer stays so the section's header can show its count while closed.
 */
export const pullRequests = createStore<{ root: string | null; list: OpenPrList | null; loading: boolean; at: number }>({ root: null, list: null, loading: false, at: 0 })

let inflight: Promise<OpenPrList> | null = null

export function loadPullRequests(root: string): Promise<OpenPrList> {
  if (inflight && pullRequests.get().root === root) return inflight
  // another project's list is not this one's
  if (pullRequests.get().root !== root) pullRequests.set({ root, list: null })
  pullRequests.set({ loading: true })
  const p = window.api.gh
    .prs(root)
    .catch((e): OpenPrList => ({ prs: [], error: String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '') }))
    .then((list) => {
      if (pullRequests.get().root === root) pullRequests.set({ list, loading: false, at: Date.now() })
      return list
    })
    .finally(() => {
      if (inflight === p) inflight = null
    })
  inflight = p
  return p
}

/** The palette's "Review a pull request…": the list in review order, fuzzy-searched by number, title and author. */
export function showPrPicker(): void {
  const root = workspace.get().rootFolder
  if (!root) return
  showPicker({
    placeholder: 'Review a pull request…',
    items: loadPullRequests(root).then((r): PickItem[] => {
      if (r.error) return [{ id: 'error', label: r.error, run: () => undefined }]
      return reviewOrder(r.prs, r.me).map((p) => ({
        id: String(p.number),
        label: `#${p.number} ${p.title}`,
        detail: `${p.author}${p.isDraft ? ' · draft' : ''} · ${ago(Date.parse(p.createdAt))}`,
        run: () => openPrReview(root, { number: p.number, title: p.title, headSha: p.headSha })
      }))
    })
  })
}
