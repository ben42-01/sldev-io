# sldev roadmap

A desktop workspace for agentic coding through CLIs (Claude Code, Codex, Gemini, Aider, DeepSeek…).
It looks and feels like Cursor but is not an IDE: terminals are the main surface, and everything
else exists to launch, organise and watch what runs in them.

Status: ✅ done · ⬜ planned

## Phase 1 · Shell & terminals
- ✅ Electron + React + TypeScript app, Cursor-style dark UI, custom title bar
- ✅ Dockable layout: tabs, splits, drag-and-drop, floating panels, as many terminals as you want
- ✅ Stable terminals: sessions live outside React (moving or re-docking never restarts the shell),
     debounced pty resize, batched output with flow control, WebGL with DOM fallback
- ✅ Restart an exited shell with Enter; split opens in the shell's current dir (OSC 7)
- ✅ File explorer with live refresh, keyboard navigation, context menu
- ✅ Open file/folder in any detected editor (Cursor, VS Code, Windsurf, Zed, Sublime, JetBrains,
     Neovim/Helix/Vim in a terminal panel), reveal in file manager, copy path
- ✅ Drag files from the explorer (or the OS) into a terminal to paste their quoted paths
- ✅ Command palette, app shortcuts, find in terminal, font zoom
- ✅ Layout, sidebar and settings persist across restarts
- ✅ Installer config (AppImage/deb/rpm, dmg, NSIS) and CI to build on all three OSes

## Phase 2 · Runtimes & tasks
- ✅ Detect package.json scripts (npm/pnpm/yarn/bun), Makefile, justfile, Cargo, uv/Poetry scripts,
     Django, Go, Deno tasks, docker compose; monorepo subfolders (apps/, packages/, …)
- ✅ Custom commands per project; start / stop (Ctrl+C then kill) / restart with live status dots
- ✅ Port detection (`localhost:5173`) with one-click "open in browser"
- ✅ Shell environment resolved from the login shell (nvm, pyenv, cargo PATH work when launched from the dock)
- ✅ Restored runtime/task panels wait for Enter instead of re-running on app start
- ✅ Tasks: Claude Code (prompt, model, effort, permission mode, worktree, print mode, extra args)
     or shell; per-project or global; live command preview; run again in one click
- ⬜ Chain and schedule tasks

## Phase 3 · Agent missions & skills (Claude Code first)
- ✅ Mission launcher: prompt + model/effort/permission mode, optional isolated git worktree
     (`../.sldev-worktrees/<repo>/<slug>` on branch `sldev/<slug>`)
- ✅ Live status from Claude Code hooks (passed via `--settings`, your own settings untouched):
     working (with current tool) · needs you (permission prompts) · ready for you · ended/failed
- ✅ Desktop notifications when a mission needs you or finishes; status-bar counter; tab dots
- ✅ Mission board panel; resume any past session (`claude --resume`) from its card
- ✅ Diff review panel: per-file unified diff (incl. untracked files), commit, merge into base,
     push & open PR via gh, remove worktree
- ✅ Claude tasks run as missions
- ✅ Skills browser: user, project, synced and plugin skills, commands and agents; create skills;
     run in a new session or type the invocation into the active terminal
- ✅ MCP servers: list with health (`claude mcp list`), add/remove/details
- ✅ Broadcast input to all visible terminals

## Phase 4 · GitHub & notes
- ✅ Workflows via gh: list, dispatch with typed inputs (choice/boolean/text), live run list with
     polling, watch / logs in a terminal, re-run failed or all, cancel, open in browser
- ✅ PR card for the current branch with check summary
- ✅ Notes: global and per-project Markdown (CodeMirror editor, autosave, split preview);
     paste into the active terminal or start a mission from a note

## Phase 5 · Remote
- ✅ SSH connections (host, port, user, jump host, start folder), import from ~/.ssh/config
- ✅ Auth via ssh-agent/Pageant, saved credential, or password prompt; keyboard-interactive / 2FA
- ✅ Credential vault: reusable passwords, private keys, key files + passphrases, encrypted with the
     OS keychain (Electron safeStorage); secrets never reach the renderer
- ✅ Host key verification with trust-on-first-use and a loud warning on key change
- ✅ Remote terminals in the dock (shared connection per host), SFTP browser with download,
     local port forwards

## Extras
- ✅ Clickable `path:line:col` in terminal output → opens your editor at that line
- ✅ Quick open (fuzzy file finder): open, paste path into terminal, or open a terminal there
- ✅ Branch switcher (status bar), embedded browser preview for dev servers (port chips)
- ✅ Settings panel (fonts, shell, editor, notifications, global hotkey), global show/hide hotkey
- ✅ App icon; Linux AppImage / deb / rpm verified locally

## Next ideas
- ⬜ Chain and schedule tasks
- ⬜ Agent usage and cost tracker (from Claude Code transcripts)
- ⬜ Multiple projects/workspaces open at once, each with its own layout
- ⬜ Keep shells alive across app restarts (background pty host)
- ⬜ SFTP upload / edit-in-place, remote port forward (-R), dynamic SOCKS (-D)
- ⬜ Other agent CLIs (Codex, Gemini, Aider) as mission backends
- ⬜ Code signing + notarization, auto-update
- ⬜ Custom keybindings and themes
