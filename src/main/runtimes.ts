import { execFile } from 'child_process'
import { existsSync, promises as fsp } from 'fs'
import { dirname, join, parse, relative, sep } from 'path'
import type { RuntimeDef, RuntimeSource } from '@shared/types'

const MONOREPO_DIRS = ['apps', 'packages', 'services', 'libs', 'crates', 'examples']
const MARKERS = ['package.json', 'Makefile', 'makefile', 'justfile', 'Justfile', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'deno.json', 'deno.jsonc', 'compose.yml', 'compose.yaml', 'docker-compose.yml', 'docker-compose.yaml']
const MAX_DIRS = 60

/** Find runnable things in a project: package scripts, make/just targets, cargo, go, compose… */
export async function detectRuntimes(root: string): Promise<RuntimeDef[]> {
  const dirs = await candidateDirs(root)
  const results = await Promise.all(
    dirs.map(async (dir) => {
      const ctx = { root, dir, rel: relative(root, dir).split(sep).join('/') }
      const found = await Promise.all([npm(ctx), make(ctx), just(ctx), cargo(ctx), python(ctx), compose(ctx), go(ctx), deno(ctx)])
      return found.flat()
    })
  )
  return results.flat()
}

/** Scripts in one folder only (the task editor's pick list); the package manager comes from the nearest lockfile above it. */
export async function detectScripts(dir: string): Promise<RuntimeDef[]> {
  const ctx = { root: parse(dir).root, dir, rel: '' }
  const found = await Promise.all([npm(ctx), make(ctx), just(ctx), cargo(ctx), python(ctx), compose(ctx), go(ctx), deno(ctx)])
  return found.flat()
}

interface Ctx {
  root: string
  dir: string
  /** dir relative to root, '' for the root itself */
  rel: string
}

