import { describe, expect, it } from 'vitest'
import { buildIndex, langOf, LANGS, resolveAll, stripComments } from '../src/shared/diagramLangs'
import { folderGraph } from '../src/shared/diagram'

const lang = (id: string): (typeof LANGS)[number] => LANGS.find((l) => l.id === id)!

/** Index and resolve a small project: `files` maps path → text (configs included). */
function project(files: Record<string, string>): { resolve: (from: string) => string[][] } {
  const paths = Object.keys(files)
  const texts = new Map(paths.filter((p) => langOf(p)).map((p) => [p, files[p]]))
  const configs = new Map(paths.filter((p) => !langOf(p)).map((p) => [p, files[p]]))
  const out = resolveAll(texts, buildIndex(paths, texts, configs))
  return { resolve: (from) => out[from].map((t) => [...t].sort()) }
}

describe('stripComments', () => {
  it('blanks comments, keeps strings and offsets', () => {
    const src = 'a // x\n"//not" /* b\nc */ d'
    const out = stripComments(src, { line: ['//'], block: ['/*', '*/'], quotes: '"' })
    expect(out).toHaveLength(src.length)
    expect(out.split('\n')).toEqual(['a     ', '"//not"     ', '     d'])
  })
})

describe('Python', () => {
  it('parses import, from-import, relative and parenthesised forms, not comments', () => {
    const specs = lang('python').parse(`
import os, app.models as m
from app.util import (
    slug,
    title as t,
)
from ..core import base
from . import views
# import nope
x = "# not a comment"
`)
    expect(specs.sort()).toEqual(['..core:base', '.:views', 'app.models', 'app.util:slug', 'app.util:title', 'os'].sort())
  })
  it('resolves against the root, src/ and pyproject folders, modules and packages', () => {
    const p = project({
      'pkg/pyproject.toml': '[project]\nname = "x"\n',
      'pkg/src/app/__init__.py': '',
      'pkg/src/app/models.py': '',
      'pkg/src/app/util/__init__.py': '',
      'pkg/src/app/core/base.py': '',
      'pkg/src/app/web/views.py': 'from ..core import base\nfrom . import forms\n',
      'pkg/src/app/web/forms.py': '',
      'pkg/src/app/main.py': 'import os\nimport app.models\nfrom app.util import slug\nfrom app import models\n'
    })
    expect(p.resolve('pkg/src/app/main.py')).toEqual([['pkg/src/app/models.py'], ['pkg/src/app/util/__init__.py'], ['pkg/src/app/models.py']])
    expect(p.resolve('pkg/src/app/web/views.py')).toEqual([['pkg/src/app/core/base.py'], ['pkg/src/app/web/forms.py']])
  })
})

describe('Java / Kotlin / Scala', () => {
  it('parses plain, static, wildcard and Scala forms', () => {
    expect(lang('jvm').parse('import a.b.C;\nimport static a.b.D.max;\nimport a.c.*;\n// import x.Y;\n').sort()).toEqual(['a.b.C', 'a.b.D.max', 'a.c.*'])
    expect(lang('jvm').parse('import a.b.C as K\nimport a.d._\nimport a.e.{F, G => H}\n').sort()).toEqual(['a.b.C', 'a.d.*', 'a.e.F', 'a.e.G'])
  })
  it('resolves by package across source roots, wildcards to every file of the package', () => {
    const p = project({
      'src/main/java/com/x/App.java': 'package com.x;\nimport com.x.model.User;\nimport com.x.util.*;\nimport static com.x.model.Ids.next;\nimport java.util.List;\n',
      'src/main/java/com/x/model/User.java': 'package com.x.model;\n',
      'src/main/java/com/x/model/Ids.java': 'package com.x.model;\n',
      'src/main/kotlin/com/x/util/Strings.kt': 'package com.x.util\n',
      'src/main/java/com/x/util/Dates.java': 'package com.x.util;\n',
      'src/test/java/com/x/AppTest.java': 'package com.x;\nimport com.x.App;\n'
    })
    expect(p.resolve('src/main/java/com/x/App.java')).toEqual([
      ['src/main/java/com/x/model/User.java'],
      ['src/main/java/com/x/util/Dates.java', 'src/main/kotlin/com/x/util/Strings.kt'],
      ['src/main/java/com/x/model/Ids.java']
    ])
    expect(p.resolve('src/test/java/com/x/AppTest.java')).toEqual([['src/main/java/com/x/App.java']])
  })
})

describe('Go', () => {
  it('parses single and grouped imports and resolves the module prefix to a folder', () => {
    expect(lang('go').parse('import "fmt"\nimport (\n  "example.com/m/internal/db"\n  h "example.com/m/http" // web\n)\n').sort()).toEqual(['example.com/m/http', 'example.com/m/internal/db', 'fmt'])
    const p = project({
      'svc/go.mod': 'module example.com/m\n\ngo 1.22\n',
      'svc/main.go': 'package main\nimport (\n  "fmt"\n  "example.com/m/internal/db"\n)\n',
      'svc/internal/db/db.go': 'package db\n',
      'svc/internal/db/conn.go': 'package db\n'
    })
    expect(p.resolve('svc/main.go')).toEqual([['svc/internal/db/conn.go', 'svc/internal/db/db.go']])
  })
})

