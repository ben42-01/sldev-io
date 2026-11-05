---
name: add-agent-cli
description: Add a new built-in coding-agent CLI to sldev-io (or fix an existing one's flags), so missions and tasks can run it. Use when asked to support another agent (Aider, Amp, Goose, Kiro, …) or when an agent's command line is wrong.
---

# Add or fix an agent CLI

Every agent is defined once in `src/shared/agents.ts` (the renderer re-exports it from `lib/agents.ts`; the sldev CLI uses it too). The UI (agent picker, model,
effort and approval fields, Settings → Agents, mission badges) reads from that registry, so no
other UI changes are needed.

## 1. Check the real CLI first

Don't guess flags. Get them from the tool itself (`<bin> --help`, or `<bin> <subcommand> --help`
if installed) or its official docs. You need:
- the binary name (`bin`): this is what PATH detection looks for
- how to start an **interactive** session with an initial prompt (positional arg? `-i`? `--prompt`?)
- the **non-interactive** form, if any (`-p`, `exec`, `run`)
- **resume**: continue the latest session (`--continue`, `resume --last`, …)
- the model flag, approval/permission flags, and an effort/reasoning flag if there is one
- the official install command

## 2. Add the definition

Copy a similar agent in `agents.ts` and add it to `BUILTIN_AGENTS`:

```ts
const myagent: AgentDef = {
  id: 'myagent', name: 'My Agent', bin: 'myagent', install: '…',
  models: [],                 // only aliases that are stable; free text is always allowed
  modelPlaceholder: 'default',
  modes: [{ value: 'auto', label: 'Auto-approve' }],   // '' (default) is implicit
  efforts: [],
  hooks: false,               // true only for Claude Code (status via hooks)
  canPrint: true, canResume: true,
  build: (o, prompt, _name, { resume }) => ['myagent', ...flag(o.model, '--model', q(o.model ?? '')), …]
}
```

Rules:
- Quote anything user-supplied with `q()`. `extraArgs(o)` is appended raw on purpose.
- With `resume`, don't re-send the prompt.
- An empty prompt must give a bare interactive session.

## 3. Status tracking

Non-hook agents are tracked from the terminal (`state/missions.ts`): output means *Working*,
5 s of silence means *Ready for you*, and a bell, OSC 9/777 or an approval prompt on screen means
*Needs you*. Set `asks` to what its approval prompt says (run it, trigger one, copy the question and
the option labels); most agents wait in a dialog without a bell, and without `asks` only the generic
patterns in `src/shared/attention.ts` catch it. Set `usageLimit` the same way. If the CLI has
its own notification hook (e.g. a config option that runs a command when a turn ends), it can
call the relay the way Claude's hooks do (see `src/main/hooks.ts`). Treat that as a separate,
deliberate feature.

## 4. Test

- `test/agents.test.ts`: add rows to the cases table for interactive, print and resume.
- `scripts/e2e/fakebin/<bin>`: a fake that prints, goes quiet, rings `\a`. Then extend
  `scenarios/missions.cjs` or copy it, and run `npm run e2e -- missions` (see `verify-in-app`).
- `npm run typecheck && npm test`.

## 5. Docs

Update the agent list in `README.md` (intro + "How missions track agents") and `AGENTS.md`.
