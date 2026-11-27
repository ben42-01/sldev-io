import { parse } from 'yaml'
import { STORY_SHAPE, parseStories, type StoryDraft } from './board'
import { parseEval } from './evals'
import { parseRecipe } from './factory'

/**
 * sldev's own skills: plain SKILL.md folders that teach any agent to draft sldev things (a mission, board
 * stories, a factory recipe, an eval) as files. They only ever create drafts: missions and stories go to
 * `.sldev/drafts/`, which the app reads into Saved missions and the board's Proposed column, and recipes and
 * evals are files the app already lists. Nothing an agent writes here starts on its own; a person launches it.
 */

/** bumped when a skill's text changes, so projects with an older copy are offered the update */
export const SKILLS_VERSION = 6

export const DRAFTS_DIR = '.sldev/drafts'
/** where each skill is installed in a project: Claude Code reads .claude/skills, most other agents .agents/skills */
export const SKILL_DIRS = ['.claude/skills', '.agents/skills']

export interface SldevSkill {
  name: string
  /** what the app shows next to it */
  label: string
  description: string
  body: string
}

const ROOT_LINE =
  'Write it at the project root (the git top level). If you are in a git worktree, use the main checkout instead: the parent of `git rev-parse --path-format=absolute --git-common-dir`. Create the folder if it is missing.'

const AGENT_IDS = 'claude, codex, cursor, copilot, opencode or gemini'

const YAML_RULE =
  'put any value that contains `: ` or ` #`, or starts with `[ { * & ! | > \' " % @` or a backtick, in double quotes (`title: "Fix: the parser"`)'
const JSON_RULE = 'it must be valid JSON: double quotes, no trailing commas, quotes and newlines inside strings written as `\\"` and `\\n`'

/**
 * The step every skill ends with. The app reads a file once and sets one it can't read aside, so an agent
 * that reports "done" without checking leaves a draft the user never sees.
 */
const checkStep = (heading: string, rule: string, intro = "The app reads the file once, and sets aside one it can't read: the user never sees it."): string => `${heading}

${intro} So before you say it's done, check it the way sldev-io reads it:

- With the sldev tools: call \`sldev_check\` with the file's path.
- Otherwise, if the \`sldev\` command is installed: run \`sldev skills check <file>\`.
- Otherwise read the file back yourself: ${rule}.

Fix what the check reports and check again. Say it's done only once it passes; if you couldn't check it, say that.`

export const SLDEV_SKILLS: SldevSkill[] = [
  {
    name: 'sldev-mission',
    label: 'Draft a mission',
    description:
      'Draft a mission for sldev-io: a brief, acceptance criteria, a kind and optionally an agent, saved as a draft the user launches from the app. Use when asked to write up, plan or queue a task for an agent, "make this a mission", or prepare work for later. It never starts the work.',
    body: `# Draft an sldev mission

sldev-io turns the file you write into a saved mission in its Missions list. A person reads it there and presses Launch. Don't launch anything and don't do the work yourself: your job is a brief another agent can carry out without asking questions.

## 1. Understand the task

Read the code it touches first, so the brief names real files, functions and commands. Ask the user only when the goal itself is unclear.

## 2. Write the draft

One file per mission: \`${DRAFTS_DIR}/mission-<short-slug>.md\`. ${ROOT_LINE}

\`\`\`markdown
---
title: Retry failed uploads
kind: build
by: claude
criteria:
  - An upload that fails with a 5xx is retried up to 3 times, with backoff
  - A 4xx is not retried
  - npm test passes, with a test for each case
---
Uploads fail for good on the first 502 from the storage API, and users lose the file.

Add retries to \`uploadFile\` in src/api/upload.ts: up to 3 attempts for 5xx responses and network errors,
waiting 1 s, 2 s and 4 s. Keep the function's signature. Don't add a dependency for this.
\`\`\`

- **title**: imperative, under 60 characters. In double quotes when it contains a colon.
- **kind**: \`build\` (changes code; the default), \`research\` (answers a question, read-only), \`investigate\` (finds a bug's cause, no fix), \`plan\` (writes a plan, no code), \`review\` (reviews changes already made), \`freeform\` (the brief is sent exactly as written).
- **criteria**: what a reviewer checks the change against. Each one observable and checkable; sldev's review shows which are met.
- **agent**: only when the user asked for one: ${AGENT_IDS}. Leave it out for the user's default.
- **worktree**: \`false\` to work in the project folder; by default a build runs in its own git worktree.
- **by**: your own agent id (${AGENT_IDS}), so the user sees who drafted it.

## 3. A good brief

- The outcome first, and why it matters, in a sentence or two.
- Where: the files and functions to change, and existing code to reuse.
- Limits: what not to touch, no new dependencies unless needed, keep public APIs.
- How to check: the tests or commands to run.
- One mission is one change someone can review in one sitting. Split bigger work into several files, or use the sldev-stories skill when the parts depend on each other.

${checkStep('## 4. Check it', `the part between the \`---\` lines is YAML: ${YAML_RULE}, and the brief under it is not empty`)}

