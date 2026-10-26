# AGENTS.md: working on sldev-io

sldev-io is an Electron desktop app: a terminal-first workspace for agentic coding through CLI
agents (Claude Code, Codex, Cursor Agent, GitHub Copilot, OpenCode, Gemini CLI, custom). It is
**not an IDE**: no code editor, files open in the user's editor. Look and feel: Cursor-like, sharp,
monochrome with a slim blue→green→purple brand gradient.

Repo: https://github.com/ben42-01/sldev-io · default branch `master`

## Commands

```bash
npm ci                    # installs and rebuilds node-pty for Electron (postinstall)
npm run dev:nosandbox     # dev app with HMR (Ubuntu needs --no-sandbox, see README)
npm run typecheck         # tsc for main/preload (tsconfig.node) and renderer (tsconfig.web)
npm test                  # vitest unit tests in test/
npm run e2e -- smoke      # build, then drive the real app (scripts/e2e), screenshots in .e2e-out/
npm run e2e -- missions   # Claude + Codex missions with fake CLIs through every status
npm run e2e -- beta       # free-beta window from /beta.json
npm run dist:linux        # installers into dist/ (each OS builds its own; node-pty is native)
```

Before you call a change done: `npm run typecheck && npm test`, and for UI or behaviour changes an
e2e scenario (add one under `scripts/e2e/scenarios/`) plus a look at its screenshots.

## Architecture

```
src/main/       Electron main process (Node): everything privileged
  index.ts        window, ALL ipcMain handlers, startup order (shell env → hook server → window)
  pty.ts          node-pty sessions with flow control (pause on HIGH water, resume on ack)
  ssh.ts          ssh2 shells, SFTP, port forwards, host-key TOFU (known_hosts.json)
  vault.ts        credentials encrypted with safeStorage async APIs; secrets never reach the renderer
  hooks.ts        loopback HTTP server receiving Claude Code hook events and sldev MCP tool calls (token-protected)
  mcpServer.ts    the stdio MCP server agents start (script string, installed in userData); mcp.ts answers its tools
  beta.ts         free-beta window: fetches <site>/beta.json, encrypted cache, clock-rollback guard
  updater.ts      electron-updater from the downloads repo (macOS: notify only until builds are signed)
  license.ts      license keys + trial: Ed25519-signed tokens from <site>/api/license, verified offline
                  (format in website/api/_licenseToken.ts, shared with the server); machineId.ts hashes the OS id
  git.ts, github.ts (gh CLI), runtimes.ts (script detection), claudeAssets.ts (skills/MCP),
  notes.ts, fs.ts, editors.ts, shellEnv.ts (login-shell PATH), store.ts (atomic JSON files)
  docker.ts       container list and start/stop/rm through the docker CLI (shell/logs run in terminals)
  setup.ts        first-run tool check (git, gh, node, docker, ssh) with per-package-manager install commands
  factory.ts      recipe files (.sldev/factory) and run output files (.sldev/runs, git-ignored)
  profiles.ts     project agent profiles (.sldev/agents/*.md) and export to Claude/OpenCode agent files
  rules.ts        rules sync: .sldev/rules.md → AGENTS.md, CLAUDE.md, GEMINI.md, Cursor, Copilot
  usage.ts        token usage read from local agent logs (Claude transcripts, Codex sessions)
src/preload/    index.ts = the whole window.api bridge (typed; api.d.ts re-exports the type)
src/shared/     types.ts shared by all processes (settings, Task, Mission, AgentOptions, …) and pure,
                  unit-tested logic: factory.ts (recipe parse + run state machine), recipes.ts (built-ins),
                  profiles.ts, rules.ts, usage.ts, missionHistory.ts
src/renderer/src/
  lib/            framework-free logic: terminals.ts (xterm sessions), agents.ts (agent registry
                  and command builders), commands.ts (palette + shortcuts), diff.ts, paths.ts
  state/          tiny stores (createStore/useStore in store.ts): workspace (settings), missions,
                  tasks, runs, runtimes, agents, profiles, factory (the run executor), notes, remote
  dock/           dockview panels: Terminal, Diff, Note, MissionBoard, Pipeline, Dashboard, Preview, Settings
  components/     sidebar views (ActivityBar → Sidebar routes by ViewId) and shared UI
  styles/app.css  all styling; design tokens on :root
website/        marketing site (Vercel): api/download.ts (/download/<os>), api/stats.ts (public download counts from GitHub), /changelog from
                  src/content/changelog.json (also baked into the app as What's new), api/license/* (Polar), public/install.sh,
                  pages: / (src/App.tsx) and /features, /pricing, /download, legal, /thanks (src/pages.tsx)
test/           vitest (node env; test/setup.ts stubs window.api)
scripts/e2e/    Electron harness, fake agent CLIs (fakebin/), scenarios/
```

