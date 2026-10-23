export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'
  text: string
  oldNo?: number
  newNo?: number
}

export interface DiffFile {
  path: string
  oldPath?: string
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  binary: boolean
  additions: number
  deletions: number
  lines: DiffLine[]
}

/** Parse `git diff` unified output into files and numbered lines. */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  for (const chunk of text.split(/^diff --git /m).slice(1)) {
    const rows = chunk.split('\n')
    const header = /^a\/(.+?) b\/(.+)$/.exec(rows[0]) ?? /^(\S+) (\S+)$/.exec(rows[0])
    const f: DiffFile = { path: header?.[2] ?? rows[0], status: 'modified', binary: false, additions: 0, deletions: 0, lines: [] }
    let oldNo = 0
    let newNo = 0
    let inHunks = false
    for (const row of rows.slice(1)) {
      if (!inHunks) {
        if (row.startsWith('new file')) f.status = 'added'
        else if (row.startsWith('deleted file')) f.status = 'deleted'
        else if (row.startsWith('rename from ')) {
          f.status = 'renamed'
          f.oldPath = row.slice(12)
        } else if (row.startsWith('Binary files')) f.binary = true
        else if (row.startsWith('+++ ') && row !== '+++ /dev/null') f.path = row.slice(4).replace(/^b\//, '')
        else if (row.startsWith('--- ') && row !== '--- /dev/null' && f.status === 'deleted') f.path = row.slice(4).replace(/^a\//, '')
      }
      const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(row)
      if (h) {
        inHunks = true
        oldNo = Number(h[1])
        newNo = Number(h[2])
        f.lines.push({ kind: 'hunk', text: row })
      } else if (inHunks) {
        if (row.startsWith('+')) {
          f.lines.push({ kind: 'add', text: row.slice(1), newNo: newNo++ })
          f.additions++
        } else if (row.startsWith('-')) {
          f.lines.push({ kind: 'del', text: row.slice(1), oldNo: oldNo++ })
          f.deletions++
        } else if (row.startsWith(' ')) f.lines.push({ kind: 'ctx', text: row.slice(1), oldNo: oldNo++, newNo: newNo++ })
        else if (row.startsWith('\\')) f.lines.push({ kind: 'meta', text: row })
      }
    }
    files.push(f)
  }
  return files
}
