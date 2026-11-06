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
