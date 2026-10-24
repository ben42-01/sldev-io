import { describe, expect, it } from 'vitest'
import { parseDiff } from '@renderer/lib/diff'

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1
-const b = 2
+const b = 3
+const c = 4
 export { a }
diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
\\ No newline at end of file
diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
diff --git a/from.ts b/to.ts
similarity index 90%
rename from from.ts
rename to to.ts
`

describe('parseDiff', () => {
  const files = parseDiff(DIFF)

  it('splits files and detects status', () => {
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['src/a.ts', 'modified'],
      ['new.txt', 'added'],
      ['old.txt', 'deleted'],
      ['img.png', 'modified'],
      ['to.ts', 'renamed']
    ])
    expect(files[3].binary).toBe(true)
    expect(files[4].oldPath).toBe('from.ts')
  })

  it('counts changes and numbers lines', () => {
    const [a] = files
    expect([a.additions, a.deletions]).toEqual([2, 1])
    expect(a.lines.find((l) => l.kind === 'del')).toMatchObject({ text: 'const b = 2', oldNo: 2 })
    expect(a.lines.filter((l) => l.kind === 'add').map((l) => l.newNo)).toEqual([2, 3])
    expect(a.lines.at(-1)).toMatchObject({ kind: 'ctx', oldNo: 3, newNo: 4 })
  })

  it('keeps "no newline" markers as meta lines', () => {
    expect(files[1].lines.at(-1)?.kind).toBe('meta')
  })

  it('returns nothing for empty input', () => {
    expect(parseDiff('')).toEqual([])
  })
})
