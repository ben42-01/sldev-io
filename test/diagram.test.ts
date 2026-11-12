import { describe, expect, it } from 'vitest'
import { folderGraph, groupOf, layered, mergeSchemas, parseImports, parsePrisma, parseSql, resolveImport, tsconfigAliases } from '../src/shared/diagram'

describe('parseImports', () => {
  it('finds static, type, side-effect, re-export, dynamic and require imports', () => {
    const src = `
      import React from 'react'
      import type { A } from './a'
      import { b,
        c } from "../b"
      import './styles.css'
      export * from './c'
      export { d } from './d'
      const e = await import('./e')
      const f = require('./f')
      // import nope from './commented'
      /* import nope2 from './block' */
      const url = 'http://example.com' // not an import
    `
    expect(parseImports(src).sort()).toEqual(['../b', './a', './c', './d', './e', './f', './styles.css', 'react'].sort())
  })
})

describe('resolveImport', () => {
  const files = new Set(['src/a.ts', 'src/b/index.tsx', 'src/c.ts', 'src/shared/types.ts', 'lib/x.js'])
  it('resolves relative paths with extensions, index files and .js written for .ts', () => {
    expect(resolveImport('src/main.ts', './a', files)).toBe('src/a.ts')
    expect(resolveImport('src/main.ts', './b', files)).toBe('src/b/index.tsx')
    expect(resolveImport('src/main.ts', './c.js', files)).toBe('src/c.ts')
    expect(resolveImport('src/deep/x.ts', '../../lib/x.js', files)).toBe('lib/x.js')
  })
  it('skips packages and unknown files', () => {
    expect(resolveImport('src/main.ts', 'react', files)).toBeNull()
    expect(resolveImport('src/main.ts', './missing', files)).toBeNull()
  })
  it('follows tsconfig paths', () => {
    const aliases = tsconfigAliases(`{
      // comment
      "compilerOptions": { "paths": { "@shared/*": ["./src/shared/*"], }, },
    }`)
    expect(aliases).toEqual({ '@shared/*': ['src/shared/*'] })
    expect(resolveImport('src/renderer/x.ts', '@shared/types', files, aliases)).toBe('src/shared/types.ts')
  })
  it('applies baseUrl and the config folder', () => {
    expect(tsconfigAliases('{"compilerOptions":{"baseUrl":"src","paths":{"~/*":["*"]}}}', 'web')).toEqual({ '~/*': ['web/src/*'] })
  })
})

describe('folderGraph', () => {
  it('groups files into folders and counts imports between them', () => {
    expect(groupOf('src/main/index.ts', 2)).toBe('src/main')
    expect(groupOf('src/index.ts', 2)).toBe('src')
    expect(groupOf('index.ts', 2)).toBe('.')
    const g = folderGraph(
      {
        'src/main/a.ts': ['src/shared/t.ts', 'src/main/b.ts'],
        'src/main/b.ts': ['src/shared/t.ts'],
        'src/shared/t.ts': []
      },
      2
    )
    expect(g.nodes).toEqual([
      { id: 'src/main', files: 2 },
      { id: 'src/shared', files: 1 }
    ])
    expect(g.edges).toEqual([{ from: 'src/main', to: 'src/shared', count: 2 }])
  })
})

describe('parsePrisma', () => {
  it('reads models, scalar columns, ids and relations', () => {
    const s = parsePrisma(
      `
      model User {
        id    Int     @id @default(autoincrement())
        email String  @unique
        name  String?
        role  Role    @default(USER)
        tags  String[]
        posts Post[]
        notes Note[]
        roles Role[]
      }
      enum Role { USER ADMIN }
      model Post {
        id       Int  @id
        authorId Int
        author   User @relation(fields: [authorId], references: [id])
      }
      `,
      'prisma/schema.prisma'
    )
    expect(s.tables.map((t) => t.name)).toEqual(['User', 'Post'])
    expect(s.tables[0].columns).toEqual([
      { name: 'id', type: 'Int', pk: true, nullable: false },
      { name: 'email', type: 'String', pk: false, nullable: false },
      { name: 'name', type: 'String', pk: false, nullable: true },
      { name: 'role', type: 'Role', pk: false, nullable: false },
      { name: 'tags', type: 'String[]', pk: false, nullable: false },
      { name: 'roles', type: 'Role[]', pk: false, nullable: false }
    ])
    expect(s.tables[1].line).toBe(13)
    expect(s.relations).toEqual([{ from: 'Post', fromColumns: ['authorId'], to: 'User', toColumns: ['id'] }])
  })
})

