# sldev CLI

Run coding agents side by side in your terminal: Claude Code, Codex, Cursor Agent, GitHub Copilot,
OpenCode and Gemini CLI, each in its own tab, with a marker that says which one is working, which is
ready, and which needs you. Plain shell tabs sit next to them, so one `sldev` window can stand in for a
terminal multiplexer while agents work. Free and open source (Apache-2.0), like the [sldev-io](https://github.com/ben42-01/sldev-io)
desktop app, which adds mission cards, the Software Factory and more on the same project files.

What it does that a plain multiplexer doesn't:

- **Status you can trust.** Claude reports through its hooks. Every other agent is watched from its
  screen: output means working, 5 s of quiet means ready, and a bell, OSC 9/777 or its approval prompt
  means it needs you. You get a desktop notification when one needs you.
- **A worktree per agent** (`--worktree`), with the branch and diff stat on each pane.
- **Failover.** When an agent hits its plan's usage limit, the same task continues on the next one,
  with a note about where the work stands (`--failover codex,gemini`).
- **Repeat.** `sldev new --repeat 4 --gap 30m --check "npm test" "Polish the settings page"` runs the
  brief pass after pass in one worktree, a commit per pass; each pass ends when the agent exits (print mode),
  and the next gets the last report and any check failure. `--accept` makes passes interactive (`sldev accept <pane>`).
- **Workflows, editor, clean.** Attached, Ctrl-b w shows the repo's GitHub Actions runs (rerun the failed
  jobs, open one in the browser; needs the GitHub CLI, signed in), Ctrl-b e opens the pane's folder in your
  editor and Ctrl-b v its changed files side by side. `sldev open <pane> [--diff]` and `sldev workflows` do the
  same from a script. `sldev clean` drops finished panes and removes their worktrees, asking first.
