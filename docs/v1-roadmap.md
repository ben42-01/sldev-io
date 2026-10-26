# v1 roadmap

What the paid 1.0 ships, in build order. Built on the `v1` branch (see "Branches" in
`go-to-production.md`); `master` stays the beta line and is merged into `v1` regularly.

**The story for 1.0:** the beta runs agents one mission at a time. 1.0 turns them into a
**software factory**: a repeatable pipeline from an intent to a reviewed pull request, run by any
mix of agents, with you approving the steps that matter. Every feature below either feeds the
factory or comes out of it.

Rules that hold for all of it (from `AGENTS.md`): agent-agnostic, nothing written to the user's own
agent settings, no telemetry, terminals stay real terminals, restored layouts never re-run anything.

**Status (2026-10-25): everything below is built on `v1`**, with unit tests (`npm test`) and an e2e
scenario per feature (`profiles`, `rules`, `factory`, `bakeoff`, `mission-actions`, `dashboard`,
`mcp`). What remains before launch is in "Before launch" at the end.

| # | Feature | Size | Why it's in 1.0 |
|---|---|---|---|
| 1 | Agent builder | M | Factory stages need named, reusable agents ("Reviewer", "Spec writer") |
| 2 | Rules sync | S | One rules file for every agent; cheap, useful on day one |
| 3 | Software Factory | XL | The headline |
| 4 | Bake-off and cross-agent review | M | Factory stages; also standalone mission actions |
| 5 | Issue → mission / factory run | S | The natural intake for the factory |
| 6 | sldev MCP server | L | Agents report status and hand off output themselves, on every CLI |
| 7 | Usage dashboard | M | Gantt timeline of every agent, token usage, time spent waiting on you |
| 8 | Launch polish | M | Tour chapters, features page, docs, e2e for all of the above |
| 9 | PR feedback loop | S | Review comments on the factory's PR go back to an agent; the factory doesn't stop at "PR opened" |
| 10 | Run history and replay | S | Trust in an automated pipeline: see what happened when, and the graph at any moment |

Not in 1.0 (candidates for 1.x, in rough order): money cost (needs per-model price tables that go stale), project map / code graph for
agent context, project memory ("lore"), headless `sldev run` for CI, sandboxed
runs, team sharing of recipes and agents.

---

## 1. Agent builder

Create agents inside the app instead of only picking a CLI. An **agent profile** is:

