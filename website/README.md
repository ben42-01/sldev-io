# The sldev site

The site of the sldev family: the sldev-io desktop app, the sldev CLI and sldev's agent skills. Vite + React + TypeScript, fully static, deployed on Vercel.
It is independent of the Electron app: its own `package.json` and lockfile.

```bash
cd website
npm ci
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
```

## Free and open source

sldev-io is free: no plans, no checkout, no license server. The home page's free band, the FAQ, the nav and the
footer link to the source (`sourceUrl`) and GitHub Sponsors (`sponsorUrl`) in `site.json`. The old `/pricing`,
`/terms`, `/refunds` and `/thanks` URLs redirect (`redirects` in `vercel.json`).

Other copy and links (version, download URL, supported agents, contact) live in
[`src/content/site.json`](src/content/site.json).

## Downloads

Nobody browses GitHub for an installer. The **Download** buttons detect the visitor's OS and link to
`/download/<windows|mac|mac-intel|linux>`; [`api/download.ts`](api/download.ts) (a Vercel function,
via the rewrite in `vercel.json`) redirects to the matching file of the newest release in
`ben42-01/sldev-io`, pre-releases included. The CDN caches each redirect for 5 minutes,
so a new release shows up within minutes and the GitHub API stays under its rate limit. Set a
`GITHUB_TOKEN` env var in Vercel only if it ever hits the limit. `npm run dev` serves the same
redirects.

[`public/install.sh`](public/install.sh) is the terminal install for macOS and Linux
(`curl -fsSL https://sldev-io.vercel.app/install.sh | sh`): it downloads the .deb (installed with
apt) or the right .dmg (copied into /Applications, quarantine flag removed) through those redirects.

## Pages

`/` is the family's home page (`src/App.tsx`, one card per product); `/app` is the desktop app's landing page
(`src/AppLanding.tsx`); `/cli` and `/cli/commands` are the CLI's (`src/cli/`, styles scoped under `.cli` in
`src/cli/cli.css`; after changing the CLI's help or version run `npm run cli-help` here and commit `src/cli/cliHelp.json`). Every other page has a `<name>/index.html` with
`data-page="<name>"`, rendered by `src/pages.tsx` inside the shared `Layout` (nav, footer) with a
`PageHeader`: `/features` (with the full FAQ), `/download`, `/changelog`, `/compare`, `/docs` and `/privacy`.
To add one: add the HTML file, an entry in `pages.tsx`, the name in `pages` in `vite.config.ts`
and a rewrite in `vercel.json`. Old one-page links (`/#download`, `/#features`, …) redirect to
their page (`src/main.tsx`).

## Privacy page

`/privacy` is rendered from [`src/content/legal.tsx`](src/content/legal.tsx). The owner's name, address and the
"last updated" date come from `legal` in
[`src/content/site.json`](src/content/site.json). The app links to them from Settings → About.
Fonts are self-hosted (`src/fonts.ts`), so the site loads nothing from third parties; keep it
that way or update the privacy page.

## Deploy on Vercel

1. Import the GitHub repo in Vercel.
2. Set **Root Directory** to `website`. The framework (Vite), build command and output directory
   come from `vercel.json`.
3. Add the domain under Project → Domains and update `url` in `site.json` and the `og:` tags in
   `index.html` if it is not `sldev.io`.