### Software Factory

A recipe is a graph of stages (`needs`); agent stages are missions in print mode, run stages are
terminals, the pr stage waits for a click. `src/shared/factory.ts` is the pure state machine (every
transition is unit-tested); `state/factory.ts` does the side effects: worktrees, missions, commits
after every stage, merging parallel branches at the fan-in. Hand-offs between stages are files in
`<worktree>/.sldev/runs/<run>/`. A restart pauses runs; nothing re-runs on its own.

### Data flow for a feature

renderer UI → `window.api.x.y()` (preload) → `ipcMain.handle('x:y')` in `src/main/index.ts` →
module in `src/main/`. Push events go back with `webContents.send` and preload `on(channel)`.
Persisted state uses `JsonStore` in userData (`~/.config/sldev-io` on Linux); store files are
typed in `StoreFiles` in `src/shared/types.ts`.

## Invariants (things that broke before)

- **Terminal sessions live outside React** (`lib/terminals.ts`). Panels attach and detach the
  xterm DOM. Sessions are disposed only when a panel is *closed*. Don't create terminals in
  components, and don't re-add React StrictMode: its double mount kills the dock and the ptys.
- **Resize**: refit the xterm grid on every ResizeObserver frame (rAF), but tell the pty only after
  60 ms of quiet (each SIGWINCH makes TUIs redraw). Hidden or tiny hosts (<20px) are skipped.
- **pty output** is batched and acknowledged: every `pty:data` chunk must be `ack`ed after
  `term.write` completes, or the pty stays paused.
- **Missions**: Claude Code gets `--settings <userData>/claude-hooks.json`, and the hooks POST
  to the loopback server. Never touch the user's `~/.claude/settings.json`. Other agents are
  tracked from terminal activity: output means working, 5 s quiet means ready, and a bell or
  OSC 9/777 means needs you. Agent-specific behaviour belongs in `lib/agents.ts`, never `if (agent === …)`
  scattered through the UI. The app is agent-agnostic: don't add Claude-only UI unless the
  feature is Claude-only by nature (slash commands, subagents, MCP). Skills are plain SKILL.md
  folders, so any agent can run them (`skillPrompt` in `lib/agents.ts`).
- **Beta window**: beta builds (`-beta` in the version) read `startsAt`/`endsAt` from the website's
  `/beta.json`, generated from `website/src/content/pricing.json`. Never bake dates into a build.
  An ended beta locks only at **launch** (`BetaEnded` screen, data untouched), never mid-session.
  If the site is unreachable and nothing is cached, the beta stays open (fails open on purpose).
  Logic lives in `src/shared/beta.ts`; build-time URLs come from `website/src/content/site.json`
  (`SLDEV_SITE_URL` / `SLDEV_BETA_CONFIG_URL` override).
- **Licensing**: the lock decision (`isLocked` in `src/shared/license.ts`) is made at **launch** only, like the
  beta. A license overrides an ended beta or trial. Beta builds are free: no key field, and main
  refuses to activate (`available: false`); licenses and the trial start with the first stable release. Only main verifies tokens; env overrides
  (`SLDEV_LICENSE_API`, `SLDEV_LICENSE_PUBLIC_KEY`, `SLDEV_TRIAL_DAYS_AGO`) work in unpackaged builds only.
  Tests never call Polar: unit tests stub `fetch`, e2e uses the fake license server in `scripts/e2e/run.cjs`.
