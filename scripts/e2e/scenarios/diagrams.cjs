// Diagrams panel: a small TS project (relative + tsconfig-path imports), a Prisma schema and a SQL migration
// in the fixture → code map with folder boxes and links, selection side panel, schema ERD with foreign keys.
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
  await h.shot('01-code-map')

  await h.js(`[...document.querySelectorAll('.dg-node')].find(n => n.getAttribute('aria-label').startsWith('src/api')).dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await h.until(() => h.js(`!!document.querySelector('.diagram-side')`), 3000)
  const side = await h.js(`document.querySelector('.diagram-side').innerText`)
  h.expect(/Imports from[\s\S]*src\/lib/i.test(side) && /Used by[\s\S]*src\/ui/i.test(side), 'side panel lists what src/api imports and who uses it')
  await h.wait(300)
  const fitted = await h.js(`(() => { const c = document.querySelector('.diagram-canvas').getBoundingClientRect(); return [...document.querySelectorAll('.dg-node')].every(n => n.getBoundingClientRect().right <= c.right + 1) })()`)
  h.expect(fitted, 'the map refits when the side panel narrows the canvas')
  await h.shot('02-code-selected')

  await h.setValue('.board-filters .search-input input', 'lib')
  await h.wait(200)
  const hits = await h.js(`document.querySelectorAll('.dg-node.hit').length`)
  h.log('hits', hits)

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
}
