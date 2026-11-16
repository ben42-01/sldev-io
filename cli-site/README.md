# cli-site

The home page of the free sldev CLI: a static site (Vite + React) that can be hosted anywhere.
It shares nothing with `website/` or the app, so either can change alone. At build time it reads two things
from the repo: the CLI's version (`cli/package.json`) and its help. Two pages: `/` and `/commands/`.

```bash
npm ci
npm run dev
npm run build                                       # dist/, served from /
CLI_SITE_BASE=/downloads.sldev.io/ npm run build    # dist/ for GitHub Pages on the downloads repo
npm run preview                                     # serves dist/ (set the same CLI_SITE_BASE)
```

`/commands/` is generated: `vite.config.ts` runs `npm run cli:build` at the repo root (so the root needs
`npm ci` too), then `node cli/dist/sldev.mjs help`, and `scripts/cliHelp.ts` parses it into sections (attach,
panes, loops, repo commands). Change the help in `cli/src/main.ts` and the next build shows it; nothing here
needs editing unless the help's column layout changes (test/cliSite.test.ts runs the parser on it).
Links between pages are relative (`commands/`, `../`), so the site works under any base path.

Content (tagline, install command, agents) is in `src/content/site.json`; the feature cards are in
`src/content/features.ts`, each linked to a command's anchor on `/commands/` (the test checks they exist). The terminal mockup
(`src/components/TerminalMockup.tsx`) is drawn after `cli/src/render.ts`; update it when the TUI's look changes.
The page loads only its own files: fonts are self-hosted, no analytics. The CLI is free, not open
source: don't say otherwise or link its source.
