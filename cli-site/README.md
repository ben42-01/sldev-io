# cli-site

The home page of the free sldev CLI: a static site (Vite + React) that can be hosted anywhere.
It shares nothing with `website/` or the app, so either can change alone; the only thing it reads from
the repo is the CLI's version, from `cli/package.json`, at build time.

```bash
npm ci
npm run dev
npm run build                                       # dist/, served from /
CLI_SITE_BASE=/downloads.sldev.io/ npm run build    # dist/ for GitHub Pages on the downloads repo
npm run preview                                     # serves dist/ (set the same CLI_SITE_BASE)
```

Content (tagline, install command, agents) is in `src/content/site.json`. The terminal mockup
(`src/components/TerminalMockup.tsx`) is drawn after `cli/src/render.ts`; update it when the TUI's look changes.
The page loads only its own files: fonts are self-hosted, no analytics. The CLI is free, not open
source: don't say otherwise or link its source.