## 5. Finish

Say in one line what you drafted and that it is in sldev-io under Missions, ready to launch. The app reads the file (now if it is open, otherwise when it next opens) and removes it from the drafts folder.
`
  },
  {
    name: 'sldev-stories',
    label: 'Write board stories',
    description:
      "Write user stories for sldev-io's work board: well-defined cards with acceptance criteria and dependencies, filed into the Proposed column for a person to approve. Use when asked to break a feature or epic into stories, tickets or tasks, or to plan work for the board.",
    body: `# Write stories for the sldev board

Stories you write land in the board's **Proposed** column. A person reads them, edits them if needed and approves them into Agent ready, where agents pick them up. Don't start any of the work yourself.

## 1. Understand the feature

Read the code it touches and what the board already has, so you don't file work that is done or already planned. Ask the user only when the goal itself is unclear.

## 2. Shape each story

${STORY_SHAPE}

Keep it to what was asked: at most about 12 stories, and no "nice to have" work nobody asked for.

## 3. File them

- **With the sldev tools** (\`sldev_board_add\` is available): call it once per story, in order, so \`after\` can name stories you filed earlier.
- **Otherwise** write them all to \`${DRAFTS_DIR}/stories-<short-slug>.json\`. ${ROOT_LINE}

\`\`\`json
{
  "by": "claude",
  "stories": [
    {
      "title": "Store login attempts per IP",
      "details": "**Why** …\\n\\n**What to do** …\\n\\n**Acceptance criteria**\\n- [ ] …\\n\\n**How to check** …",
      "labels": ["api"],
      "priority": "high"
    },
    {
      "title": "Rate-limit /api/login",
      "details": "…",
      "labels": ["api", "feature"],
      "priority": "normal",
      "after": ["Store login attempts per IP"]
    }
  ]
}
\`\`\`

\`by\` is your own agent id (${AGENT_IDS}). The app adds the stories to Proposed (now if it is open, otherwise when it next opens) and removes the file.

${checkStep('## 4. Check the file', `${JSON_RULE}, and every story has a "title". Stories filed with \`sldev_board_add\` need no check`)}

## 5. Finish

Say in one line how many stories you wrote and that they wait in Proposed on the board.
`
  },
  {
    name: 'sldev-recipe',
    label: 'Write a factory recipe',
    description:
      "Write a Software Factory recipe for sldev-io: a YAML pipeline of agent, command and pull-request stages that the user runs from the app's Factory. Use when asked for a workflow, pipeline or process an agent team should follow (spec → build → test → review → PR), or to automate a repeated way of working.",
    body: `# Write an sldev factory recipe

A recipe is a pipeline of stages the user starts from sldev-io's Factory. It never runs on its own: you only write the file. Save it as \`.sldev/factory/<short-slug>.yml\` at the project root, where it shows up in the Recipes library at once. A recipe with the same name as a built-in one replaces it in this project.

## Example

