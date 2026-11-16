import type { SkillSet, SldevSkill } from '@shared/sldevSkills'
import { MAX_SPAWN } from './protocol'

/**
 * The CLI's own skills, installed by `sldev skills install` next to the app's (src/shared/sldevSkills.ts). They
 * drive the CLI's commands, so they live here; `test/skills.test.ts` checks every command and flag they name
 * exists, and that what they run from inside a pane is something the daemon's guard lets a pane do.
 */

/** bumped when a CLI skill's text changes, so projects with an older copy are offered the update */
export const CLI_SKILLS_VERSION = 1

const CONDUCTOR: SldevSkill = {
  name: 'sldev-conductor',
  label: 'Run other agents',
  description:
    'Split a task between other coding agents with the sldev CLI: start each part in its own git worktree, wait for them, merge their branches into yours and report. Use inside a sldev pane started with --allow-spawn, when asked to conduct, orchestrate, fan out, parallelize or delegate parts of a task to other agents. It never pushes or opens a pull request.',
  body: `# Conduct other agents with sldev

You split one task between other coding agents. Each part runs as its own agent in its own git worktree; you wait
for them, read what they did, merge their branches into your own branch and report. A person reviews your branch
afterwards: you never push, never open a pull request, and never merge into anything but your own branch.

## 1. Check that you may start agents

\`\`\`bash
echo "pane=$SLDEV_MISSION_ID daemon=$SLDEV_CLI_DAEMON"
sldev ls --json
git status --porcelain
start=$(git rev-parse HEAD)    # keep it: the review and the report compare against it
\`\`\`

In the \`ls\` output, your pane is the one whose \`id\` is \`$SLDEV_MISSION_ID\`. You may start
\`allowSpawn\` minus \`spawned\` more agents (\`spawned\` is left out until you start the first).

Stop here, change nothing and tell the person how to start you, if:

- either variable is empty: you are not running in a sldev pane;
- your pane has no \`allowSpawn\`, or \`spawned\` already equals it;
- your pane has \`spawnedBy\`: another agent started you, so you can't start agents.

The command to give them (from their own terminal, not yours; up to ${MAX_SPAWN} agents):

\`\`\`bash
sldev new --allow-spawn 3 --kind build --worktree conduct/<task> "<the task, as they gave it to you>"
\`\`\`

If \`git status --porcelain\` lists files you didn't write, stop and ask: merging into a folder with someone else's
uncommitted work mixes the two.

### What sldev lets you do from a pane

- \`sldev new\` at most \`allowSpawn\` times over your pane's whole life (1 to ${MAX_SPAWN}); agents that ended still count.
- Every agent you start runs in print mode (it does the task and exits, no questions), in a new worktree branched
  from your current branch's last commit. \`--here\`, \`--repeat\` and \`--allow-spawn\` are refused. They have no
  failover, can't start agents, and git push fails for them.
- \`sldev send\` and \`sldev kill\` work only on the agents you started; \`sldev ls\`, \`sldev read\` and
  \`sldev wait\` work on any pane.
- \`sldev review\`, \`sldev loops stop\`, \`sldev stop\` and attaching (\`sldev\` alone) are refused.

When sldev refuses something, don't look for a way around it (unsetting the variables, another terminal, starting
agents some other way): say in your report what you wanted to do.

## 2. Split the task

Read enough of the code to know where each part goes. Then:

- At most as many parts as you have places left; keep one place if you want a review (step 6). Fewer is fine. If the
  task doesn't split, do it yourself, or give the whole of it to one agent.
- Parts must be independent: different files. Two parts that would change the same file are one part, or run one
  after the other (start the second after you merged the first, so its worktree has it).
- Workers branch from your last commit, not your working folder: commit anything of yours they need first.
- Each part gets a branch name (\`conduct/<task>-<part>\`), a brief that stands on its own (the worker never sees this
  conversation: say what to change, where, and why), two to four acceptance criteria someone can check, and the
  line "Commit your work on this branch when it is done." (a build mission doesn't commit unless the brief asks).

## 3. Start the workers

Start every part before you wait for any, so they run at the same time:

\`\`\`bash
w1=$(sldev new --print --kind build --agent claude --worktree conduct/users-api \\
  --title "Paginate GET /users" \\
  --criteria "GET /users takes ?page and ?per_page, default 50" \\
  --criteria "npm test passes" \\
  "Add pagination to GET /users in src/api/users.ts ... Commit your work on this branch when it is done.")
w2=$(sldev new --print --kind build --agent codex --worktree conduct/users-ui ...)
\`\`\`

\`sldev new\` prints the new pane's id; write down each id with its branch. \`sldev agents\` lists the agents
installed here (\`--agent\`). \`--criteria\` needs \`--kind\`; give it once per criterion.

## 4. Wait for each, then read what it did

\`\`\`bash
sldev wait "$w1" --for done --timeout 300
\`\`\`

It prints the pane's line once the agent has exited. On a timeout it prints \`sldev: timed out\` and exits with 1:
the worker is still going, so run the same command again. Keep \`--timeout\` below your own limit for one command.
While you wait, \`sldev read "$w1" --lines 40\` shows what it's doing; don't kill a worker only for being slow.

When it's done:

\`\`\`bash
sldev ls --json               # its status (ended or failed), exitCode, report, worktree.path and worktree.branch
sldev read "$w1" --lines 120  # its last screen, when the report is thin
\`\`\`

A worker that \`failed\` or exited with an error isn't merged: note why. If you have places left, you may start
it again with a better brief.

## 5. Merge the finished branches into yours

In your own folder, one branch at a time:

\`\`\`bash
git -C <worktree.path> status --porcelain    # files it left uncommitted?
git -C <worktree.path> add -A && git -C <worktree.path> commit -m "<part title>"   # only if it did
git log --oneline HEAD..<worktree.branch>    # what the merge brings
git merge --no-ff <worktree.branch> -m "Merge <worktree.branch>: <part title>"
\`\`\`

Run the project's checks (its tests, typecheck) after each merge, and fix what the merge broke.

On a merge conflict, \`git status\` lists the files. Resolve it only if both sides' briefs and reports make the
right result clear; then \`git add\` the files, \`git commit\`, and run the checks. If you can't, run
\`git merge --abort\`, merge nothing more that touches those files, and stop to ask the person: which branches,
which files, what each side wanted. Never make a conflict go away by taking one side wholesale (\`-X ours\`,
\`-X theirs\`, \`git checkout --theirs\`).

Never \`git push\`, never open a pull request (\`gh pr create\` or otherwise), never rebase, reset or force anything,
and don't delete the workers' branches or worktrees: the person removes them with \`sldev clean\` after reviewing.

## 6. Optionally, a second agent reviews the merged result

\`sldev review\` is refused from inside a pane. With a place left, start a read-only reviewer: its worktree branches
from your branch, so it sees everything you merged.

\`\`\`bash
r=$(sldev new --print --kind review --agent codex --worktree conduct/<task>-review \\
  "Review the changes from $start to HEAD (git diff $start..HEAD): <what the task was>. Look for bugs, parts that don't fit together, and missing tests.")
sldev wait "$r" --for done --timeout 300    # again until it's done
sldev read "$r" --lines 200
\`\`\`

Fix what it finds that you agree with (commit it), and list the rest in your report. Without a place left, suggest in
the report that the person runs \`sldev review $SLDEV_MISSION_ID --agent <id>\` from their own terminal.

## 7. Report

Your final reply, for the person who reviews your branch:

- The task and your branch (\`git branch --show-current\`), with \`git log --oneline $start..HEAD\`.
- Each worker: pane id, agent, branch, what it did (from its report), and whether it was merged; if not, why.
- The checks you ran after merging and what they said; the review's findings if there was one.
- What's left: failed parts, conflicts you stopped on, follow-ups, anything sldev refused.

Say that nothing was pushed and the branch is ready for their review.
`
}

export const CLI_SKILLS: SkillSet = { skills: [CONDUCTOR], version: CLI_SKILLS_VERSION }
