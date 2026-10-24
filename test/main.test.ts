import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { workflowInputs } from '../src/main/github'
import { detectRuntimes } from '../src/main/runtimes'

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'sldev-io-test-'))
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  return root
}

describe('workflowInputs', () => {
  const root = project({
    'wf/inputs.yml': `on:
  workflow_dispatch:
    inputs:
      env:
        description: Target
        type: choice
        options: [staging, prod]
        default: staging
        required: true
      dry: { type: boolean }
`,
    'wf/bare.yml': 'on: [push, workflow_dispatch]\n',
    'wf/push.yml': 'on: push\n'
  })

  it('reads dispatch inputs', async () => {
    expect(await workflowInputs(root, 'wf/inputs.yml')).toEqual([
      { name: 'env', description: 'Target', required: true, default: 'staging', type: 'choice', options: ['staging', 'prod'] },
      { name: 'dry', description: undefined, required: false, default: undefined, type: 'boolean', options: undefined }
    ])
  })

  it('distinguishes dispatchable without inputs from not dispatchable', async () => {
    expect(await workflowInputs(root, 'wf/bare.yml')).toEqual([])
    expect(await workflowInputs(root, 'wf/push.yml')).toBeNull()
    expect(await workflowInputs(root, 'wf/missing.yml')).toBeNull()
  })
})

describe('detectRuntimes', () => {
  it('finds package scripts with the right package manager, including workspaces', async () => {
    const root = project({
      'package.json': JSON.stringify({ scripts: { dev: 'vite', test: 'vitest' } }),
      'pnpm-lock.yaml': '',
      'packages/api/package.json': JSON.stringify({ scripts: { start: 'node .' } }),
      'Makefile': 'build:\n\tcc main.c\n'
    })
    const found = await detectRuntimes(root)
    const byId = Object.fromEntries(found.map((r) => [r.id, r]))
    expect(byId['npm::dev']?.command).toBe('pnpm run dev')
    expect(byId['npm:packages/api:start']).toMatchObject({ command: 'pnpm run start', group: 'packages/api/package.json' })
    expect(found.some((r) => r.source === 'make' && r.name === 'build')).toBe(true)
  })
})
