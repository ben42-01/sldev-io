import { spawn } from 'child_process'
import { defaultShell } from './pty'

const MARK = '__SLDEV_ENV__'

/**
 * Apps launched from a desktop/dock don't inherit the PATH users set up in their shell rc files
 * (nvm, pyenv, cargo, homebrew…). Ask an interactive login shell for its environment once at
 * startup and merge it into process.env, so terminals, runtimes and editor detection all see it.
 */
export function loadShellEnv(timeoutMs = 5000): Promise<void> {
  if (process.platform === 'win32') return Promise.resolve()
  return new Promise((resolve) => {
    const { shell } = defaultShell()
    const script = `'${process.execPath}' -e 'process.stdout.write("${MARK}"+JSON.stringify(process.env)+"${MARK}")'`
    const child = spawn(shell, ['-ilc', script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: true
    })
    let out = ''
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        // already gone
      }
      resolve()
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.on('error', () => {
      clearTimeout(timer)
      resolve()
    })
    child.on('close', () => {
      clearTimeout(timer)
      const m = out.split(MARK)
      if (m.length >= 3) {
        try {
          const env = JSON.parse(m[1]) as Record<string, string>
          delete env.ELECTRON_RUN_AS_NODE
          for (const k of ['SHLVL', '_', 'OLDPWD', 'PWD']) delete env[k]
          Object.assign(process.env, env)
        } catch {
          // keep the inherited env
        }
      }
      resolve()
    })
  })
}
