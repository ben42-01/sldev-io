# sldev-io

Agentic coding workspace for CLI agents: Claude Code, Codex, Cursor Agent, GitHub Copilot,
OpenCode, Gemini CLI or any CLI you add. Dockable terminals, a file explorer, runtimes, agent
missions with live status and diff review, skills and MCP, GitHub workflows, notes and SSH with an
encrypted credential vault. See [ROADMAP.md](ROADMAP.md).

## Key shortcuts (Linux/Windows · macOS)

| | |
|---|---|
| Command palette | `Ctrl+Shift+P` · `⌘⇧P` |
| Quick open file | `Ctrl+Alt+P` · `⌘P` |
| New terminal / split right / split down | `Ctrl+Shift+T` / `Ctrl+Shift+D` / `Ctrl+Alt+Shift+D` · `⌘T` / `⌘D` / `⌘⇧D` |
| New agent mission | `Ctrl+Shift+M` · `⌘⇧M` |
| Sidebar views 1–8 | `Ctrl+Shift+1…8` · `⌘1…8` |
| Broadcast input to visible terminals | `Ctrl+Alt+B` · `⌘⇧B` |
| Find in terminal | `Ctrl+Shift+F` · `⌘F` |
| Copy / paste in terminal | `Ctrl+Shift+C` / `Ctrl+Shift+V` · `⌘C` / `⌘V` |
| Settings | `Ctrl+,` · `⌘,` |
| Show/hide window from anywhere | `Ctrl+Shift+Space` (configurable) |

## How missions track agents

Pick the agent per mission or task (default in Settings → Agents). Settings also shows which agent
CLIs are on your PATH and lets you add custom ones as command templates (`{prompt}`, `{model}`,
`{name}`), with optional non-interactive and "continue last session" variants.

**Claude Code** gets the richest tracking: missions launch `claude --settings <userData>/claude-hooks.json …`. That file registers Claude Code
hooks (SessionStart, UserPromptSubmit, PreToolUse, Notification, Stop, SessionEnd) that run a tiny
relay script with Electron's bundled Node and POST to a loopback server in the app (random port,
per-run token). Your own `~/.claude/settings.json` is never modified.

**Every other agent** is tracked from its terminal: output means *Working*, 5 seconds of quiet
means *Ready for you*, and a terminal bell or OSC 9 / OSC 777 notification means *Needs you*.
Worktrees, diff review, commit / merge / PR and notifications work the same for all agents.

## Develop

```bash
npm install          # also rebuilds node-pty for Electron
npm run dev          # hot-reloading dev app
npm run typecheck
npm test             # unit tests (vitest)
```

On Ubuntu 23.10+ Electron may abort with a `chrome-sandbox` / SUID sandbox error. Either fix the helper once:

```bash
sudo chown root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

or run `npm run dev:nosandbox`.

## Installers

```bash
npm run dist:linux   # AppImage, deb, rpm
npm run dist:mac     # dmg, zip (on macOS)
npm run dist:win     # NSIS installer (on Windows)
```

node-pty is native, so each OS builds its own installer.

## CI and releases

- **CI** (`.github/workflows/ci.yml`) runs on every push and PR: typecheck, unit tests, build.
- **Release** (`.github/workflows/release.yml`) runs when you push a `release/**` branch
  (e.g. `release/0.2.0`). It builds Linux (AppImage, deb, rpm), Windows (NSIS) and macOS
  (dmg/zip, Intel and Apple Silicon), then attaches them plus `SHA256SUMS.txt` to the GitHub
  release `v<package.json version>`, creating it if needed. Bump `version` before cutting the
  branch; pushing again to the branch replaces the assets. You can also start it from the
  Actions tab and switch macOS off.

Builds are unsigned until signing secrets are added: Windows shows a SmartScreen warning, and
on macOS users must right-click → Open the first time (or run `xattr -cr /Applications/sldev-io.app`).

## Layout

- `src/main`: Electron main process: pty and SSH managers, git/gh, Claude hooks server,
  skills scanner, notes, credential vault, persistence
- `src/preload`: the `window.api` bridge
- `src/renderer`: React UI; terminal sessions live in `lib/terminals.ts`, outside React
- `src/shared`: types shared by both sides
