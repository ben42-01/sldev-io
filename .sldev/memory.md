# Project memory

Things agents and people learned about this project. sldev-io points every mission here.
Edit freely: remove what is no longer true. Commit it to share it with your team.

- 2026-10-30: For review tasks, inspect untracked files explicitly with git status --short and read them; git diff alone omits them. (codex, mission "Review: have a look at gh-stats npm script and see if you ca")
- 2026-11-05: node-pty is N-API, so the root node_modules build (rebuilt for Electron) also loads under plain Node: the CLI tests in cli/test spawn real ptys with it. @xterm/headless has only a CJS default export under Node ESM; load it with createRequire (cli/src/screen.ts). Tests that host the daemon in-process must not use execFileSync/spawnSync against it, because that blocks the daemon's replies. (claude, mission "SLDEV IO Free Cli Version") · files: cli/src/screen.ts, cli/test/daemon.test.ts, src/main/pty.ts