\`\`\`yaml
name: Feature
description: Spec, build, check, review, pull request. You approve the spec and the review.
stages:
  - id: spec
    prompt: |
      Write a short spec for this change: {intent}
      Save it to {out}. Don't change any code.
    gate: approve
  - id: build
    prompt: |
      Implement the spec in {spec.out}.
      Commit your work when the checks pass.
  - id: verify
    run: [typecheck?, lint?, test?]
    onFail: { retry: build, max: 2 }
  - id: review
    agent: codex
    prompt: |
      Review the changes on this branch against the spec in {spec.out}.
      Write your findings to {out}.
    gate: approve
  - id: pr
    pr:
      title: "{intent}"
      body: "{spec.out}"
\`\`\`

## Fields

Recipe: \`name\` (required), \`description\` (one line), \`setup\` (command that prepares a new worktree, \`none\` to skip; detected from the lockfile by default), \`stages\` (required).

Each stage is **exactly one** of:
- an agent stage: \`prompt\`, optionally \`agent\` (a profile name from \`.sldev/agents/*.md\`, a CLI id: ${AGENT_IDS}, \`Profile@cli\`, or a list for a bake-off; left out = the user's default agent), or \`skill\` (a skill name; the prompt becomes its arguments)
- a run stage: \`run\`, a command, a package script name (\`test\`; \`test?\` = skip when the project has none) or a list of them
- a PR stage: \`pr: { title, body }\`, both optional. It only opens the pull request when the user clicks.

Per stage: \`id\` (letters, digits, \`-\`, \`_\`; unique), \`needs\` (stage ids to wait for; default the stage above; several run in parallel and are merged here; each must be defined above), \`gate: approve\` (wait for the user after it), \`onFail: { retry: <stage above>, max: 1–10 }\` (on a run stage), \`maxDiff\` (ask for approval past this many changed lines), \`interactive: true\` (a normal session the user types into), \`model\`, \`effort\`, \`mode\` (in that CLI's own values).

Placeholders in prompts and the PR: \`{intent}\` (what the user typed when starting the run), \`{out}\` (this stage's output file), \`{<stage>.out}\` (another stage's output file), \`{base}\` (the branch the run started from), \`{log}\` (on a retry, the failure that caused it).

## Good recipes

- Hand-offs between stages are files: a stage writes \`{out}\`, a later one reads \`{stage.out}\`.
- Put a check (\`run\`) after every stage that changes code, with \`onFail\` back to it.
- Work can land on \`{base}\` while the run works. Tell the last stage that changes code to finish by running \`git fetch\`, merging \`{base}\` (or its upstream, if that is newer), resolving conflicts and committing, so the check after it tests what the pull request will merge. Never push from a stage: the pr stage does that on the user's click.
- Gate the steps a person should see (the spec, the review); not every stage.
- Use the project's own scripts, read from package.json, the Makefile or whatever the project uses.

${checkStep('## Check it', `it is YAML, so ${YAML_RULE}; each stage is exactly one kind, and every \`needs\`/\`retry\` names a stage above it`)}

## Finish

Say in one line that the recipe is in sldev-io under Factory → Recipes.
`
  },
  {
    name: 'sldev-eval',
    label: 'Write an eval',
    description:
      'Write an eval for sldev-io: a task with checks that tells which agent (or prompt) does best on this project, run from Mission Control → Evals. Use when asked to compare or benchmark agents, models or prompts on real work, or to turn a past bug or task into a repeatable test.',
    body: `# Write an sldev eval

