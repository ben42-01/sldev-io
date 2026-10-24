import type { SetupCheck, SetupReport } from '@shared/types'

/** Required tools that are missing or not ready: these block core features. */
export function blockers(report: SetupReport | null): SetupCheck[] {
  return report?.checks.filter((c) => c.level === 'required' && c.state !== 'ok') ?? []
}

/** Open the setup panel on start the first time, and afterwards only while something required is missing. */
export function shouldOpenSetup(report: SetupReport, seen: boolean): boolean {
  return !seen || blockers(report).length > 0
}

/** Agent install commands are shell one-liners; `curl … | bash` ones don't run on Windows. */
export function agentInstallCommand(install: string | undefined, platform: string): string | undefined {
  return install && !(platform === 'win32' && /\|\s*(ba)?sh\b/.test(install)) ? install : undefined
}