- **Privacy**: no telemetry. A new network request from the app means updating `website/src/content/legal.tsx`
  (`/privacy`) and `legal.updatedAt` in `site.json` in the same change.
- **Secrets**: credential secrets are resolved in main only. Don't send them over IPC and don't log them.
- **Factory**: never add agent-specific behaviour to the runner; stages talk to agents only through
  prompts, files and (optionally) the sldev MCP tools. Pushing (the pr stage) only happens on a click.
- **Layout restore** must not re-run commands: restored runtime/task panels wait for Enter, and
  restored missions resume their session instead of re-sending the prompt.
- **Styling**: monochrome UI (`--fg`, `--border*`), `--radius: 2px`, outline buttons
  (`.btn`, `.btn.primary` = white outline, inverts on hover). Color only via the brand gradient
  (`--brand`, `.brand-frame`, `.brand-text`) or status colors (green/amber/red). Icons come from
  lucide-react and global CSS makes them 1.5px with square caps. Don't add blue buttons.

## Gotchas

- **TypeScript 7**: `paths` entries must start with `./`, and there's no `baseUrl`.
- **Exact versions** in package.json. Add deps with `--save-exact` and prefer versions at least two weeks old.
- **npm 10.9 crashes** (`reading 'edgesOut'`) when installing some packages, vitest for example.
  Install those with `npx -y npm@11.6.2 install …` and check that `npm ci --dry-run` still works.
- **Ubuntu sandbox**: Electron needs `--no-sandbox` here (chrome-sandbox SUID).
- **gh** is a snap on the dev box and can't read repos under /tmp.
- **Electron 45**: use the async `safeStorage` APIs; the sync ones are deprecated.
- **Linux release builds run on `ubuntu-22.04`**, not `ubuntu-latest`: native modules link against the
  runner's glibc, and a newer runner makes the app fail to start on older distros. The release workflow
  rejects anything above glibc 2.35. It compiles with clang 15 there, because gcc 11/12 reject Electron's V8 headers.
- **ssh2 `hostVerifier`** is async (callback); the typings need a cast through `unknown`.

## Testing without side effects

Never run a real `claude`/`codex` mission, dispatch a real workflow, or push from tests, because
they spend the user's quota or touch real repos. The e2e harness runs against a temp git repo with
fake CLIs in `scripts/e2e/fakebin/`. `claude` fires the hook events from `--settings` and edits
files; `codex` prints, goes quiet, then rings the bell. Add a fake there for a new agent.

## Workflows and releases

- `.github/workflows/ci.yml`: typecheck, test and build on every push and PR.
- `.github/workflows/release.yml`: push `release/<version>` to build Linux, Windows and macOS
  installers and attach them to GitHub release `v<package.json version>`. Bump the version
  first. Builds are unsigned for now.

## Production docs

`docs/go-to-production.md` is the owner's launch guide (phases, accounts, secrets, runbooks) and
`docs/monetization-plan.md` has the reasoning. Keep them in sync when you change releases, the
beta window, licensing or pricing. `docs/v1-roadmap.md` is the 1.0 scope, its status and what still
needs checking against the real agent CLIs; 1.0 work happens on the `v1` branch.

## Skills

Step-by-step playbooks live in `.claude/skills/*/SKILL.md`. Claude Code loads them automatically;
other agents can read them as plain Markdown:

- `verify-in-app`: run and extend the e2e harness, read screenshots
- `add-agent-cli`: add or fix a built-in agent CLI
- `add-feature`: new sidebar view, panel, IPC channel or persisted store, end to end
- `cut-release`: version bump, release branch, watching the build

## Conventions

- Match the surrounding code: small modules, comments only for the non-obvious "why", no
  default exports, named functions, `void promise` for fire-and-forget.
- Commit messages: imperative summary line, optional body. Don't commit `out/`, `dist/`,
  `.e2e-out/`, or anything secret.