An eval is one task given to several agents, each in its own git worktree, with checks that tell a good result from a bad one. The user runs it from sldev-io (Mission Control → Evals); you only write the file. Save it as \`.sldev/evals/<short-slug>.yml\` at the project root, where it shows up at once.

## Example

\`\`\`yaml
name: "Fix the off-by-one in pagination"
description: Can the agent find a small bug from a report and prove the fix with a test?
brief: |
  The last page of /api/items is missing its final item when the total is a multiple of the page size.
  Fix it and add a test that fails without the fix.
base: 3f2c1ab       # a commit from before the fix, so there is something to do
role: Implementer   # optional: the profile this measures, so a Lead's "auto" routes that role by it
timeout: 20         # minutes
checks:
  - run: npm test                       # must exit 0
  - run: node scripts/check-pages.js
    expect: ok                          # and print this
  - diff: 80                            # at most this many changed lines
  - judge: The fix is in the pagination code, not a special case in the route, and the new test covers the bug.
\`\`\`

## Fields

- \`name\`, \`brief\` (required): the brief is exactly what the agent is told, as you'd give it to a person.
- \`checks\` (required, at least one): \`run\` (a command that must exit 0, with optional \`expect\`: text the output must contain), \`diff\` (the most changed lines allowed), \`judge\` (a rubric another agent grades the change against).
- \`role\`: the name of the profile (\`.sldev/agents\`) this eval measures, e.g. Reviewer or Implementer. A Lead that delegates "auto" work in that role picks the best agent on these evals first. Leave it out for a general eval.
- \`base\`: the branch or commit to start from (default: HEAD when the run starts). \`setup\`: the dependency install (detected by default). \`timeout\` in minutes (default 20).

## Good evals

- The task is real and of this project: a bug that was fixed, a feature that was built. Pick a \`base\` from before it, so the checks fail there and pass only when the work is done.
- At least one \`run\` check that can't pass by accident (a test of the behaviour, not just "it builds").
- A \`diff\` limit catches agents that rewrite too much; a \`judge\` catches what commands can't (the right place, the right approach).

${checkStep('## Check it', `it is YAML, so ${YAML_RULE}; \`name\`, \`brief\` and at least one check are there`)}

## Finish

Say in one line that the eval is in sldev-io under Mission Control → Evals, ready to run on the agents the user picks.
`
  },
  {
    name: 'sldev-new-project',
    label: 'Set up a new project',
    description:
      "Set up a brand-new project in an empty folder with the stack's own generator and sldev's baseline: README, .gitignore, LICENSE, one build and one test command with a sample test, a GitHub Actions CI workflow, .sldev/rules.md and a first git commit. Use when asked to start, scaffold, bootstrap or create a new project, app, library or repository from scratch. It never creates a remote or pushes.",
    body: `# Set up a new project

The folder you are in is empty and becomes a new project: set it up so it builds, tests and runs CI from its first commit. It may already hold sldev's own \`.claude/\`, \`.agents/\` and \`.sldev/\` folders; keep them.

