---
name: add-feature
description: Implement a feature in sldev-io end to end, such as a new sidebar view, dock panel, IPC call into the main process, persisted store or command-palette entry with a shortcut. Use when building or extending any app section (runtimes, tasks, missions, skills, workflows, notes, remote) or fixing a bug that crosses main/preload/renderer.
---

# Add a feature end to end

Read `AGENTS.md` first (architecture + invariants). Then follow the pieces you need, in order.

## Main-process capability (filesystem, git, network, child processes, secrets)

1. Put the logic in a module under `src/main/` (pure functions where possible, so they can be
   unit-tested like `github.ts`/`runtimes.ts` in `test/main.test.ts`).
2. Register `ipcMain.handle('area:verb', …)` in `src/main/index.ts` next to the related handlers.
3. Expose it in `src/preload/index.ts` under the matching `window.api.area` group, with explicit
   parameter and return types. Push events use `on('area:event', cb)`, which returns an unsubscribe.
4. Put shared types in `src/shared/types.ts`.

Secrets stay in main. Validate paths and arguments in main, because the renderer is untrusted.
Use `execFile`/`spawn` with argument arrays, never shell strings built from user input.

## Persisted data

- A new store file: add it to `StoreFiles` in `src/shared/types.ts`. It's then available through
  `window.api.store.get/set('<name>')`.
- A user setting: add it to `AppSettings` **and** `DEFAULT_SETTINGS` (old settings files merge over
  the defaults). Read it via `useStore(workspace, w => w.x)` and write it with `updateSettings()`.
- Changing the shape of stored data? Migrate on load (see `migrateTask` in `state/tasks.ts`).

## Renderer state

Put a store in `src/renderer/src/state/<area>.ts` using `createStore` and `useStore` from
`state/store.ts`. Keep logic there or in `lib/`, and keep components thin.

## Sidebar view

1. Add the id to `ViewId` in `state/workspace.ts`.
2. Add an entry to `VIEW_META` in `components/ActivityBar.tsx` (label + lucide icon).
3. Route it in `components/Sidebar.tsx`.
4. Build the view with `ViewShell` (from `RuntimesView.tsx`) for the header, filter and actions.
5. Add it to the `VIEWS` list in `lib/commands.ts`. That generates the `view.<id>` palette command
   and the `Ctrl+Shift+<n>` / `Cmd+<n>` shortcut from its position. Keep the order the same as `VIEW_META`.

## Dock panel

Register the component in `dock/Dock.tsx` and open it with `openPanel(component, id, title, params, 'right' | 'below')`
from `dock/dockApi.ts`. Terminals always go through `openTerminal()`, never a custom panel.

## Commands and shortcuts

Add to `staticCommands()` in `lib/commands.ts`: `{ id, category, title, keys?: { mac, other }, when?, run }`.
Check for shortcut collisions with existing entries and with terminal programs
(avoid plain Ctrl+letter, which belongs to the shell).

## Styling

Use classes in `styles/app.css` and the tokens on `:root`. Stay monochrome with sharp 2px corners
and outline buttons. Color comes only from the brand gradient or status colors.

## Done means

1. `npm run typecheck && npm test`
2. A unit test for any new pure logic
3. An e2e check and screenshots for UI (`verify-in-app` skill)
4. README/ROADMAP updated if the feature is user-visible
