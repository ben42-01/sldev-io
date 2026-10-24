# sldev-io

Agentic coding workspace for CLI agents: Claude Code, Codex, Cursor Agent, GitHub Copilot,
OpenCode, Gemini CLI or any CLI you add. Dockable terminals, a file explorer, runtimes, agent
missions with live status and diff review, skills and MCP, GitHub workflows, notes, SSH with an
encrypted credential vault, and Docker containers (shells, logs, start/stop) under Remote. See [ROADMAP.md](ROADMAP.md).

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

## First-run setup

sldev-io drives tools that are already on your machine. On first start (and whenever a required tool
is missing) it opens a **Setup** panel that checks git (required), the GitHub CLI and its login,
Node.js/npm, Docker, the OpenSSH client and every agent CLI. Missing tools get an **Install** button
with the right command for your machine (apt, dnf, pacman, zypper, Homebrew or winget), and tools
that need a login or a running daemon get **Fix**. Commands run in a visible terminal so you can
answer sudo/UAC prompts, and the check reruns when they finish. Reopen it any time with
*Check setup* in the command palette or Settings → Setup.

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

Launching (downloads, beta window, payments, licensing, signing): see
[docs/go-to-production.md](docs/go-to-production.md).

- **CI** (`.github/workflows/ci.yml`) runs on every push and PR: typecheck, unit tests, build.
- **Release** (`.github/workflows/release.yml`) runs when you push a `release/**` branch
  (e.g. `release/0.2.0`). It builds Linux (AppImage, deb, rpm), Windows (NSIS) and macOS
  (dmg/zip, Intel and Apple Silicon), then publishes them plus `SHA256SUMS.txt` and the update
  metadata (`*.yml`, `*.blockmap`) as release `v<package.json version>` in the **public**
  [`ben42-01/downloads.sldev.io`](https://github.com/ben42-01/downloads.sldev.io) repo (using the
  `RELEASES_TOKEN` secret), and records the same release in this private repo. Bump `version` before cutting the
  branch; pushing again to the branch replaces the assets. You can also start it from the
  Actions tab and switch macOS off.
- A version with a suffix (`0.2.0-beta.1`, `0.2.0-rc.1`) becomes a GitHub **pre-release**,
  so it never shows as "Latest".

### Cutting a release

```bash
# 1. on an up-to-date master, set the version (no git tag: the workflow creates the release)
git switch master && git pull
npm version 0.2.0-beta.1 --no-git-tag-version   # or 0.2.0 for a stable release
git commit -am "Release v0.2.0-beta.1" && git push origin master

# 2. push a release branch with the same version: this starts the build
git switch -c release/0.2.0-beta.1
git push -u origin release/0.2.0-beta.1

# 3. watch it (or open the Release workflow in the Actions tab), takes 10-20 minutes
gh run watch $(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status

# 4. back to work
git switch master
```

When it finishes, `v0.2.0-beta.1` on the downloads repo's Releases page has the AppImage, deb, rpm, exe, dmg,
zip and `SHA256SUMS.txt`. If one OS fails, fix it on the release branch and push again; the
files on the release are replaced. Next betas are `-beta.2`, `-beta.3`, …; the final release is
plain `0.2.0`.

Builds are unsigned until signing secrets are added: Windows shows a SmartScreen warning, and
on macOS users must right-click → Open the first time (or run `xattr -cr /Applications/sldev-io.app`).

## Layout

- `src/main`: Electron main process: pty and SSH managers, git/gh, Claude hooks server,
  skills scanner, notes, credential vault, persistence
- `src/preload`: the `window.api` bridge
- `src/renderer`: React UI; terminal sessions live in `lib/terminals.ts`, outside React
- `src/shared`: types shared by both sides
