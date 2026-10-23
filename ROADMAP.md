# sldev roadmap

A desktop workspace for agentic coding through CLIs (Claude Code, Codex, Gemini, Aider, DeepSeek…).
It looks and feels like Cursor but is not an IDE: terminals are the main surface, and everything
else exists to launch, organise and watch what runs in them.

Status: ✅ done · 🔜 next · ⬜ planned

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
- ⬜ Mission launcher: agent CLI + prompt + folder, optional isolated git worktree
- ⬜ Status detection (running · waiting for input · done · failed) via output heuristics and
     shell integration (OSC 133/633), with desktop notifications when an agent needs you
- ⬜ Mission board: all running agents at a glance
- ⬜ Diff review when a mission finishes; commit / open PR via gh
- ⬜ Skills: list ~/.claude/skills, project .claude/skills and plugins; create, edit, run
- ⬜ MCP server manager: list, enable and configure MCP servers for each agent CLI
- ⬜ Prompt library / snippets you can send to any terminal
- ⬜ Broadcast input to several terminals at once

## Phase 4 · GitHub & notes
- ⬜ Workflows via gh: list, dispatch with inputs, watch runs live, re-run failed jobs, logs
- ⬜ PRs and checks for the current branch
- ⬜ Notes: global and per-project Markdown files; send a note to an agent as a prompt

## Phase 5 · Remote
- ⬜ SSH connections (host, user, port, jump host), import from ~/.ssh/config, ssh-agent support
- ⬜ Credential vault: reusable passwords, keys, key + passphrase; encrypted with the OS keychain
     (Electron safeStorage); secrets never reach the renderer
- ⬜ Remote terminals in the dock; SFTP file browser; port forwarding; known-hosts management

## More ideas
- ⬜ Clickable `path:line` in terminal output, opening the editor at that line (great for agent output)
- ⬜ Quick open (fuzzy file finder): open in editor or insert the path into the active terminal
- ⬜ Multiple projects/workspaces, each with its own saved layout
- ⬜ Git panel: branch switcher, status, worktree manager
- ⬜ Embedded browser preview panel for dev servers
- ⬜ .env / secrets manager injecting variables into runtimes and missions
- ⬜ Agent usage and cost tracker
- ⬜ Searchable terminal history across sessions; keep shells alive across app restarts
- ⬜ Docker containers panel; per-terminal CPU/memory
- ⬜ Global hotkey drop-down terminal
- ⬜ Settings UI, themes, custom keybindings, auto-update
