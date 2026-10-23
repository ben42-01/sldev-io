import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'

/** Tiny JSON file store in userData. Writes are debounced and atomic (tmp + rename). */
export class JsonStore<T extends object> {
  private data: T
  private timer: NodeJS.Timeout | null = null
  private readonly file: string

  constructor(name: string, defaults: T) {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, `${name}.json`)
    let loaded: Partial<T> = {}
    try {
      loaded = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      // first run or corrupt file: fall back to defaults
    }
    this.data = { ...defaults, ...loaded }
  }

  get(): T {
    return this.data
  }

  set(patch: Partial<T>): T {
    this.data = { ...this.data, ...patch }
    this.scheduleWrite()
    return this.data
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.file)
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 300)
  }
}
