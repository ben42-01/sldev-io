import { rmSync } from 'fs'
import { delimiter, join, resolve } from 'path'

/**
 * Puts the e2e harness's fake agent CLIs (scripts/e2e/fakebin) first on PATH and returns a function that
 * puts PATH back. On Windows the .cmd shims in fakebin/win come first: Windows can't run the shell fakes.
 */
export function useFakeAgents(): () => void {
  const fakebin = resolve(__dirname, '../../scripts/e2e/fakebin')
  const saved = process.env.PATH
  const dirs = process.platform === 'win32' ? [join(fakebin, 'win'), fakebin] : [fakebin]
  process.env.PATH = [...dirs, saved].join(delimiter)
  return () => {
    process.env.PATH = saved
  }
}

/**
 * Removes a test's temp folder. Windows keeps a folder locked for a while after the processes that ran in it
 * (a shell tab, its console host) are killed: it retries longer there, and a folder still locked after that is
 * left to the OS's temp cleanup instead of failing tests that passed.
 */
export function removeTemp(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: process.platform === 'win32' ? 30 : 10, retryDelay: 300 })
  } catch (e) {
    if (process.platform !== 'win32' || (e as NodeJS.ErrnoException).code !== 'EBUSY') throw e
    console.warn(`left ${dir} behind: still locked`)
  }
}