describe('parseSql', () => {
  it('reads tables, primary keys and foreign keys inline, as constraints and from ALTER TABLE', () => {
    const s = parseSql(
      `
      -- users
      CREATE TABLE IF NOT EXISTS "public"."users" (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        created_at timestamp with time zone DEFAULT now()
      );
      CREATE TABLE orders (
        id integer,
        user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        total numeric(10, 2),
        PRIMARY KEY (id),
        CONSTRAINT fk_x FOREIGN KEY (id) REFERENCES users (id)
      );
      CREATE TABLE \`items\` (\`order_id\` int, \`sku\` text, UNIQUE (sku));
      ALTER TABLE items ADD CONSTRAINT fk_o FOREIGN KEY (order_id) REFERENCES orders(id);
      `,
      'db/001.sql'
    )
    expect(s.tables.map((t) => t.name)).toEqual(['users', 'orders', 'items'])
    expect(s.tables[0].columns).toEqual([
      { name: 'id', type: 'serial', pk: true, nullable: false },
      { name: 'email', type: 'varchar(255)', nullable: false },
      { name: 'created_at', type: 'timestamp', nullable: true }
    ])
    expect(s.tables[0].line).toBe(3)
    expect(s.tables[1].columns.find((c) => c.name === 'id')?.pk).toBe(true)
    expect(s.tables[1].columns.map((c) => c.name)).toEqual(['id', 'user_id', 'total'])
    expect(s.relations).toEqual([
      { from: 'orders', fromColumns: ['user_id'], to: 'users', toColumns: ['id'] },
      { from: 'orders', fromColumns: ['id'], to: 'users', toColumns: ['id'] },
      { from: 'items', fromColumns: ['order_id'], to: 'orders', toColumns: ['id'] }
    ])
  })

  it('merges migrations: a later table wins, relations to unknown tables go', () => {
    const a = parseSql('create table a (id int primary key, b_id int references b(id));', '1.sql')
    const b = parseSql('create table A (id int primary key, name text); create table c (a_id int references a);', '2.sql')
    const m = mergeSchemas([a, b], ['1.sql', '2.sql'])
    expect(m.tables.map((t) => [t.name, t.columns.length])).toEqual([
      ['A', 2],
      ['c', 1]
    ])
    expect(m.relations).toEqual([{ from: 'c', fromColumns: ['a_id'], to: 'A', toColumns: [] }])
  })
})

describe('layered', () => {
  it('puts dependents left of their dependencies and survives cycles', () => {
    const size = (): { w: number; h: number } => ({ w: 100, h: 40 })
    const p = layered(['ui', 'state', 'shared', 'x'], [
      { from: 'ui', to: 'state' },
      { from: 'state', to: 'shared' },
      { from: 'ui', to: 'shared' },
      { from: 'x', to: 'ui' },
      { from: 'shared', to: 'x' }
    ], size)
    const at = Object.fromEntries(p.map((n) => [n.id, n]))
    expect(p).toHaveLength(4)
    expect(at.ui.x).toBeLessThan(at.state.x)
    expect(at.state.x).toBeLessThan(at.shared.x)
  })
})

