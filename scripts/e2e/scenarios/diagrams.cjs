// Diagrams panel: a small TS project (relative + tsconfig-path imports), a Python package, a Java tree, a Go module,
// a Prisma schema and a SQL migration in the fixture → code map with folder boxes and links in every language, the
// language filter, selection side panel, Files tab with leaves, schema ERD with foreign keys; then a Swift-only
// project, where the panel switches to Files on its own.
const fs = require('fs')
const path = require('path')

function write(root, rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}

module.exports = async (h) => {
  const r = h.fixture
  write(r, 'tsconfig.json', '{ // paths\n "compilerOptions": { "paths": { "@lib/*": ["./src/lib/*"] } } }\n')
  write(r, 'src/ui/App.tsx', "import { api } from '../api/client'\nimport { fmt } from '@lib/format'\nexport const App = () => fmt(api())\n")
  write(r, 'src/ui/Header.tsx', "import { App } from './App'\nimport { useStore } from '../state/store'\nexport const H = () => [App, useStore]\n")
  write(r, 'src/state/store.ts', "import { api } from '../api/client'\nexport const useStore = () => api\n")
  write(r, 'src/api/client.ts', "import { fmt } from '../lib/format'\nimport type { User } from '../lib/types'\nexport const api = () => fmt('x')\n")
  write(r, 'src/lib/format.ts', "export const fmt = (s: string) => s\n")
  write(r, 'src/lib/types.ts', 'export interface User { id: number }\n')
  // Python: absolute and relative imports, a pyproject root
  write(r, 'py/pyproject.toml', '[project]\nname = "shop"\n')
  write(r, 'py/shop/__init__.py', '')
  write(r, 'py/shop/models.py', 'from .db import session\n')
  write(r, 'py/shop/db.py', '"""Database."""\nimport os\n')
  write(r, 'py/shop/web/views.py', 'from shop.models import Order\nfrom ..db import session  # relative\n')
  // Java: resolved by package, not by path
  write(r, 'jv/src/main/java/com/acme/App.java', 'package com.acme;\nimport com.acme.model.User;\nimport com.acme.util.*;\npublic class App {}\n')
  write(r, 'jv/src/main/java/com/acme/model/User.java', 'package com.acme.model;\nimport com.acme.util.Strings;\npublic class User {}\n')
  write(r, 'jv/src/main/java/com/acme/util/Strings.java', 'package com.acme.util;\npublic class Strings {}\n')
  // Go: a module, packages are folders
  write(r, 'gosvc/go.mod', 'module example.com/svc\n\ngo 1.22\n')
  write(r, 'gosvc/cmd/main.go', 'package main\n\nimport (\n  "fmt"\n  "example.com/svc/store"\n)\n')
  write(r, 'gosvc/store/store.go', 'package store\n')
  write(r, 'prisma/schema.prisma', `model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  name  String?
  posts Post[]
}

model Post {
  id       Int    @id
  title    String
  authorId Int
  author   User   @relation(fields: [authorId], references: [id])
  comments Comment[]
}
`)
  write(r, 'db/migrations/001_init.sql', `CREATE TABLE "Comment" (
  id serial PRIMARY KEY,
  post_id integer NOT NULL REFERENCES "Post"(id),
  author_id integer REFERENCES "User"(id),
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);
`)

  await h.openFixture()
  await h.click('.activitybar .activity-btn[aria-label="Diagrams"]')
  await h.until(() => h.js(`document.querySelectorAll('.diagram-canvas .dg-node').length > 0`), 8000)
  await h.wait(300)
  const nodes = await h.js(`[...document.querySelectorAll('.diagram-canvas .dg-node')].map(n => n.getAttribute('aria-label').split(',')[0]).sort()`)
  h.log('code nodes', JSON.stringify(nodes))
  for (const n of ['src/api', 'src/lib', 'src/state', 'src/ui']) h.expect(nodes.includes(n), `code map has ${n}`)
  const edges = await h.js(`document.querySelectorAll('.diagram-canvas .dg-edge').length`)
  h.expect(edges >= 4, `code map draws the folder links (${edges})`)
  // dependents to the left of their dependencies: ui → … → lib
  const xs = await h.js(`Object.fromEntries([...document.querySelectorAll('.dg-node')].map(n => [n.getAttribute('aria-label').split(',')[0], n.getBoundingClientRect().x]))`)
  h.expect(xs['src/ui'] < xs['src/lib'], 'src/ui sits left of src/lib')
  for (const n of ['py/shop', 'jv/src', 'gosvc/cmd', 'gosvc/store']) h.expect(nodes.includes(n), `code map has ${n}`)
  const titles = await h.js(`[...document.querySelectorAll('.diagram-canvas .dg-edge title')].map(t => t.textContent)`)
  h.expect(titles.some((t) => t.startsWith('gosvc/cmd → gosvc/store')), 'Go import drawn as a link')
  const lsub = await h.js(`document.querySelector('.board-title .small').textContent`)
  h.expect(/Python 4/.test(lsub) && /Java\/Kotlin 3/.test(lsub) && /Go 2/.test(lsub), `subtitle counts files per language (${lsub})`)
  const langs = await h.js(`[...document.querySelectorAll('.board-filters .seg[aria-label="Language"] button')].map(b => b.textContent)`)
  h.log('languages', JSON.stringify(langs))
  h.expect(langs.length === 5 && langs[0] === 'All', 'language filter lists All and the four languages present')
  await h.shot('01-code-map')

  // one language: Python only, at depth 3 py/shop/web → py/shop
  await h.click('.board-filters .seg[aria-label="Language"] button', 'Python')
  await h.click('.board-filters .seg[aria-label="Folder depth"] button', 'Depth 3')
  await h.until(() => h.js(`[...document.querySelectorAll('.dg-node')].some(n => n.getAttribute('aria-label').startsWith('py/shop/web'))`), 8000)
  await h.wait(300)
  const pyNodes = await h.js(`[...document.querySelectorAll('.diagram-canvas .dg-node')].map(n => n.getAttribute('aria-label').split(',')[0]).sort()`)
  h.expect(JSON.stringify(pyNodes) === JSON.stringify(['py/shop', 'py/shop/web']), `Python filter shows only Python folders (${pyNodes})`)
  h.expect((await h.js(`document.querySelectorAll('.diagram-canvas .dg-edge').length`)) === 1, 'Python link py/shop/web → py/shop')
  await h.shot('01b-code-python')
  await h.click('.board-filters .seg[aria-label="Language"] button', 'All')
  await h.click('.board-filters .seg[aria-label="Folder depth"] button', 'Depth 2')
  // jv/src is a box at depth 2 only (src/api is one at depth 3 too)
  await h.until(() => h.js(`[...document.querySelectorAll('.dg-node')].some(n => n.getAttribute('aria-label').startsWith('jv/src,'))`), 8000)
  await h.wait(300)

  await h.js(`[...document.querySelectorAll('.dg-node')].find(n => n.getAttribute('aria-label').startsWith('src/api')).dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await h.until(() => h.js(`!!document.querySelector('.diagram-side')`), 3000)
  const side = await h.js(`document.querySelector('.diagram-side').innerText`)
  h.expect(/Imports from[\s\S]*src\/lib/i.test(side) && /Used by[\s\S]*src\/ui/i.test(side), 'side panel lists what src/api imports and who uses it')
  for (let i = 0; i < 5; i++) { h.log('DBG', await h.js(`!!document.querySelector('.diagram-side') + ' ' + document.querySelectorAll('.dg-node').length + ' ' + document.querySelector('.board-title .small').textContent`)); await h.wait(100) }
  await h.wait(300)
  const fitted = await h.js(`(() => { const c = document.querySelector('.diagram-canvas').getBoundingClientRect(); return [...document.querySelectorAll('.dg-node')].every(n => n.getBoundingClientRect().right <= c.right + 1) })()`)
  h.expect(fitted, 'the map refits when the side panel narrows the canvas')
  await h.shot('02-code-selected')

  await h.setValue('.board-filters .search-input input', 'lib')
  await h.wait(200)
  const hits = await h.js(`document.querySelectorAll('.dg-node.hit').length`)
  h.log('hits', hits)

  // Files: folders of any language, small folders' files as leaves
  await h.setValue('.board-filters .search-input input', '')
  await h.click('.board-filters .seg button', 'Files')
  await h.until(() => h.js(`document.querySelectorAll('.diagram-canvas .dg-file').length > 0`), 8000)
  await h.wait(300)
  const fnodes = await h.js(`[...document.querySelectorAll('.diagram-canvas .dg-node')].map(n => n.getAttribute('aria-label'))`)
  h.log('files nodes', fnodes.length)
  for (const n of ['py/shop, 4 files', 'gosvc/store, 1 file', 'src/ui/App.tsx, file', 'gosvc/store/store.go, file']) h.expect(fnodes.includes(n), `Files has ${n}`)
  const pyBox = await h.js(`[...document.querySelectorAll('.dg-node')].find(n => n.getAttribute('aria-label').startsWith('py,')).textContent`)
  h.expect(/4 · Python 4/.test(pyBox), `folder box shows count and languages (${pyBox})`)
  const fx = await h.js(`Object.fromEntries([...document.querySelectorAll('.dg-node')].map(n => [n.getAttribute('aria-label').split(',')[0], n.getBoundingClientRect().x]))`)
  h.expect(fx['.'] < fx.src && fx.src < fx['src/ui'] && fx['src/ui'] < fx['src/ui/App.tsx'], 'the tree runs left to right')
  await h.shot('04-files')

  await h.click('.board-filters .seg button', 'Schema')
  await h.until(() => h.js(`document.querySelectorAll('.dg-table').length > 0`), 8000)
  await h.setValue('.board-filters .search-input input', '')
  await h.wait(300)
  const tables = await h.js(`[...document.querySelectorAll('.dg-table')].map(n => n.getAttribute('aria-label')).sort()`)
  h.log('tables', JSON.stringify(tables))
  h.expect(tables.length === 3, 'schema shows User, Post and Comment')
  const rels = await h.js(`document.querySelectorAll('.diagram-canvas .dg-edge').length`)
  h.expect(rels === 3, `schema draws three foreign keys (${rels})`)
  const sub = await h.js(`document.querySelector('.board-title .small').textContent`)
  h.expect(/3 tables · 3 relations · 2 files/.test(sub), `subtitle counts tables and files (${sub})`)
  await h.shot('03-schema')

  // a Swift-only project: nothing to map, so the panel shows Files once on its own
  const swift = path.join(path.dirname(r), 'swift-only')
  write(swift, 'Sources/App/App.swift', 'import Foundation\nimport Models\n')
  write(swift, 'Sources/Models/User.swift', 'struct User {}\n')
  write(swift, 'Package.swift', '// swift-tools-version:5.9\n')
  await h.openFixture({ rootFolder: swift })
  await h.click('.activitybar .activity-btn[aria-label="Diagrams"]')
  await h.until(() => h.js(`!!document.querySelector('.diagram-hint')`), 8000)
  await h.until(() => h.js(`document.querySelectorAll('.diagram-canvas .dg-node').length > 0`), 8000)
  await h.wait(300)
  const on = await h.js(`document.querySelector('.board-filters .seg[aria-label="Diagram"] button.on').textContent`)
  h.expect(/Files/.test(on), `switched to Files (${on})`)
  h.expect(/No imports to map/.test(await h.js(`document.querySelector('.diagram-hint').textContent`)), 'says why it switched')
  const sw = await h.js(`document.querySelector('.board-title .small').textContent`)
  h.expect(/Swift 3/.test(sw), `Swift counted in Files (${sw})`)
  await h.shot('05-swift-files')
  // picking Code map stays there and says which languages are mapped
  await h.click('.board-filters .seg button', 'Code map')
  await h.until(() => h.js(`!!document.querySelector('.empty.big')`), 8000)
  await h.wait(500)
  const empty = await h.js(`document.querySelector('.empty.big').innerText`)
  h.expect(/No imports to map/.test(empty) && /Swift/.test(empty) && /Python/.test(empty), 'empty state lists mapped languages and points at Files')
  h.expect(/Code map/.test(await h.js(`document.querySelector('.board-filters .seg[aria-label="Diagram"] button.on').textContent`)), 'no second switch after the user picked a tab')
  await h.shot('06-swift-code-empty')
}
