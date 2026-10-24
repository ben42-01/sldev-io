import { homedir } from 'os'
import type { PackageManager, SetupCheck, SetupLevel, SetupReport } from '@shared/types'
import { findOnPath } from './editors'
import { run } from './git'
import { loadShellEnv } from './shellEnv'

/** Install commands per package manager; `darwin` is the fallback on a Mac without Homebrew. */
type Installs = Partial<Record<PackageManager | 'darwin', string>>

interface Readiness {
  fix?: string
  detail: string
}

export interface ToolDef {
  id: string
  name: string
  why: string
  level: SetupLevel
  bin: string
  /** only checked on these platforms */
  platforms?: NodeJS.Platform[]
  install: Installs
  docs: string
  /** installed but unusable (logged out, daemon down)? null = ready */
  ready?: () => Promise<Readiness | null>
}

const firstLine = (s: string): string => s.trim().split('\n')[0] ?? ''

const pkg = (name: string, names: Partial<Record<'apt' | 'dnf' | 'pacman' | 'zypper', string>> = {}): Installs => ({
  apt: `sudo apt-get install -y ${names.apt ?? name}`,
  dnf: `sudo dnf install -y ${names.dnf ?? name}`,
  pacman: `sudo pacman -S --needed ${names.pacman ?? name}`,
  zypper: `sudo zypper install -y ${names.zypper ?? name}`
})

export const TOOLS: ToolDef[] = [
  {
    id: 'git',
    name: 'Git',
    why: 'Branches, worktrees for missions, diff review, commit and merge.',
    level: 'required',
    bin: 'git',
    install: { ...pkg('git'), brew: 'brew install git', darwin: 'xcode-select --install', winget: 'winget install --id Git.Git -e --source winget' },
    docs: 'https://git-scm.com/downloads'
  },
  {
    id: 'brew',
    name: 'Homebrew',
    why: 'Package manager used to install the other tools on macOS.',
    level: 'recommended',
    bin: 'brew',
    platforms: ['darwin'],
    install: { darwin: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' },
    docs: 'https://brew.sh'
  },
  {
    id: 'gh',
    name: 'GitHub CLI',
    why: 'Workflows, pull requests and CI status in the Workflows view.',
    level: 'recommended',
    bin: 'gh',
    install: { ...pkg('gh', { pacman: 'github-cli' }), brew: 'brew install gh', winget: 'winget install --id GitHub.cli -e --source winget' },
    docs: 'https://github.com/cli/cli#installation',
    ready: async () => {
      const r = await run('gh', ['auth', 'status'], homedir(), 10000)
      return r.code === 0 ? null : { fix: 'gh auth login', detail: 'Not logged in to GitHub.' }
    }
  },
  {
    id: 'node',
    name: 'Node.js and npm',
    why: 'Most agent CLIs (Claude Code, Codex, Copilot, Gemini) install with npm.',
    level: 'recommended',
    bin: 'node',
    install: { ...pkg('nodejs npm'), brew: 'brew install node', winget: 'winget install --id OpenJS.NodeJS.LTS -e --source winget' },
    docs: 'https://nodejs.org/en/download'
  },
  {
    id: 'docker',
    name: 'Docker',
    why: 'Run and open shells in containers.',
    level: 'optional',
    bin: 'docker',
    install: { ...pkg('docker', { apt: 'docker.io', dnf: 'moby-engine' }), brew: 'brew install --cask docker', winget: 'winget install --id Docker.DockerDesktop -e --source winget' },
    docs: 'https://docs.docker.com/get-started/get-docker/',
    ready: async () => {
      const r = await run('docker', ['info', '--format', '{{.ServerVersion}}'], homedir(), 10000)
      if (r.code === 0) return null
      if (/permission denied/i.test(r.stderr)) return { fix: 'sudo usermod -aG docker "$USER"', detail: 'Your user may not use the Docker daemon yet (log out and back in after the fix).' }
      const fix = process.platform === 'linux' ? 'sudo systemctl enable --now docker' : process.platform === 'darwin' ? 'open -a Docker' : undefined
      return { fix, detail: 'The Docker daemon is not running.' }
    }
  },
  {
    id: 'ssh',
    name: 'OpenSSH client',
    why: 'ssh and git over SSH in your terminals. The Remote view does not need it.',
    level: 'optional',
    bin: 'ssh',
    install: pkg('openssh-client', { dnf: 'openssh-clients', pacman: 'openssh', zypper: 'openssh-clients' }),
    docs: 'https://www.openssh.com'
  }
]

const LINUX_MANAGERS: Array<[string, PackageManager]> = [
  ['apt-get', 'apt'],
  ['dnf', 'dnf'],
  ['pacman', 'pacman'],
  ['zypper', 'zypper']
]

export function detectPackageManager(platform: NodeJS.Platform, has: (bin: string) => boolean): PackageManager | null {
  if (platform === 'darwin') return has('brew') ? 'brew' : null
  if (platform === 'win32') return has('winget') ? 'winget' : null
  return LINUX_MANAGERS.find(([bin]) => has(bin))?.[1] ?? null
}

export function installCommand(tool: ToolDef, platform: NodeJS.Platform, pm: PackageManager | null): string | undefined {
  return (pm && tool.install[pm]) || (platform === 'darwin' ? tool.install.darwin : undefined)
}

async function version(bin: string): Promise<string | undefined> {
  const r = await run(bin, ['--version'], homedir(), 10000)
  return r.code === 0 ? /\d+\.\d+(\.\d+)?/.exec(firstLine(r.stdout))?.[0] : undefined
}

async function check(tool: ToolDef, pm: PackageManager | null): Promise<SetupCheck> {
  const base = { id: tool.id, name: tool.name, why: tool.why, level: tool.level, docs: tool.docs }
  if (!findOnPath(tool.bin)) return { ...base, state: 'missing', install: installCommand(tool, process.platform, pm) }
  const [v, notReady] = await Promise.all([version(tool.bin), tool.ready?.() ?? null])
  return notReady ? { ...base, state: 'not-ready', version: v, ...notReady } : { ...base, state: 'ok', version: v }
}

/** Check the tools the app relies on. `reloadEnv` re-reads the login-shell PATH first, to see tools installed since startup. */
export async function checkSetup(reloadEnv = false): Promise<SetupReport> {
  if (reloadEnv) await loadShellEnv()
  const pm = detectPackageManager(process.platform, (b) => !!findOnPath(b))
  const tools = TOOLS.filter((t) => !t.platforms || t.platforms.includes(process.platform))
  return { platform: process.platform, packageManager: pm, checks: await Promise.all(tools.map((t) => check(t, pm))) }
}
