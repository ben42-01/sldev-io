# sldev

Agentic coding workspace for CLI agents (Claude Code first). Dockable terminals, a file explorer,
runtimes, Claude missions with live status and diff review, skills and MCP, GitHub workflows,
notes and SSH with an encrypted credential vault. See [ROADMAP.md](ROADMAP.md).

## Key shortcuts (Linux/Windows · macOS)

| | |
|---|---|
| Command palette | `Ctrl+Shift+P` · `⌘⇧P` |
| Quick open file | `Ctrl+Alt+P` · `⌘P` |
| New terminal / split right / split down | `Ctrl+Shift+T` / `Ctrl+Shift+D` / `Ctrl+Alt+Shift+D` · `⌘T` / `⌘D` / `⌘⇧D` |
| New Claude mission | `Ctrl+Shift+M` · `⌘⇧M` |
| Sidebar views 1–8 | `Ctrl+Shift+1…8` · `⌘1…8` |
| Broadcast input to visible terminals | `Ctrl+Alt+B` · `⌘⇧B` |
| Find in terminal | `Ctrl+Shift+F` · `⌘F` |
| Copy / paste in terminal | `Ctrl+Shift+C` / `Ctrl+Shift+V` · `⌘C` / `⌘V` |
| Settings | `Ctrl+,` · `⌘,` |
| Show/hide window from anywhere | `Ctrl+Shift+Space` (configurable) |

## How missions track Claude

Missions launch `claude --settings <userData>/claude-hooks.json …`. That file registers Claude Code
hooks (SessionStart, UserPromptSubmit, PreToolUse, Notification, Stop, SessionEnd) that run a tiny
relay script with Electron's bundled Node and POST to a loopback server in the app (random port,
per-run token). Your own `~/.claude/settings.json` is never modified.

## Develop

```bash
npm install          # also rebuilds node-pty for Electron
npm run dev          # hot-reloading dev app
npm run typecheck
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

node-pty is native, so each OS builds its own installer; `.github/workflows/release.yml` does
this on a `v*` tag.

## Layout

- `src/main`: Electron main process: pty and SSH managers, git/gh, Claude hooks server,
  skills scanner, notes, credential vault, persistence
- `src/preload`: the `window.api` bridge
- `src/renderer`: React UI; terminal sessions live in `lib/terminals.ts`, outside React
- `src/shared`: types shared by both sides