async function candidateDirs(root: string): Promise<string[]> {
  const dirs = [root]
  const hasMarker = (d: string): boolean => MARKERS.some((m) => existsSync(join(d, m)))
  const children = async (d: string): Promise<string[]> =>
    (await fsp.readdir(d, { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'target' && e.name !== 'dist')
      .map((e) => join(d, e.name))
  for (const child of await children(root)) {
    if (dirs.length >= MAX_DIRS) break
    if (hasMarker(child)) dirs.push(child)
    if (MONOREPO_DIRS.includes(child.slice(root.length + 1))) {
      for (const pkg of await children(child)) if (dirs.length < MAX_DIRS && hasMarker(pkg)) dirs.push(pkg)
    }
  }
  return dirs
}

function def(ctx: Ctx, source: RuntimeSource, file: string, name: string, command: string, detail?: string): RuntimeDef {
  const group = ctx.rel ? `${ctx.rel}/${file}` : file
  return { id: `${source}:${ctx.rel}:${name}`, name, command, cwd: ctx.dir, source, group, detail }
}

const readText = (p: string): Promise<string | null> => fsp.readFile(p, 'utf8').catch(() => null)
const firstExisting = (dir: string, names: string[]): string | undefined => names.find((n) => existsSync(join(dir, n)))
const quoteArg = (s: string): string => (/^[\w:.@/-]+$/.test(s) ? s : JSON.stringify(s))

/** Walk up from dir to root looking for a lockfile to pick the package manager. */
function packageManager(ctx: Ctx): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  let d = ctx.dir
  for (;;) {
    if (existsSync(join(d, 'pnpm-lock.yaml'))) return 'pnpm'
    if (existsSync(join(d, 'yarn.lock'))) return 'yarn'
    if (existsSync(join(d, 'bun.lockb')) || existsSync(join(d, 'bun.lock'))) return 'bun'
    if (existsSync(join(d, 'package-lock.json')) || d === ctx.root) return 'npm'
    const up = dirname(d)
    if (up === d) return 'npm'
    d = up
  }
}

async function npm(ctx: Ctx): Promise<RuntimeDef[]> {
  const text = await readText(join(ctx.dir, 'package.json'))
  if (!text) return []
  let scripts: Record<string, string> = {}
  try {
    scripts = JSON.parse(text).scripts ?? {}
  } catch {
    return []
  }
  const pm = packageManager(ctx)
  const run = pm === 'yarn' ? 'yarn' : `${pm} run`
  return Object.entries(scripts)
    .filter(([name]) => !/^(pre|post)/.test(name) || !scripts[name.replace(/^(pre|post)/, '')])
    .map(([name, body]) => def(ctx, 'npm', 'package.json', name, `${run} ${quoteArg(name)}`, body))
}

async function make(ctx: Ctx): Promise<RuntimeDef[]> {
  const file = firstExisting(ctx.dir, ['GNUmakefile', 'Makefile', 'makefile'])
  const text = file && (await readText(join(ctx.dir, file)))
  if (!text) return []
  const targets = new Set<string>()
  for (const line of text.split('\n')) {
    const m = /^([A-Za-z0-9][\w./-]*)\s*:(?![=:])/.exec(line)
    if (m && !m[1].includes('%')) targets.add(m[1])
  }
  return [...targets].map((t) => def(ctx, 'make', file!, t, `make ${t}`))
}

async function just(ctx: Ctx): Promise<RuntimeDef[]> {
  const file = firstExisting(ctx.dir, ['justfile', 'Justfile', '.justfile'])
  if (!file) return []
  const summary = await new Promise<string | null>((resolve) =>
    execFile('just', ['--summary'], { cwd: ctx.dir, timeout: 3000 }, (err, out) => resolve(err ? null : out))
  )
  let recipes = summary?.trim().split(/\s+/).filter(Boolean)
  if (!recipes) {
    const text = (await readText(join(ctx.dir, file))) ?? ''
    recipes = [...text.matchAll(/^@?([A-Za-z_][\w-]*)[^:\n=]*:(?!=)/gm)].map((m) => m[1])
  }
  return recipes.map((r) => def(ctx, 'just', file, r, `just ${r}`))
}

async function cargo(ctx: Ctx): Promise<RuntimeDef[]> {
  if (!existsSync(join(ctx.dir, 'Cargo.toml'))) return []
  return ['run', 'build', 'test', 'check', 'clippy'].map((c) => def(ctx, 'cargo', 'Cargo.toml', c, `cargo ${c}`))
}

async function go(ctx: Ctx): Promise<RuntimeDef[]> {
  if (!existsSync(join(ctx.dir, 'go.mod'))) return []
  return [
    def(ctx, 'go', 'go.mod', 'run', 'go run .'),
    def(ctx, 'go', 'go.mod', 'test', 'go test ./...'),
    def(ctx, 'go', 'go.mod', 'build', 'go build ./...')
  ]
}

async function python(ctx: Ctx): Promise<RuntimeDef[]> {
  const out: RuntimeDef[] = []
  const runner = existsSync(join(ctx.dir, 'uv.lock')) ? 'uv run' : existsSync(join(ctx.dir, 'poetry.lock')) ? 'poetry run' : null
  const text = await readText(join(ctx.dir, 'pyproject.toml'))
  if (text && runner) {
    // minimal TOML reading: entries under [project.scripts] / [tool.poetry.scripts]
    let inScripts = false
    for (const line of text.split('\n')) {
      const header = /^\s*\[([^\]]+)\]/.exec(line)
      if (header) inScripts = header[1] === 'project.scripts' || header[1] === 'tool.poetry.scripts'
      else if (inScripts) {
        const m = /^\s*"?([\w.-]+)"?\s*=\s*"([^"]+)"/.exec(line)
        if (m) out.push(def(ctx, 'python', 'pyproject.toml', m[1], `${runner} ${m[1]}`, m[2]))
      }
    }
  }
  if (existsSync(join(ctx.dir, 'manage.py'))) {
    const py = runner ? `${runner} python` : 'python'
    out.push(def(ctx, 'python', 'manage.py', 'runserver', `${py} manage.py runserver`), def(ctx, 'python', 'manage.py', 'migrate', `${py} manage.py migrate`))
  }
  if (text && existsSync(join(ctx.dir, 'tests')) && runner) out.push(def(ctx, 'python', 'pyproject.toml', 'pytest', `${runner} pytest`))
  return out
}

async function compose(ctx: Ctx): Promise<RuntimeDef[]> {
  const file = firstExisting(ctx.dir, ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'])
  if (!file) return []
  return [
    def(ctx, 'compose', file, 'up', 'docker compose up'),
    def(ctx, 'compose', file, 'down', 'docker compose down'),
    def(ctx, 'compose', file, 'logs', 'docker compose logs -f')
  ]
}

async function deno(ctx: Ctx): Promise<RuntimeDef[]> {
  const file = firstExisting(ctx.dir, ['deno.json', 'deno.jsonc'])
  const text = file && (await readText(join(ctx.dir, file)))
  if (!text) return []
  try {
    // strip // and /* */ comments for jsonc
    const tasks = JSON.parse(text.replace(/\/\*[\s\S]*?\*\/|(^|[^:"])\/\/.*$/gm, '$1')).tasks ?? {}
    return Object.entries(tasks).map(([name, body]) =>
      def(ctx, 'deno', file!, name, `deno task ${quoteArg(name)}`, typeof body === 'string' ? body : undefined)
    )
  } catch {
    return []
  }
}
