# v1 roadmap

What the paid 1.0 ships, in build order. Built on the `v1` branch (see "Branches" in
`go-to-production.md`); `master` stays the beta line and is merged into `v1` regularly.

**The story for 1.0:** the beta runs agents one mission at a time. 1.0 turns them into a
**software factory**: a repeatable pipeline from an intent to a reviewed pull request, run by any
mix of agents, with you approving the steps that matter. Every feature below either feeds the
factory or comes out of it.

Rules that hold for all of it (from `AGENTS.md`): agent-agnostic, nothing written to the user's own
agent settings, no telemetry, terminals stay real terminals, restored layouts never re-run anything.

| # | Feature | Size | Why it's in 1.0 |
|---|---|---|---|
| 1 | Agent builder | M | Factory stages need named, reusable agents ("Reviewer", "Spec writer") |
| 2 | Rules sync | S | One rules file for every agent; cheap, useful on day one |
| 3 | Software Factory | XL | The headline |
| 4 | Bake-off and cross-agent review | M | Factory stages; also standalone mission actions |
| 5 | Issue → mission / factory run | S | The natural intake for the factory |
| 6 | sldev MCP server | L | Agents report status and hand off output themselves, on every CLI |
| 7 | Launch polish | M | Tour chapters, features page, docs, e2e for all of the above |

Not in 1.0 (candidates for 1.x, in rough order): PR feedback loop (review comments re-run the
agent), cost and token tracking (only Claude reports it reliably today), project map / code graph
for agent context, project memory ("lore"), mission replay, headless `sldev run` for CI, sandboxed
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

### Recipe

A recipe is YAML (`yaml` is already a dependency), either in the repo at `.sldev/factory/<name>.yaml`
or built into the app. Stages run in order; a stage is an agent step, a command step or a gate.

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
  - id: build
    agent: [Implementer@claude, Implementer@codex]   # more than one = bake-off
    prompt: Implement {spec.out}. Commit when done.
  - id: verify
    run: [lint, test]        # names from the detected runtimes, or literal commands
    onFail: { retry: build, max: 2 }   # the failing log goes back to the build agent
  - id: review
    agent: Reviewer
    prompt: Review the diff against {spec.out}. Write findings to {out}.
    gate: approve
  - id: pr
    pr: { title: "{intent}", body: "{spec.out}\n\n{review.out}" }
```

Placeholders: `{intent}`, `{issue}`, `{out}` (this stage's output file), `{<stage>.out}`,
`{diff}` (path to the current diff), `{log}` (failing command output on a retry).

### How a run works

- A run gets **one worktree and branch** (`sldev/factory/<slug>`); every stage works there.
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
- **Pipeline panel** (dock): the run as a graph, left to right, fan-out for bake-offs. Each node
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

## 7. Launch polish

- Website: tour chapters for the Factory pipeline and a bake-off; Factory section on /features;
  pricing feature list.
- `docs/go-to-production.md`: the launch checklist gets the 1.0 feature freeze.
- e2e: `factory`, `bakeoff`, `rules`, `profiles` scenarios; screenshots reviewed.

## Build order

1. Agent builder and rules sync (foundations, independently shippable to the beta too)
2. Factory core: recipe parse, sequential runner, command stages, gates, pipeline panel
3. Factory: bake-off, retry and the verify→fix loop, built-in recipes, detection
4. Mission actions (bake-off, review with), issue intake
5. MCP server
6. Launch polish

Steps 1 and 4 are useful during the beta as well; they can land on `master` and be merged into `v1`.