describe('mermaid export', () => {
  it('writes a flowchart and an ER diagram', async () => {
    const { codeMermaid, schemaMermaid } = await import('../src/shared/diagram')
    expect(codeMermaid({ nodes: [{ id: 'src/a', files: 1 }, { id: 'src/b', files: 2 }], edges: [{ from: 'src/a', to: 'src/b', count: 3 }] })).toBe(
      'flowchart LR\n  src_a["src/a"]\n  src_b["src/b"]\n  src_a -->|3| src_b'
    )
    const s = parseSql('create table u (id int primary key); create table p (uid int references u(id), price numeric(10,2));', 'x.sql')
    expect(schemaMermaid(s)).toBe(['erDiagram', '  u {', '    int id PK', '  }', '  p {', '    int uid', '    numeric price', '  }', '  p }o--|| u : "uid"'].join('\n'))
  })
})

describe('files diagram', () => {
  it('names languages by extension and skips non-code', async () => {
    const { languageOf } = await import('../src/shared/diagram')
    expect(languageOf('a/b.py')).toBe('Python')
    expect(languageOf('App.SWIFT')).toBe('Swift')
    expect(languageOf('x.d.ts')).toBeNull()
    expect(languageOf('README.md')).toBeNull()
    expect(languageOf('.github/x')).toBeNull()
  })
  it('groups folders to the depth, counts languages and shows files of small folders as leaves', async () => {
    const { structureGraph, structureMermaid, LEAF_MAX } = await import('../src/shared/diagram')
    const many = Array.from({ length: LEAF_MAX + 1 }, (_, i) => `big/f${i}.go`)
    const g = structureGraph(['setup.py', 'README.md', 'app/main.py', 'app/db/schema.sql', 'app/db/models.py', 'app/db/deep/x.py', ...many], 2)
    const ids = g.nodes.map((n) => n.id)
    expect(ids).toEqual(['.', 'app', 'app/db', 'app/db/models.py', 'app/db/schema.sql', 'app/main.py', 'big', 'setup.py'])
    expect(g.files).toBe(5 + many.length)
    expect(g.nodes.find((n) => n.id === 'app')).toMatchObject({ kind: 'dir', files: 4, languages: { Python: 3, SQL: 1 } })
    expect(g.nodes.find((n) => n.id === 'app/db')!.files).toBe(3)
    expect(g.nodes.find((n) => n.id === 'app/main.py')!.kind).toBe('file')
    expect(g.edges).toContainEqual({ from: '.', to: 'app' })
    expect(g.edges).toContainEqual({ from: 'app', to: 'app/db' })
    expect(g.edges).toContainEqual({ from: 'app/db', to: 'app/db/models.py' })
    expect(g.edges).toContainEqual({ from: '.', to: 'setup.py' })
    expect(g.leavesHidden).toBe(false)
    const m = structureMermaid(structureGraph(['src/a.py', 'src/b.sql'], 1), 'proj')
    expect(m).toBe('flowchart LR\n  _["proj/ · 2"]\n  src["src/ · 2"]\n  src_a_py["a.py"]\n  src_b_sql["b.sql"]\n  _ --> src\n  src --> src_a_py\n  src --> src_b_sql')
  })
  it('summarises languages by count', async () => {
    const { languageSummary } = await import('../src/shared/diagram')
    expect(languageSummary({ SQL: 4, Python: 10 })).toBe('Python 10, SQL 4')
    expect(languageSummary({ A: 1, B: 2, C: 3, D: 4 }, 2)).toBe('D 4, C 3, +2')
  })
})

describe('treeLayout', () => {
  it('puts each level in a column and centres parents on their children', async () => {
    const { treeLayout } = await import('../src/shared/diagram')
    const p = treeLayout('.', [{ from: '.', to: 'a' }, { from: '.', to: 'b' }, { from: 'a', to: 'a/x' }, { from: 'a', to: 'a/y' }], () => ({ w: 100, h: 40 }), { x: 50, y: 10 })
    const at = Object.fromEntries(p.map((n) => [n.id, n]))
    expect([at['.'].x, at.a.x, at['a/x'].x]).toEqual([0, 150, 300])
    expect([at['a/x'].y, at['a/y'].y, at.b.y]).toEqual([0, 50, 100])
    expect(at.a.y).toBe(25)
    expect(at['.'].y).toBe((25 + 100 + 40) / 2 - 20)
  })
})
