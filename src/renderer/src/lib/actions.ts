import type { EditorInfo } from '@shared/types'
import { preferredEditor, workspace } from '../state/workspace'
import { openTerminal } from '../dock/dockApi'
import { basename, dirname, shellQuote } from './paths'
import { setFileLinkOpener, shellKind } from './terminals'

/** Open a file at a line (clicked `path:line:col` in terminal output, diff lines…). */
export async function openFileAt(path: string, line?: number, col?: number): Promise<void> {
  const editor = preferredEditor()
  if (!editor) return void window.api.shell.openPath(path)
  if (editor.kind === 'terminal') {
    const cmd = line ? await window.api.editors.terminalGoto(editor.id, path, line) : null
    if (cmd) return void openTerminal({ cwd: dirname(path), title: `${editor.name}: ${basename(path)}`, initialInput: `${cmd}\r` })
    return openInEditor(path, editor)
  }
  await window.api.editors.open(editor.id, path, line, col)
}

setFileLinkOpener((p, l, c) => void openFileAt(p, l, c))

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
        initialInput: `${cmd} ${shellQuote(target, shellKind())}\r`
      })
    }
    return
  }
  await window.api.editors.open(editor.id, target)
}

export function guiEditors(): EditorInfo[] {
  return workspace.get().editors
}
