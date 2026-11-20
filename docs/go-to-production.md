# sldev-io: going to production

A step-by-step guide from "works on my machine" to "people download it, star it and sponsor it".

> **2026-11-20: sldev-io is free and open source (Apache-2.0).** Payments, Polar, license keys, the trial and the
> beta window were removed from the app and the website. The phases about them are gone from this guide; support
> comes from GitHub stars and [GitHub Sponsors](https://github.com/sponsors/ben42-01). Older notes below that still
> mention a price describe history, not the plan.
It's written to be followed in order. Every step says **who** does it:

- 🧑 **You**: accounts, legal, decisions. Things only the owner can do.
- 🤖 **Claude**: code changes. Each comes with a prompt you can paste into a new session.
- ✅ **Done**: already built and tested.

Last updated: 2026-10-24. Prices and provider details change; anything marked *(check)* should be
confirmed on the provider's site when you get there.

---

## Contents

1. [The big picture](#1-the-big-picture)
2. [Phase 1: Accounts and setup](#2-phase-1-accounts-and-setup)
3. [Phase 2: Public beta](#3-phase-2-public-beta)
6. [Phase 5: Legal and business](#6-phase-5-legal-and-business)
7. [Phase 6: Code signing](#7-phase-6-code-signing)
8. [Phase 7: Launch day](#8-phase-7-launch-day)
9. [After launch: day-to-day operations](#9-after-launch-day-to-day-operations)
10. [Reference](#10-reference)

---

## 1. The big picture

### The pieces

```
                         ┌──────────────────────────────┐
                         │  sldev-io (this repo, PUBLIC) │
                         │  source code + workflows      │
                         └──────────────┬───────────────┘
              push release/x.y.z        │        push master
          ┌─────────────────────────────┴───────────────────────┐
          ▼                                                     ▼
┌───────────────────────────┐                      ┌───────────────────────────┐
│ GitHub Actions: Release   │                      │ Vercel: website/          │
│ builds Linux/Win/macOS    │                      │ sldev.io                  │
└─────────────┬─────────────┘                      │  • landing, docs, privacy │
              │ uploads installers                 │  • /download/<os>         │
              ▼                                    │  • Star / Sponsor links   │
┌───────────────────────────┐                      └──────┬──────────────┬─────┘
│ sldev-io GitHub Releases  │◄── "Download" button ───────┘              │
│ only installers, no code  │                                            │
└─────────────┬─────────────┘                                            │
              │ download + auto-update                                    │
              ▼                                                           │
┌───────────────────────────┐   links only (About, docs); no API calls   │
│ The app on a user's PC    │────────────────────────────────────────────┘
│ (free, no license)        │
└───────────────────────────┘
```

### What exists today

| Piece | Status |
|---|---|
| App (terminals, agents, missions, …) | ✅ |
| CI on every push | ✅ |
| Release workflow (builds all OSes, attaches to a GitHub release **in this private repo**) | ✅ |
| Website with OS-aware downloads, `install.sh`, Star and Sponsor links | ✅ (sldev-io.vercel.app) |
| Publishing installers to this repo's GitHub Releases (older than 3 days deleted) | ✅ |
| Auto-update in the app (`src/main/updater.ts`) | ✅ Windows and Linux .deb install updates; macOS shows "Download" until it's signed |
| Settings → About (version, updates, diagnostics, legal links) | ✅ |
| Code signing (macOS / Windows) | 🧑 accounts + 🤖 wiring (Phase 6) |
| Privacy policy | ✅ at `/privacy`; 🧑 fill in `site.json` → `legal` |
| Open source | ✅ Apache-2.0 `LICENSE`; 🧑 make `ben42-01/sldev-io` public and turn on GitHub Sponsors |

### Decisions already made

- **Free and open source** (Apache-2.0) since 2026-11-20: no price, no license keys, no trial, no beta window. Support is
  GitHub stars and GitHub Sponsors; sponsoring unlocks nothing.
- Downloads and the auto-update feed: GitHub Releases of `ben42-01/sldev-io` (public since 2026-11-20).
  `ben42-01/downloads.sldev.io` now only carries the CLI's `cli` branch, the public skills and the CLI site.
- No telemetry. The website self-hosts its fonts and loads nothing from third parties.

### Decisions still open

| Decision | Recommendation | Needed by |
|---|---|---|
| Apple Developer account ($99/year) | Before launch: removes the Gatekeeper warning and enables macOS auto-update | Phase 6 |

---

## 2. Phase 1: Accounts and setup

**Goal:** everything public-facing has a home. **Time:** about 1–2 hours of your time, plus
waiting for verifications. Start Apple (2.6) early, because its review takes days.

### 2.1 🧑 Domain

> **Current state:** the site runs at **https://sldev-io.vercel.app** and `site.json` → `url` points
> there, and the app links to it from Settings → About. When you buy `sldev.io`, add it
> to the same Vercel project. The `.vercel.app` address keeps working, so builds already pointing at
> it stay fine. Then switch `url` and the `og:` tags in `website/index.html` to the new domain.

1. Make sure you own `sldev.io` (or choose the domain you'll use). The app links to
   `https://<domain>/privacy` and `/download/<os>`.
2. If the domain is **not** `sldev.io`, change `url` in `website/src/content/site.json`.
   That one field feeds both the website and the app build.

### 2.2 🧑 Deploy the website on Vercel

1. Sign in to [vercel.com](https://vercel.com) with GitHub. Click **Add New → Project** and
   import `ben42-01/sldev-io`. Give Vercel access to that private repo when asked.
2. Set **Root Directory** to `website`. Framework, build command and output come from
   `website/vercel.json`, so leave them as detected.
3. Deploy, then open the `*.vercel.app` URL and check the page.
4. **Project → Settings → Domains**: add `sldev.io` (and `www.sldev.io`). Set the DNS records
   Vercel shows at your registrar, and wait until both show "Valid".
5. **Plan**: Vercel's free Hobby plan is for personal, **non-commercial** use *(check
   vercel.com/pricing)*. A free open-source project with a GitHub Sponsors link is generally fine on Hobby; read the
   current terms before you add anything that sells.

From now on, every push to `master` that touches `website/` redeploys the site.

### 2.3 🧑 Public downloads repo (CLI and skills only)

> Since 2026-11-20 app installers are released in `sldev-io` itself. The downloads repo and `RELEASES_TOKEN` are
> still used by `cli-publish.yml`, `cli-site.yml` (the redirect from the old CLI site) and `npm run skills:publish`.

1. The repo `ben42-01/downloads.sldev.io` exists and is public. It needs **at least one commit**
   because GitHub can't attach releases to an empty repo: open it on GitHub and click **Add a
   README**, e.g. "Installers for sldev-io. Get it at https://sldev.io", then commit to `main`.
   Optional: Settings → turn off Wiki and Projects; keep Issues on if you want bug reports there.
2. Create a token the release workflow can use to upload there:
   1. GitHub → your avatar → **Settings → Developer settings → Personal access tokens →
      Fine-grained tokens → Generate new token**.
   2. Name: `sldev-io release upload`. Expiration: 1 year (put a reminder in your calendar).
   3. **Repository access → Only select repositories → `downloads.sldev.io`**.
   4. **Permissions → Repository permissions → Contents: Read and write**. Leave everything
      else as "No access".
   5. Generate and copy the token. It's shown only once.
3. Save it in the **source** repo: `ben42-01/sldev-io` → **Settings → Secrets and variables →
   Actions → New repository secret**. Name: `RELEASES_TOKEN`. Value: the token.
4. ✅ The website's download buttons go through `/download/<windows|mac|mac-intel|linux>`
   (`website/api/download.ts`, a Vercel function), which redirects to the matching installer of
   the newest release in this repo, betas included. Nothing to change per release. `install.sh`
   on the site uses the same redirects.

> Never paste the token into chat, a file, or a commit. Only into the GitHub secret field.

### 2.4 🧑 Support email

Set up an address people can reach, e.g. `support@sldev.io`, using your domain's email
forwarding or a mailbox. Put it in `contactEmail` in `site.json`.

### 2.6 🧑 (Optional for the beta) Apple Developer Program

Removes the Gatekeeper warning and enables macOS auto-update. Enrolment can take a few days. See
[Phase 6](#7-phase-6-code-signing).

### Phase 1 checklist

- [ ] Domain owned; `site.json` → `url` correct
- [ ] Website live on the domain
- [ ] `downloads.sldev.io` public repo created
- [ ] `RELEASES_TOKEN` secret added to `sldev-io`
- [ ] `https://<site>/download/windows` redirects to the newest `.exe`
- [ ] Support email working; `site.json` → `contactEmail` set
- [ ] `ben42-01/sldev-io` public (after a last check for secrets in its history) and GitHub Sponsors turned on

---

## 3. Phase 2: Public beta

**Goal:** anyone can download `0.1.0-beta.2`; it updates itself; you control when the free beta
starts and ends.

### 3.1 Publishing ✅ and auto-update ✅

✅ The release workflow publishes to this repo's GitHub Releases (pre-releases for `-beta`
versions) and deletes releases older than 3 days. The website's download buttons and
`install.sh` serve the installers (deb, exe, two dmgs); the release also carries what
electron-updater reads (`latest*.yml`, `.blockmap`, the macOS zip).

✅ Auto-update (`src/main/updater.ts`, electron-updater): checks 15 s after start and every 6 h.
Beta builds follow pre-releases, stable builds only stable releases.
- **Windows**: downloads in the background, installs on quit or via "restart to update".
- **Linux (.deb)**: downloads in the background; "restart to update" asks for the password (pkexec).
- **macOS**: Squirrel.Mac only installs signed apps, so unsigned builds show "update available",
  which opens the website download. After Phase 6 signing, set `manual` to false in `updater.ts`.
- `0.1.0-beta.2` has no updater: its users install `beta.3` by hand once. The first automatic
  update is `beta.3 → beta.4`; test it on one machine per OS before announcing.

### 3.3 🧑 Cut the release

From the repo root, with a clean `master`:

```bash
# 1. set the version (no git tag; the workflow handles that)
npm version 0.1.0-beta.2 --no-git-tag-version
git commit -am "Release v0.1.0-beta.2"
git push origin master

# 2. push a release branch with the same name: this starts the build
git switch -c release/0.1.0-beta.2
git push -u origin release/0.1.0-beta.2
git switch master

# 3. watch it (10–20 minutes)
gh run watch $(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

Or ask Claude: "cut release 0.1.0-beta.2". The `cut-release` skill does the same steps and
asks before pushing.

### 3.4 🧑 Verify before announcing

- [ ] The release in `sldev-io` lists the `.deb`, the `-setup.exe` and the `.dmg`s (x64 and
      arm64), plus the update files: `latest*.yml`, `.blockmap`s and the macOS `.zip`s
- [ ] The website's Download button downloads the installer for your OS, and
      `curl -fsSL https://<site>/install.sh | sh` installs it on Linux and macOS
- [ ] Install on at least one machine per OS you can reach; the app opens and shows the right
      beta chip/banner for your dates
- [ ] Set `endsAt` to yesterday on a test branch deploy (or ask Claude to run `npm run e2e -- beta`)
      to see the ended screen; then restore the real date
- [ ] Install beta.3, release a `beta.4`, and confirm the app offers and installs the update (Settings → About)

Unsigned builds show warnings: on Windows click "More info → Run anyway"; on macOS right-click
the app → Open (or `xattr -cr /Applications/sldev-io.app`). The website FAQ already says so.

### 3.5 🧑 Announce

Places developers look: Hacker News "Show HN", Reddit (r/commandline, r/ClaudeAI, r/ChatGPTCoding),
X/Bluesky, dev.to, Product Hunt. Collect feedback in GitHub
issues on the **public** releases repo (enable Issues there) or a Discord.

---

## 6. Phase 5: Legal and business

> This is a checklist, not legal or tax advice. A short call with an accountant is worth it once
> money comes in.

### Business basics (UK sole trader example)

- The provider pays you **after** VAT. You report that income yourself (e.g. Self Assessment in the UK).
- Keep the provider's payout reports; they're your sales records.
- If you later form a company, update the provider account, the signing certificates
  (organization name) and the legal pages.

---

## 7. Phase 6: Code signing

Unsigned works, but signing removes the scary warnings that put new users off.

### macOS

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) (about $99/year).
   An individual enrolment shows your personal name. An organization needs a D-U-N-S number.
2. In Xcode or on developer.apple.com, create a **Developer ID Application** certificate.
   Export it as a `.p12` file with a password.
3. Create an **app-specific password** at appleid.apple.com, and note your **Team ID**
   (Membership page).
4. Add these secrets to `ben42-01/sldev-io` (Settings → Secrets → Actions):

| Secret | Value |
|---|---|
| `CSC_LINK` | the `.p12` file, base64-encoded (`base64 -w0 cert.p12`) |
| `CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password |
| `APPLE_TEAM_ID` | your Team ID |

5. 🤖 "Wire macOS signing and notarization into the release workflow using those secrets (see
   docs/go-to-production.md, Phase 6), and keep unsigned builds working when the secrets are missing."

### Windows (nice to have)

- **Azure Artifact Signing** (formerly Trusted Signing, ≈ $10/month) is the cheapest option, but
  it's only open to **individuals in the USA/Canada** or **organizations** in the EU/UK, as of 2026
  *(check)*. As a UK individual you'd need a company first.
- Otherwise buy an **OV code-signing certificate** from a CA (DigiCert, Sectigo, Certum, SSL.com),
  roughly $150–300/year. Certificates now live on a hardware token or a cloud signing service,
  so tell Claude which one you choose; the CI setup differs.
- Without signing, Windows SmartScreen warns until the app builds up reputation.

---

## 8. Phase 7: Launch day

### Two weeks before (T-14)

- [ ] Phases 1–6 done (Windows signing optional)
- [ ] 1.0 features frozen: every box under "Before launch" in `docs/v1-roadmap.md` ticked
- [ ] Decide the launch date
- [ ] Write the launch post (Show HN, Reddit, X/Bluesky): lead with "free and open source", link the repo

### One week before (T-7)

- [ ] Release candidate: push a `release/<version>-rc.1`, install it, test the main flows
- [ ] Privacy page live; README has screenshots, a GIF and the Star / Sponsor lines

### Launch day (T-0)

1. Make `ben42-01/sldev-io` public (Settings → General → Danger zone → Change visibility).
2. Release: `npm version <version> --no-git-tag-version`, commit, push `release/<version>`. Wait for green.
3. Set `site.json` → `version`; push `master` → the site redeploys.
4. Post the announcement and answer the first issues quickly: early stars come from the first day's thread.

---

## 9. After launch: day-to-day operations

| Situation | What to do |
|---|---|
| Ship an update | `npm version 1.0.1`, push `release/1.0.1`. Users auto-update |
| Token expiring | `RELEASES_TOKEN` expires after a year: create a new one (Phase 1, 2.3) and replace the secret |
| Signing certificate expiring | Renew with Apple/the CA; replace the `CSC_*` secrets |

---

## 10. Reference

### Config files you edit

| File | Field | Effect |
|---|---|---|
| `website/src/content/site.json` | `url` | Website domain; the app links to it (baked in at app build time) |
| | `sourceUrl` / `sponsorUrl` | The repo and GitHub Sponsors page: Star and Sponsor in the app and on the site |
| | `downloadUrl` | Where "download" links outside the site point (the site's download section) |
| | `version` | Version shown on the site |
| | `contactEmail` | Footer and support links |
| `package.json` | `version` | App version; `-beta.N` = a GitHub pre-release |

### Secrets and environment variables

| Name | Where | Phase |
|---|---|---|
| `RELEASES_TOKEN` | GitHub secret, `sldev-io` repo | 1 |
| `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | GitHub secrets, `sldev-io` repo | 6 |
| `SLDEV_SITE_URL` | Optional, at app build time, to point a test build at a preview site | any |

Never commit any of these, and never paste them into a chat.

### Running costs (approximate, check current prices)

| Item | Cost |
|---|---|
| Domain (`.io`) | ~£30–60 / year |
| Vercel Hobby | free |
| GitHub (public source, releases repo, Sponsors) | free; GitHub takes no fee on personal sponsorships |
| Apple Developer Program | ~$99 / year |
| Windows OV certificate (optional) | ~$150–300 / year |

### Commands cheat sheet

```bash
npm run dev:nosandbox                 # run the app in development
npm run typecheck && npm test         # checks
npm run e2e -- about                  # Settings → About with Star and Sponsor
cd website && npm run dev             # website locally (http://localhost:5173)
npm version 0.1.0-beta.3 --no-git-tag-version && git commit -am "Release v0.1.0-beta.3" && git push
git switch -c release/0.1.0-beta.3 && git push -u origin release/0.1.0-beta.3 && git switch master
```

### Related documents

- `docs/funding.md`: why it's free, and how it can pay for itself
- `website/README.md`: how the website works
- `README.md` → "CI and releases": the release workflow in detail
- `AGENTS.md`: for Claude and other agents working on the code

### Sources checked for this guide (2026)

- Vercel Hobby non-commercial restriction: [third-party summary](https://deploywise.dev/blog/vercel-free-tier-limits-2026), check vercel.com's terms
- Windows signing: [Microsoft code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options),
  [DevClass on Artifact Signing](https://devclass.com/2026/01/14/code-signing-windows-apps-may-be-easier-and-more-secure-with-new-azure-artifact-service/)
- macOS notarization with electron-builder: [electron.build/docs/notarization](https://www.electron.build/docs/notarization)

## The free CLI

`.github/workflows/cli-publish.yml` (manual: Actions → Publish CLI → Run workflow) builds `cli/` and force-pushes it as a
standalone package to the `cli` branch of `ben42-01/downloads.sldev.io`, tagged `cli-v<version>`, using `RELEASES_TOKEN`.
Users install it with `npm i -g github:ben42-01/downloads.sldev.io#cli`. Bump `cli/package.json` first. It makes no GitHub
release there, so the app updater and `/download` don't see it. Moving to npm later: `npm publish` from `cli/` once the name is free.

### The CLI's pages

Since 2026-11-20 the CLI's home page is part of the sldev site: `/cli` and `/cli/commands` (`website/src/cli/`), deployed
with the rest of the website. After changing the CLI's help or version, run `npm run cli-help` in `website/` and commit
`website/src/cli/cliHelp.json` (`npm test` fails until you do).

The old GitHub Pages site (`https://ben42-01.github.io/downloads.sldev.io/`) still serves the last deploy. Once the sldev
site is live on Vercel, run **Actions → Redirect the old CLI site** once (`.github/workflows/cli-site.yml`): it replaces
the downloads repo's `gh-pages` branch with pages that forward to `/cli` and `/cli/commands`.
