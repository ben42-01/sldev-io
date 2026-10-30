import type { ReactNode } from 'react'

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
            on its own: Claude Code in auto mode, Codex in full-auto, Gemini CLI auto-accepting edits. Change this per agent in{' '}
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
              <tr><td><code>agent</code> + <code>prompt</code></td><td>An agent stage. <code>agent</code>: a profile, a CLI id, <code>Profile@cli</code>, or a list for a bake-off</td></tr>
              <tr><td><code>skill</code></td><td>Run this skill in an agent stage; the prompt becomes its arguments (default <code>{'{intent}'}</code>), <code>agent</code> defaults to your default agent</td></tr>
              <tr><td><code>run</code></td><td>A run stage: a command, a script name (<code>test</code>, <code>test?</code> = optional) or a list of them</td></tr>
              <tr><td><code>pr</code></td><td>A PR stage: <code>{'{ title, body }'}</code>, both optional (title defaults to <code>{'{intent}'}</code>)</td></tr>
              <tr><td><code>needs</code></td><td>Stage ids to wait for. Default: the stage above. Several = run in parallel and merge here</td></tr>
              <tr><td><code>gate: approve</code></td><td>Wait for Approve or Reject after the stage</td></tr>
              <tr><td><code>maxDiff</code></td><td>Ask for approval when the run's changed lines pass this number</td></tr>
              <tr><td><code>onFail</code></td><td><code>{'{ retry: <stage or list>, max: 1–10 }'}</code> on a run stage; default <code>max</code> is 2</td></tr>
              <tr><td><code>interactive: true</code></td><td>A normal session you type into; finishes with Done</td></tr>
            </tbody>
          </table>
          <p>A stage is exactly one of agent (or skill), run or pr.</p>
        </>
      )
    }
  ]
}

export const docs: DocPage[] = [recipes]
