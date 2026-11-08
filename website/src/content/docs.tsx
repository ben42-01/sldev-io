import type { ReactNode } from 'react'
import { ContextGraph } from '../components/ContextGraph'

/**
 * Docs pages: /docs lists them, /docs/<id> shows one with its sections as the table of contents.
 * Keep them in step with the app: recipe fields come from src/shared/factory.ts (parseRecipe).
 */
export interface DocSection {
  id: string
  title: string
  body: ReactNode
}

export interface DocPage {
  id: string
  title: string
  summary: string
  sections: DocSection[]
}

function Code({ file, children }: { file?: string; children: string }) {
  return (
    <figure className="docs-code">
      {file && <figcaption>{file}</figcaption>}
      <pre>{children.replace(/^\n/, '').trimEnd()}</pre>
    </figure>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <aside className="docs-note">{children}</aside>
}

/** The Feature recipe as a graph: the check's retry loop is the dashed line back to build. */
function FeatureGraph() {
  const stages = [
    { id: 'spec', kind: 'agent · Spec writer', gate: true },
    { id: 'build', kind: 'agent · Implementer' },
    { id: 'verify', kind: 'run · typecheck, lint, test' },
    { id: 'review', kind: 'agent · Reviewer', gate: true },
    { id: 'pr', kind: 'pull request', gate: true }
  ]
  const w = 128
  const gap = 24
  return (
    <figure className="docs-graph">
      <svg viewBox={`0 0 ${stages.length * (w + gap) - gap} 120`} role="img" aria-label="spec, build, verify, review and pr in a row; verify loops back to build when it fails">
        {stages.map((s, i) => {
          const x = i * (w + gap)
          return (
            <g key={s.id}>
              {i > 0 && <line x1={x - gap} y1={32} x2={x} y2={32} className="edge" />}
              <rect x={x + 0.5} y={8.5} width={w - 1} height={48} rx={2} className={s.id === 'verify' ? 'node check' : 'node'} />
              <text x={x + 10} y={28} className="id">{s.id}</text>
              <text x={x + 10} y={45} className="kind">{s.kind}</text>
              {s.gate && <text x={x + w - 10} y={28} className="gate" textAnchor="end">approve</text>}
            </g>
          )
        })}
        <path d={`M ${2 * (w + gap) + w / 2} 57 C ${2 * (w + gap) + w / 2} 104, ${w + gap + w / 2} 104, ${w + gap + w / 2} 57`} className="loop" />
        <text x={(w + gap) * 1.5 + w / 2} y={112} className="kind" textAnchor="middle">onFail: retry build with the failing log</text>
      </svg>
    </figure>
  )
}

const recipes: DocPage = {
  id: 'recipes',
  title: 'Software Factory recipes',
  summary:
    'A recipe turns a one-line request into a pull request: stages run agents, checks and approvals in order, each in an isolated git worktree. This guide walks through writing one, from the smallest recipe to parallel builds, retry loops and bake-offs.',
  sections: [
    {
      id: 'what',
      title: 'What a recipe is',
      body: (
        <>
          <p>
            A recipe is a YAML file that describes a pipeline as a list of <b>stages</b>. There are three kinds:
          </p>
          <ul>
            <li>
              <b>Agent stages</b> give a prompt to a coding agent (Claude Code, Codex, Gemini CLI, Cursor, Copilot, OpenCode or your own CLI). The
              agent runs unattended and writes a short report.
            </li>
            <li>
              <b>Run stages</b> run commands, usually your checks. Exit code 0 means pass.
            </li>
            <li>
              <b>PR stages</b> push the branch and open a pull request, but only when you click.
            </li>
          </ul>
          <p>
            When you start a run, you pick a recipe and describe what you want (or pick a GitHub issue). sldev-io creates a new branch and worktree
            next to your repository, runs the stages there, commits after every stage and shows the whole run as a graph in the Pipeline panel.
            Your own checkout is never touched.
          </p>
          <FeatureGraph />
          <p>
            Five recipes ship with the app: <b>Feature</b> (above), <b>Bug fix</b>, <b>Parallel feature</b>, <b>Bake-off</b> and <b>Fix CI</b>.
            Start with those. To change one, pick it in <b>New factory run</b> and choose <b>Copy to .sldev/factory to edit it</b>: the copy
            lives in your repository and replaces the built-in one.
          </p>
        </>
      )
    },
    {
      id: 'first',
      title: 'Your first recipe',
      body: (
        <>
          <p>
            Project recipes live in <code>.sldev/factory/</code> in your repository, one <code>.yml</code> file each. Commit them and everyone on
            the team gets them. Here is the smallest useful recipe: one agent does the work, then your tests run.
          </p>
          <Code file=".sldev/factory/quick-change.yml">{`
name: Quick change
description: One agent makes the change, then the tests run.
stages:
  - id: build
    agent: Implementer
    prompt: |
      {intent}
      Commit your work when the tests pass.
  - id: test
    run: test
`}</Code>
          <p>What each line does:</p>
          <ul>
            <li>
              <code>name</code> is what you pick in <b>New factory run</b>. A project recipe with the same name as a built-in one replaces it.
            </li>
            <li>
              <code>agent: Implementer</code> is a built-in agent profile: a role that works with whichever CLI is your default agent.
            </li>
            <li>
              <code>{'{intent}'}</code> becomes what you typed when you started the run.
            </li>
            <li>
              <code>run: test</code> runs the project's <code>test</code> script (an npm script, a make or just target, and so on). You can also
              write a plain command, such as <code>run: npm test -- --run</code>.
            </li>
          </ul>
          <p>
            Save the file, open the Factory view (it reloads recipes when you open it), choose <b>New factory run</b>, pick <b>Quick change</b>,
            describe the change and press Start. A stage starts when the one above it is done, unless you say otherwise with <code>needs</code>.
          </p>
          <Note>
            Mistakes are caught before anything runs: a recipe that doesn't parse (a stage that needs one that doesn't exist, two stages with
            the same id) is listed with the reason in the Factory view, and an agent name that isn't a profile or a CLI stops the run before it
            starts.
          </Note>
        </>
      )
    },
    {
      id: 'handoffs',
      title: 'Passing work between stages',
      body: (
        <>
          <p>
            Stages hand work to each other through <b>files</b>, so any agent can read what another one wrote. Every agent stage has an output
            file, <code>.sldev/runs/&lt;run&gt;/&lt;stage&gt;.md</code> in the worktree. The folder is git-ignored, so these notes never end up
            in your commits.
          </p>
          <Code file=".sldev/factory/spec-first.yml">{`
name: Spec first
stages:
  - id: spec
    agent: Spec writer
    prompt: |
      Write a short spec for: {intent}
      Save it to {out}. Don't change any code.
    gate: approve
  - id: build
    agent: Implementer
    prompt: |
      Implement the spec in {spec.out}.
      Commit your work when the checks pass.
`}</Code>
          <ul>
            <li>
              <code>{'{out}'}</code> is this stage's own output file. If your prompt doesn't mention it, sldev-io adds "Write a short summary of
              what you did to …" for you.
            </li>
            <li>
              <code>{'{spec.out}'}</code> is the path to the <code>spec</code> stage's file. In a PR title or body it becomes the file's text
              instead, so the spec can be the PR description.
            </li>
          </ul>
          <p>
            An agent stage that ends without writing its output file <b>fails</b>, with "Ended without writing …" on the stage, so the next stage
            never starts on nothing.
          </p>
          <h3>Placeholders</h3>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Placeholder</th>
                <th>Becomes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>{'{intent}'}</code></td>
                <td>What you asked for when you started the run (or the issue's title and text)</td>
              </tr>
              <tr>
                <td><code>{'{out}'}</code></td>
                <td>This stage's output file</td>
              </tr>
              <tr>
                <td><code>{'{<stage>.out}'}</code></td>
                <td>Another stage's output file; its text in a PR title or body</td>
              </tr>
              <tr>
                <td><code>{'{base}'}</code></td>
                <td>The branch the run started from, for example <code>main</code></td>
              </tr>
              <tr>
                <td><code>{'{log}'}</code></td>
                <td>On a retry, the failure that caused it (it is also added to the prompt on its own)</td>
              </tr>
            </tbody>
          </table>
        </>
      )
    },
    {
      id: 'agents',
      title: 'Choosing agents',
      body: (
        <>
          <p>
            The <code>agent</code> field takes a profile, a CLI, or both:
          </p>
          <table className="docs-table">
            <tbody>
              <tr>
                <td><code>agent: Reviewer</code></td>
                <td>The Reviewer profile, on the CLI the profile names, or your default agent</td>
              </tr>
              <tr>
                <td><code>agent: codex</code></td>
                <td>The Codex CLI with no profile. CLI ids: <code>claude</code>, <code>codex</code>, <code>cursor</code>, <code>copilot</code>, <code>opencode</code>, <code>gemini</code>, or a custom agent's id</td>
              </tr>
              <tr>
                <td><code>agent: Reviewer@gemini</code></td>
                <td>The Reviewer profile, run on Gemini CLI</td>
              </tr>
              <tr>
                <td><code>agent: [Implementer@claude, Implementer@codex]</code></td>
                <td>A bake-off: both run the same prompt, and you keep the better result (see below)</td>
              </tr>
            </tbody>
          </table>
          <p>
            The built-in profiles are <b>Spec writer</b>, <b>Implementer</b>, <b>Reviewer</b>, <b>Test writer</b> and <b>Fixer</b>. To make your
            own, open the Agents settings and add a profile: a name, a role (instructions in Markdown) and optionally a CLI, model, permission mode
            and effort. Project profiles are saved as <code>.sldev/agents/&lt;name&gt;.md</code>, so they can be committed next to the recipes that
            use them.
          </p>
          <Code file=".sldev/agents/security-reviewer.md">{`
---
name: Security reviewer
description: Reviews a change for security problems only
agent: claude
model: opus
---
You review changes for security problems: injection, authentication and
authorization mistakes, secrets in code, unsafe deserialization.
Report each finding with the file and line, and how to fix it.
Ignore style and naming.
`}</Code>
          <p>
            Using a cross-agent review is a cheap way to catch mistakes: let one CLI build and another review, for example{' '}
            <code>agent: Implementer@claude</code> and then <code>agent: Reviewer@codex</code>.
          </p>
        </>
      )
    },
    {
      id: 'skills',
      title: 'Your own skills and specs',
      body: (
        <>
          <p>
            If you already have a skill for specs, reviews or builds, a stage can run it instead of the recipe's prompt. <code>skill</code> takes
            the skill's name; the stage prompt, if any, becomes its arguments (without one, the intent is).
          </p>
          <Code file=".sldev/factory/house.yml">{`
name: House flow
stages:
  - id: spec
    skill: our-spec          # .claude/skills, .sldev/skills, .agents/skills or ~/.claude
    gate: approve
  - id: build
    agent: Implementer
    prompt: Implement {spec.out}. Commit when done.
  - id: review
    agent: Reviewer@codex
    skill: security-review
    prompt: the changes on this branch; write findings to {out}
`}</Code>
          <p>
            Any agent can run a skill: Claude Code by its slash name, the others are pointed at its <code>SKILL.md</code>. Skills in{' '}
            <code>.sldev/skills</code> or <code>.agents/skills</code> work the same for every agent.
          </p>
          <p>
            You don't have to edit a recipe to try this. In the run form, <b>Agents and skills per stage</b> swaps the agent or skill of any stage
            for that run, and <b>Save as a project recipe</b> keeps your choices as a copy.
          </p>
          <p>
            Already have a spec? <b>Start from</b> skips the first stage and uses a file from the repository, or the result of a finished Plan
            or Research mission, as that stage's output. The run starts at the stage after it.
          </p>
        </>
      )
    },
    {
      id: 'checks',
      title: 'Checks and retry loops',
      body: (
        <>
          <p>
            A run stage takes one command or a list. A list runs in order and stops at the first failure. Each entry is either a command or the
            name of a script sldev-io found in your project (npm scripts, make and just targets, cargo, Python, Go and so on). A trailing{' '}
            <code>?</code> makes a script optional: it is skipped when the project doesn't have it. That's why the built-in recipes work in any
            project:
          </p>
          <Code>{`
  - id: verify
    run: [typecheck?, lint?, test?]
    onFail: { retry: build, max: 2 }
`}</Code>
          <p>
            <code>onFail</code> turns a failing check into a loop. The stages named in <code>retry</code> run again, with the end of the failing
            output added to their prompt, and then the check runs again. <code>max</code> is how many times it loops (1 to 10, default 2). After
            that the run stops and waits for you.
          </p>
          <p>
            <code>retry</code> can name several stages, for example <code>retry: [part-a, part-b]</code> after a parallel build. Everything after
            them runs again too.
          </p>
          <Note>
            Checks run in the stage's terminal, so you can watch them, and the full output stays there after they finish.
          </Note>
        </>
      )
    },
    {
      id: 'gates',
      title: 'Approvals and limits',
      body: (
        <>
          <p>A run only waits for you where the recipe says so:</p>
          <ul>
            <li>
              <code>gate: approve</code> on a stage: when it finishes, the stage shows <b>Approve</b> and <b>Reject</b>. Rejecting asks what
              should change, and the stage runs again with your note.
            </li>
            <li>
              <code>maxDiff: 400</code> on an agent stage: if the run has changed more than 400 lines by the end of that stage, it waits for your
              approval. This catches an agent that rewrites half the project for a small request.
            </li>
            <li>
              <b>The PR stage always waits.</b> Nothing is pushed until you click <b>Push and open PR</b>.
            </li>
          </ul>
          <Code>{`
  - id: build
    agent: Implementer
    prompt: Implement the spec in {spec.out}. Commit when done.
    maxDiff: 400
  - id: pr
    pr:
      title: "{intent}"
      body: "{spec.out}"
`}</Code>
          <p>
            A run started from a GitHub issue adds <code>Closes #&lt;number&gt;</code> to the pull request. Review comments on that PR show up
            in the Pipeline panel, and <b>Address comments</b> hands them to an agent in the same worktree. You push the update with a click.
          </p>
        </>
      )
    },
    {
      id: 'parallel',
      title: 'Parallel stages',
      body: (
        <>
          <p>
            By default each stage follows the one above it. <code>needs</code> changes that: stages that need the same stage run at the same
            time, each in its own worktree branched from the run. A stage that needs several waits for all of them, and their branches are merged
            back first.
          </p>
          <Code file=".sldev/factory/split-build.yml">{`
name: Split build
stages:
  - id: spec
    agent: Spec writer
    prompt: |
      Write a short spec for: {intent}
      Split it into "Part A" (backend) and "Part B" (frontend). Save it to {out}.
    gate: approve
  - id: backend
    needs: [spec]
    agent: Implementer@claude
    prompt: Implement Part A of {spec.out}. Only Part A. Commit when done.
  - id: frontend
    needs: [spec]
    agent: Implementer@codex
    prompt: Implement Part B of {spec.out}. Only Part B. Commit when done.
  - id: verify
    needs: [backend, frontend]
    run: [typecheck?, test?]
    onFail: { retry: [backend, frontend], max: 1 }
  - id: pr
    pr:
      title: "{intent}"
      body: "{spec.out}"
`}</Code>
          <p>
            Split the work so the parts touch different files. If both change the same lines, the merge conflicts: the run pauses and tells you
            the worktree to resolve it in. Commit the resolution, then press Resume.
          </p>
        </>
      )
    },
    {
      id: 'bakeoff',
      title: 'Bake-offs',
      body: (
        <>
          <p>
            Give a stage a list of agents and they all get the same prompt, each in its own worktree. When they finish, the stage shows every
            version with its diff and line counts. Review each diff, then <b>Keep</b> one: its branch is merged into the run and the others are
            removed.
          </p>
          <Code file=".sldev/factory/bake-off.yml">{`
name: Bake-off
stages:
  - id: build
    agent: [Implementer@claude, Implementer@codex, Implementer@gemini]
    prompt: |
      {intent}
      Commit your work when done.
  - id: verify
    run: [typecheck?, lint?, test?]
  - id: pr
    pr:
      title: "{intent}"
      body: "{build.out}"
`}</Code>
          <p>It's a good way to find out which agent suits your codebase, and for hard problems where one attempt often isn't enough.</p>
        </>
      )
    },
    {
      id: 'interactive',
      title: 'Talking to a stage',
      body: (
        <>
          <p>
            Agent stages run unattended: the agent gets its prompt, works, and exits. When you want to steer an agent while it works, make the
            stage interactive:
          </p>
          <Code>{`
  - id: design
    agent: Spec writer
    interactive: true
    prompt: Let's design {intent} together. Save the result to {out}.
`}</Code>
          <p>
            An interactive stage is a normal session in a terminal: you type into it, and you click <b>Done</b> on the stage when you're
            finished. Claude Code and Codex can also mark it done themselves.
          </p>
          <p>
            Any finished agent stage can also be continued: the speech-bubble button on the stage resumes that agent's session in a terminal, so
            you can ask a follow-up or a small fix. What it changes is committed before the next stage starts.
          </p>
        </>
      )
    },
    {
      id: 'setup',
      title: 'Setup and permissions',
      body: (
        <>
          <p>
            A new worktree only has the files git tracks: no <code>node_modules</code>, no virtualenv. Before a worktree's first stage, sldev-io
            installs dependencies once, based on your lockfile:
          </p>
          <table className="docs-table">
            <tbody>
              <tr><td><code>package-lock.json</code></td><td><code>npm ci</code></td></tr>
              <tr><td><code>pnpm-lock.yaml</code></td><td><code>pnpm install --frozen-lockfile</code></td></tr>
              <tr><td><code>yarn.lock</code></td><td><code>yarn install --frozen-lockfile</code></td></tr>
              <tr><td><code>bun.lock</code></td><td><code>bun install --frozen-lockfile</code></td></tr>
              <tr><td><code>uv.lock</code></td><td><code>uv sync</code></td></tr>
              <tr><td><code>poetry.lock</code></td><td><code>poetry install</code></td></tr>
            </tbody>
          </table>
          <p>
            Set your own with <code>setup:</code> at the top of the recipe (for example <code>setup: make deps</code> or{' '}
            <code>{'setup: cp ../.env . && npm ci'}</code>), or turn it off with <code>setup: none</code>. If setup fails, the run pauses with
            the error.
          </p>
          <p>
            Because unattended stages have nobody to approve a file edit or a command, each agent runs with a permission mode that lets it work
            on its own: Claude Code in auto mode, Codex in workspace-write, Gemini CLI auto-accepting edits. Change this per agent in{' '}
            <b>Settings → Software Factory</b>, or per stage through the profile's permission mode. Stages always run in the run's worktree, never
            in your checkout.
          </p>
        </>
      )
    },
    {
      id: 'failures',
      title: 'When a run fails',
      body: (
        <>
          <p>A failed run waits for you. On the failed stage you can:</p>
          <ul>
            <li>
              <b>Send it back</b> (on a failed check): the stages it retries run again with the failure and your note, such as "the date test
              is flaky, mock the clock", and the check gets its retries back.
            </li>
            <li>
              <b>Try again</b> (on a failed agent stage): it runs again with the failure and your note.
            </li>
            <li>
              <b>Fix it yourself</b>: the wrench opens a terminal in the stage's worktree. Fix what's wrong, then press ↻ to run the stage again.
            </li>
            <li>
              <b>Look at what happened</b>: <b>History</b> lists every stage start, retry and failure, and the slider replays the graph at any
              moment.
            </li>
          </ul>
          <p>
            Closing the app pauses running runs. Nothing runs again on its own: press <b>Resume</b> when you're back.
          </p>
        </>
      )
    },
    {
      id: 'share',
      title: 'Sharing recipes',
      body: (
        <>
          <p>
            <b>Share</b> on a recipe copies it, together with the custom agent profiles it uses, as one block of text you can paste anywhere: a
            chat, an issue or a gist. Whoever receives it chooses <b>Import recipe</b> and pastes it. The recipe is saved to their{' '}
            <code>.sldev/factory/</code> and the profiles to <code>.sldev/agents/</code>. A profile they already have by that name is kept as it
            is.
          </p>
          <p>Plain recipe YAML can be imported the same way.</p>
        </>
      )
    },
    {
      id: 'reference',
      title: 'Reference',
      body: (
        <>
          <h3>Recipe</h3>
          <table className="docs-table">
            <tbody>
              <tr><td><code>name</code></td><td>Required. Shown in the run form; a project recipe replaces a built-in one with the same name</td></tr>
              <tr><td><code>description</code></td><td>One line shown under the name</td></tr>
              <tr><td><code>setup</code></td><td>Command that prepares a new worktree; <code>none</code> to skip. Default: from the lockfile</td></tr>
              <tr><td><code>stages</code></td><td>Required. The list of stages</td></tr>
            </tbody>
          </table>
          <h3>Stage</h3>
          <table className="docs-table">
            <tbody>
              <tr><td><code>id</code></td><td>Letters, digits, <code>-</code> and <code>_</code>; unique. Default: <code>stage-1</code>, <code>stage-2</code>…</td></tr>
              <tr><td><code>agent</code> + <code>prompt</code></td><td>An agent stage. <code>agent</code>: a profile, a CLI id, <code>Profile@cli</code>, or a list for a bake-off. Leave it out and the stage runs on your default agent</td></tr>
              <tr><td><code>skill</code></td><td>Run this skill in an agent stage; the prompt becomes its arguments (default <code>{'{intent}'}</code>), <code>agent</code> defaults to your default agent</td></tr>
              <tr><td><code>run</code></td><td>A run stage: a command, a script name (<code>test</code>, <code>test?</code> = optional) or a list of them</td></tr>
              <tr><td><code>pr</code></td><td>A PR stage: <code>{'{ title, body }'}</code>, both optional (title defaults to <code>{'{intent}'}</code>)</td></tr>
              <tr><td><code>needs</code></td><td>Stage ids to wait for. Default: the stage above. Several = run in parallel and merge here</td></tr>
              <tr><td><code>gate: approve</code></td><td>Wait for Approve or Reject after the stage</td></tr>
              <tr><td><code>maxDiff</code></td><td>Ask for approval when the run's changed lines pass this number</td></tr>
              <tr><td><code>onFail</code></td><td><code>{'{ retry: <stage or list>, max: 1–10 }'}</code> on a run stage; default <code>max</code> is 2</td></tr>
              <tr><td><code>interactive: true</code></td><td>A normal session you type into; finishes with Done. The run form can switch it per stage, or for every stage</td></tr>
              <tr><td><code>model</code>, <code>effort</code>, <code>mode</code></td><td>The agent's model, reasoning effort and approval mode, in that CLI's own values (as in the mission form). Without <code>mode</code>, print-mode stages use the unattended mode from Settings</td></tr>
            </tbody>
          </table>
          <p>A stage is exactly one of agent (or skill, or just a prompt), run or pr. You don't have to write the YAML by hand: Recipes → New recipe builds it step by step, and Import takes a shared recipe or a file.</p>
        </>
      )
    }
  ]
}

const missions: DocPage = {
  id: 'missions',
  title: 'Missions, limits, memory and automations',
  summary:
    'A mission is one agent on one task. This guide covers mission kinds (research is not a build), what happens when an agent hits its usage limit, the project memory every mission starts from, and automations that start work on their own.',
  sections: [
    {
      id: 'control',
      title: 'Mission Control',
      body: (
        <>
          <p>
            <b>Mission Control</b> is a tab in the main area for all agent work, so you can keep both sidebars closed. Open it from the top
            button of the left bar, which also counts what needs you, or with <b>Open Mission Control</b> in the command palette. It has three tabs:
          </p>
          <table className="docs-table">
            <tbody>
              <tr><td><b>Missions</b></td><td>Every mission of the project, as columns (Needs you, Working, Ready, Finished), a grid of cards, or a list with one row each. Your choice is remembered.</td></tr>
              <tr><td><b>Factory runs</b></td><td>Running and finished runs; click one to open its pipeline.</td></tr>
              <tr><td><b>Usage</b></td><td>The usage dashboard: timeline, time waiting on you, tokens and outcomes.</td></tr>
            </tbody>
          </table>
          <p>
            <b>New mission</b> (<code>Ctrl+Shift+M</code>, <code>Cmd+Shift+M</code> on a Mac) and <b>New factory run</b> open as dialogs,
            so you can start work with both sidebars closed. The <b>Agents</b> tab of the right sidebar still lists your missions; its row
            button switches the cards to compact rows when you have many.
          </p>
          <p>
            The dialog asks for the agent first, then the brief. Tick other agents under <b>Also run it on</b> to run the same brief as a
            bake-off. The working folder, worktree, branch, model and effort sit under <b>Options</b>, whose summary line says what will
            happen (for example <i>project · new worktree from main · default model</i>). You can also type a brief on the start screen and
            press Enter to open the dialog with it. Each mission card names its next step: <b>Answer</b>, <b>Review 3 files</b> or{' '}
            <b>Build from this</b>.
          </p>
          <p>
            Not ready to start yet? <b>Save for later</b> in the New mission dialog keeps the brief and every setting under{' '}
            <b>Saved for later</b>, in the Agents tab and at the top of Mission Control. Click one to edit it, or <b>Launch</b> it as saved.
          </p>
          <p>
            <b>Review changes</b> opens a mission's change in a tab of its own, on the walkthrough (below), and hides both sidebars while it is
            on screen (turn that off with the button in its toolbar or in Settings → Editor). <b>All files</b> shows every file in path order,
            side by side or unified; tick <b>Viewed</b> to fold a file away. With
            VS Code, Cursor, Windsurf or a JetBrains IDE as your editor, <b>Diff in …</b> opens a file's changes in the editor's own diff view.
          </p>
        </>
      )
    },
    {
      id: 'review',
      title: 'Reviewing a change: the walkthrough',
      body: (
        <>
          <p>
            Agents write more code than anyone can read line by line, so the Review tab doesn't start with files in path order. It starts
            with <b>what was asked</b> (the brief and its acceptance criteria) and the change split into <b>parts</b>, in reading order. The
            question for each part is why it is there and whether it is needed, before how it is written.
          </p>
          <ul>
            <li>
              <b>Noise is folded</b>: lockfiles, generated files, snapshots and hunks that only reformat or reorder lines. The bar on top
              shows how much of the diff that was.
            </li>
            <li>
              <b>Risky spots are flagged</b>: sign-in and permissions, billing, migrations, new dependencies, removed or skipped tests,
              something that looks like a key, CI and deploy files, silenced checks (<code>@ts-ignore</code>, <code>eslint-disable</code>).
            </li>
            <li>
              <b>New code nothing uses</b> is flagged too: an export that nothing else in the change calls is dead, or there for later.
            </li>
          </ul>
          <p>
            Without an agent, parts are grouped by folder. Click <b>Explain the change</b> and an agent (the one that did the work, or any
            other) reads the diff and writes a walkthrough: a summary, and for each part why it exists, whether it was <b>asked for</b>,{' '}
            <b>supports</b> what was asked or was <b>not asked for</b>, which criteria it meets, a <b>simpler way</b> if there clearly is one,
            and what could break. The bar shows how much of the change is asked for and how much isn't, so overengineering is visible before
            you read a line. The agent runs in print mode, reads only, and writes one file under <code>.sldev/runs</code>; it doesn't appear
            in your missions.
          </p>
          <p>
            Give each part a verdict: <b>Looks good</b> (<kbd>A</kbd>), <b>Send back…</b> with a note (<kbd>S</kbd>), or <b>Cut it</b> for a
            part nobody asked for. <b>Ask why</b> (<kbd>Q</kbd>) puts a question about one part to an agent, with that part's diff and the
            task, and the answer shows under it. <kbd>J</kbd> and <kbd>K</kbd> move between parts. When you're through, <b>Send back</b>{' '}
            gives every note to the agent that did the work as one follow-up, each with its part and files. A Board card in Review has a{' '}
            <b>Review</b> button that opens the same tab.
          </p>
        </>
      )
    },
    {
      id: 'skills',
      title: 'Let your agents draft work: the sldev skills',
      body: (
        <>
          <p>
            Most planning happens in a chat with an agent. The sldev skills let that agent write the result straight into sldev-io as a{' '}
            <b>draft</b>, instead of you copying it into a form. Add them from the right sidebar → <b>Skills</b> → <b>Add to this project</b>,
            or with the free CLI: <code>sldev skills install</code>. They are plain <code>SKILL.md</code> folders in{' '}
            <code>.claude/skills</code> and <code>.agents/skills</code>, so Claude Code, Codex, OpenCode, Copilot and the others find them;
            commit them and your team has them too.
          </p>
          <table className="docs-table">
            <tbody>
              <tr><td><code>/sldev-mission</code></td><td>A mission: brief, acceptance criteria, kind and optionally an agent. It shows up under <b>Saved for later</b>, marked with who drafted it.</td></tr>
              <tr><td><code>/sldev-stories</code></td><td>Board stories with why, what to change, acceptance criteria and which story waits for which. They land in <b>Proposed</b>.</td></tr>
              <tr><td><code>/sldev-recipe</code></td><td>A factory recipe in <code>.sldev/factory</code>. It shows up in Recipes.</td></tr>
              <tr><td><code>/sldev-eval</code></td><td>An eval in <code>.sldev/evals</code>. It shows up in Mission Control → Evals.</td></tr>
            </tbody>
          </table>
          <p>
            Agents leave missions and stories in <code>.sldev/drafts</code> (kept out of git). While the app is open it takes them in within
            a few seconds and empties the folder; a draft it can't read is renamed to <code>.bad</code> and kept. <b>Nothing starts on its
            own</b>: you read the draft, edit it if you like, and press Launch or approve the stories. A new version of sldev-io with better
            skills offers <b>Update</b>; copies you edited by hand are kept unless you replace them.
          </p>
        </>
      )
    },
    {
      id: 'kinds',
      title: 'Mission kinds',
      body: (
        <>
          <p>
            Every mission starts with a kind. It decides how your brief is framed, how the agent should end, and the defaults of the form:
          </p>
          <table className="docs-table">
            <tbody>
              <tr><td><b>Build</b></td><td>Change code. Own worktree, ends with a diff to review.</td></tr>
              <tr><td><b>Research</b></td><td>Answer a question. Nothing is changed; the agent runs in its read-only mode where it has one.</td></tr>
              <tr><td><b>Investigate</b></td><td>Find the root cause with evidence. Fixes only if you ask.</td></tr>
              <tr><td><b>Plan</b></td><td>A plan, no code. Hand it to a Build mission or a factory run.</td></tr>
              <tr><td><b>Review</b></td><td>Review a branch, a diff or part of the code. Read-only.</td></tr>
              <tr><td><b>Map project</b></td><td>The agent reads the project and writes reference docs to <code>.sldev/context/</code> for later missions. No brief needed; see <a href="/docs/context#map">project context</a>.</td></tr>
              <tr><td><b>Freeform</b></td><td>Your prompt exactly as you wrote it, nothing added.</td></tr>
            </tbody>
          </table>
          <p>
            A finished Plan or Research mission has <b>Build from this</b> and <b>Run a factory recipe from this</b>: its result becomes the
            brief, or the spec the run starts from.
          </p>
          <p>
            Your own kinds are Markdown files. <b>New kind from this one</b> in the form copies the selected kind to{' '}
            <code>.sldev/missions/</code> (or your user folder) and opens it in your editor:
          </p>
          <Code file=".sldev/missions/security-audit.md">{`
---
name: Security audit
description: Look for security problems only
worktree: false
access: read          # read = the agent's read-only mode; write = normal
---
Security audit: {title}

{brief}

{criteria}

Look for injection, authentication mistakes, secrets in code and unsafe
defaults. Do not change any files. List findings with file and line.
`}</Code>
        </>
      )
    },
    {
      id: 'limits',
      title: 'When an agent hits its usage limit',
      body: (
        <>
          <p>
            When Claude Code, Codex, Gemini or another agent stops at its plan's usage limit, the mission card says so and offers{' '}
            <b>Continue on</b> another agent. The next agent works in the same folder, with the original task, your handoff notes and the last
            output of the one that stopped, so it picks up where that one left off instead of starting over.
          </p>
          <p>
            Choose the order in <b>Settings → Agents → When an agent hits its usage limit</b>. With <b>Continue automatically</b> on,
            missions and factory stages move on without asking; otherwise a factory stage stops with a <b>Continue on…</b> button.
          </p>
        </>
      )
    },
    {
      id: 'memory',
      title: 'Project memory',
      body: (
        <>
          <p>
            <code>.sldev/memory.md</code> holds one line for each thing someone learned about the project: a command that works, a gotcha,
            where something lives. Every mission (except Freeform) is pointed at it, so the next agent doesn't rediscover it.
          </p>
          <p>
            Add a line from a mission's details (<b>Remember</b>). Claude Code and Codex missions with the sldev tools add to it
            themselves through <code>sldev_remember</code>, naming the files a note is about. It's a plain file: edit it, prune it, commit it
            to share it with your team.
          </p>
          <p>
            The memory is one part of the <a href="/docs/context">project context</a>: with your reference docs, pinned files and skills, it is
            indexed and linked to your code, and each mission gets the notes that match its task.
          </p>
        </>
      )
    },
    {
      id: 'automations',
      title: 'Automations',
      body: (
        <>
          <p>In the Factory view, an automation runs a recipe or starts a mission by itself:</p>
          <ul>
            <li><b>On a schedule</b>: every hour, day, weekday or week. "Every weekday at 9: review yesterday's commits."</li>
            <li><b>When CI fails</b> on a branch: the newest failure gets one run, with the failing run's id and log command.</li>
            <li><b>When an issue gets a label</b>: one run per issue, one at a time; a recipe's pull request closes the issue.</li>
            <li><b>Repeat</b>: the same mission pass after pass, each building on the last. "Polish the settings page, 4 passes, run the tests after each."</li>
          </ul>
          <p>
            A repeat needs a clear signal that a pass is over, so it doesn't guess from a quiet terminal. With <b>The agent exits</b>, each pass runs
            in print mode, where the agent can't stop to ask, so its exit means it's finished; nobody has to be there. With <b>I accept it</b>,
            you steer each pass and click <b>Accept pass</b> on its mission card. Every pass works in the same worktree and is committed on its own,
            and the next pass gets the last one's report. An optional check (<code>npm test</code>) runs after each pass: a failure goes to the next
            pass to fix first, and two in a row stop the loop. A pass that changes nothing ends it too. The CLI runs the same loop with{' '}
            <code>sldev new --repeat 4 --check "npm test" "…"</code>.
          </p>
          <Note>
            Automations run while sldev-io is open. A time missed while it was closed is skipped, not caught up. An automation never starts
            a second run while its last one is still going, and nothing is pushed until you click.
          </Note>
        </>
      )
    }
  ]
}

const context: DocPage = {
  id: 'context',
  title: 'Project context',
  summary:
    "One memory for every agent: what agents learned, your reference docs, pinned files and skills, indexed on your machine and linked to the files they're about. Each mission gets the notes that match its task.",
  sections: [
    {
      id: 'overview',
      title: 'How it works',
      body: (
        <>
          <p>
            Agents forget everything between sessions, and one vendor's agent never sees what another learned. The project context fixes both.
            The knowledge lives as Markdown in your repo. sldev-io indexes it on your machine, links each note to the files it mentions, and gives
            every mission the notes that match its task, whichever agent runs it.
          </p>
          <ContextGraph compact />
          <p>
            Open it from the <b>Context</b> tab in the right sidebar (or <b>Show Project Context</b> in the command palette). It lists everything
            agents are told, flags notes to check, and searches the way a mission's brief is matched, so you can see what a task would get before
            you start it.
          </p>
        </>
      )
    },
    {
      id: 'sources',
      title: 'What goes in',
      body: (
        <>
          <p>Four kinds of plain files, all in the project, all safe to edit and commit:</p>
          <table className="docs-table">
            <tbody>
              <tr>
                <td><code>.sldev/memory.md</code></td>
                <td>Learnings: one dated line each, ending with the files it is about (<code> · files: src/auth.ts</code>). Added by agents, by <b>Remember</b> in a mission's details, or by you.</td>
              </tr>
              <tr>
                <td><code>.sldev/context/*.md</code></td>
                <td>Reference docs: architecture, commands, conventions, gotchas. Each heading is its own entry, so a match points at the section that matters, not a whole file.</td>
              </tr>
              <tr>
                <td><code>.sldev/pinned.md</code></td>
                <td>Files you pinned, with an optional note. Pinned Markdown files are indexed by section too.</td>
              </tr>
              <tr>
                <td>Project skills</td>
                <td><code>SKILL.md</code> folders in <code>.claude/skills</code>, <code>.sldev/skills</code> and <code>.agents/skills</code>, by name and description.</td>
              </tr>
            </tbody>
          </table>
          <Code file=".sldev/memory.md">{`
# Project memory

- 2026-10-30: Integration tests need Postgres: docker compose up db (codex, mission "Fix flaky tests") · files: docker-compose.yml
- 2026-10-31: Tokens are signed in src/server/auth.ts with a 1h expiry (you)
`}</Code>
          <p>
            Paths in a note are picked up even without the <code>files:</code> list: anything in backticks or written like a path that exists in
            the project.
          </p>
        </>
      )
    },
    {
      id: 'missions',
      title: 'What a mission gets',
      body: (
        <>
          <p>
            When a mission starts, sldev-io searches the context with its brief and adds up to six matches to the prompt: where to read each one
            (an absolute path and line, so a mission in a worktree can open it) and what it says. A note about a file the brief names ranks
            first. The prompt points at notes; it doesn't paste whole docs, so it stays short.
          </p>
          <Code file="Added to the prompt">{`
Project context that looks relevant to this task (read what applies; check anything marked out of date against the code):
- /work/shop/.sldev/memory.md:4: Tokens are signed in src/server/auth.ts with a 1h expiry (2026-10-31)
- /work/shop/.sldev/context/architecture.md:12: Authentication
`}</Code>
          <p>
            Every mission kind gets this except <b>Freeform</b>, which sends your text exactly as written. Factory stages get it too. Settings →
            Agents → <b>Project context</b> turns it off.
          </p>
        </>
      )
    },
    {
      id: 'tools',
      title: 'Agents look up and add',
      body: (
        <>
          <p>Agents with the sldev tools (Claude Code and Codex by default) get two more:</p>
          <ul>
            <li>
              <code>sldev_recall</code>: look things up by topic (<i>"how are tests run"</i>) or by file (<code>src/server/auth.ts</code>). By file,
              it also returns the other files those notes link to, one step through the graph.
            </li>
            <li>
              <code>sldev_remember</code>: add a learning with the files it is about. The next agent working on those files is pointed at it.
            </li>
          </ul>
          <p>Other agents read the same notes from their prompt; they just can't call the tools.</p>
        </>
      )
    },
    {
      id: 'map',
      title: 'Map a project',
      body: (
        <>
          <p>
            <b>Map this project</b> in the Context tab (or the <b>Map project</b> mission kind) asks an agent to read the code and write the docs
            in <code>.sldev/context/</code>: an overview, architecture, commands, conventions and gotchas, one section per topic, naming the
            files each is about. It writes nothing else and commits nothing: review the diff like any other change. A brief is optional, for
            example "focus on the payment flow".
          </p>
          <p>
            From the Context tab's menu you can also add it to the project as a skill (<code>.sldev/skills/map-project/SKILL.md</code>), so you
            can run it from any agent's own CLI.
          </p>
        </>
      )
    },
    {
      id: 'stale',
      title: 'Notes that may be out of date',
      body: (
        <>
          <p>
            A note is flagged when a file it's about changed after the note was written, or no longer exists. The Context tab marks it, and so
            does the prompt, so the agent checks it against the code instead of trusting it. "Changed" means a newer commit, not a newer file
            time, so a fresh clone doesn't flag everything.
          </p>
          <p>Fix the note, or forget it from the Context tab (it asks first, and removes only that line).</p>
        </>
      )
    },
    {
      id: 'pin',
      title: 'Pin files',
      body: (
        <p>
          Pin the files agents should know about: a design doc, a schema, the API spec. Use <b>Pin a file</b> in the Context tab, or right-click a
          file in the explorer and choose <b>Pin to project context</b>. Unpinning removes it from the list, never the file.
        </p>
      )
    },
    {
      id: 'privacy',
      title: 'Where it lives',
      body: (
        <>
          <p>
            The Markdown in <code>.sldev/</code> is the source. Commit it and your whole team, and every agent they use, shares it. The search
            index is a SQLite file in sldev-io's data folder, rebuilt from the Markdown whenever it changes; deleting it loses nothing.
          </p>
          <Note>Search runs on your machine. No embeddings service, no upload: nothing about your code leaves it.</Note>
        </>
      )
    }
  ]
}

const workspace: DocPage = {
  id: 'workspace',
  title: 'Runtimes, tasks and terminals',
  summary:
    "The everyday workspace: start your project's dev servers and scripts with one click, save the commands and agent prompts you run often as tasks, and work across split terminals with the keyboard.",
  sections: [
    {
      id: 'runtimes',
      title: 'Runtimes',
      body: (
        <>
          <p>
            Open a folder and the <b>Runtimes</b> view lists what it can run, grouped by the file it came from. Monorepo packages under{' '}
            <code>apps/</code>, <code>packages/</code>, <code>services/</code>, <code>libs/</code>, <code>crates/</code> and{' '}
            <code>examples/</code> are found too.
          </p>
          <table className="docs-table">
            <tbody>
              <tr><td><code>package.json</code></td><td>Every script, run with npm, pnpm, yarn or bun depending on the lockfile</td></tr>
              <tr><td><code>Makefile</code>, <code>justfile</code></td><td>Make targets and just recipes</td></tr>
              <tr><td><code>Cargo.toml</code>, <code>go.mod</code></td><td>run, build and test (plus check and clippy for Cargo)</td></tr>
              <tr><td><code>pyproject.toml</code>, <code>manage.py</code></td><td>Project scripts, pytest, and Django's runserver and migrate</td></tr>
              <tr><td><code>compose.yml</code></td><td><code>docker compose</code> up, down and logs</td></tr>
              <tr><td><code>deno.json</code></td><td>Deno tasks</td></tr>
            </tbody>
          </table>
          <p>
            Click play (or double-click the row) to start one in its own terminal. Running runtimes share one group of tabs, so a dev server, a
            watcher and a database sit together. Clicking a running one shows its terminal; restart and stop are on the row and in its
            right-click menu.
          </p>
          <p>
            Missing something? <b>+</b> adds a custom command, with its own folder relative to the project, such as{' '}
            <code>npm run dev -- --port 4000</code> in <code>web</code>. Custom commands are kept per project.
          </p>
        </>
      )
    },
    {
      id: 'preview',
      title: 'Ports and the preview',
      body: (
        <>
          <p>
            When a running command prints a local address like <code>http://localhost:5173</code>, its port shows up under the runtime. Click
            the port to open the page in a preview panel next to your terminals, or right-click it to open it in your browser.{' '}
            <b>Open browser preview</b> in the command palette opens one for any address.
          </p>
        </>
      )
    },
    {
      id: 'tasks',
      title: 'Tasks',
      body: (
        <>
          <p>A task is something you run often, saved under a name. There are two kinds:</p>
          <ul>
            <li>
              <b>Shell</b>: a command line, like <code>npm ci &amp;&amp; npm test</code>. The editor can fill it in from the project's scripts.
            </li>
            <li>
              <b>Agent</b>: a prompt for one of your agents, with its model, permission mode and profile. It runs as a mission, so you get its
              live status, notifications and the diff to review, in its own worktree if you tick that.
            </li>
          </ul>
          <p>
            A task belongs to the open project or is <b>global</b> and shows in every project ("update my dotfiles", "clean Docker images").
            The editor always shows the exact command it will run.
          </p>
        </>
      )
    },
    {
      id: 'terminals',
      title: 'Terminals',
      body: (
        <>
          <p>
            Terminals open in your login shell, so your <code>PATH</code> and aliases work. Split them right or down, drag tabs to rearrange
            them, or open a floating terminal from the command palette. <b>Broadcast</b> sends what you type to every visible terminal, which helps for the
            same command on several servers.
          </p>
          <p>
            When you reopen the app your layout comes back. Restored runtimes and tasks wait for you to press Enter instead of running again,
            and agents resume their session instead of starting over.
          </p>
        </>
      )
    },
    {
      id: 'shortcuts',
      title: 'Keyboard shortcuts',
      body: (
        <>
          <p>
            Everything is in the command palette. On Windows and Linux the shortcuts use <b>Ctrl+Shift</b> so they don't take keys from the
            programs in your terminals:
          </p>
          <table className="docs-table">
            <thead>
              <tr><th>Action</th><th>macOS</th><th>Windows and Linux</th></tr>
            </thead>
            <tbody>
              <tr><td>All commands</td><td><code>Cmd+Shift+P</code></td><td><code>Ctrl+Shift+P</code></td></tr>
              <tr><td>Quick open a file</td><td><code>Cmd+P</code></td><td><code>Ctrl+Alt+P</code></td></tr>
              <tr><td>New terminal</td><td><code>Cmd+T</code></td><td><code>Ctrl+Shift+T</code></td></tr>
              <tr><td>Split right / down</td><td><code>Cmd+D</code> / <code>Cmd+Shift+D</code></td><td><code>Ctrl+Shift+D</code> / <code>Ctrl+Alt+Shift+D</code></td></tr>
              <tr><td>Find in terminal</td><td><code>Cmd+F</code></td><td><code>Ctrl+Shift+F</code></td></tr>
              <tr><td>Broadcast input</td><td><code>Cmd+Shift+B</code></td><td><code>Ctrl+Alt+B</code></td></tr>
              <tr><td>Close panel</td><td><code>Cmd+W</code></td><td><code>Ctrl+Shift+W</code></td></tr>
              <tr><td>New mission</td><td><code>Cmd+Shift+M</code></td><td><code>Ctrl+Shift+M</code></td></tr>
              <tr><td>Next mission that needs you</td><td><code>Cmd+Shift+J</code></td><td><code>Ctrl+Shift+J</code></td></tr>
              <tr><td>Sidebar views</td><td><code>Cmd+1</code> … <code>Cmd+9</code></td><td><code>Ctrl+Shift+1</code> … <code>Ctrl+Shift+9</code></td></tr>
              <tr><td>Toggle sidebar</td><td><code>Cmd+B</code></td><td><code>Ctrl+Shift+B</code></td></tr>
              <tr><td>Focus mode (hide both sidebars)</td><td><code>Cmd+Alt+F</code></td><td><code>Ctrl+Alt+F</code></td></tr>
              <tr><td>Open folder</td><td><code>Cmd+O</code></td><td><code>Ctrl+Shift+O</code></td></tr>
              <tr><td>Open the project in your editor</td><td><code>Cmd+Shift+O</code></td><td><code>Ctrl+Alt+O</code></td></tr>
              <tr><td>Settings</td><td><code>Cmd+,</code></td><td><code>Ctrl+,</code></td></tr>
            </tbody>
          </table>
        </>
      )
    },
    {
      id: 'more',
      title: 'Notes and GitHub workflows',
      body: (
        <>
          <p>
            <b>Notes</b> are plain Markdown files, for one project or for all of them. They stay on your machine in the app's data folder,
            not in the repository.
          </p>
          <p>
            <b>GitHub Workflows</b> lists the repository's workflows and recent runs through the GitHub CLI (<code>gh</code>). Run a workflow
            with its inputs, watch a run live in a terminal, read its logs, re-run failed jobs or cancel it.
          </p>
        </>
      )
    }
  ]
}

const agents: DocPage = {
  id: 'agents',
  title: 'Agents, skills and shared rules',
  summary:
    'sldev-io works with the coding agents you already use. Add any other CLI, give every agent the same project rules from one file, and run your skills on any of them.',
  sections: [
    {
      id: 'clis',
      title: 'Supported agents',
      body: (
        <>
          <p>
            Built in: <b>Claude Code</b> (<code>claude</code>), <b>Codex</b> (<code>codex</code>), <b>Cursor Agent</b>, <b>GitHub Copilot</b>,{' '}
            <b>OpenCode</b> and <b>Gemini CLI</b>. sldev-io starts the CLI you installed, with your own login and plan; it doesn't sign in for
            you and doesn't send your code anywhere. <b>Settings → Agents</b> shows which ones it found and how to install the rest.
          </p>
          <p>
            Claude Code reports its status through hooks, so its mission cards show exactly when it's working or waiting. For the others,
            sldev-io watches the terminal: output means working, a few quiet seconds means ready, and a bell means it needs you. Claude Code and
            Codex can also report through the sldev tools (MCP).
          </p>
        </>
      )
    },
    {
      id: 'custom',
      title: 'Adding another CLI',
      body: (
        <>
          <p>
            <b>Settings → Agents → Add custom agent</b> takes any command line. <code>{'{prompt}'}</code>, <code>{'{model}'}</code> and{' '}
            <code>{'{name}'}</code> are filled in; without <code>{'{prompt}'}</code> the prompt goes at the end. Give it a non-interactive
            command too, and it can run factory stages:
          </p>
          <Code file="Aider as a custom agent">{`
Interactive:      aider
Non-interactive:  aider --message {prompt} --yes
Continue:         aider --restore-chat-history
`}</Code>
        </>
      )
    },
    {
      id: 'rules',
      title: 'One set of rules for every agent',
      body: (
        <>
          <p>
            Each agent reads its own instructions file. Keep one <code>.sldev/rules.md</code> instead, and sldev-io writes it to all of them (
            <b>Skills → Rules</b>):
          </p>
          <table className="docs-table">
            <tbody>
              <tr><td><code>AGENTS.md</code></td><td>Codex, OpenCode, Cursor, Copilot and most other agents</td></tr>
              <tr><td><code>CLAUDE.md</code></td><td>Claude Code</td></tr>
              <tr><td><code>GEMINI.md</code></td><td>Gemini CLI</td></tr>
              <tr><td><code>.cursor/rules/sldev.mdc</code></td><td>Cursor</td></tr>
              <tr><td><code>.github/copilot-instructions.md</code></td><td>GitHub Copilot</td></tr>
            </tbody>
          </table>
          <p>
            <b>Create from this project's agent files</b> starts <code>rules.md</code> from the files you already have. Turn off the files you
            don't want. A file someone edited by hand is never overwritten without asking.
          </p>
        </>
      )
    },
    {
      id: 'skills',
      title: 'Skills, commands and MCP servers',
      body: (
        <>
          <p>
            The <b>Skills</b> view lists the project's and your own skills, slash commands and subagents, plus the MCP servers configured for
            Claude Code. Run a skill on any agent: Claude Code gets its slash command, other agents are pointed at its <code>SKILL.md</code>.
            Skills in <code>.sldev/skills</code> or <code>.agents/skills</code> are meant for every agent.
          </p>
          <p>
            Skills also work as factory stages (<code>skill: our-spec</code>); see <a href="/docs/recipes#skills">your own skills and specs</a>.
            Agent profiles (a role like Reviewer, with its CLI and model) are covered under{' '}
            <a href="/docs/recipes#agents">choosing agents</a>.
          </p>
        </>
      )
    },
    {
      id: 'usage',
      title: 'Usage and the agents dashboard',
      body: (
        <p>
          The usage dashboard (the <b>Usage</b> tab of <a href="/docs/missions#control">Mission Control</a>) reads the token counts Claude Code
          and Codex already write to their local logs, and shows a timeline of your missions and how long each waited on you. The agents
          dashboard shows every running agent in one view. Nothing leaves your machine.
        </p>
      )
    }
  ]
}

const remote: DocPage = {
  id: 'remote',
  title: 'Remote servers and containers',
  summary: 'Connect to servers over SSH, keep their credentials encrypted, forward ports, browse files, and manage your Docker containers, all next to your local terminals.',
  sections: [
    {
      id: 'ssh',
      title: 'SSH connections',
      body: (
        <>
          <p>
            In <b>Remote → Connections</b>, add a server with its host, port and user. It can sign in three ways: through your ssh-agent (or
            Pageant on Windows), with a saved credential, or by asking for the password each time. Choose a <b>jump host</b> to go through a
            bastion, and a <b>start folder</b> for new terminals.
          </p>
          <p>
            The first time you connect, sldev-io shows the server's key fingerprint and asks you to trust it. If the key ever changes, it warns
            you before connecting, like <code>ssh</code> does.
          </p>
        </>
      )
    },
    {
      id: 'credentials',
      title: 'Credentials',
      body: (
        <>
          <p>
            <b>Remote → Credentials</b> holds passwords and private keys, encrypted with your system's keychain (Keychain on macOS, Windows'
            data protection, the secret service on Linux). They're only decrypted for connecting and are never
            shown again. For a <b>key file</b>, only the path is saved, and the key is read from disk on each connect.
          </p>
          <Note>On Linux without a keyring (gnome-keyring, KWallet), sldev-io says so and doesn't save secrets; use ssh-agent instead.</Note>
        </>
      )
    },
    {
      id: 'forwards',
      title: 'Port forwards and files',
      body: (
        <>
          <p>
            A connection can forward local ports to the server, such as local <code>8080</code> to <code>localhost:80</code> over there. Turn
            each one on or off from the connection's row.
          </p>
          <p>
            Browse the server's files from the connection, download one, or open a terminal in any folder. Agents can run on the server too:
            open a terminal there and start the CLI.
          </p>
        </>
      )
    },
    {
      id: 'containers',
      title: 'Docker containers',
      body: (
        <p>
          <b>Remote → Containers</b> lists your Docker containers, grouped by compose project. Start, stop, restart or remove one, open a shell
          in it, follow its logs in a terminal, or open its published ports in your browser. It uses the <code>docker</code> CLI you already
          have.
        </p>
      )
    }
  ]
}

const lead: DocPage = {
  id: 'lead',
  title: 'Lead missions: one agent delegates to others',
  summary:
    'Give a Lead a big goal. It plans, hands the parts to other agents running in parallel in their own worktrees, reviews each diff, sends work back and merges what passes. Nothing is pushed.',
  sections: [
    {
      id: 'what',
      title: 'What a Lead does',
      body: (
        <>
          <p>
            A Lead is a mission kind. Instead of writing the code, the Lead agent reads enough of the project to plan, splits the goal into
            tasks of one pull request each with acceptance criteria, and starts a worker for each. Workers can be any agent with the sldev
            tools, so a Claude Lead can hand the API to Codex and the tests to Gemini.
          </p>
          <p>
            Each worker runs unattended (print mode, with the unattended mode from Settings → Software Factory) in its own git worktree,
            branched from the Lead's branch. The Lead collects their reports, reads every diff against the criteria, sends a worker back
            with feedback when it falls short, and merges the good branches into its own branch with your tests as the check. You review
            the Lead's branch at the end.
          </p>
        </>
      )
    },
    {
      id: 'start',
      title: 'Start a Lead',
      body: (
        <>
          <p>
            Open New mission, pick the <strong>Lead</strong> kind and describe the goal, as you would to a tech lead. Or, on the Board,
            open a card's menu and choose <strong>Start with a Lead</strong>: the card follows the Lead to Review.
          </p>
          <p>
            The Lead runs in an ordinary terminal, so you can watch it plan and answer its questions. Its workers show inside its card in
            Mission Control, each with its agent, its state, and a mark once it is merged.
          </p>
          <Note>The Lead needs an agent with the sldev tools: Claude Code or Codex. Workers can be any agent with them.</Note>
        </>
      )
    },
    {
      id: 'tools',
      title: 'The tools a Lead uses',
      body: (
        <>
          <p>Only a Lead mission can call these; a worker that tries is told to do its own part.</p>
          <ul>
            <li><code>sldev_delegate</code>: start a worker with a title, a brief, acceptance criteria, an agent (or <code>auto</code>) and a kind (build, investigate, research, review).</li>
            <li><code>sldev_wait</code>: get the reports of workers that finished, with their branch and diff size. It returns within 45 seconds; the Lead calls it again while some are still running.</li>
            <li><code>sldev_mission_diff</code>: read a worker's diff.</li>
            <li><code>sldev_followup</code>: send a finished worker back with what to fix. It continues in the same branch.</li>
            <li><code>sldev_integrate</code>: merge finished branches into the Lead's, in order, then run a check such as <code>npm test</code>. A merge conflict stops there, for the Lead to resolve in its folder.</li>
          </ul>
        </>
      )
    },
    {
      id: 'routing',
      title: 'Routing by your evals',
      body: (
        <p>
          With agent <code>auto</code> (the default), each task goes to the installed agent that scored best on this project's{' '}
          <a href="/docs/evals">evals</a>: pass rate first, then checks passed, then speed. The worker's card says why it was chosen.
          Without eval results it falls back to your default agent.
        </p>
      )
    },
    {
      id: 'limits',
      title: 'Limits and safety',
      body: (
        <ul>
          <li>A Lead starts at most 6 workers, 3 at a time. Workers can't delegate further.</li>
          <li>Workers start from the Lead's branch, so a later worker sees what was already integrated.</li>
          <li>Nothing is pushed. The Lead's branch waits for your review, like any mission's.</li>
          <li>It all runs on your machine, only while the app is open.</li>
        </ul>
      )
    }
  ]
}

const board: DocPage = {
  id: 'board',
  title: 'The Board: stories, approval and pick-up',
  summary:
    'Plan work in columns. Agents write well-defined stories into Proposed, you approve them, and the factory picks up Agent ready cards on its own. GitHub issues come in; merged pull requests move cards to Done.',
  sections: [
    {
      id: 'columns',
      title: 'The columns',
      body: (
        <>
          <p>The Board has its own button on the left bar. Cards move left to right:</p>
          <ul>
            <li><strong>Backlog</strong>: ideas and work that isn't ready for an agent.</li>
            <li><strong>Proposed</strong>: stories an agent wrote or refined, waiting for your approval.</li>
            <li><strong>Agent ready</strong>: approved, clear enough for an agent. Pick-up takes these.</li>
            <li><strong>In progress</strong>: an agent is on it; the card shows how its run is going.</li>
            <li><strong>Review</strong>: the agent is done; review the diff or the pull request.</li>
            <li><strong>Done</strong>: reviewed and merged.</li>
          </ul>
          <p>Drag cards between columns, filter by text, number or label, and set a priority. The Board menu has everything else.</p>
        </>
      )
    },
    {
      id: 'stories',
      title: 'Agents write the stories',
      body: (
        <>
          <p>
            <strong>Write stories</strong> takes a feature, an epic or a problem. A read-only agent reads the code and splits it into
            stories, each with <em>why</em>, <em>what to do</em> (the files likely to change), <em>acceptance criteria</em> and{' '}
            <em>how to check</em>, plus labels and a priority. It checks the board first, so it doesn't file what is already there.
          </p>
          <p>
            <strong>Refine with an agent</strong> on a Backlog or Proposed card rewrites a vague card ("Login is slow") as a proper story in
            place, and splits it when it is really several pieces of work.
          </p>
          <p>
            Whatever an agent writes lands in Proposed with its name on it. Approve cards one by one or all at once; only then can pick-up
            see them. Agents that find follow-up work during a mission (a missing test, a bug next door) file it the same way, with{' '}
            <code>sldev_board_add</code>.
          </p>
          <Note>Agents without the sldev tools write their stories to a JSON file that sldev-io reads, so story writing works with every agent.</Note>
        </>
      )
    },
    {
      id: 'pickup',
      title: 'Pick-up',
      body: (
        <p>
          Turn on <strong>Auto pick-up</strong> and choose what starts for a card (a factory recipe or a mission of a kind on an agent) and
          how many at once. Pick-up takes Agent ready cards highest priority first, follows each run to Review, and flags a question or a
          failure on the card. A card can have its own recipe, or start with a <a href="/docs/lead">Lead</a>. It runs only while the app is
          open, and a recipe's pull request step still waits for your click.
        </p>
      )
    },
    {
      id: 'waits',
      title: 'Cards that wait for others',
      body: (
        <>
          <p>
            A card can wait for others: set <strong>Waits for</strong> (card numbers) when you edit it. Pick-up skips it until every card it
            waits for is Done, then starts it on its own, so "Create a team" goes before "Invite people to a team" without you watching.
            The card says what it waits for, and the one it waits for says what it unblocks. A loop is refused.
          </p>
          <p>
            Agents that write stories set this too: a story filed <code>after</code> another (by its title or number) waits for it.{' '}
            <strong>Start now</strong> from the card's menu still starts it early if you want.
          </p>
        </>
      )
    },
    {
      id: 'spent',
      title: 'What the work took, and the PR description',
      body: (
        <>
          <p>
            When a card's run or mission finishes, the card shows what it took: the time from start to finish, how many agents worked on it
            (stages, follow-ups, a Lead's workers) and, for agents whose logs say (Claude Code, Codex), the tokens and their cost at API list
            prices. The Done column adds them up for a release.
          </p>
          <p>
            <strong>Copy as PR description</strong> on a card gives Markdown for your pull request: the story's why, the agent's own report
            of what changed, the acceptance criteria as boxes to tick, how to check it, <code>Closes #42</code> for an imported issue, and the
            diff size.
          </p>
        </>
      )
    },
    {
      id: 'retro',
      title: 'Retros into the project memory',
      body: (
        <p>
          <strong>Retro: save lessons to memory</strong> on a finished card starts a read-only mission that looks back at how the work went:
          what was sent back, what failed over at a usage limit, the review notes, the diff. It saves at most three lessons the next agent
          needs (a convention it missed, a command that has to run, a gotcha) to <a href="/docs/context">.sldev/memory.md</a>, which every
          later mission reads. No summaries of the change, and nothing when nothing is worth remembering. The card shows how many it left.
        </p>
      )
    },
    {
      id: 'release',
      title: 'Release notes from Done',
      body: (
        <p>
          The tag on the Done column (or <strong>Release notes from Done</strong> in the Board menu) writes release notes from the cards
          finished since the last ones, grouped by label: New, Fixes, Docs and Under the hood, with issue numbers. Edit them, copy them,
          and <strong>Copy and mark released</strong> so the next notes start after these cards.
        </p>
      )
    },
    {
      id: 'git',
      title: 'Share the board through git',
      body: (
        <>
          <p>
            <strong>Share the board through git</strong> (Board menu) keeps the cards in <code>.sldev/board.json</code> in your project.
            Commit it, and everyone who pulls sees the same board; their changes come in when the window gets focus after a pull. Each card's
            newer side wins, a deleted card stays deleted, and which runs and missions worked on a card stays on the machine that ran them.
          </p>
          <Note>
            The file is written as stable, two-space JSON sorted by card number, so a change is a readable diff. If a merge leaves conflict
            markers in it, the board says so and waits until you resolve them; it never overwrites the file. sldev-io doesn't commit or push
            it for you.
          </Note>
        </>
      )
    },
    {
      id: 'github',
      title: 'GitHub issues and pull requests',
      body: (
        <p>
          <strong>Import GitHub issues</strong> lists open issues (filter by label) and makes cards with their labels and a link back; P1,
          urgent or critical labels come in as high priority. A card's factory run closes its issue with its pull request, and once that
          pull request is merged (checked through your <code>gh</code> every few minutes) the card moves to Done.
        </p>
      )
    }
  ]
}

const evalsGuide: DocPage = {
  id: 'evals',
  title: 'Evals: measure agents on your own code',
  summary:
    'An eval is a task from your repository with checks. Run a suite against any agents and models, each attempt in its own worktree, and compare pass rate, time and diff size on a leaderboard.',
  sections: [
    {
      id: 'file',
      title: 'An eval file',
      body: (
        <>
          <p>
            Evals are YAML files in <code>.sldev/evals/</code>, committed with your code. Mission Control → Evals → <strong>New eval</strong>{' '}
            writes one from a template, and <strong>Save as eval</strong> on any mission turns a task you already gave an agent into one,
            starting from the commit that mission started from.
          </p>
          <Code file=".sldev/evals/leap-years.yml">{`
name: Leap years
description: Date parsing edge cases
brief: |
  parseDate('2024-02-29') must return a date; parseDate('2023-02-29') must throw.
base: main          # where every attempt starts (default: HEAD when the run starts)
setup: npm ci       # dependencies (default: detected, like factory runs)
timeout: 20         # minutes before the agent is stopped
checks:
  - run: npm test
  - run: node scripts/check-dates.js
    expect: ok
  - diff: 80
  - judge: Adds a test for 2024-02-29 and keeps the public API.
`}</Code>
        </>
      )
    },
    {
      id: 'checks',
      title: 'Checks',
      body: (
        <ul>
          <li><code>run</code>: a command in the attempt's worktree that must exit 0. With <code>expect</code>, its output must contain that text.</li>
          <li><code>diff</code>: the most changed lines allowed. An attempt that changes nothing fails it.</li>
          <li><code>judge</code>: a second agent reads the diff against your rubric and writes a verdict. It passes only if every point is met.</li>
        </ul>
      )
    },
    {
      id: 'run',
      title: 'Running a suite',
      body: (
        <>
          <p>
            <strong>Run evals</strong> asks which evals, which agents (each with an optional model, so two models of one agent can compete),
            how many attempts each and how many at a time. Agents vary from run to run: three attempts tell you more than one.
          </p>
          <p>
            Every attempt gets its own worktree from the eval's base. Setup is committed first, so the diff is the agent's alone. The agent
            runs in print mode with the unattended mode, then the checks run. Nothing is pushed, and deleting a run removes its worktrees.
          </p>
        </>
      )
    },
    {
      id: 'prompts',
      title: 'Tune your prompts',
      body: (
        <>
          <p>
            Evals measure instructions as well as agents. A prompt variant is a Markdown file in <code>.sldev/evals/prompts/</code> whose
            text goes before the eval's brief. In <strong>Run evals</strong>, tick the variants to compare (and <em>As written</em>, the brief
            alone): every agent runs every eval with each of them, and the matrix and leaderboard show them side by side.
          </p>
          <Code file=".sldev/evals/prompts/tests-first.md">{`
Before you change anything, read the tests next to the code you will touch.
Keep the change as small as the task allows, and run the tests before you finish.
`}</Code>
          <p>
            <strong>New prompt variant</strong> writes one from a template and opens it in your editor. When one wins, copy it from the
            leaderboard into <a href="/docs/agents#rules">your rules</a> or a mission kind. Routing for a Lead's <code>auto</code> uses the
            plain attempts only, since a variant measures the words, not the agent.
          </p>
        </>
      )
    },
    {
      id: 'scores',
      title: 'The scoreboard',
      body: (
        <p>
          Each run shows a matrix of evals against agents. The leaderboard ranks every finished attempt in the project by pass rate, then
          checks passed (partial credit), then median time, with median diff size alongside. <strong>Copy</strong> gives a Markdown table
          for a pull request or a team channel. A <a href="/docs/lead">Lead</a> with agent <code>auto</code> routes each task to the
          leaderboard's best installed agent.
        </p>
      )
    }
  ]
}

export const docs: DocPage[] = [lead, board, evalsGuide, recipes, missions, context, workspace, agents, remote]