**Never create a remote, never push, never publish anything** (no \`gh repo create\`, no \`git remote add\`, no \`git push\`, no package publish). The person creates the GitHub repository with one click in sldev-io (**Create repository on GitHub…** on the mission's card) when they're ready.

## 1. Settle what to build

- **Stack**: the one the description names. If it names none, pick the most common choice for that kind of project and say which in your summary.
- **Name**: the one you were given. Otherwise suggest a short kebab-case repository name (\`weather-cli\`, \`invoice-api\`). Work in this folder as it is: don't make a subfolder for the project.
- **License**: the one the description names. Otherwise ask, offering Apache-2.0 (the default) or MIT; when nobody can answer (you run unattended), use Apache-2.0.

## 2. Generate with the stack's own tool

Use the stack's official generator, never a hand-written copy of what it makes:

| Stack | Generator |
| --- | --- |
| Node / TypeScript | \`npm create vite@latest\`, \`npm init -y\` |
| Rust | \`cargo init\` |
| Go | \`go mod init <module>\` |
| .NET | \`dotnet new <template>\` |
| Java / Kotlin | \`gradle init\` (or Maven's archetype) |
| Python | \`uv init\` |

- Read the generator's \`--help\` before you run it, and look up current versions (\`npm view <package> version\`, the toolchain's own \`--version\`, its release page) instead of versions from memory.
- Use its non-interactive flags. A generator that refuses a folder that isn't empty: generate into a temporary subfolder, move its files up, and remove the subfolder.
- If the toolchain isn't installed, stop and say so. Don't install toolchains system-wide without asking.

## 3. The baseline every project gets

- \`README.md\`: what it is, and how to build, test and run it.
- \`.gitignore\` for the stack, plus \`.sldev/runs/\` and \`.sldev/drafts/\`.
- \`LICENSE\`: the license's full text, with this year and the name from \`git config user.name\`.
- **One build command and one test command**, with one small sample test that passes. Prefer the stack's own (\`cargo test\`, \`go test ./...\`, \`npm test\`).
- \`.github/workflows/ci.yml\`: on push and pull request, set up the toolchain with its official setup action (current major version), install dependencies, run the build and the test command.
- \`.sldev/rules.md\`: rules for agents working here: the stack, the build and test commands, the layout, conventions. sldev-io copies it into AGENTS.md, CLAUDE.md and the other agents' files.
- \`git init -b main\`, then one first commit of everything: \`Initial project setup\`.

## 4. Check it

Build and tests must pass: run the build command, then the test command, from the project folder. Fix what fails, run them again, and commit the fixes (amend the first commit while it is the only one). Don't report a project whose checks you haven't seen pass.

## 5. Write the result

\`.sldev/runs/new-project.json\` (git-ignored), which sldev-io shows when you finish:

\`\`\`json
{
  "name": "weather-cli",
  "stack": "Rust (cargo)",
  "build": "cargo build",
  "test": "cargo test",
  "license": "Apache-2.0",
  "checks": "passed",
  "by": "claude"
}
\`\`\`

\`name\` is the repository name (kebab-case), \`build\` and \`test\` the exact commands, run from the project folder. \`checks\` is \`"passed"\` only when you saw both pass in step 4, else \`"failed"\`: sldev-io offers to create the GitHub repository only for a project whose checks passed. \`by\` is your own agent id (${AGENT_IDS}).

${checkStep('Then check the result file.', `${JSON_RULE}, and "name", "stack", "build" and "test" are non-empty strings`, 'sldev-io reads the file to show the project; one it can\'t read only says so.')}

## 6. Finish

Say in a few lines: the name, the stack, the build and test commands and that they pass, and that nothing was pushed: there is no remote yet. sldev-io offers **Create repository on GitHub…** on the card once the checks passed.
`
  }
]

/**
 * A set of skills installed and versioned together: the app's (below) or the CLI's (cli/src/skills.ts). The
 * install mechanics in src/main/sldevSkills.ts take one, so each side ships only its own.
 */
export interface SkillSet {
  skills: SldevSkill[]
  /** bumped when one of its skills' text changes */
  version: number
  /** installing also prepares the app's drafts inbox (`.sldev/drafts`) */
  drafts?: boolean
}

export const APP_SKILLS: SkillSet = { skills: SLDEV_SKILLS, version: SKILLS_VERSION, drafts: true }

const MARK = 'sldev-skill'

/** The SKILL.md as written into a project. */
export function skillText(s: SldevSkill, version = SKILLS_VERSION): string {
  return `---\nname: ${s.name}\ndescription: ${JSON.stringify(s.description)}\nmetadata:\n  ${MARK}: "${version}"\n---\n\n${s.body.trim()}\n`
}

/** the version an installed copy says it is; null when it isn't one of ours */
export function skillVersionOf(text: string): number | null {
  const m = new RegExp(`^\\s*${MARK}:\\s*"?(\\d+)"?\\s*$`, 'm').exec(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '')
  return m ? Number(m[1]) : null
}

export type SkillCopyState = 'missing' | 'current' | 'outdated' | 'edited' | 'foreign'

export interface SkillState {
  name: string
  label: string
  /** the worst of its copies: missing anywhere is missing, then outdated, then edited by hand */
  state: SkillCopyState
}

export interface DraftFile {
  name: string
  text: string
}

