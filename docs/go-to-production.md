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
│ downloads.sldev.io (PUBLIC)│◄── "Download" button ───────┘              │
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
| Website with pricing from JSON, OS-aware downloads, `install.sh` | ✅ live at sldev-io.vercel.app |
| "Limited time" labels and beta countdown on the site | ✅ |
| Configurable beta window (`/beta.json` → app chip, banner, "beta ended" screen) | ✅ |
| Publishing installers to the **public** downloads repo `ben42-01/downloads.sldev.io` | ✅ (needs the `RELEASES_TOKEN` secret and a first commit in that repo) |
| Auto-update in the app (`src/main/updater.ts`) | ✅ Windows and Linux .deb install updates; macOS shows "Download" until it's signed |
| Settings → About (version, updates, diagnostics, legal links) | ✅ |
| License keys: server + app screen + trial | ✅ built; 🧑 signing key in Vercel + sandbox test (Phase 4) |
| Payment provider products | 🧑 to set up (Phase 3) |
| Code signing (macOS / Windows) | 🧑 accounts + 🤖 wiring (Phase 6) |
| License terms, privacy policy, refund policy | ✅ drafted at `/terms`, `/privacy`, `/refunds`; 🧑 fill in `site.json` → `legal` (Phase 5) |

### Decisions already made

- Price: **Personal €10.99 one-time** (Team €50 for 5 seats, from `pricing.json`).
- Downloads: the **public GitHub repo** `ben42-01/downloads.sldev.io`. The source repo stays private.
- `v0.1.0-beta.1` stays unpublished. The first public build is `0.1.0-beta.2`.
- The beta window is controlled from the website, never baked into builds.
- Beta window: opened 2026-10-24 and was closed early on 2026-10-31 for the `1.0.0` launch; `pricing.json` has no
  beta dates any more (`null`), so `/beta.json` is empty and beta builds never lock.
