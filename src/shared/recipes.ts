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
  }
]
