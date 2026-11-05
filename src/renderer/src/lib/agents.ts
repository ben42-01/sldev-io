// The agent registry lives in src/shared/agents.ts (the sldev CLI uses it too); this keeps the renderer's imports.
import { commandLine } from '@shared/agents'

export * from '@shared/agents'

/** A command as one readable line: shell commands as typed, argv quoted for this platform's shell. */
export function commandText(command: string | string[] | undefined): string {
  return commandLine(command, window.api.platform)
}