- a base CLI (built-in or custom) plus model, permission mode and effort (today's `AgentOptions`)
- a **role**: Markdown instructions ("You review diffs for security issues. Never edit files.")
- optional skills to load and MCP servers to attach
- a name and icon colour, used on mission cards and factory stages

How the role reaches the agent, without touching user settings:

- every agent: the role is prepended to the prompt (`lib/agents.ts`, one helper, like `skillPrompt`)
- Claude Code additionally gets it through `--append-system-prompt`

Profiles are stored per user (`agentProfiles` store) or per project in `.sldev/agents/<name>.md`
(front matter + role body), so a team can commit them. **Export** writes the same profile as a
Claude subagent (`.claude/agents/<name>.md`) or an OpenCode agent (`.opencode/agent/<name>.md`).

Ships with starters: Implementer, Spec writer, Reviewer (read-only), Test writer, Fixer.

UI: Agents section in Settings becomes a list + editor; every agent picker (new mission, task,
skill run, factory stage) lists profiles above raw CLIs.

## 2. Rules sync

One source, `.sldev/rules.md`, generates the file each agent reads:
`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/sldev.mdc`, `.github/copilot-instructions.md`.

- First run imports whichever of those files already exist and merges them into the source.
- Each target can be switched off; generated files start with a one-line "generated from
  .sldev/rules.md" comment.
- Writing always shows a diff first. Hand-edited targets are detected (hash of what we wrote) and
  never overwritten silently.
- Lives in the Skills view as a "Rules" tab; main-process module `rules.ts`.

## 3. Software Factory

### Missions are nodes, recipes are graphs

There is one engine, not two features: a **mission is a single node**, and a factory run is a
**graph of nodes** (a DAG plus retry edges). A node is an agent step (a mission), a command step or
a gate. A node runs when everything in its `needs` is done, so independent nodes run in parallel
and a node with several `needs` waits for all of them (fan-out / fan-in). With no `needs`, a node
depends on the one above it, so simple recipes read as a plain list.

### Recipe

A recipe is YAML (`yaml` is already a dependency), either in the repo at `.sldev/factory/<name>.yaml`
or built into the app.

```yaml
name: Feature
intake: prompt            # prompt | issue
stages:
  - id: spec
    agent: Spec writer      # an agent profile, or a raw CLI id
    prompt: |
      Write a short spec for: {intent}
      Save it to {out}.
    gate: approve           # a human approves before the run continues
  - id: api
    needs: [spec]
    agent: Implementer@claude
    prompt: Implement the API part of {spec.out}. Commit when done.
  - id: ui
    needs: [spec]           # runs in parallel with api, in its own worktree
    agent: Implementer@codex
    prompt: Implement the UI part of {spec.out}. Commit when done.
  - id: verify
    needs: [api, ui]        # fan-in: branches are merged into the run branch first
    run: [lint, test]        # names from the detected runtimes, or literal commands
    onFail: { retry: [api, ui], max: 2 }   # the failing log goes back to those agents
  - id: review
    agent: Reviewer
    prompt: Review the diff against {spec.out}. Write findings to {out}.
    gate: approve
  - id: pr
    pr: { title: "{intent}", body: "{spec.out}\n\n{review.out}" }
```

An agent list on one node (`agent: [Implementer@claude, Implementer@codex]`) is a **bake-off**:
same prompt, parallel worktrees, you pick the winner.

Placeholders: `{intent}`, `{issue}`, `{out}` (this stage's output file), `{<stage>.out}`,
`{diff}` (path to the current diff), `{log}` (failing command output on a retry).

### How a run works

- A run gets **one worktree and branch** (`sldev/factory/<slug>`). Sequential nodes work there;
  parallel nodes each get a worktree branched from it and are merged back at the fan-in node (a
  merge conflict pauses the run and opens the conflict for you or an agent to resolve).
- **Agent stages** run the CLI non-interactively (`print` mode; every built-in agent supports
  it) in a normal terminal panel you can watch. The process exiting ends the stage; the exit code
  decides success. A stage can set `interactive: true` to run a normal session instead and finish
  with a **Done** button (or the MCP `sldev_done` call, see 6).
- **Hand-offs are files**: each stage writes to `.sldev/runs/<run>/<stage>.md` (git-ignored), so any
  agent can read the previous stage's output. No agent-specific protocol.
- **Command stages** run in terminals; exit code 0 = green.
- **Gates**: `approve` (button), `green` (default for commands), `maxDiff: 400` (lines changed).
- **Bake-off**: a stage with several agents forks one worktree per agent from the run's current
  commit, runs them in parallel, and shows their diffs side by side with stats and test results.
  You pick a winner; the run continues on the winner's branch and the others are removed.
- **Retry a stage** with the same or a different agent from the pipeline view.
- Runs are persisted (`factoryRuns` store). After a restart a run comes back **paused**, never
  re-running a stage on its own (layout-restore invariant).

### Recipes out of the box

- **Feature**: spec → build → verify → review → PR (above)
- **Bug fix**: reproduce (write a failing test) → fix → verify → PR
- **Fix CI**: read the failing workflow run through `gh` → fix → verify → PR
- **Bake-off**: one prompt, 2–3 agents, compare, PR the winner

**Detect**: opening the Factory on a project without recipes proposes them, with `lint`/`test`/
`build` filled in from `runtimes.ts` detection, and writes them to `.sldev/factory/` on accept.

### UI

- New activity-bar section **Factory**: recipes, active and past runs.
- **Pipeline panel** (dock): the run as a graph, left to right, with parallel branches, fan-in
  and retry edges drawn (laid out from `needs`; no graph library needed at this size). Each node
  shows agent, status, time, diff size; click to open its terminal or output file. Gates show
  Approve / Reject (reject sends a note back to the previous agent).
- Mission cards show which run and stage they belong to; desktop notifications at every gate.

### Code layout

- `src/shared/factory.ts`: recipe types, YAML parse/validate, placeholder fill (pure, unit-tested)
- `src/renderer/src/state/factory.ts`: the run state machine, built on `startMission`, terminals
  and `git.addWorktree`; no new pty plumbing
- `src/main/factory.ts`: read/write recipes and run output files
- `dock/PipelinePanel.tsx`, `components/FactoryView.tsx`
- e2e: `factory` scenario with the fake CLIs (fake agents need a print mode that writes `{out}`)

## 4. Bake-off and cross-agent review (as mission actions)

The factory machinery, exposed for one-off use:

- **New mission → "Run on several agents"**: same prompt, 2–3 agents, separate worktrees, a
  compare panel, keep one.
- **Mission → "Review with…"**: a second agent (read-only profile) reviews the mission's diff and
  writes findings next to it; "Send to the first agent" pastes them into its session.

## 5. Issue → mission / factory run

New mission and Factory both get **From issue**: lists open issues through `gh issue list`,
fills the intent with the title and body, and adds `Closes #n` to the PR body. GitHub only in 1.0
(the app already drives `gh`); Linear and Jira later.

## 6. sldev MCP server

A small stdio MCP server shipped with the app (run with Electron as node, like the hook relay),
attached per mission. It talks to the existing loopback hook server with the mission token.

Tools:

- `sldev_status(state, message)`: working / needs you / done. **Gives every agent the precise
  status Claude gets from hooks**, instead of the 5-seconds-of-quiet guess.
- `sldev_done(summary)`: finishes an interactive factory stage
- `sldev_output(markdown)`: writes the stage's output file
- `sldev_missions()`, `sldev_mission_diff(id)`: read other missions (for review and hand-off)
- `sldev_rules()`: the project rules from 2

Attaching: how each CLI takes an extra MCP server is agent-specific, so it's a new optional field
on `AgentDef` (`mcpArgs`) in `lib/agents.ts`, e.g. Claude `--mcp-config <file>`, Codex
`-c mcp_servers.sldev=…`. Agents without a per-run flag fall back to terminal tracking.
Loopback only, so no change to the privacy page; still listed there for transparency.

## 7. Usage dashboard

A **Dashboard** dock panel of widgets, per project or across all of them, for today, the week or
the month. Everything comes from data already on the machine: nothing is sent anywhere.

**Recording** (lands first, in step 1, so there is history by the time the dashboard ships):
missions get a `history: { status, at }[]` of every status change. Factory nodes are missions, so
runs get the same for free.

Widgets:

- **Timeline (Gantt)**: one row per mission, grouped by agent or by factory run; bars coloured
  by status (working / needs you / waiting / ended), so parallel work and idle gaps are visible.
  Click a bar to open the mission.
- **Waiting on you**: total and per-mission time spent in "needs you" before you answered.
  The number that shows whether running more agents is actually paying off.
- **Tokens**: input / output / cache tokens per agent, per project, per day.
- **Outcomes**: missions that ended in a PR, a merge, or were discarded; bake-off wins per agent.
- **Active now**: what is running, what is blocked on you.

**Token sources** (read locally, one reader per agent in `src/main/usage.ts`, declared on
`AgentDef` as `usage?: 'claude' | 'codex' | …`):

| Agent | Source | 1.0 |
|---|---|---|
| Claude Code | the session transcript (`transcript_path` in every hook payload) has `usage` per message | yes |
| Codex | session logs under `~/.codex/sessions/` record token counts | yes |
| OpenCode, Gemini CLI | local session storage; verify the format before committing to it | if stable |
| Cursor Agent, Copilot | nothing local found yet | shown as "not reported" |

Tokens only, no money: prices differ by plan and change, and a wrong number is worse than none.
Optional budget alerts per mission ("tell me past 2M tokens") come with it.

UI: dashboard panel built from small SVG components (bars and a timeline are easy by hand; no
chart library), opened from the activity bar and the palette.

## 8. Launch polish

- Website: tour chapters for the Factory pipeline and a bake-off; Factory section on /features;
  pricing feature list.
- `docs/go-to-production.md`: the launch checklist gets the 1.0 feature freeze.
- e2e: `factory`, `bakeoff`, `rules`, `profiles` scenarios; screenshots reviewed.

## 9. PR feedback loop

When the pr stage has opened a pull request, the run remembers it (`FactoryRun.pr`) and the pipeline
panel gets a **Review feedback** section. It reads the reviews, conversation comments and line comments
through `gh` (`gh pr view --json comments,reviews` and `gh api repos/{owner}/{repo}/pulls/<n>/comments`),
lists the ones newer than the last hand-over, and **Address N comments** starts an interactive mission
with a chosen recipe agent in the run worktree (prompt: `feedbackPrompt` in `src/shared/prFeedback.ts`,
which tells the agent to commit and not push). When it's done, **Push update** commits and pushes the
branch: like opening the PR, pushing only happens on a click. e2e: `pr-feedback` (local bare origin,
fake `gh`).

## 10. Run history and replay

Every change to a run is diffed against the previous state (`recordEvents` in `src/shared/factory.ts`,
called from `put` in `state/factory.ts`), so node status changes, retries, pauses, the PR, the
feedback hand-over and the push land in `FactoryRun.events` without each transition having to log
itself. **History** on the pipeline panel lists them with times since the start; the slider (or a
click on an event) replays the graph as it was then (`statusesAt`), read-only. Runs from before this
change have no history.

## Build order

1. Mission status history (tiny, starts collecting dashboard data), agent builder, rules sync
2. Factory core: recipe parse, graph runner (`needs`, parallel worktrees, fan-in merge), command
   nodes, gates, pipeline panel
3. Factory: bake-off, retry edges and the verify→fix loop, built-in recipes, detection
4. Mission actions (bake-off, review with), issue intake
5. Usage dashboard: timeline, waiting-on-you, tokens (Claude, Codex), outcomes
6. MCP server
7. Launch polish

Steps 1, 4 and 5 are useful during the beta as well; they can land on `master` and be merged into `v1`.

## Before launch

The e2e harness drives fake CLIs, so these were built from the CLIs' documentation and need one run
against the real tools (on a scratch repo, with a cheap model):

- [ ] **Codex MCP flag**: `codex -c 'mcp_servers.sldev={command=…,args=[…],env={…}}' exec …` starts
      the sldev server and its tools show up (the inline-table form of `-c`).
- [ ] **Codex token usage**: the session log format (`~/.codex/sessions/YYYY/MM/DD/*.jsonl`,
      `session_meta` + `token_count` events). The Claude Code transcript format is verified.
- [ ] **Claude Code `--mcp-config` inline JSON** together with `--settings` and `-p`.
- [ ] **Print mode for every built-in agent** in a factory run (`claude -p`, `codex exec`,
      `cursor-agent -p`, `copilot -p --allow-all-tools`, `opencode run`, `gemini -p`): each exits
      when done and its exit code means success.
- [ ] A real **pr stage**: push and `gh pr create --body` on a scratch GitHub repo.
- [ ] **PR feedback**: on that PR, a review, a conversation comment and a line comment show up in
      Review feedback (the JSON field names from `gh pr view` and the REST pulls/comments API), and
      Push update lands on the PR.
- [ ] Website: Factory and bake-off chapters in the tour, the features page and the pricing list
      (on `v1`, so they go live with the launch).

Known gaps, fine for 1.0: "retry this stage with a different agent" (retry reruns the same agent),
interactive factory stages finish with Done or `sldev_done` only, OpenCode/Cursor/Copilot/Gemini get
no MCP tools (no per-run flag), token usage for Claude Code and Codex only.
