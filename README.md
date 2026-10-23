# sldev

Agentic coding workspace: dockable terminals, a file explorer, and (soon) runtimes, agent missions,
skills, GitHub workflows, notes and SSH. See [ROADMAP.md](ROADMAP.md).

## Develop

```bash
npm install          # also rebuilds node-pty for Electron
npm run dev          # hot-reloading dev app
npm run typecheck
```

On Ubuntu 23.10+ Electron may abort with a `chrome-sandbox` / SUID sandbox error. Either fix the helper once:

```bash
sudo chown root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

or run `npm run dev:nosandbox`.

## Installers

```bash
npm run dist:linux   # AppImage, deb, rpm
npm run dist:mac     # dmg, zip (on macOS)
npm run dist:win     # NSIS installer (on Windows)
```

node-pty is native, so each OS builds its own installer; `.github/workflows/release.yml` does
this on a `v*` tag.

## Layout

- `src/main`: Electron main process (pty manager, filesystem, editor detection, persistence)
- `src/preload`: the `window.api` bridge
- `src/renderer`: React UI; terminal sessions live in `lib/terminals.ts`, outside React
- `src/shared`: types shared by both sides
