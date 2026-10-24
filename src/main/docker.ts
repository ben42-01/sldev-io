import { homedir } from 'os'
import type { DockerAction, DockerContainer, DockerList } from '@shared/types'
import { findOnPath } from './editors'
import { run } from './git'

const ID = /^[0-9a-f]{6,64}$/

function labels(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const i = pair.indexOf('=')
    if (i > 0) out[pair.slice(0, i)] = pair.slice(i + 1)
  }
  return out
}

/** Parse `docker ps --format '{{json .}}'`, one JSON object per line. */
export function parseContainers(stdout: string): DockerContainer[] {
  const list: DockerContainer[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    try {
      const c = JSON.parse(line) as Record<string, string>
      const l = labels(c.Labels ?? '')
      const ports = c.Ports ?? ''
      list.push({
        id: c.ID,
        name: (c.Names ?? '').split(',')[0],
        image: c.Image,
        state: c.State,
        status: c.Status,
        ports,
        hostPorts: [...new Set([...ports.matchAll(/:(\d+)->/g)].map((m) => Number(m[1])))],
        project: l['com.docker.compose.project'] || undefined,
        service: l['com.docker.compose.service'] || undefined
      })
    } catch {
      // skip lines that aren't JSON (warnings)
    }
  }
  return list
}

export async function listContainers(): Promise<DockerList> {
  if (!findOnPath('docker')) return { available: false, error: 'Docker is not installed.', containers: [] }
  const r = await run('docker', ['ps', '-a', '--format', '{{json .}}'], homedir(), 15000)
  if (r.code !== 0) return { available: false, error: r.stderr.trim().split('\n')[0] || 'Could not reach the Docker daemon.', containers: [] }
  return { available: true, containers: parseContainers(r.stdout) }
}

export async function containerAction(id: string, action: DockerAction): Promise<void> {
  if (!ID.test(id) || !['start', 'stop', 'restart', 'rm'].includes(action)) throw new Error('Invalid container action')
  const r = await run('docker', [action, id], homedir(), 60000)
  if (r.code !== 0) throw new Error(r.stderr.trim() || `docker ${action} failed`)
}