- **Release model**: `0.1.0-beta.N` builds are the **free beta**: GitHub pre-releases, governed by
  the beta window, no license key field and no "Buy" (Settings → License just says "Free during the
  beta"). **`1.0.0` is go-live**: a normal release with the 14-day trial and license keys. Installed
  betas update themselves to `1.0.0` and start the trial there. Nothing in a beta build changes
  when you go live; the release, the live Polar token and the live checkout links do.
- Payment provider: **Polar** (merchant of record, built-in license keys). Plain Stripe would make
  you the seller of record (VAT registration and filing), and Stripe Managed Payments has no license keys.
- **3 machines** per Personal license; Team = 5 people × 3 machines (15 activations).
- Updates: **every future update included**, no renewals, no subscription. Prices may rise later for new buyers only.
- **No discount codes** (beta testers had it free). Donations: maybe later, not planned.
- No telemetry. The website self-hosts its fonts and loads nothing from third parties.

### Decisions still open

| Decision | Recommendation | Needed by |
|---|---|---|
| Trial length for paid builds | 14 days | Phase 4 |
| Apple Developer account ($99/year) | Before launch: removes the Gatekeeper warning and enables macOS auto-update | Phase 6 |

---

## 2. Phase 1: Accounts and setup

**Goal:** everything public-facing has a home. **Time:** about 1–2 hours of your time, plus
waiting for verifications. Start the payment provider (2.5) and Apple (2.6) early, because their
reviews take days.

### 2.1 🧑 Domain

> **Current state:** the site runs at **https://sldev-io.vercel.app** and `site.json` → `url` points
> there, so the app reads `https://sldev-io.vercel.app/beta.json`. When you buy `sldev.io`, add it
> to the same Vercel project. The `.vercel.app` address keeps working, so builds already pointing at
> it stay fine. Then switch `url` and the `og:` tags in `website/index.html` to the new domain.

1. Make sure you own `sldev.io` (or choose the domain you'll use). The app reads
   `https://<domain>/beta.json`, and links to `https://<domain>/pricing`.
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
- [ ] `downloads.sldev.io` public repo created
- [ ] `RELEASES_TOKEN` secret added to `sldev-io`
- [ ] `https://<site>/download/windows` redirects to the newest `.exe`
- [ ] Support email working; `site.json` → `contactEmail` set
- [ ] Payment provider sign-up started

---

## 3. Phase 2: Public beta

**Goal:** anyone can download `0.1.0-beta.2`; it updates itself; you control when the free beta
starts and ends.

### 3.1 Publishing ✅ and auto-update ✅

✅ The release workflow publishes to `ben42-01/downloads.sldev.io` (pre-releases for `-beta`
versions) and also keeps a record in the private repo. The website's download buttons and
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

- [ ] The release in `downloads.sldev.io` lists the `.deb`, the `-setup.exe` and the `.dmg`s (x64 and
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

### 4C. Checkout links on the website (done on `v1`, 2026-10-31)

In `website/src/content/pricing.json`, per plan:

```json
"price": 10.99,
"checkoutUrl": "https://buy.polar.sh/polar_cl_…",
"sandboxCheckoutUrl": "https://sandbox-api.polar.sh/v1/checkout-links/polar_cl_…/redirect"
```

Vercel **production** builds link `checkoutUrl` (Polar live); previews and local builds link
`sandboxCheckoutUrl`, so a preview never takes real money (`__LIVE_CHECKOUT__` in `website/vite.config.ts`,
like `VERCEL_ENV` in `api/_polar.ts`). While `price` is `0` or the link is empty, the button says
"Download free trial"; with both, "Buy Personal" / "Buy Team".

The app shows the same plans in Settings → License and on the trial-ended screen (`src/shared/pricing.ts`,
baked in from `pricing.json` at build time), with buy buttons that open the **live** checkout in the browser.
Build with `SLDEV_CHECKOUT=sandbox` to link the sandbox instead. After paying, Polar emails the key and the
buyer pastes it into the app, so the checkout links' success URL (`/thanks`) only needs the website to be up.

### Phase 3 checklist

- [ ] Account verified, payouts connected
- [ ] Personal (€10.99, 3 activations) and Team (€50, 15 activations) products, **test** and **live**
- [x] Checkout links on the site (live and sandbox)
- [ ] Test purchase emailed a license key
- [ ] Organization/store ID and product IDs written down for Claude
- [ ] API token stored in Vercel env vars (never in the repo)

---

## 5. Phase 4: Licensing ✅ built

**Goal:** paid builds need a license key or an active trial; beta builds keep using the beta window.

### How it works

```
customer buys ──► Polar emails the key "SLDEV-…" (and shows it in the customer portal)
customer opens the app ──► Settings → License (or palette: "Enter license key") → paste key
app (main) ──POST <site>/api/license/activate { key, machine hash, "Linux x64", version }──►
Vercel function ──► Polar: validate key, reuse this machine's activation or create one
                ◄── token { plan, machine, email, iat, exp } signed with Ed25519
app verifies the signature with the public key built into it → unlocked, works offline
the app refreshes the token every 14 days; it stays valid 45 days after the last refresh
refunded / revoked / deactivated → refresh gets 403 → the app drops the license with a message
```

| Piece | Where |
|---|---|
| Token format (sign + verify) | `website/api/_licenseToken.ts`, shared by server and app |
| Polar calls, IDs per environment | `website/api/_polar.ts` (Vercel production = live org, everything else = sandbox) |
| Functions | `website/api/license/{activate,refresh,deactivate}.ts` |
| App | `src/main/license.ts`, `machineId.ts`, `licenseKey.ts` (public key); UI in `components/License.tsx` |
| Lock rule | `isLocked` in `src/shared/license.ts`: decided at launch only |
| After checkout | `/thanks` page (Polar checkout link success URL) |

- **Machine hash**: SHA-256 of the OS machine id plus an app salt. The raw id never leaves the PC.
- **Reinstalling** on the same machine reuses its activation (looked up with the access token).
- **Trial** (stable builds only): 14 days from first start, stored encrypted on the machine.
  Deleting the app's data folder resets it; registering trials on the server can come later if
  that's ever abused.
- **Moving machines**: Settings → License → "Deactivate this machine" frees a slot.

### 5.1 🧑 The signing key pair

`node scripts/license-keygen.mjs` writes the **public** key into `src/main/licenseKey.ts` (commit
it) and the **private** key to `~/sldev-io-license-signing-key.txt` without printing it. Then:
1. Copy the file's one line into Vercel → Settings → Environment Variables as
   `LICENSE_SIGNING_KEY`, for **Preview and Production**.
2. Save it in your password manager, then delete the file.

Losing the private key means existing tokens keep working until they expire, but new ones can't be
issued until you ship a build with a new public key.

### 5.2 🧑 Polar access token

An organization access token with **license_keys:read/write** and **products:read**, in Vercel as
`POLAR_ACCESS_TOKEN`: the **sandbox** token in **Preview**, the **live** token in **Production**
(add the live one at launch). Without products:read the server guesses the plan from the
activation limit (15 = Team).

### 5.3 🧑 Test against the sandbox

1. Push a branch; Vercel builds a preview with the sandbox settings.
2. Build the app against it: `SLDEV_SITE_URL=https://<preview-url> npm run dist:linux` (or run
   unpackaged: `SLDEV_LICENSE_API=https://<preview-url>/api/license npm run dev:nosandbox`).
3. Buy in the sandbox checkout (card `4242 4242 4242 4242`), then in the app: activate, deactivate,
   activate again; fill the 3 slots and check a 4th machine is refused; refund the order in the
   sandbox dashboard and use **Check license** (it should drop the license).

### Phase 4 checklist

- [x] License server, app screens, trial and tests built
- [ ] Key pair created; private key in Vercel and your password manager
- [ ] License functions deployed; sandbox key activates and deactivates
- [ ] Activation limit enforced; refund revokes
- [ ] Trial counts down and ends correctly on a stable test build

---

## 6. Phase 5: Legal and business

> This is a checklist, not legal or tax advice. A short call with an accountant is worth it once
> money comes in.

### Pages the website needs (before taking payments) ✅ drafted

`/terms` (license terms and terms of sale), `/privacy` and `/refunds` are live in the website
source (`website/src/content/legal.tsx`) and linked from the site footer and the app's
Settings → About. They describe what the code actually does: no telemetry, the beta and update
checks, license activation with a hashed machine ID, Polar as merchant of record.

🧑 Before taking payments:
1. Fill in `website/src/content/site.json` → `legal`: `seller` (your legal name or company),
   `address` (postal address; expected in the EU/UK) and `country` (governing law, e.g.
   "England and Wales"). Until then the pages show `[seller name]` placeholders.
2. Read the three pages once. If the app starts sending anything new, update `/privacy` and
   `legal.updatedAt` in the same change.
3. Polar asks for the terms, privacy and refund URLs during its organization review: use
   `https://<site>/terms`, `/privacy`, `/refunds`.

> This isn't legal advice: if you're unsure about anything, a one-off review by a lawyer is cheap
> compared with the risk.

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

### Branches: `master` (beta) and `v1` (launch)

- **`master`** is the beta line. Fixes go here and ship as `0.1.0-beta.N` (push `release/0.1.0-beta.N`).
- **`v1`** collects what only the paid launch needs: prices and checkout links in `pricing.json`,
  launch copy on the site, signing, `1.0.0`. Push it as often as you like; it never publishes
  anything (only `release/**` branches do). Vercel builds a preview of it with the **sandbox**
  license server, so the whole purchase → key → activate flow can be tested there first.
- Keep `v1` current: `git switch v1 && git merge master && git push`.
- **Launch**: `git switch master && git merge v1`, then `npm version 1.0.0 --no-git-tag-version`,
  commit, push `master`, push `release/1.0.0` (the steps under T-0 below).

### Two weeks before (T-14)

- [ ] Phases 1–6 done (Windows signing optional)
- [ ] 1.0 features frozen: every box under "Before launch" in `docs/v1-roadmap.md` ticked
- [ ] Decide the launch date. Set `beta.endsAt` to the day **before** launch, so beta builds
      start showing the 14-day banner now
- [ ] Write the launch post and the email to beta testers (if you collected emails)

### One week before (T-7)

- [ ] Release candidate: `npm version 1.0.0-rc.1`, push `release/1.0.0-rc.1`, install, test
      purchase in test mode end to end
- [ ] Legal pages live

### Launch day (T-0)

1. Release **`1.0.0`**: `npm version 1.0.0 --no-git-tag-version`, commit, push `release/1.0.0`.
   Wait for green.
2. In `pricing.json`: set `price` to `10.99` / `50`, paste the **live** `checkoutUrl`s, update
   `announcement` and the FAQ ("What does it cost today?"). Set `site.json` → `version` to `1.0.0`
   (downloads pick up the new release by themselves).
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
| Raise the price | New buyers only: change `price`/`listPrice` in `pricing.json` and the product price in Polar. Existing licenses keep all updates |
| Token expiring | `RELEASES_TOKEN` expires after a year: create a new one (Phase 1, 2.3) and replace the secret |
| Signing certificate expiring | Renew with Apple/the CA; replace the `CSC_*` secrets |
| Suspected key leak | Disable the key in the provider dashboard; issue the customer a new one |

---

## 10. Reference

### Config files you edit

| File | Field | Effect |
|---|---|---|
| `website/src/content/site.json` | `url` | Website domain; also where the app reads `/beta.json` and links to pricing (baked in at app build time) |
| | `downloadUrl` | Where "download" links outside the site point (the site's download section) |
| | `version` | Version shown on the site |
| | `contactEmail` | Footer and support links |
| `website/src/content/pricing.json` | `beta.startsAt` / `beta.endsAt` | The free-beta window for the site **and** all installed beta apps |
| | `beta.label` | Tag on free plans |
| | `plans[].price` / `listPrice` | Today's price / regular price (struck through while lower) |
| | `plans[].checkoutUrl` | Provider checkout link; the button sells once `price > 0` and this is set |
| | `announcement`, `faq` | Banner above the plans; FAQ entries |
| `package.json` | `version` | App version; `-beta.N` = beta build (beta window applies) |

### Polar IDs (not secret)

| | Sandbox (`sldev-io-sbx`, sandbox.polar.sh) | Live (`sldev-io`) |
|---|---|---|
| Organization | `44affab5-d66f-4a87-89dc-e854ffe79dcb` | `0a93fdbe-37be-4c87-b67d-bb55bd519a02` |
| Personal product (€10.99, 3 activations) | `290c2831-7c65-43a0-8645-33f0463daa89` | `7c2938d3-5332-43ec-8cc8-0675d275d6d5` |
| Team product (€50, 15 activations) | `b5bbfcf4-58b3-466a-bc4c-25524d343cc1` | `e6901d0f-06ad-4d3d-9cf0-c75603f6486c` |

| Checkout link, Personal | [sandbox](https://sandbox-api.polar.sh/v1/checkout-links/polar_cl_eV3DN4OtqGOyiKR3VowNavcL4q7acuGTOAbei4b9uPI/redirect) | `https://buy.polar.sh/polar_cl_rcckqPVuJv8HQEn5zMUj73onQJ01SRdX7WGbR1M8nmE` |
| Checkout link, Team | [sandbox](https://sandbox-api.polar.sh/v1/checkout-links/polar_cl_z7dRZP1VJJpbb6YRug68aYRZHsi6ipK8aHZBS0sYukY/redirect) | `https://buy.polar.sh/polar_cl_kOosNrPOzIGDsN9zKPY6aUF8xmBWurk50AFnj24k7S9` |

The live checkout links go into `checkoutUrl` in `pricing.json` **on launch day only**: anyone
with them can buy, and the app accepts live keys only once `POLAR_ACCESS_TOKEN` (live) and
`LICENSE_SIGNING_KEY` are set for Production. Success URL on all four:
`https://sldev-io.vercel.app/thanks?checkout_id={CHECKOUT_ID}`. Access tokens are secrets and
live only in Vercel.

### Secrets and environment variables

| Name | Where | Phase |
|---|---|---|
| `RELEASES_TOKEN` | GitHub secret, `sldev-io` repo | 1 |
| `POLAR_ACCESS_TOKEN` **or** `LEMONSQUEEZY_API_KEY` | Vercel env var | 3–4 |
| `LICENSE_SIGNING_KEY` | Vercel env var (Preview and Production) | 4 |
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
