# sldev-io: going to production

A step-by-step guide from "works on my machine" to "people download the beta, then pay for it".
It's written to be followed in order. Every step says **who** does it:

- 🧑 **You**: accounts, payments, legal, decisions. Things only the owner can do.
- 🤖 **Claude**: code changes. Each comes with a prompt you can paste into a new session.
- ✅ **Done**: already built and tested.

Last updated: 2026-10-24. Prices and provider details change; anything marked *(check)* should be
confirmed on the provider's site when you get there.

---

## Contents

1. [The big picture](#1-the-big-picture)
2. [Phase 1: Accounts and setup](#2-phase-1-accounts-and-setup)
3. [Phase 2: Public beta](#3-phase-2-public-beta)
4. [Phase 3: Payment provider (Polar or Lemon Squeezy)](#4-phase-3-payment-provider)
5. [Phase 4: Licensing](#5-phase-4-licensing)
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
                         │  sldev-io (this repo, PRIVATE)│
                         │  source code + workflows      │
                         └──────────────┬───────────────┘
              push release/x.y.z        │        push master
          ┌─────────────────────────────┴───────────────────────┐
          ▼                                                     ▼
┌───────────────────────────┐                      ┌───────────────────────────┐
│ GitHub Actions: Release   │                      │ Vercel: website/          │
│ builds Linux/Win/macOS    │                      │ sldev.io                  │
└─────────────┬─────────────┘                      │  • landing + pricing page │
              │ uploads installers                 │  • /beta.json (beta dates)│
              ▼                                    │  • /api/license/* (later) │
┌───────────────────────────┐                      └──────┬──────────────┬─────┘
│ sldev-io-releases (PUBLIC)│◄── "Download" button ───────┘              │
│ only installers, no code  │                                            │
└─────────────┬─────────────┘                                            │
              │ download + auto-update                                    │
              ▼                                                           │
┌───────────────────────────┐   reads /beta.json every 6 h               │
│ The app on a user's PC    │────────────────────────────────────────────┘
│ (beta build or paid build)│   later: activates license keys ──► /api/license ──► Polar / Lemon Squeezy
└───────────────────────────┘
```

### What exists today

| Piece | Status |
|---|---|
| App (terminals, agents, missions, …) | ✅ |
| CI on every push | ✅ |
| Release workflow (builds all OSes, attaches to a GitHub release **in this private repo**) | ✅ |
| Website with pricing from JSON | ✅ (not yet deployed, as far as this repo knows) |
| "Limited time" labels and beta countdown on the site | ✅ |
| Configurable beta window (`/beta.json` → app chip, banner, "beta ended" screen) | ✅ |
| Publishing installers to the **public** releases repo | 🤖 to build (Phase 2) |
| Auto-update in the app | 🤖 to build (Phase 2) |
| License keys: server + app screen + trial | 🤖 to build (Phase 4) |
| Payment provider products | 🧑 to set up (Phase 3) |
| Code signing (macOS / Windows) | 🧑 accounts + 🤖 wiring (Phase 6) |
| EULA, privacy policy, refund policy, terms | 🧑 to write or source (Phase 5) |

### Decisions already made

- Price: **Personal €10.99 one-time** (Team €50 for 5 seats, from `pricing.json`).
- Downloads: a **public GitHub repo** that you create (e.g. `ben42-01/sldev-io-releases`). The
  source repo stays private.
- `v0.1.0-beta.1` stays unpublished. The first public build is `0.1.0-beta.2`.
- The beta window is controlled from the website, never baked into builds.

### Decisions still open

| Decision | Recommendation | Needed by |
|---|---|---|
| Payment provider | Polar (Lemon Squeezy as fallback) | Phase 3 |
| Machines per Personal license | 3 | Phase 3 |
| Team license activations | 15 (5 people × 3 machines) | Phase 3 |
| Updates policy | Pay once, keep that version forever, 1 year of updates included | Phase 4 |
| Trial length for paid builds | 14 days | Phase 4 |
| Beta-tester discount | e.g. 30% for the first month after launch | Phase 7 |
| Beta start/end dates | Set when ready (Phase 2) | Phase 2 |

---

## 2. Phase 1: Accounts and setup

**Goal:** everything public-facing has a home. **Time:** about 1–2 hours of your time, plus
waiting for verifications. Start the payment provider (2.5) and Apple (2.6) early, because their
reviews take days.

### 2.1 🧑 Domain

1. Make sure you own `sldev.io` (or choose the domain you'll use). The app reads
   `https://<domain>/beta.json`, and links to `https://<domain>/#pricing`.
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
5. Check that `https://sldev.io/beta.json` returns `{"startsAt": null, "endsAt": null}`.
6. **Plan**: Vercel's free Hobby plan is for personal, **non-commercial** use *(check
   vercel.com/pricing)*. Upgrade the team to **Pro** before you take payments (≈ $20/month).

From now on, every push to `master` that touches `website/` redeploys the site.

### 2.3 🧑 Public downloads repo

1. GitHub → **New repository**: `sldev-io-releases`, **Public**, add a README. Example README
   text: "Installers for sldev-io. Get it at https://sldev.io".
2. Create a token the release workflow can use to upload there:
   1. GitHub → your avatar → **Settings → Developer settings → Personal access tokens →
      Fine-grained tokens → Generate new token**.
   2. Name: `sldev-io release upload`. Expiration: 1 year (put a reminder in your calendar).
   3. **Repository access → Only select repositories → `sldev-io-releases`**.
   4. **Permissions → Repository permissions → Contents: Read and write**. Leave everything
      else as "No access".
   5. Generate and copy the token. It's shown only once.
3. Save it in the **source** repo: `ben42-01/sldev-io` → **Settings → Secrets and variables →
   Actions → New repository secret**. Name: `RELEASES_TOKEN`. Value: the token.
4. Update `website/src/content/site.json`:
   ```json
   "downloadUrl": "https://github.com/ben42-01/sldev-io-releases/releases/latest"
   ```
   While only beta (pre-release) versions exist, "latest" shows nothing, so use
   `https://github.com/ben42-01/sldev-io-releases/releases` until the first stable release.

> Never paste the token into chat, a file, or a commit. Only into the GitHub secret field.

### 2.4 🧑 Support email

Set up an address people can reach, e.g. `support@sldev.io`, using your domain's email
forwarding or a mailbox. Put it in `contactEmail` in `site.json`. The payment provider will also
ask for a support address.

### 2.5 🧑 Start the payment provider account

Create the account now so verification runs while the rest gets built. Full steps are in
[Phase 3](#4-phase-3-payment-provider); for now just sign up and start identity verification.

### 2.6 🧑 (Optional for the beta) Apple Developer Program

Needed before paying macOS users arrive. Enrolment can take a few days. See
[Phase 6](#7-phase-6-code-signing).

### Phase 1 checklist

- [ ] Domain owned; `site.json` → `url` correct
- [ ] Website live on the domain; `/beta.json` reachable
- [ ] `sldev-io-releases` public repo created
- [ ] `RELEASES_TOKEN` secret added to `sldev-io`
- [ ] `site.json` → `downloadUrl` points at the releases repo
- [ ] Support email working; `site.json` → `contactEmail` set
- [ ] Payment provider sign-up started

---

## 3. Phase 2: Public beta

**Goal:** anyone can download `0.1.0-beta.2`; it updates itself; you control when the free beta
starts and ends.

### 3.1 🤖 Build: publish to the public repo + auto-update

Paste into a new Claude session:

> Read AGENTS.md and docs/go-to-production.md (Phase 2). Change the release workflow so installers
> are published to the public repo `ben42-01/sldev-io-releases` using the `RELEASES_TOKEN`
> secret (pre-release for `-beta` versions), keeping the private repo's release optional. Add
> auto-update with electron-updater from that repo: beta builds follow pre-releases, stable
> builds follow stable releases; check on start and every few hours, download in the
> background, and offer "Restart to update" in the status bar. Add an e2e or unit test where
> possible, update the README release section, then show me the diff before pushing.

What you'll get: the same `release/<version>` flow as today, but the files land in the public
repo, and installed apps update themselves.

### 3.2 🧑 Set the beta window

Edit `website/src/content/pricing.json`:

```json
"beta": {
  "startsAt": "2026-11-01",
  "endsAt": "2027-01-31",
  "label": "Limited time"
}
```

| Field | Meaning |
|---|---|
| `startsAt` | First day of the free beta (UTC). Before it, the site says "Free beta opens …". The app runs normally. `null` = already open. |
| `endsAt` | **Last free day** (until 23:59:59 UTC). `null` = no end yet: the app never locks. |
| `label` | Text of the tag on the free plans. |

Commit and push `master`; Vercel redeploys within a minute or two. Installed beta apps pick it up
on next start or within 6 hours.

What users see as the end approaches:

| Time left | Website | App |
|---|---|---|
| no `endsAt` | "Limited time only" | nothing |
| more than 14 days | countdown "Free beta ends in N days" | small "beta · N days left" in the status bar |
| 14 days or fewer | countdown | amber chip + dismissible banner with "Get sldev-io" |
| after `endsAt` | "The free beta has ended" | next launch shows the "beta ended" screen (data kept, never mid-session) |

To **extend**, move `endsAt` later and push. To **end now**, set `endsAt` to yesterday's date.
The "Check again" button on the ended screen re-reads the dates immediately.

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

- [ ] The release in `sldev-io-releases` lists: `.AppImage`, `.deb`, `.rpm`, `.exe`, `.dmg` (x64 and
      arm64), `.zip`, `SHA256SUMS.txt`, and (after 3.1) the `latest*.yml` files auto-update reads
- [ ] The website's Download button opens that page
- [ ] Install on at least one machine per OS you can reach; the app opens and shows the right
      beta chip/banner for your dates
- [ ] Set `endsAt` to yesterday on a test branch deploy (or ask Claude to run `npm run e2e -- beta`)
      to see the ended screen; then restore the real date
- [ ] (After 3.1) install beta.2, release a `beta.3`, and confirm the app offers the update

Unsigned builds show warnings: on Windows click "More info → Run anyway"; on macOS right-click
the app → Open (or `xattr -cr /Applications/sldev-io.app`). The website FAQ already says so.

### 3.5 🧑 Announce

Places developers look: Hacker News "Show HN", Reddit (r/commandline, r/ClaudeAI, r/ChatGPTCoding),
X/Bluesky, dev.to, Product Hunt (better saved for the paid launch). Collect feedback in GitHub
issues on the **public** releases repo (enable Issues there) or a Discord.

### Running the beta

| You want to… | Do this |
|---|---|
| Ship fixes | Bump to `0.1.0-beta.3`, push `release/0.1.0-beta.3`. Users auto-update (after 3.1). |
| Extend the beta | Move `endsAt` later in `pricing.json`, push. |
| End the beta early | Set `endsAt` to yesterday, push. |
| Pause new sign-ups | Not needed: downloads are public; control access with `endsAt`. |

---

## 4. Phase 3: Payment provider

**Goal:** a checkout page that takes €10.99 and emails a license key, tested in test mode.

Both providers are a **merchant of record**: they are the legal seller. They charge the customer,
handle EU/UK VAT and sales tax, issue invoices and refunds, and pay you out. You don't register for
VAT in every country.

### Comparison

| | Polar | Lemon Squeezy |
|---|---|---|
| Fees *(check)* | 5% + $0.50 per sale for new organizations (paid plans from $20/month lower it), plus international card and payout fees | about 5% + $0.50 per sale, no monthly fee |
| License keys | Built-in "License Keys" benefit with activation limits | Built-in, activation limit per product/variant |
| Test environment | Separate sandbox at `sandbox.polar.sh` (API `sandbox-api.polar.sh`) | "Test mode" toggle in the same store |
| Currency | Multi-currency pricing is documented, but EUR availability for your account should be confirmed *(check)* | Store currency can be EUR |
| Verdict | **Recommended**: developer-focused, good license API | Fine fallback if Polar's review is slow or EUR isn't available |

At €10.99, expect roughly **€1.00–1.30 per sale in fees** (about 10–12%).

### 4A. Polar, step by step

1. **Sign up** at [polar.sh](https://polar.sh) (GitHub login is fine). Create an
   **organization** named `sldev-io`. Its slug appears in checkout URLs.
2. **Settings → Organization**: add the website URL, support email and a short description of
   the product. Polar reviews organizations before they can sell, so be specific: "Desktop app
   for developers: a terminal workspace for AI coding agents, sold as a one-time license."
3. **Finance / Payouts**: connect a payout account (Stripe Connect Express) and finish identity
   verification. You can't receive money until this is done.
4. **Products → New product** (create it in the **sandbox** first, then repeat in production):
   - Name: `sldev-io Personal`
   - Description: one or two sentences plus "One-time payment. License for 1 developer, up to 3 machines."
   - Pricing: **One-time**, **fixed price**, **€10.99**. If EUR isn't offered for your
     account, use the closest USD price and tell Claude so the site shows the right currency.
   - **Benefits → Add benefit → License Keys**:
     - Prefix: `SLDEV` (keys look like `SLDEV-XXXX-…`)
     - **Activation limit: 3** (machines). Leave "require activation" on.
     - Expiration: **none** (lifetime key)
     - Usage limit: none
   - Save.
5. Repeat for **`sldev-io Team`**: €50, License Keys benefit with **activation limit 15**.
6. **Checkout links**: on each product, create a **checkout link** and copy its URL.
   - Success URL: `https://sldev.io/thanks` (Claude can add that page, or use the home page for now).
7. **Emails**: check that the customer receipt email includes the license key. It's part of the
   benefit, and customers can also find it in Polar's customer portal.
8. **IDs for Claude** (not secrets): Settings → copy the **Organization ID**. Products → copy
   each **Product ID**.
9. **Access token for the server**: **Settings → Developers → New token** (organization access
   token). Scopes: license keys read and write. Name: `sldev-io license server`.
   - Store it **only** in Vercel: Project → Settings → Environment Variables →
     `POLAR_ACCESS_TOKEN` (Production). Make a separate sandbox token for `Preview`.
10. **Test purchase in the sandbox** with Stripe's test card `4242 4242 4242 4242`, any future
    date and any CVC. Confirm you receive the email with a license key.

### 4B. Lemon Squeezy, step by step

1. **Sign up** at [lemonsqueezy.com](https://www.lemonsqueezy.com) and create a **store**
   (`sldev-io`, currency **EUR**). New stores start in **test mode**.
2. **Settings → General**: store URL, support email, logo (use `website/public/favicon.svg` or `build/icon.png`).
3. **Settings → Payouts**: identity verification + bank account or PayPal.
4. **Activate the store** (Settings → "Activate store"): fill in the business details. They review
   the store before live sales are allowed.
5. **Products → New product**:
   - Name `sldev-io Personal`, description as above, **Single payment**, **€10.99**.
   - Turn on **Generate license keys**:
     - **Activation limit: 3**
     - **License length: Unlimited**
   - Save. Add a second product (or a variant) `sldev-io Team`, €50, activation limit 15.
6. **Share → Checkout link**: copy each product's URL. Set the confirmation redirect to
   `https://sldev.io/thanks`.
7. **IDs for Claude**: Store ID and each product/variant ID (from the URL or the API).
8. **API key**: Settings → API → **New API key**. Store it only in Vercel as
   `LEMONSQUEEZY_API_KEY`. The License API itself (activate/validate/deactivate) doesn't need it.
   The server uses it to check orders and refunds.
9. **Test purchase** in test mode with card `4242 4242 4242 4242`. Confirm the license key email.
10. When the store is approved, switch **Test mode off** and repeat steps 5–6 for live products
    (test and live products are separate).

### 4C. 🧑 Put the checkout links on the website (only at launch)

In `website/src/content/pricing.json`, per plan:

```json
"price": 10.99,
"checkoutUrl": "https://…checkout-link…"
```

While `price` is `0` or `checkoutUrl` is empty, the button says "Download the beta". Once both
are set, it says "Buy Personal" and opens checkout. Don't do this until Phase 7.

### Phase 3 checklist

- [ ] Account verified, payouts connected
- [ ] Personal (€10.99, 3 activations) and Team (€50, 15 activations) products, **test** and **live**
- [ ] Checkout links copied (not on the site yet)
- [ ] Test purchase emailed a license key
- [ ] Organization/store ID and product IDs written down for Claude
- [ ] API token stored in Vercel env vars (never in the repo)

---

## 5. Phase 4: Licensing

**Goal:** paid builds need a license key or an active trial; beta builds keep using the beta window.

### How it will work

```
customer buys ──► provider emails key "SLDEV-…"
customer opens the app ──► Settings → License → paste key
app (main process) ──POST https://sldev.io/api/license/activate { key, machineHash }──►
Vercel function ──► Polar / Lemon Squeezy activate (counts against the 3 machines)
                ◄── signed token { plan, seats, machine, updatesUntil, expires } (Ed25519)
app checks the signature with the public key built into it → unlocked, works offline
every ~14 days the app refreshes the token; offline grace 30 days
refunded / revoked keys stop refreshing → the app asks for a license again
```

- **Machine hash**: a SHA-256 of the OS machine id plus an app salt. The raw id never leaves the PC.
- **Trial** (stable builds only): 14 days from first start, also registered by machine hash so
  deleting settings doesn't reset it.
- **Moving machines**: Settings → License → "Deactivate this machine" frees a slot.

### 5.1 🧑 Create the signing key pair (once)

Claude will give you a one-line command that generates an Ed25519 key pair. Then:
- Store the **private** key in Vercel as `LICENSE_SIGNING_KEY` (Production only).
- The **public** key goes into the app source. It isn't secret.

Losing the private key means existing tokens still work, but new ones can't be issued until you
ship a build with a new public key. Keep a copy in your password manager.

### 5.2 🤖 Build: license server + app

> Read AGENTS.md, docs/monetization-plan.md and docs/go-to-production.md (Phase 4). We use
> **<Polar | Lemon Squeezy>**. IDs: organization/store `<id>`, Personal product `<id>`, Team
> product `<id>`. Build: (1) Vercel functions in website/api/license (activate, refresh,
> deactivate, trial) that call the provider and return Ed25519-signed tokens. Read secrets only
> from env vars `<POLAR_ACCESS_TOKEN | LEMONSQUEEZY_API_KEY>` and `LICENSE_SIGNING_KEY`, and give
> me the key-generation command. (2) src/main/license.ts with offline verification, encrypted
> token storage, a 14-day refresh, a 30-day grace period and a 14-day trial for stable builds.
> (3) A license gate screen, Settings → License (enter key, status, deactivate this machine) and
> a status-bar chip. Beta builds keep the beta window and also accept a license. Tests: unit
> tests for token verification, e2e with a mocked license server, and a fake provider for the
> functions. Don't call the real provider from tests.

### 5.3 🧑 Configure and test

1. Vercel env vars: `LICENSE_SIGNING_KEY` and the provider token (sandbox/test values in
   **Preview**, live values in **Production**).
2. Deploy a preview, then build a test version of the app pointed at the preview (Claude will
   give you the command).
3. With a **test-mode** key: activate, deactivate, activate on a 4th machine (should be refused at
   3), refund the test order (should stop working at the next refresh).

### Phase 4 checklist

- [ ] Key pair created; private key in Vercel and your password manager
- [ ] License functions deployed; test-mode key activates and deactivates
- [ ] Activation limit enforced; refund revokes
- [ ] Trial counts down and ends correctly on a stable test build

---

## 6. Phase 5: Legal and business

> This is a checklist, not legal or tax advice. A short call with an accountant is worth it once
> money comes in.

### Pages the website needs (before taking payments)

| Page | What it covers | Notes |
|---|---|---|
| **Terms of Sale / EULA** | What the license allows (1 developer, 3 machines), no reselling, updates policy, warranty disclaimer, liability limit | Shown on the website; the app links to it on first start and in Settings |
| **Privacy policy** | What's collected: purchase email (by the provider), machine hash and app version (by the license server), the beta check (IP in server logs). No telemetry. | Must match what the code does. Ask Claude to draft it from the code |
| **Refund policy** | e.g. "Full refund within 14 days, no questions asked" | Providers require a refund policy; EU/UK buyers have a 14-day withdrawal right for digital goods unless they waive it at checkout *(check provider setting)* |
| **Imprint / contact** | Your name or company, address, email | Expected in the EU (Germany especially) |

🤖 Prompt:

> Draft website pages for sldev-io: terms of sale/EULA, privacy policy, refund policy and a
> contact page, based on what the code actually collects (read src/main/beta.ts and the license
> code) and docs/go-to-production.md. Plain language, add them to the website footer, and mark
> anything I must fill in (name, address).

### Business basics (UK sole trader example)

- The provider pays you **after** VAT. You report that income yourself (e.g. Self Assessment in the UK).
- Keep the provider's payout reports; they're your sales records.
- If you later form a company, update the provider account, the signing certificates
  (organization name) and the legal pages.

---

## 7. Phase 6: Code signing

Unsigned is acceptable for a free beta. For paid users, signing removes the scary warnings.

### macOS (needed for paid launch)

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
- [ ] Decide the launch date. Set `beta.endsAt` to the day **before** launch, so beta builds
      start showing the 14-day banner now
- [ ] Create a beta-tester discount code in the provider (e.g. 30%, valid 30 days)
- [ ] Write the launch post and the email to beta testers (if you collected emails)

### One week before (T-7)

- [ ] Release candidate: `npm version 1.0.0-rc.1`, push `release/1.0.0-rc.1`, install, test
      purchase in test mode end to end
- [ ] 🤖 "Add the beta-tester discount code to the beta-ended screen and banner"
- [ ] Legal pages live

### Launch day (T-0)

1. Release **`1.0.0`**: `npm version 1.0.0 --no-git-tag-version`, commit, push `release/1.0.0`.
   Wait for green.
2. In `pricing.json`: set `price` to `10.99` / `50`, paste the **live** `checkoutUrl`s, update
   `announcement` and the FAQ ("What does it cost today?"). Set `site.json` → `version` to `1.0.0`
   and `downloadUrl` to `…/releases/latest`.
3. Push `master` → the site redeploys with prices and "Buy" buttons.
4. Buy one license yourself with a real card (refund it afterwards) and activate it in the
   installed `1.0.0`.
5. Post the announcement.

### The day after (T+1)

- [ ] Check the provider dashboard for failed payments or disputes
- [ ] Check Vercel function logs for license errors
- [ ] Answer support email

---

## 9. After launch: day-to-day operations

| Situation | What to do |
|---|---|
| Customer lost their key | They find it in the provider's customer portal or receipt email; you can resend from the dashboard |
| "Too many activations" | Ask them to deactivate an old machine in Settings → License; or reset activations from the provider dashboard |
| Refund request | Refund in the provider dashboard. The key is revoked; the app stops working at its next refresh (within ~14 days + grace) |
| Ship an update | `npm version 1.0.1`, push `release/1.0.1`. Users auto-update |
| Change the price | Edit `listPrice`/`price` in `pricing.json` (site) **and** the product price in the provider. Existing keys are unaffected |
| Run a sale | Create a discount code in the provider; mention it in `announcement` |
| Token expiring | `RELEASES_TOKEN` expires after a year: create a new one (Phase 1, 2.3) and replace the secret |
| Signing certificate expiring | Renew with Apple/the CA; replace the `CSC_*` secrets |
| Suspected key leak | Disable the key in the provider dashboard; issue the customer a new one |

---

## 10. Reference

### Config files you edit

| File | Field | Effect |
|---|---|---|
| `website/src/content/site.json` | `url` | Website domain; also where the app reads `/beta.json` and links to pricing (baked in at app build time) |
| | `downloadUrl` | Website "Download" buttons |
| | `version` | Version shown on the site |
| | `contactEmail` | Footer and support links |
| `website/src/content/pricing.json` | `beta.startsAt` / `beta.endsAt` | The free-beta window for the site **and** all installed beta apps |
| | `beta.label` | Tag on free plans |
| | `plans[].price` / `listPrice` | Today's price / regular price (struck through while lower) |
| | `plans[].checkoutUrl` | Provider checkout link; the button sells once `price > 0` and this is set |
| | `announcement`, `faq` | Banner above the plans; FAQ entries |
| `package.json` | `version` | App version; `-beta.N` = beta build (beta window applies) |

### Secrets and environment variables

| Name | Where | Phase |
|---|---|---|
| `RELEASES_TOKEN` | GitHub secret, `sldev-io` repo | 1 |
| `POLAR_ACCESS_TOKEN` **or** `LEMONSQUEEZY_API_KEY` | Vercel env var | 3–4 |
| `LICENSE_SIGNING_KEY` | Vercel env var (Production) | 4 |
| `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | GitHub secrets, `sldev-io` repo | 6 |
| `SLDEV_SITE_URL`, `SLDEV_BETA_CONFIG_URL` | Optional, at app build time, to point a test build at a preview site | any |

Never commit any of these, and never paste them into a chat.

### Running costs (approximate, check current prices)

| Item | Cost |
|---|---|
| Domain (`.io`) | ~£30–60 / year |
| Vercel Pro (needed for commercial use) | ~$20 / month |
| GitHub (private source + public releases repo) | free |
| Payment provider | ~5% + $0.50 per sale |
| Apple Developer Program | ~$99 / year |
| Windows OV certificate (optional) | ~$150–300 / year |

### Commands cheat sheet

```bash
npm run dev:nosandbox                 # run the app in development
npm run typecheck && npm test         # checks
npm run e2e -- beta                   # test the beta window end to end
cd website && npm run dev             # website locally (http://localhost:5173, /beta.json too)
npm version 0.1.0-beta.3 --no-git-tag-version && git commit -am "Release v0.1.0-beta.3" && git push
git switch -c release/0.1.0-beta.3 && git push -u origin release/0.1.0-beta.3 && git switch master
```

### Related documents

- `docs/monetization-plan.md`: the reasoning behind these choices
- `website/README.md`: how the website and pricing JSON work
- `README.md` → "CI and releases": the release workflow in detail
- `AGENTS.md`: for Claude and other agents working on the code

### Sources checked for this guide (2026)

- Polar fees: [Introducing Polar Plans](https://polar.sh/blog/introducing-polar-plans);
  license keys: [Polar docs](https://polar.sh/docs/features/benefits/license-keys),
  [activate endpoint](https://polar.sh/docs/api-reference/customer_portal/activate-license-key.md);
  multi-currency: [Polar products](https://polar.sh/docs/features/products)
- Lemon Squeezy: [test mode](https://docs.lemonsqueezy.com/help/getting-started/test-mode),
  [generating license keys](https://docs.lemonsqueezy.com/help/licensing/generating-license-keys),
  [License API](https://docs.lemonsqueezy.com/api/license-api)
- Vercel Hobby non-commercial restriction: [third-party summary](https://deploywise.dev/blog/vercel-free-tier-limits-2026), check vercel.com's terms
- Windows signing: [Microsoft code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options),
  [DevClass on Artifact Signing](https://devclass.com/2026/01/14/code-signing-windows-apps-may-be-easier-and-more-secure-with-new-azure-artifact-service/)
- macOS notarization with electron-builder: [electron.build/docs/notarization](https://www.electron.build/docs/notarization)
