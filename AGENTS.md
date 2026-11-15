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
npm run e2e -- tour       # every main surface in dark and light, for judging a styling change
npm run dist:linux        # installers into dist/ (each OS builds its own; node-pty is native)
npm run cli:build         # the free sldev CLI → cli/dist/sldev.mjs (its tests run with npm test)
```

Before you call a change done: `npm run typecheck && npm test`, and for UI or behaviour changes an
e2e scenario (add one under `scripts/e2e/scenarios/`) plus a look at its screenshots.

## Architecture

```
src/main/       Electron main process (Node): everything privileged
  index.ts        window, ALL ipcMain handlers, startup order (shell env → hook server → window)
  pty.ts          node-pty sessions with flow control (pause on HIGH water, resume on ack)
  launch.ts       how an agent argv is spawned without a shell (PATH lookup, Windows .exe/.cmd handling)
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
  diagram.ts      code map (imports between folders: TS/JS, Python, Java/Kotlin/Scala, Go, C#, Rust, C/C++, Ruby, PHP), Files (folders
                  and source files of any language) and schema ERD (Prisma, SQL DDL) for the Diagrams panel; parsing in src/shared/diagram*.ts
  docker.ts       container list and start/stop/rm through the docker CLI (shell/logs run in terminals)
  setup.ts        first-run tool check (git, gh, node, docker, ssh) with per-package-manager install commands
  factory.ts      recipe files (.sldev/factory) and run output files (.sldev/runs, git-ignored)
  sldevSkills.ts  installs sldev's skills into a project (.claude/skills, .agents/skills) and lists/clears .sldev/drafts; no electron (the CLI's `sldev skills` uses it)
  evals.ts        eval files (.sldev/evals/*.yml), prompt variants (.sldev/evals/prompts/*.md) and the check commands of an eval attempt (exit code + output, killed on timeout)
  boardFile.ts    the work board shared through git: .sldev/board.json, written atomically (merging is in src/shared/board.ts)
  profiles.ts     project agent profiles (.sldev/agents/*.md) and export to Claude/OpenCode agent files
  rules.ts        rules sync: .sldev/rules.md → AGENTS.md, CLAUDE.md, GEMINI.md, Cursor, Copilot
  usage.ts        token usage read from local agent logs (Claude transcripts, Codex sessions); reads only the
                  appended bytes on each poll, never whole logs (re-parsing them froze the app)
  missionKinds.ts custom mission kinds: .sldev/missions/*.md (project) and <userData>/missions (user)
  memory.ts       project memory (.sldev/memory.md): read by missions, appended by sldev_remember and "Remember"
  context.ts      project context index: memory, .sldev/context docs, .sldev/pinned.md and skills in a per-project
                  SQLite db (node:sqlite, FTS5 + file edges) under <userData>/context; a cache, rebuilt when a source changes
  stalls.ts       notes main-process stalls and an unresponsive window in <userData>/stalls.log and About diagnostics
src/preload/    index.ts = the whole window.api bridge (typed; api.d.ts re-exports the type)
src/shared/     types.ts shared by all processes (settings, Task, Mission, AgentOptions, …) and pure,
                  unit-tested logic: agents.ts (the agent registry and command builders, used by the CLI too), factory.ts (recipe parse + run state machine), recipes.ts (built-ins),
                  recipeDraft.ts (the recipe builder's draft ↔ YAML, validated by parsing it back), recipeBundle.ts (share/import text),
                  profiles.ts, rules.ts, usage.ts, missionHistory.ts, argv.ts (quoting), status.ts (state → tone),
                  pricing.ts (plans and Polar checkout links for the in-app plans, from website/src/content/pricing.json),
                  missionPrompt.ts (mission/follow-up/second-opinion prompts and handoff), missionKinds.ts (Build,
                  Research, Plan… templates), failover.ts (usage-limit handoff), context.ts (context parsing, ranking, staleness, prompt lines), screenReport.ts (terminal screen as a report), diagram.ts (import/Prisma/SQL parsers, Files tree, layered and tree layouts, Mermaid export), diagramLangs.ts (per-language import parsers and resolvers over one index), attention.ts (approval prompts on screen), automations.ts (schedules, CI and
                  issue triggers), memory.ts,
                  board.ts (the work board: columns, pick-up order and dependencies, how a card follows its run, story prompts and parsing, PR descriptions, release notes, retro prompts, the board file and its merge), recap.ts (Mission Control's Recap: standup/today/week Markdown from missions, local only),
                  review.ts (the review cockpit: hunks, noise, risk flags, unused new code, the walkthrough an agent writes over the real diff, its prompts), diff.ts (git diff parsing), gitGraph.ts (the commit graph: log parsing, lane layout, PR numbers),
                  gitStats.ts (the GitHub stats panel's activity charts: commits and PRs per local day/week),
                  sldevSkills.ts (sldev's own skills: their SKILL.md texts and versions, and the mission/story drafts agents leave in .sldev/drafts),
                  evals.ts (eval files, checks, judge verdicts, the scoreboard), lead.ts (Lead missions: limits, routing by eval results, what workers and sldev_wait say), repeat.ts (repeat loops: when a pass is over, what stops the loop, what the next pass is told; app and CLI),
                  theme.ts (Settings → Appearance: theme resolution, window colours, interface zoom)
src/renderer/src/
  lib/            framework-free logic: terminals.ts (xterm sessions), agents.ts (re-exports the agent
                  registry from src/shared/agents.ts, adds commandText), commands.ts (palette + shortcuts), fuzzy.ts (palette
                  matching, highlights, recent picks), theme.ts (applies the theme and zoom), diff.ts, paths.ts
  state/          tiny stores (createStore/useStore in store.ts): workspace (settings), missions, savedMissions (briefs kept
                  to launch later), focus (review focus / focus mode),
                  tasks, runs, runtimes, agents, profiles, factory (the run executor), notes, remote,
                  missionKinds, evals (eval runs: a worktree, a print-mode mission and the checks per attempt), lead (answers a Lead's sldev_delegate/wait/followup/integrate: workers, merges), review (the review cockpit's walkthrough and Ask why helpers, verdicts per part, Send back), drafts (takes the drafts agents leave in .sldev/drafts into saved missions and Proposed), automations (the trigger loop and repeat passes, while the app is open), board (work board cards
                  and the pick-up loop that starts Agent ready cards as runs or missions)
  dock/           dockview panels: Terminal, Diff, Note, MissionControl (missions board, factory runs, usage; opened from
                  the top of the left ActivityBar), Pipeline, Recipes (recipe library, step-by-step builder, import/export),
                  Dashboard, Agents, Board (the work board in its own tab), Diagram (code map, Files and schema, local parsing, opened from the Explorer header), Preview, Settings
  components/     sidebar views and shared UI: the left ActivityBar → Sidebar (explorer, runtimes, factory, tasks,
                  notes, remote, git: status, fetch, pull, branches (GitBranches.tsx) and the worktrees list (GitWorktrees.tsx) in state/git.ts), the right RightPanel tabs (overview, agents, skills, context, workflows); showView() routes by ViewId
  styles/app.css  all styling; design tokens on :root
website/        marketing site (Vercel): api/download.ts (/download/<os>), api/stats.ts (public download counts from GitHub), /changelog from
                  src/content/changelog.json (also baked into the app as What's new), api/license/* (Polar), public/install.sh,
                  pages: / (src/App.tsx) and /features, /pricing, /download, legal, /thanks (src/pages.tsx),
                  /docs guides from src/content/docs.tsx (keep the recipe guide in step with src/shared/factory.ts; a new guide
                  also needs website/docs/<id>/index.html, which test/docsPages.test.ts checks)
marketing/promo/ the 90 s advert, animated with Remotion (own package.json; prices, URL and colours read from website/,
                  music in public/ is git-ignored); see its README. Update a scene when the app UI it shows changes
test/           vitest (node env; test/setup.ts stubs window.api)
cli/            the free, open-source sldev CLI (Apache-2.0, its own package.json, bin `sldev`): daemon.ts owns the
                  ptys (src/main/pty.ts with a headless-screen sink), the hook/MCP server (src/main/hooks.ts in the CLI's own data folder, cli/src/paths.ts)
                  and a Unix socket; tracker.ts is the mission status logic for panes; tui.ts the tabbed view (top tabs, grouped sidebar, popups; render.ts draws it);
                  loops.ts the repeat loops (`sldev new --repeat`); workflows.ts (gh runs), editor.ts (sldev open), clean.ts; repo.ts and usage.ts the rules, memory, recall and usage commands. Tests in cli/test (run by npm test)
scripts/e2e/    Electron harness, fake agent CLIs (fakebin/), scenarios/
```

### Software Factory

A recipe is a graph of stages (`needs`); agent stages are missions in print mode, run stages are
terminals, the pr stage waits for a click. `src/shared/factory.ts` is the pure state machine (every
transition is unit-tested); `state/factory.ts` does the side effects: worktrees, missions, commits
after every stage, merging parallel branches at the fan-in. Hand-offs between stages are files in
`<worktree>/.sldev/runs/<run>/`. A restart pauses runs; nothing re-runs on its own. Each new worktree
gets its dependencies installed once (`setupCommand`, or the recipe's `setup:`), and print-mode stages
run with the agent's `unattendedMode` (Settings → Software Factory), because nobody is there to approve.

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
  OSC 9/777 means needs you. Agent-specific behaviour belongs in `src/shared/agents.ts`, never `if (agent === …)`
  scattered through the UI. The app is agent-agnostic: don't add Claude-only UI unless the
  feature is Claude-only by nature (slash commands, subagents, MCP). Skills are plain SKILL.md
  folders, so any agent can run them (`skillPrompt` in `src/shared/agents.ts`).
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
  Unpackaged builds (`npm run dev`, the owner's own copy) are always licensed and skip the trial (`devBuild` in
  `src/main/license.ts`), unless `SLDEV_LICENSE_API` is set (the e2e harness sets it) or `SLDEV_DEV_LICENSE=0`.
  Packaged builds never take that path.
  Tests never call Polar: unit tests stub `fetch`, e2e uses the fake license server in `scripts/e2e/run.cjs`.
- **Privacy**: no telemetry. A new network request from the app means updating `website/src/content/legal.tsx`
  (`/privacy`) and `legal.updatedAt` in `site.json` in the same change.
- **Secrets**: credential secrets are resolved in main only. Don't send them over IPC and don't log them.
- **Factory**: never add agent-specific behaviour to the runner; stages talk to agents only through
  prompts, files and (optionally) the sldev MCP tools. Pushing (the pr stage) only happens on a click.
- **Mission kinds**: the closing lines of a mission prompt come from its kind (`src/shared/missionKinds.ts`), never
  hard-coded: a Research mission told to "summarize what changed" goes and changes something. Freeform sends the
  brief exactly as written (no memory line either). Read-only kinds preselect the agent's `readOnlyMode`.
- **Project context**: the Markdown in `.sldev/` is the source of truth and the SQLite index is a disposable cache;
  never store anything only in the index. Prompts point at notes (absolute path and line), they don't paste them, and
  Freeform missions get nothing added. No embeddings or remote calls: search stays local.
- **Reports**: a mission's report is the agent's own (Claude's Stop hook, `sldev_done`). Agents that don't report back
  get their terminal screen after the prompt instead (`reportFrom: 'terminal'`, `src/shared/screenReport.ts`), and the UI
  says so; a real report always replaces it, never the other way round.
- **Needs you** for agents without hooks: a bell, OSC 9/777, or their approval prompt on screen (`asks` per agent in
  `src/shared/agents.ts`, `src/shared/attention.ts`), checked as output arrives and only below where the user last typed, so an
  answered question doesn't count. Mission details say how each agent's status is known (`statusSource`).
- **Usage limits**: what counts as "hit the limit" is per agent (`usageLimit` in `src/shared/agents.ts`), checked only against
  the last lines of output; the handoff to the next agent replaces the limit line, or the next agent's own echo of its
  prompt would flag it too. Factory stages continue on their own only with Settings → Agents → continue automatically.
- **Automations** run only while the app is open, skip (never catch up) a time missed while it was closed, never start
  a second thing while their last one is live, and never push.
- **Board pick-up** (`src/shared/board.ts`, the Board tab: `dock/BoardPanel.tsx`) follows the automation rules: only while the app is open,
  never more than the set number of cards at once, never pushes. Work only moves a card forward (Agent ready → In progress →
  Review); a card the human put in Backlog, Review or Done stays there. Moving a card back to Agent ready forgets its finished
  run so it can be picked up again; a card that can't start goes to Backlog with the reason, never retried every tick.
  Cards an agent files or rewrites (`sldev_board_add`, `sldev_board_update`, the story-writing missions of Write stories and Refine)
  always land in Proposed, and only a person approves them into Agent ready, so agents can't feed pick-up themselves.
  Story missions are read-only; agents without the sldev tools write their stories to a JSON file under `.sldev/runs/`. A merged PR
  (asked through gh every 5 minutes for cards in Review, and on window focus at most every 30 s; a run's PR is recorded, a mission's
  is found by its worktree branch) moves its card to Done; Clear Done/Backlog (`clearColumnFlow`) deletes a column's cards with their
  worktrees after asking, and never while an agent is at work in one; imported issues are closed by their run's PR.
  A card with `blockedBy` (card numbers; agents set it with `after`) isn't picked up until those are Done; manual Start can
  override from the menu. `spent` (time, agents, tokens from local logs) is measured once its work finishes and is not a change
  to the card (no `updatedAt` bump). Retros are read-only missions whose lessons go to `.sldev/memory.md` (sldev_remember, or a
  JSON file the app adds), never anywhere else.
- **Board in git** (`.sldev/board.json`, opt-in per project, `src/main/boardFile.ts`): only the shared fields are written
  (`SHARED` in `src/shared/board.ts`); runs, missions, state and spend stay local. The file is read before it is ever written
  (focus, every tick, before each write), merged card by card by `updatedAt`, deletions kept as tombstones. Conflict markers or
  bad JSON stop the sync with the reason on the board and the file untouched. The app never commits it.
- **Evals** (`src/shared/evals.ts`, Mission Control → Evals): every attempt gets its own worktree from the eval's `base`
  (default: HEAD when the run started), setup is committed before the agent starts so the diff is the agent's alone, and the
  agent runs in print mode with the factory's unattended mode. Checks run after it exits; a judge is a second print-mode
  mission that writes `VERDICT: PASS|FAIL` to a file under `.sldev/runs`. Eval missions carry `eval` (like `factory`): no
  notifications, no failover, kept out of the missions board and Recap. Only while the app is open; a restart stops running
  attempts (Continue starts the queue again), and nothing is pushed. Deleting a run removes its worktrees and branches.
  Prompt variants (`.sldev/evals/prompts/*.md`) are part of the contestant (`agent/model+prompt`) and go before the brief;
  `routeAgent` ignores attempts with a variant, since they measure instructions, not agents.
- **Review cockpit** (`src/shared/review.ts`, `components/ReviewCockpit.tsx`, the Review tab's Walkthrough view): parts can only
  claim hunks that exist in the real diff, and every hunk no part claims is still shown ("Not in the walkthrough"), so an agent can
  never hide a change; noise is folded, never dropped. Walkthrough and Ask why agents are helpers (`explains` on the mission, like
  `eval`): print mode with the unattended mode, told to write one file under the project's `.sldev/runs` and change nothing else,
  kept off the missions lists and Recap, no notifications or failover. Send back is one follow-up to the mission's own agent; nothing
  is committed or pushed.
- **sldev skills** (`src/shared/sldevSkills.ts`): they only ever create drafts. Missions and stories go through `.sldev/drafts/` (git-ignored),
  which the app takes in while it is open (saved missions, the board's Proposed column) and then empties; nothing an agent drafts
  launches or reaches Agent ready without a person. Recipes and evals are written where the app already reads them. Install never
  overwrites a hand-edited copy unless asked; bump `SKILLS_VERSION` when a skill's text changes, and keep each skill's example in step
  with its parser (test/sldevSkills.test.ts parses them). They are also public in the downloads repo's `skills/` (`npx skills add
  ben42-01/downloads.sldev.io`): run `npm run skills:publish` after changing one.
  Every skill ends with a check step: the agent runs `sldev_check` (MCP) or `sldev skills check <file>`, both `checkSkillFile`, which
  reads the file exactly as the app will, and says it's done only once it passes. A draft the app can't read is renamed `.bad` and the
  toast says why; mission front matter that isn't YAML (an unquoted colon in a title) is read line by line instead of set aside.
- **Lead missions** (kind `lead`, `src/shared/lead.ts`, `state/lead.ts`): only a Lead may call sldev_delegate, wait, followup and
  integrate (main checks the caller's kind; the CLI has none). Main can't start missions, so it forwards those calls to the
  window (`lead:request`/`lead:reply`) and waits. Workers run in print mode with the unattended mode, each in a worktree
  branched from the Lead's branch, carry `delegate`, show inside the Lead's card (not as missions of their own), and can't
  delegate. `maxWorkers`/`parallel` are hard limits. sldev_wait returns within 45 s (agents' tool calls time out), so the
  Lead calls it again. Integrating merges worker branches into the Lead's own worktree; a conflict stops there for the Lead
  to resolve. Nothing is pushed: the human reviews the Lead's branch. "auto" routes to the best agent on the project's evals.
- **Repeat** (`src/shared/repeat.ts`): a pass ends only on a signal that can't be mistaken: the agent's process exits
  (print mode, the default) or the user accepts it. Never end a pass on a Stop hook or a quiet terminal: a turn can end
  with a question. Passes share the first pass's worktree and each is committed there; in place, nothing is committed.
  A restart pauses a loop mid-pass (Run now continues), a pass that hits the usage limit ends the loop (no failover),
  and nothing is pushed. A repeat is one brief run again, not a recipe: the CLI's loops don't make it a `sldev run`.
- **Layout restore** must not re-run commands: restored runtime/task panels wait for Enter, and
  restored missions resume their session instead of re-sending the prompt.
- **Agent spawning**: agents start from an **argv array** (`agentCommand` in `src/shared/agents.ts` returns one
  element per argument, never quoted) and main spawns it without a shell (`src/main/launch.ts`: a real
  `.exe` first, npm `.cmd` shims unwrapped to `node <script>`, versioned launchers like Cursor's `agent.cmd`
  run as `versions\<newest>\node.exe index.js`, cmd.exe only as a last resort, and a `.ps1` next to the `.cmd`
  for multi-line prompts cmd.exe can't take). Never join an agent command into a string or run it through `cmd /c`/`sh -c`: on
  Windows that once delivered the prompt as the single word "need". `commandText()` is for display only.
  Shell strings (`command: string`) are for user-typed runtime/task commands; on Windows they run in cmd.exe,
  except a command starting with a `.ps1`, which goes to PowerShell (cmd.exe would open it in Notepad).
- **The CLI** (`cli/`) is open source: it may import only `src/shared/*` and the Electron-free `src/main/` modules it
  already uses (pty, launch, hooks, mcp, git, github, editors, rules, memory, context, missionKinds, sldevSkills), never the UI, licensing or
  beta. Keep those modules free of `electron` imports (they take a data dir or a sink instead). The client checks the
  daemon's version on connect (`connect` in `cli/src/client.ts`): a daemon left by an older sldev is replaced when nothing
  runs in it, and the daemon answers every command, an unknown one with an error, because a silent one hung `sldev` after
  upgrades. Bump `cli/package.json` and `cli/src/version.ts` together. It has its own data folder
  (`~/.config/sldev`, `dataDir` in `cli/src/paths.ts`) and config (`<data>/config.json`, `cli/src/config.ts`), and shares
  code with the app, not state: it never reads the app's settings, and only `sldev clean --orphans` reads the app's records
  (`appDataDir`), read only. A daemon left by sldev 0.4 in `<app userData>/cli` is kept while it runs panes, else replaced. It makes no network requests of its own; the one exception is the workflows view
  (`sldev workflows`, Ctrl-b w), which asks GitHub through the user's `gh`, and only while it's open. Another one means updating
  `/privacy` like the app. `sldev clean` never removes a worktree a live pane, an unfinished loop or the app (its missions,
  runs, automations) uses. No `sldev run`: the factory stays in the app.
  A request from inside a pane (the client sends `from` when `SLDEV_MISSION_ID` and `SLDEV_CLI_DAEMON`, the daemon's
  random instance id, are both set) is guarded in `guard` in `cli/src/daemon.ts`: `new` only with the pane's `--allow-spawn <n>`
  (children: worktree, print, no failover, can't spawn, git push blocked through env config), `send`/`kill`/… only on its
  own children, `ls`/`read`/`wait` open, the rest refused. A new command must go in `OPEN` or `CHILD_ONLY` on purpose, or it's
  refused from panes. The guard changes the protocol's meaning, so bump the CLI version with it (an older daemon ignores `from`).
- **Destructive actions** ask first with `confirmAction`/`confirmDelete` (`components/Modal.tsx`,
  flows in `lib/removals.tsx`), saying what is removed and kept. Never `window.confirm`/`alert`.
  Worktrees are removed without `--force` unless the user ticked "discard", and never while something
  runs in them.
- **Styling** (UI guide look): OKLCH surface ladder (`--background` < `--surface` < `--surface-raised` <
  `--muted`, borders above), radius scale (`--radius-xs/sm` chips, `--radius` 6px buttons/inputs,
  `--radius-lg` cards, `--radius-xl` modals, `--radius-full` pills/dots), and an inner radius smaller
  than its container. Buttons: `.btn` secondary, `.btn.primary` light-grey fill (one per area),
  `.btn.ghost`, `.btn.danger` (destructive only on hover); focus-visible ring. Colour means state only,
  through `src/shared/status.ts` (`missionSignal` etc. → tone) and `StatusDot`/`StatusPill`: working
  green, attention amber, error red, review blue, done teal; pulse = live activity (ping halo, never
  blink). The aurora border (`.aurora`) is for containers only (cards, modals, board icons), never
  buttons or inputs, and a status border wins over it. Dialogs use the shared `Modal` (`<dialog>`).
  Field labels are uppercase 10px; hints under fields explain the effect. Every async region has
  empty/loading/error states (`components/States.tsx`). Icons come from lucide-react (1.5px, square caps)
  and icon-only buttons get `title` and `aria-label`.
- **Themes**: dark (default), light and "match system" (Settings → Appearance). Light mode only redefines tokens
  (`:root[data-theme='light']` in app.css), so never hard-code a colour in a rule or a component: use the ladder, `--tint`
  for faint washes, `--overlay` behind dialogs, `--shadow`/`--shadow-strong`, `--code-bg`. Things drawn outside CSS follow
  `appearance` in `lib/theme.ts` (xterm palette in `lib/terminals.ts`, CodeMirror in `NotePanel.tsx`, dockview in `Dock.tsx`).
  The theme is resolved in the renderer (main's `nativeTheme` stays on "system", so a previewed dev site keeps the OS
  scheme); main gets the resolved one for the window background and title-bar buttons, and passes it to the preload as
  `--sldev-theme=` so the first paint matches. Check a UI change in both: `SLDEV_E2E_THEME=light npm run e2e -- <scenario>`.

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
needs checking against the real agent CLIs. Since 1.0.2, work happens on `master` (`v1` is kept equal to it);
releases are still cut from `release/<version>` branches, and pushing `master` builds nothing but CI.

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