/** An installed copy against this version's: outdated copies are replaced, hand-edited and foreign ones are kept. */
export function copyState(s: SldevSkill, text: string | null, version = SKILLS_VERSION): SkillCopyState {
  if (text === null) return 'missing'
  if (text.replace(/\r\n/g, '\n') === skillText(s, version)) return 'current'
  const v = skillVersionOf(text)
  if (v === null) return 'foreign'
  return v < version ? 'outdated' : 'edited'
}

// ── drafts an agent left in .sldev/drafts ─────────────────────────────

export const MISSION_KINDS_DRAFTABLE = ['build', 'research', 'investigate', 'plan', 'review', 'freeform']

export interface MissionDraft {
  title?: string
  brief: string
  criteria?: string
  kind: string
  agent?: string
  worktree?: boolean
  by?: string
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined)

const unquote = (v: string): string => {
  const t = v.trim()
  return t.length > 1 && (t[0] === '"' || t[0] === "'") && t.endsWith(t[0]) ? t.slice(1, -1) : t
}

/**
 * Front matter read line by line, for when it isn't valid YAML: agents write `title: Fix: the parser` or
 * `title: [WIP] …` unquoted. Each `key: value` takes the rest of its line; a key with nothing after it starts
 * a `- item` list. Null when a line fits neither, so a truly broken header still fails.
 */
function looseFrontMatter(src: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  let list: string[] | null = null
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item && list) {
      list.push(unquote(item[1]))
      continue
    }
    const kv = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line)
    if (!kv) return null
    const v = (kv[2] ?? '').trim()
    if (!v) out[kv[1]] = list = []
    else {
      list = null
      out[kv[1]] = v === 'true' ? true : v === 'false' ? false : unquote(v)
    }
  }
  return out
}

/** a criterion as YAML read it: `- Retries: up to 3` comes back as a one-key mapping */
const criterion = (c: unknown): string =>
  c && typeof c === 'object' && !Array.isArray(c)
    ? Object.entries(c as Record<string, unknown>)
        .map(([k, v]) => (v === null || v === undefined ? k : `${k}: ${String(v)}`))
        .join(', ')
    : String(c ?? '')

/**
 * A mission-*.md draft: YAML front matter (title, kind, criteria, agent, worktree, by) and the brief. Front
 * matter that isn't valid YAML is read line by line instead (`warning` says so), so an unquoted colon in a
 * title doesn't lose the draft.
 */
export function parseMissionDraft(src: string, kinds: string[] = MISSION_KINDS_DRAFTABLE): { draft?: MissionDraft; error?: string; warning?: string; unknownKind?: string } {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(src)
  let fm: Record<string, unknown> = {}
  let warning: string | undefined
  if (m) {
    try {
      const v = parse(m[1]) as unknown
      if (v && typeof v === 'object' && !Array.isArray(v)) fm = v as Record<string, unknown>
    } catch (e) {
      const why = (e as Error).message.split('\n')[0]
      const loose = looseFrontMatter(m[1])
      if (!loose) return { error: `The front matter isn't valid YAML: ${why}` }
      fm = loose
      warning = `The front matter isn't valid YAML (${why}), so it was read line by line. Put values that contain ": " or start with [ { * & ! | > ' " % @ in double quotes.`
    }
  }
  const brief = (m ? m[2] : src).trim()
  if (!brief) return { error: 'The brief is empty: write it under the front matter' }
  const crit = Array.isArray(fm.criteria) ? fm.criteria.map((c) => criterion(c).trim()).filter(Boolean) : text(fm.criteria)?.split('\n').filter((l) => l.trim()) ?? []
  const kind = text(fm.kind)?.toLowerCase()
  if (kind && !kinds.includes(kind)) warning = [warning, `Unknown kind "${kind}": it becomes build. Known: ${kinds.join(', ')}.`].filter(Boolean).join(' ')
  return {
    ...(warning ? { warning } : {}),
    // the app makes it a build; the CLI's briefs refuse it
    ...(kind && !kinds.includes(kind) ? { unknownKind: kind } : {}),
    draft: {
      title: text(fm.title)?.slice(0, 100),
      brief,
      criteria: crit.length ? crit.map((c) => (/^\s*(?:[-*+]|\d+[.)])\s/.test(c) ? c.trim() : `- ${c}`)).join('\n') : undefined,
      kind: kind && kinds.includes(kind) ? kind : 'build',
      agent: text(fm.agent)?.toLowerCase(),
      worktree: typeof fm.worktree === 'boolean' ? fm.worktree : undefined,
      by: text(fm.by)?.toLowerCase()
    }
  }
}