describe('C#', () => {
  it('maps usings to files declaring the namespace (block or file-scoped), one edge per folder', () => {
    expect(lang('csharp').parse('using System;\nglobal using App.Models;\nusing static App.Util.Strings;\nusing X = App.Data;\n').sort()).toEqual(['App.Data', 'App.Models', 'System', 'static:App.Util.Strings'])
    const files = {
      'Api/Program.cs': 'using System;\nusing App.Models;\nnamespace App.Api;\n',
      'Models/User.cs': 'namespace App.Models\n{\n  class User {}\n}\n',
      'Models/Order.cs': 'namespace App.Models;\n'
    }
    const p = project(files)
    expect(p.resolve('Api/Program.cs')).toEqual([['Models/Order.cs', 'Models/User.cs']])
    const g = folderGraph({ 'Api/Program.cs': p.resolve('Api/Program.cs') }, 1)
    expect(g.edges).toEqual([{ from: 'Api', to: 'Models', count: 1 }])
  })
})

describe('Rust', () => {
  it('follows mod declarations and crate/super/self paths', () => {
    expect(lang('rust').parse('mod db;\npub mod api;\nuse crate::db::{pool, Conn};\nuse super::x;\nuse std::io;\n').sort()).toEqual(['crate::db::Conn', 'crate::db::pool', 'mod:api', 'mod:db', 'super::x'])
    const p = project({
      'Cargo.toml': '[package]\nname = "x"\n',
      'src/main.rs': 'mod db;\nmod api;\n',
      'src/db/mod.rs': 'pub mod pool;\n',
      'src/db/pool.rs': 'use super::super::api::handlers;\n',
      'src/api.rs': 'mod handlers;\nuse crate::db::pool::Pool;\nuse crate::Config;\n',
      'src/api/handlers.rs': 'use self::inner;\n'
    })
    expect(p.resolve('src/main.rs')).toEqual([['src/db/mod.rs'], ['src/api.rs']])
    expect(p.resolve('src/db/mod.rs')).toEqual([['src/db/pool.rs']])
    expect(p.resolve('src/db/pool.rs')).toEqual([['src/api/handlers.rs']])
    expect(p.resolve('src/api.rs')).toEqual([['src/api/handlers.rs'], ['src/db/pool.rs'], ['src/main.rs']])
  })
})

describe('C / C++', () => {
  it('resolves quoted includes next to the file, else by a unique path suffix', () => {
    expect(lang('cpp').parse('#include <stdio.h>\n#include "util.h"\n# include "net/sock.h"\n// #include "no.h"\n').sort()).toEqual(['net/sock.h', 'util.h'])
    const p = project({
      'src/main.c': '#include "util.h"\n#include "net/sock.h"\n#include "dup.h"\n',
      'src/util.h': '',
      'include/net/sock.h': '',
      'a/dup.h': '',
      'b/dup.h': ''
    })
    expect(p.resolve('src/main.c')).toEqual([['src/util.h'], ['include/net/sock.h']])
  })
})

describe('Ruby and PHP', () => {
  it('resolves require_relative', () => {
    const p = project({ 'lib/a.rb': "require 'json'\nrequire_relative 'b'\nrequire_relative '../app/c.rb'\n", 'lib/b.rb': '', 'app/c.rb': '' })
    expect(p.resolve('lib/a.rb')).toEqual([['lib/b.rb'], ['app/c.rb']])
  })
  it('resolves use through composer psr-4 and literal require/include', () => {
    expect(lang('php').parse("<?php\nuse App\\Models\\User;\nuse App\\Http\\{Kernel, Request as R};\nrequire_once __DIR__ . '/boot.php';\n$f = function () use ($x) {};\n").sort()).toEqual(
      ['App\\Http\\Kernel', 'App\\Http\\Request', 'App\\Models\\User', 'path:/boot.php'].sort()
    )
    const p = project({
      'composer.json': JSON.stringify({ autoload: { 'psr-4': { 'App\\': 'src/' } } }),
      'public/index.php': "<?php\nuse App\\Models\\User;\nuse Vendor\\Thing;\ninclude 'helpers.php';\n",
      'public/helpers.php': '',
      'src/Models/User.php': ''
    })
    expect(p.resolve('public/index.php')).toEqual([['src/Models/User.php'], ['public/helpers.php']])
  })
})

describe('TS/JS stays as it was', () => {
  it('resolves relative imports and tsconfig paths through the index', () => {
    const p = project({
      'tsconfig.json': '{"compilerOptions":{"paths":{"@lib/*":["./src/lib/*"]}}}',
      'src/ui/App.tsx': "import { a } from '../api/client'\nimport { f } from '@lib/format'\nimport React from 'react'\n",
      'src/api/client.ts': '',
      'src/lib/format.ts': '',
      'src/types.d.ts': ''
    })
    expect(p.resolve('src/ui/App.tsx')).toEqual([['src/api/client.ts'], ['src/lib/format.ts']])
    expect(langOf('src/types.d.ts')).toBeUndefined()
  })
})
