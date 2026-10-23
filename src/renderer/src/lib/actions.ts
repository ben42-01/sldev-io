import type { EditorInfo } from '@shared/types'
import { preferredEditor, workspace } from '../state/workspace'
import { openTerminal } from '../dock/dockApi'
import { basename, dirname, shellQuote } from './paths'

/** Open a file or folder in an editor. Terminal editors (nvim, helix…) open in a new terminal panel. */
export async function openInEditor(target: string, editor: EditorInfo | undefined = preferredEditor(), isDir = false): Promise<void> {
  if (!editor) {
    await window.api.shell.openPath(target)
    return
  }
  if (editor.kind === 'terminal') {
    const cmd = await window.api.editors.terminalCommand(editor.id)
    if (cmd) {
      openTerminal({
        cwd: isDir ? target : dirname(target),
        title: `${editor.name}: ${basename(target)}`,
        initialInput: `${cmd} ${shellQuote(target)}\r`
      })
    }
    return
  }
  await window.api.editors.open(editor.id, target)
}

export function guiEditors(): EditorInfo[] {
  return workspace.get().editors
}
