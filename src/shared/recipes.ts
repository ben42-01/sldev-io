/** Recipes that ship with the app. "Add to project" copies one to .sldev/factory/ for editing. */
export const BUILTIN_RECIPES: Array<{ slug: string; text: string }> = [
  {
    slug: 'feature',
    text: `name: Feature
description: Spec, build, check, review, pull request. You approve the spec and the review.
stages:
  - id: spec
    agent: Spec writer
    prompt: |
      Write a short spec for this change: {intent}
      Save it to {out}. Don't change any code.
    gate: approve
  - id: build
    agent: Implementer
    prompt: |
      Implement the spec in {spec.out}.
      Commit your work when the checks pass.
  - id: verify
    run: [typecheck?, lint?, test?]
    onFail: { retry: build, max: 2 }
  - id: review
    agent: Reviewer
    prompt: |
      Review the changes on this branch against the spec in {spec.out}.
      Write your findings to {out}.
    gate: approve
  - id: pr
    pr:
      title: "{intent}"
      body: "{spec.out}"
`
  },
  {
    slug: 'bug-fix',
    text: `name: Bug fix
description: Reproduce with a failing test, fix it, check, pull request.
stages:
  - id: reproduce
    agent: Test writer
    prompt: |
      Write a test that reproduces this bug and fails for the reported reason: {intent}
      Don't fix the bug. Explain in {out} what the test shows.
  - id: fix
    agent: Fixer
    prompt: |
      Fix the bug described in {reproduce.out} so that the new test passes.
      Commit when done.
  - id: verify
    run: [typecheck?, test?]
    onFail: { retry: fix, max: 2 }
  - id: pr
    pr:
      title: "Fix: {intent}"
      body: "{reproduce.out}"
`
  },
  {
    slug: 'parallel-feature',
    text: `name: Parallel feature
description: One spec, two agents build separate parts at the same time, merged and checked together.
stages:
  - id: spec
    agent: Spec writer
    prompt: |
      Write a short spec for: {intent}
      Split the work into two independent parts named "Part A" and "Part B". Save it to {out}.
    gate: approve
  - id: part-a
    needs: [spec]
    agent: Implementer
    prompt: Implement Part A of {spec.out}. Only Part A. Commit when done.
  - id: part-b
    needs: [spec]
    agent: Implementer
    prompt: Implement Part B of {spec.out}. Only Part B. Commit when done.
  - id: verify
    needs: [part-a, part-b]
    run: [typecheck?, test?]
    onFail: { retry: [part-a, part-b], max: 1 }
  - id: pr
    pr:
      title: "{intent}"
      body: "{spec.out}"
`
  },
  {
    slug: 'bake-off',
    text: `name: Bake-off
description: The same task on two agents at once. Compare their diffs, keep the best, check it, open the PR.
stages:
  - id: build
    agent: [Implementer@claude, Implementer@codex]
    prompt: |
      {intent}
      Commit your work when done.
  - id: verify
    run: [typecheck?, lint?, test?]
  - id: pr
    pr:
      title: "{intent}"
      body: "{build.out}"
`
  },
  {
    slug: 'fix-ci',
    text: `name: Fix CI
description: Find out why CI fails, fix it, check locally, open the PR.
stages:
  - id: diagnose
    agent: Fixer
    prompt: |
      CI is failing on {base}. {intent}
      Use the GitHub CLI to find out why, for example:
        gh run list --branch {base} --limit 5
        gh run view <run id> --log-failed
      Write the cause and the fix you plan to {out}. Don't change code yet.
  - id: fix
    agent: Fixer
    prompt: |
      Fix the CI failure described in {diagnose.out}.
      Commit when done.
  - id: verify
    run: [typecheck?, lint?, test?]
    onFail: { retry: fix, max: 2 }
  - id: pr
    pr:
      title: "Fix CI: {intent}"
      body: "{diagnose.out}"
`
  },
  {
    slug: 'software-team',
    text: `name: Software team
description: The Software team's roles at work. Product owner specs it, implementer builds, reviewer and QA check it side by side, implementer fixes what they found, release manager drafts the PR. You approve the spec and push.
stages:
  - id: spec
    agent: Product owner
    prompt: |
      Write a short spec for this change, not board stories: {intent}
      Goal, scope and non-goals, the files likely to change, acceptance criteria as a checklist, and how to check it.
      Save it to {out}. Don't change any code.
    gate: approve
  - id: build
    agent: Implementer
    prompt: |
      Implement the spec in {spec.out}.
      Run the project checks and commit your work when they pass.
  - id: review
    needs: [build]
    agent: Reviewer
    prompt: |
      Review the changes on this branch since {base} against the spec in {spec.out}.
      Write your findings and your verdict to {out}. Don't edit any other file.
  - id: qa
    needs: [build]
    agent: QA
    prompt: |
      Check the changes on this branch against the acceptance criteria in {spec.out}.
      Run the project's checks and add tests for behaviour nothing covers yet; commit them.
      Write each check (command, pass or fail, the failing output) and any product bugs to {out}.
  - id: fix
    needs: [review, qa]
    agent: Implementer
    prompt: |
      Fix what the reviewer found in {review.out} and what QA found in {qa.out}.
      Run the project checks and commit when they pass.
      Write what you fixed, and what you left and why, to {out}.
  - id: release
    agent: Release manager
    prompt: |
      Draft the pull request description for this branch: {intent}
      Read the spec in {spec.out}, the review in {review.out}, the QA report in {qa.out}, the fixes in {fix.out}
      and the commits since {base}. Write it to {out} as Markdown: what changed and why, how it was checked,
      and the risks for the reviewer. Don't edit any other file.
  - id: pr
    pr:
      title: "{intent}"
      body: "{release.out}"
`
  }
]
