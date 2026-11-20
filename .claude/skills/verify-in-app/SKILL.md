---
name: verify-in-app
description: Run sldev-io for real and check a change works, using the Electron e2e harness with fake agent CLIs and screenshots. Use after any UI or behaviour change, when asked to "test it", "check it works", "take a screenshot", or when writing a new e2e scenario.
---

# Verify a change in the real app

The harness at `scripts/e2e/run.cjs` boots the **built** app (`out/`) and gives it:
- a temp `userData`, so it never touches `~/.config/sldev-io`
- a throwaway git repo (`h.fixture`) with `package.json` and `src/app.js`
- `scripts/e2e/fakebin/` first on PATH, so fake `claude`/`codex` run instead of real ones

## Run

```bash
npm run e2e -- smoke       # builds first; then runs scripts/e2e/scenarios/smoke.cjs
npm run e2e -- missions
# already built? skip the build:
npx electron --no-sandbox scripts/e2e/run.cjs <scenario>
```

PASS/FAIL lines print to stdout, and the exit code is 1 on any failure. Everything is saved in
`.e2e-out/<scenario>/`: `console.log` (renderer console + results) and `*.png`. **Open the
screenshots** with the Read tool; a passing assertion doesn't mean the UI looks right.

## Write a scenario

`scripts/e2e/scenarios/<name>.cjs` exports `async (h) => {}`. Helpers:

| helper | what it does |
|---|---|
| `h.openFixture(settings?)` | open the fixture project (notifications off) and reload |
| `h.key('T', ['control','shift'])` | send a shortcut (app shortcuts: see `lib/commands.ts`) |
| `h.type('text\r')` | type into the focused element or terminal |
| `h.click(selector, text?)` | click the first match (optionally containing text) |
| `h.setValue(selector, value, pickExpr?)` | set a React-controlled input/select/textarea; `pickExpr` is JS on `e` to choose among matches |
| `h.js(code)` | evaluate in the renderer (`window.api.*` is available) |
| `h.until(fn, timeoutMs?)` | poll an async check until it's truthy (use for time-based status changes) |
| `h.reload()` | reload the renderer, which acts like a new launch |
| `h.wait(ms)`, `h.shot(name)`, `h.expect(cond, msg)`, `h.log(...)` | |

Tips:
- Terminals render with WebGL, so their text isn't in the DOM. Assert on side effects
  (`echo x > file`, then `fs.existsSync(path.join(h.fixture, 'file'))`) or on app state in the DOM.
- Seed persisted data before `openFixture` with `h.js("window.api.store.set('tasks', {...})")`.
- Status heuristics and fake hooks are time-based (idle = 5 s; each fake Claude hook spawns a
  process). Prefer `h.until(...)` over fixed waits.
- New agent? Add a fake to `scripts/e2e/fakebin/<bin>` (chmod +x) that behaves like the real CLI
  for what you test.

## Never in tests

No real `claude`/`codex`/… runs, no real workflow dispatch, no `git push`, no writes to the
user's real repos or `~/.config/sldev-io`.