- **Briefs written ahead of time** in `.sldev-cli/briefs/*.md`: `sldev briefs` lists them, `sldev launch <name>`
  (or Ctrl-b b, then Enter) starts one with its kind, agent, worktree and acceptance criteria. See [Briefs](#briefs).
- **Second opinions.** `sldev review <pane> --agent claude` has another agent review a pane's changes, read-only.
- **One set of rules** in `.sldev/rules.md`, written out as AGENTS.md, CLAUDE.md, GEMINI.md, Cursor and Copilot rules.
- **sldev skills** (`sldev skills install`): any agent can draft a mission, board stories, a factory recipe or an eval
  as files the sldev-io app takes in as drafts. `sldev skills check <file>` reads one the way the app will (agents
  started by sldev get the same check as the `sldev_check` tool), so a draft that wouldn't load is fixed before anyone waits for it.
  The same install adds `sldev-conductor`: an agent in a pane started with `--allow-spawn` splits a task between
  other agents and merges their branches into its own. See [A conductor](#a-conductor-one-agent-running-others).
- **Project memory** in `.sldev/memory.md`, searchable with `sldev recall`, and the sldev MCP tools in
  every agent it starts.
- **Usage and cost** from the agents' own local logs: `sldev usage [--week]`.

Nothing in the CLI talks to the network itself; the workflows view asks GitHub through your own `gh`, only
while it's open. The daemon listens on a Unix socket (a named pipe on Windows) and a loopback port (for
Claude's hooks and the MCP tools), both protected.

## Install

Needs Node.js 22.16 or newer, on Linux, macOS or Windows 10/11 (Windows is new: tested in CI, tell us what breaks).

```bash
npm i -g sldev-cli    # the package is sldev-cli; the command is sldev
```

npm wouldn't take the name `sldev` (too close to an existing package), so the package is `sldev-cli`.
Builds are also on GitHub (the public downloads repo, branch `cli`, written by the "Publish CLI" workflow):

```bash
npm i -g github:ben42-01/downloads.sldev.io#cli          # newest
npm i -g github:ben42-01/downloads.sldev.io#cli-v0.3.0   # a specific version
```

From a checkout of the source repo, `npm run cli:pack` builds `dist/sldev-cli-<version>.tgz`, which installs with `npm i -g ./dist/sldev-cli-<version>.tgz`.

The CLI is standalone: it does not need the sldev-io desktop app or Electron. It needs Node.js
22.16+, plus a C++ toolchain on Linux (`build-essential`, Python 3), because node-pty compiles there; macOS and Windows get a prebuilt binary.

On Windows the daemon listens on a named pipe instead of a Unix socket, notifications are Windows toasts,
and repeat checks run in cmd.exe (a check that starts with a `.ps1` runs in PowerShell).

## Use

```bash
sldev new --agent claude --kind build --worktree feature/dark-mode "Add a dark mode toggle"
sldev new --agent codex "Why is test/parser.test.ts flaky?"
sldev                     # attach: every session is a tab (keys below)
sldev ls
sldev wait 2 --for needs-you
sldev send 2 "yes"
sldev new --allow-spawn 2 "Split the migration into parts and hand two of them to other agents"
sldev stop                # stops the daemon and every agent in it (a reboot doesn't: they resume)
```

### Briefs

A brief is a mission written ahead of time, by you or by an agent, and started by you. Briefs live in the
project's `.sldev-cli/` folder, at the top level of the repo's main checkout (also when you're in one of its
worktrees):

```
.sldev-cli/
  .gitignore         "*": nothing in here is committed unless you change it
  briefs/*.md        waiting
  briefs/launched/   started ones, with the pane they ran in
  kinds/*.md         the project's own mission kinds (same format as the app's .sldev/missions/*.md)
```

A brief is Markdown with the same front matter as an sldev-io mission draft, and the brief as the body:

```markdown
---
title: Add a dark mode toggle
kind: build            # build (default), research, investigate, plan, review, freeform, or a kind of your own
agent: codex           # optional; sldev launch --agent wins, else claude
worktree: true         # true: a new worktree named after it; false: in place; left out: as the kind says
criteria:
  - The toggle is in Settings and remembered
  - npm test passes
by: claude             # who wrote it, shown in the list
---

Add a toggle to the settings page that switches the UI to a dark theme. …
```

```bash
sldev briefs              # what's waiting: name, title, kind, agent, or why it can't launch (--json too)
sldev launch dark-mode    # by name (the file name without .md) or by path; --agent <id> overrides the brief's
```

`sldev launch` starts it like `sldev new --kind … --criteria …`: the kind's closing lines and the acceptance
criteria go into the prompt, along with the pointer to the project memory. The brief then moves to
`briefs/launched/` with `pane:` and `launched:` added to its front matter, so `sldev briefs` only shows what's
still waiting. A brief that can't start (no brief under the front matter, front matter that doesn't read, a kind
or agent sldev doesn't know, criteria on a freeform brief) is refused with the reason and stays where it is.
Nothing in `.sldev-cli/` ever starts on its own. Attached, **Ctrl-b b** shows the waiting briefs; Enter launches
the one in focus in a new tab.

In Ctrl-b c's brief prompt, **Ctrl-e** opens a brief template in your terminal editor (`$VISUAL`, `$EDITOR`, else
vi): write the brief, save and close, and it starts, like `git commit`. Left empty, nothing starts and the file is
removed; one that can't start waits in `briefs/` with the reason on the status line.

The CLI and the app keep their inboxes apart: the CLI never reads or writes `.sldev/drafts` (the app's), and the
app never reads `.sldev-cli/`. `.sldev/memory.md` and `.sldev/rules.md` stay shared; they are plain project files
any agent reads.

### Tabs

Attached, every session (an agent or a plain shell) is a tab along the top, numbered `1 2 3` with a `+` at the
end for a new one. Each tab's marker is its state: a spinner while the agent works, an amber dot when it needs you,
blue when it's ready for you, `✓` done, `✕` failed, `›` a shell. A tab in the background that needs you stands out.
The line under the tabs marks the one in front and says who runs it, where (its branch) and its diff stat.

On terminals 100 columns or wider a sidebar groups the tabs by project (the repo they work in), each group with its
most urgent state, and each tab with its agent and state in words, or a shell's folder. Its foot counts the agents
by state and shows any repeat loops.

It looks like the app in dark mode: sldev paints its own surfaces from the app's grey ladder (panes on the darkest
tone, the sidebar, tab bar and status bar a step up, popups and whatever is in focus a step up again), so it doesn't
depend on your terminal's background. Container edges carry the app's blue → green → purple gradient: soft along
the sidebar and split dividers, full on popups and under the tab in front; plain rules stay a quiet grey, and colour
otherwise only means state. Nothing is drawn in reverse video: the tab and sidebar row in front are lifted, bold, with
an accent bar, and in a split the pane that doesn't take the keys is drawn faint. Inside a pane, a program's own
colours are kept; only cells with the default colours get the pane's. Colours are 24-bit where the terminal says so
(`COLORTERM=truecolor`), the nearest of 256 otherwise, and sldev asks the terminal for its background (OSC 11) and
switches to the app's light ladder on a light one. `SLDEV_THEME=terminal` turns the painted surfaces off and draws on
your terminal's own background; `NO_COLOR` takes every colour out of sldev's own drawing.

Keys go to the tab in front; Ctrl-b is the prefix:

| Ctrl-b then | does |
| --- | --- |
| `c` | a new tab: pick a shell or an agent (the ones not installed say how to get them), then type the brief, or nothing to start it without one; Ctrl-e writes a longer one in `$EDITOR` |
| `t` | a new shell tab (`$SHELL`; PowerShell on Windows) in the folder of the tab in front |
| `b` | the briefs waiting in `.sldev-cli/briefs`; Enter launches the one in focus |
| `1`–`9` | that tab |
| `n` / `p` (or Tab, `o`) | next / previous tab |
| `<` / `>` | move the tab left / right |
| `,` | rename the tab |
| `x` | close the tab (asks first while its agent or shell still runs) |
| `s` | split: the tab in front and the next one side by side (needs 60 columns) |
| `w` / `e` / `v` | workflows, the tab's folder in your editor, its changed files |
| `?` | every key |
| `d` | detach; everything keeps running |
| Ctrl-b | send a Ctrl-b to the tab |

Tabs, `+` and the sidebar's rows take clicks. **Drag over a tab's text to copy it**: the selection stays inside
that tab (never the sidebar or the tab beside it) and goes to the clipboard when you let go, through wl-copy,
xclip or xsel (pbcopy, clip on macOS and Windows) and OSC 52, which also works over SSH in terminals that allow it.
The **wheel scrolls back** through a tab's history; typing goes back to the newest output. A program in a tab that
reads the mouse itself gets its clicks and wheel instead; Shift+drag still makes your terminal's own selection.

The daemon keeps the tabs: `sldev` attaches again to the same order, names, tab in front and split, and
every tab's screen and scrollback. Typing `exit` in a shell tab closes it. Shell tabs show in `sldev ls`
and take `send`, `read` and `kill` like agents, but they aren't missions: the sldev MCP tools don't list
them, and `sldev wait` without a pane waits for agents only.

**Sessions survive a reboot** (or a daemon that crashed or was killed): the daemon keeps its panes in
`sessions.json` in its folder, and the next `sldev` reopens each shell tab in its folder and resumes each agent's
own session where it was (Claude Code by its session id, the others with their "continue the latest session").
A prompt is never sent again, so an agent that hadn't started a session yet, a `--print` run, a pass of a repeat
and an agent another agent started come back as ended, with why, and their files as they left them. Repeat loops
themselves don't come back. `sldev stop` stops every agent on purpose, so it forgets them.

### Agents that start agents

An agent in a pane can run `sldev` too. sldev gives every agent pane `SLDEV_MISSION_ID` and `SLDEV_CLI_DAEMON`, and
a command run with them counts as that pane's agent asking:

- `sldev new` is refused unless you started that pane with `--allow-spawn <n>` (1–8). Its agent may then start up to n
  agents over the pane's whole life (ones that ended still count). They always run `--print` in a worktree of their
  own (`--here` and `--repeat` are refused), have no failover, can't start agents themselves, and nothing in this path
  pushes.
- `send`, `kill`, `accept`, `rename` and typing work only on that pane's own children; `ls`, `read` and `wait` stay
  open; `review`, `loops stop`, `stop` and attaching the TUI are refused.

`sldev ls` and the sidebar show each child under the pane that started it (`└`), and `ls` shows a pane's
`[started 1/2]`. Closing a tab whose children still run asks whether to stop them too; `sldev kill <pane> --children`
does the same from the command line. This is a guard against an agent starting agents nobody asked for, not a
sandbox: an agent that unsets those variables goes unrecognised, like any shell outside sldev.

### A conductor: one agent running others

`sldev skills install` also installs the `sldev-conductor` skill (in `.claude/skills` and `.agents/skills`). An agent
that has it, running in a pane you started with `--allow-spawn <n>`, splits the brief into at most n independent
parts, starts each as an agent of its own in a worktree branched from its branch, waits for them, merges their
branches into its own and reports. It never pushes or opens a pull request, and it stops on a merge conflict it can't
resolve. Started without `--allow-spawn`, it says so and gives you the command to start it again.

```bash
sldev skills install
sldev new --allow-spawn 3 --kind build --worktree conduct/users \
  "/sldev-conductor Add pagination to the users list: the API, the UI table and the docs"
```

(`/sldev-conductor` is how Claude Code calls a skill; other agents find it by its description, or say "use the
sldev-conductor skill".) Its agent then does what the skill tells it to, in its own pane:

```bash
sldev ls --json                    # its own pane: allowSpawn 3, spawned 0
start=$(git rev-parse HEAD)
w1=$(sldev new --print --kind build --agent claude --worktree conduct/users-api \
  --criteria "GET /users takes ?page and ?per_page" --criteria "npm test passes" \
  "Add pagination to GET /users in src/api/users.ts … Commit your work on this branch when it is done.")
w2=$(sldev new --print --kind build --agent codex --worktree conduct/users-ui …)
sldev wait "$w1" --for done --timeout 300   # "sldev: timed out" and exit 1: still going, wait again
sldev ls --json                    # status, report, worktree.path and worktree.branch of each
sldev read "$w1" --lines 120
git merge --no-ff conduct/users-api -m "Merge conduct/users-api: paginate GET /users"
git merge --no-ff conduct/users-ui  -m "Merge conduct/users-ui: paged users table"
npm test
r=$(sldev new --print --kind review --agent codex --worktree conduct/users-review \
  "Review the changes from $start to HEAD (git diff $start..HEAD) …")   # the third place, optional
sldev wait "$r" --for done --timeout 300 && sldev read "$r" --lines 200
```

Its final reply is the report for you:

```
Branch conduct/users: 2 merges, 1 fix after review (git log --oneline 3f2a1c0..HEAD).
- pane 4, claude, conduct/users-api: ?page/?per_page on GET /users, tests added. Merged.
- pane 5, codex, conduct/users-ui: the table pages through the API. Merged.
- pane 6, codex, review: an off-by-one on the last page (fixed in 9b1e2d4); docs still list the old response.
npm test passes after each merge. The docs part I did myself (7c4d0a1). Left: nothing known.
Nothing was pushed; the branch is ready for your review.
```

`sldev ls` shows the workers under the conductor (`└`). Review its branch in your editor (`sldev open <pane> --diff`),
or have a second agent go over it with `sldev review <pane> --agent <id>`, which only works from your own terminal.
When you're done, `sldev clean` removes the finished panes and their worktrees. The limits are the guard's above: the
workers can't start agents and can't push, and `review`, `stop` and the TUI are refused from inside a pane.

### After an upgrade

The daemon from the sldev you had before may still be running (for 0.4 and older, in the app's folder; see
[Moving from sldev 0.4](#moving-from-sldev-04)). `sldev` checks its version: one with nothing
running in it is replaced on the spot; one still running agents is left alone (stopping it would stop them), and
`sldev` says so. Let them finish, then `sldev stop` and `sldev` again.

If a key does nothing, start `sldev` with `SLDEV_DEBUG_KEYS=<file>` set: each chunk the terminal sends is logged
there (with the tab in front), which shows how your terminal encodes it. Windows Terminal's win32-input-mode
(`ESC[66;48;2;1;8;1_` for Ctrl-b) is understood.

`sldev help` lists everything. `SKILL.md` teaches an agent to use sldev itself, so one agent can hand
work to another.

## Data folder and config

The CLI keeps its own folder: `~/.config/sldev` on Linux (`$XDG_CONFIG_HOME/sldev` when that is set),
`~/Library/Application Support/sldev` on macOS, `%APPDATA%\sldev` on Windows; `SLDEV_DATA_DIR` overrides it.
Its config, user mission kinds (`missions/`), the project context index (`context/`) and the daemon's runtime
files (socket, `daemon.log`, `sessions.json`, hook relay, MCP script) all live there. It shares code with the sldev-io app, not
state: it never reads the app's settings, and the two can run at the same time without answering each other's
agents. The one time it looks at the app's folder is `sldev clean --orphans`, which reads the app's missions,
runs and automations (read only) so it never removes a worktree the app uses (`SLDEV_APP_DATA_DIR` points it
elsewhere). Both use the project's `.sldev/` rules, memory and context; the CLI's project mission kinds and
briefs are in `.sldev-cli/` (see [Briefs](#briefs)).

`sldev config` prints where `config.json` is and the values in effect. Edit the file by hand; the daemon reads
it when it starts (`sldev stop`, then `sldev`). A missing file, bad JSON or a wrong value means that key's
default, never an error.

```json
{
  "editor": "zed",
  "customAgents": [
    { "id": "aider", "name": "Aider", "command": "aider --message {prompt}", "printCommand": "aider --yes-always --message {prompt}" }
  ],
  "failoverOrder": ["codex", "gemini"],
  "failoverAuto": true,
  "unattendedModes": { "claude": "acceptEdits", "codex": "" }
}
```

| Key | Default | Means |
| --- | --- | --- |
| `editor` | `null` | the editor `sldev open` and Ctrl-b e use (`cursor`, `vscode`, `windsurf`, `zed`, `sublime`, `idea`, `nvim`…); `null`: the first one found. `--editor` wins |
| `customAgents` | `[]` | agent CLIs of your own: `id`, `name`, `command` (`{prompt}` `{model}` `{name}` are filled in; the prompt is appended when `{prompt}` is missing), optional `printCommand` (for `--print`) and `resumeCommand` |
| `failoverOrder` | `[]` | agents to continue on, in order, when one stops at its usage limit |
| `failoverAuto` | `false` | use `failoverOrder` for every new pane; otherwise only `--failover` sets one |
| `unattendedModes` | `{}` | permission mode per agent id for `--print` panes; a missing agent gets its recommended one, `""` the agent's own default |

### Moving from sldev 0.4

sldev 0.4 and older ran inside the app's folder (`~/.config/sldev-io/cli`). Mission kinds and config don't
move over by themselves: copy `~/.config/sldev-io/missions/*.md` to `~/.config/sldev/missions/` and set your
editor and custom agents in `config.json` again. A daemon an older sldev left running in the old folder is
still found: if it runs agents, sldev keeps using it and says it will move once they're done; with nothing
running, it is stopped and the new one starts in the CLI's own folder.

## Development

The CLI lives in `cli/` of the sldev-io repo and imports only `src/shared/` and the Electron-free
modules of `src/main/` (pty, launch, hooks, mcp, git, rules, memory, context, missionKinds, sldevSkills).

```bash
npm run cli:build            # → cli/dist/sldev.mjs
node cli/dist/sldev.mjs help
npx vitest run cli/test      # daemon, TUI and tracker tests, against the e2e fake CLIs
```