/** A stories-*.json draft: {by, stories: […]} or just the array. */
export function parseStoriesDraft(src: string): { stories: StoryDraft[]; by?: string } {
  try {
    const v = JSON.parse(src) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>
      return { stories: Array.isArray(o.stories) ? parseStories(JSON.stringify(o.stories)) : [], by: text(o.by)?.toLowerCase() }
    }
  } catch {
    // a bare array or a ```stories block: parseStories reads those
  }
  return { stories: parseStories(src) }
}

/** what kind of draft a file in .sldev/drafts is, by its name */
export function draftKind(name: string): 'mission' | 'stories' | null {
  if (/^mission[^/\\]*\.md$/i.test(name)) return 'mission'
  if (/^stories[^/\\]*\.json$/i.test(name)) return 'stories'
  return null
}

// ── the result a new-project mission leaves ───────────────────────────

/** where the sldev-new-project skill writes what it set up, relative to the project folder */
export const NEW_PROJECT_RESULT = '.sldev/runs/new-project.json'

export interface NewProjectResult {
  name: string
  stack: string
  build: string
  test: string
  license?: string
  by?: string
  /** the agent saw the build and the tests pass ("passed"), or couldn't make them ("failed"); unset: it didn't say */
  checks?: 'passed' | 'failed'
}

const checksOf = (v: unknown): 'passed' | 'failed' | undefined => {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return t === 'passed' || t === 'failed' ? t : undefined
}

/** The result file of a new-project mission; `error` says what's wrong with it in a line. */
export function parseNewProjectResult(src: string): { result?: NewProjectResult; error?: string; warning?: string } {
  let v: unknown
  try {
    v = JSON.parse(src)
  } catch (e) {
    return { error: `Not valid JSON: ${(e as Error).message}. Escape quotes and newlines inside strings (\\" and \\n).` }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'The file needs one object: {"name": "…", "stack": "…", "build": "…", "test": "…"}' }
  const o = v as Record<string, unknown>
  const missing = (['name', 'stack', 'build', 'test'] as const).filter((k) => !text(o[k]))
  if (missing.length) return { error: `Missing ${missing.map((k) => `"${k}"`).join(', ')}: each must be a non-empty string.` }
  const name = text(o.name)!
  return {
    result: { name, stack: text(o.stack)!, build: text(o.build)!, test: text(o.test)!, license: text(o.license), by: text(o.by)?.toLowerCase(), checks: checksOf(o.checks) },
    ...(/^[a-z0-9]+(?:[-._][a-z0-9]+)*$/.test(name) ? {} : { warning: `"${name}" isn't a kebab-case repository name (e.g. weather-cli).` })
  }
}

// ── checking a file an sldev skill wrote ──────────────────────────────

export type SkillFileKind = 'mission' | 'stories' | 'recipe' | 'eval' | 'new-project'

/** Which of the skills' files `path` is, from where it sits: a draft by its name, a recipe or eval by its folder. */
export function skillFileKind(path: string): SkillFileKind | null {
  const p = path.replace(/\\/g, '/')
  if (/(^|\/)\.sldev\/factory\/[^/]+\.ya?ml$/i.test(p)) return 'recipe'
  if (/(^|\/)\.sldev\/evals\/[^/]+\.ya?ml$/i.test(p)) return 'eval'
  if (/(^|\/)\.sldev\/runs\/new-project\.json$/i.test(p)) return 'new-project'
  if (/(^|\/)\.sldev\/drafts\/[^/]+$/i.test(p)) return draftKind(p.split('/').pop()!)
  return null
}

