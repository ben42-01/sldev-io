import { promises as fsp, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import type { WebContents } from 'electron'
import type { DirEntry } from '@shared/types'

const HIDDEN = new Set(['.git', '.DS_Store'])

export async function readDir(dir: string): Promise<DirEntry[]> {
  const dirents = await fsp.readdir(dir, { withFileTypes: true })
  const entries = await Promise.all(
    dirents
      .filter((d) => !HIDDEN.has(d.name))
      .map(async (d): Promise<DirEntry> => {
        const path = join(dir, d.name)
        let isDir = d.isDirectory()
        if (d.isSymbolicLink()) {
          isDir = await fsp.stat(path).then((s) => s.isDirectory(), () => false)
        }
        return { name: d.name, path, isDir, isSymlink: d.isSymbolicLink() }
      })
  )
  return entries.sort((a, b) =>
    a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  )
}

/** Ref-counted, debounced, non-recursive directory watchers (one per expanded folder in the tree). */
export class DirWatchers {
  private watchers = new Map<string, { w: FSWatcher; refs: number; timer: NodeJS.Timeout | null }>()

  constructor(private owner: () => WebContents | null) {}

  watch(dir: string): void {
    const existing = this.watchers.get(dir)
    if (existing) {
      existing.refs++
      return
    }
    try {
      const entry = { w: null as unknown as FSWatcher, refs: 1, timer: null as NodeJS.Timeout | null }
      entry.w = watch(dir, { persistent: false }, () => {
        if (entry.timer) clearTimeout(entry.timer)
        entry.timer = setTimeout(() => {
          const wc = this.owner()
          if (wc && !wc.isDestroyed()) wc.send('fs:changed', dir)
        }, 150)
      })
      entry.w.on('error', () => this.unwatch(dir, true))
      this.watchers.set(dir, entry)
    } catch {
      // unreadable dir or watcher limit reached: tree still works, just without live refresh
    }
  }

  unwatch(dir: string, force = false): void {
    const e = this.watchers.get(dir)
    if (!e) return
    if (--e.refs > 0 && !force) return
    if (e.timer) clearTimeout(e.timer)
    e.w.close()
    this.watchers.delete(dir)
  }

  closeAll(): void {
    for (const dir of [...this.watchers.keys()]) this.unwatch(dir, true)
  }
}