export type SkillFileCheck = { ok: true; kind: SkillFileKind; summary: string; warning?: string } | { ok: false; kind: SkillFileKind | null; error: string }

/**
 * Reads a file an agent wrote with an sldev skill the way the app will, so the agent can fix it before it
 * says it's done (sldev_check, `sldev skills check`). The app reads drafts once and sets bad ones aside, so a
 * mistake found later is a draft the user never sees.
 */
export function checkSkillFile(path: string, src: string): SkillFileCheck {
  const kind = skillFileKind(path)
  if (!kind)
    return {
      ok: false,
      kind,
      error: `sldev-io doesn't read ${path}. Missions go to ${DRAFTS_DIR}/mission-<slug>.md, stories to ${DRAFTS_DIR}/stories-<slug>.json, recipes to .sldev/factory/<slug>.yml, evals to .sldev/evals/<slug>.yml and a new project's result to ${NEW_PROJECT_RESULT}, at the project root.`
    }
  if (kind === 'mission') {
    const r = parseMissionDraft(src)
    if (!r.draft) return { ok: false, kind, error: r.error! }
    const d = r.draft
    const crit = d.criteria ? d.criteria.split('\n').length : 0
    return { ok: true, kind, summary: `A ${d.kind} mission: "${d.title ?? d.brief.split('\n')[0].slice(0, 60)}", ${crit} criteria.`, ...(r.warning ? { warning: r.warning } : {}) }
  }
  if (kind === 'stories') {
    const t = src.trim()
    let listed: number | undefined
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        const v = JSON.parse(t) as unknown
        const arr = Array.isArray(v) ? v : (v as { stories?: unknown })?.stories
        if (!Array.isArray(arr)) return { ok: false, kind, error: 'The file needs a "stories" array: {"by": "…", "stories": [{"title": "…", "details": "…"}]}' }
        listed = arr.length
      } catch (e) {
        return { ok: false, kind, error: `Not valid JSON: ${(e as Error).message}. Escape quotes and newlines inside strings (\\" and \\n).` }
      }
    }
    const { stories } = parseStoriesDraft(src)
    if (!stories.length) return { ok: false, kind, error: 'No stories found: each story needs at least a "title".' }
    const dropped = listed !== undefined ? listed - stories.length : 0
    return {
      ok: true,
      kind,
      summary: `${stories.length} ${stories.length === 1 ? 'story' : 'stories'}: ${stories.map((st) => st.title).join('; ').slice(0, 300)}`,
      ...(dropped > 0 ? { warning: `${dropped} of the ${listed} entries were skipped: each story needs a "title".` } : {})
    }
  }
  if (kind === 'new-project') {
    const r = parseNewProjectResult(src)
    if (!r.result) return { ok: false, kind, error: r.error! }
    const n = r.result
    return { ok: true, kind, summary: `The project "${n.name}" (${n.stack}): build \`${n.build}\`, test \`${n.test}\`.`, ...(r.warning ? { warning: r.warning } : {}) }
  }
  if (kind === 'recipe') {
    const r = parseRecipe(src, path)
    if (!r.recipe) return { ok: false, kind, error: r.error }
    return { ok: true, kind, summary: `The recipe "${r.recipe.name}": ${r.recipe.nodes.map((n) => n.id).join(' → ')}.` }
  }
  const e = parseEval(src, path)
  if (!e.spec) return { ok: false, kind, error: e.error ?? 'Not an eval' }
  return { ok: true, kind, summary: `The eval "${e.spec.name}": ${e.spec.checks.length} checks.` }
}

/** A check's result in a few lines, for an agent (the MCP tool) or a terminal (the CLI). */
export function checkText(path: string, c: SkillFileCheck): string {
  if (!c.ok) return `${path}: NOT OK. sldev-io would not take this file.\n${c.error}\nFix the file and check it again before you say it's done.`
  return `${path}: OK. ${c.summary}${c.warning ? `\nBut: ${c.warning}` : ''}`
}
