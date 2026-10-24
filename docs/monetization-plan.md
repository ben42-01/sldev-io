# Monetization plan: from free beta to paid licenses

Status: **draft, partly decided**, 2026-10-24.

Decided: Personal stays **€10.99** at launch (revisit after real traction). `v0.1.0-beta.1` stays
unpublished; the next release (`0.1.0-beta.2`) ships everything since, including the expiry.
 Nothing in the app enforces anything yet; the website
shows "Limited time" labels and an optional countdown (`website/src/content/pricing.json` → `beta.endsAt`).

## Recommendation in one paragraph

Keep the one-time license the site already promises. Sell it through a **merchant of record**
(Polar or Lemon Squeezy) rather than raw Stripe payment links: they handle EU/UK VAT, invoices,
refunds and license keys. Ship every beta build with a **built-in expiry date**, set from the
website's `beta.endsAt`. A small `beta.json` on the website can **extend** the beta without a
new build. When a beta expires the app shows a full-screen "Beta ended" page; it keeps the user's
data and doesn't stop running work. A paid license is a key the app exchanges once, through a tiny
Vercel function, for an **offline-verifiable signed token** (Ed25519). The app checks it locally
and refreshes it online every couple of weeks. After launch, new users get a 14-day trial on the
same mechanism. Before any of this matters, installers have to be downloadable by the public
(the repo is private) and the app needs auto-update, so beta users move to paid builds smoothly.

## What has to change

### 0. Blockers for any public beta

| Problem | Fix |
|---|---|
| The repo is **private**, so `site.downloadUrl` (GitHub Releases) is a 404 for everyone else | Publish installers to a separate **public** `ben42-01/sldev-io-releases` repo (the release workflow pushes there with a fine-grained token secret). It's free and works with electron-updater. The source stays private. |
| No auto-update | `electron-updater` with the GitHub provider pointed at the releases repo: a beta channel for `-beta.N` versions, stable for the rest. Beta users get the expiry-aware build and later the paid build automatically. |
| `v0.1.0-beta.1` has **no expiry** and would work forever | Don't distribute it. The first public build is `0.1.0-beta.2`, with expiry. |
| Unsigned builds | Fine for a free beta, but paying users shouldn't see SmartScreen or Gatekeeper warnings. macOS needs an Apple Developer account (yearly fee) for signing and notarization. For Windows, Azure Trusted Signing is the cheapest current option. Both need your accounts, so start them early because verification takes days. |

### 1. Beta window (app) ✅ built

- **Remote, not baked in**: `beta.startsAt` / `beta.endsAt` in `website/src/content/pricing.json`
  are published as `/beta.json`. Beta builds read it at start (waiting at most 1.5 s) and every 6 h.
  With no dates the beta never expires. Setting, moving or clearing a date and redeploying the site
  opens, extends or ends it for everyone, with no app release.
- **Offline**: the last fetched dates are cached (encrypted). With nothing cached and no network
  the beta stays open, which fails open on purpose during development.
- **Clock rollback**: store the latest time ever seen (encrypted with safeStorage) and use
  `max(now, lastSeen)`. When online, prefer the `Date` header from the `beta.json` response.
- **UX**:
  - From 14 days before the end: an amber status-bar chip ("Beta · 12 days left") and a banner
    on start, with links to the pricing page and "Enter license".
  - After the end: at **next launch** the app opens to a "The beta has ended" page with Buy,
    Enter license key, Open data folder and Export notes. Running sessions are never killed:
    if the date passes mid-session, show a banner and lock at the next start.
  - Data (settings, notes, connections, credentials) is never deleted. A license unlocks
    everything exactly as it was.

### 2. Payments

| Option | Pros | Cons |
|---|---|---|
| **Polar** (recommended) | Merchant of record (VAT handled), built-in license keys with activation limits, developer-focused, API for validate/activate | Younger company. New organizations since 27 May 2026 pay **5% + $0.50** per sale (paid plans from $20/mo lower that) plus international card and payout fees |
| Lemon Squeezy | Merchant of record, mature license-key API (activate/validate/deactivate per instance, 60 req/min) | Product development has slowed since the Stripe acquisition. About **5% + $0.50** per sale, no monthly fee (third-party figures) |
| Stripe payment links (current site plan) | Lowest fees, you own everything | **You** are the seller: VAT registration (EU OSS/UK), invoices, refunds. No license keys, so you'd need a webhook, key generation and email |

The server code below keeps the provider behind one function, so switching later is cheap.

At €10.99 the fixed $0.50 matters: expect roughly €1.00–1.30 in fees per sale (about 10–12%)
once international and payout fees are added. Check the official pricing pages before launch;
the fees changed in 2026.

### 3. Licensing (app + small server)

```
buy (checkout) ──► provider emails key ──► user pastes key in app
app main ──POST /api/license/activate {key, machine}──► Vercel function
            ◄── signed token {licenseId, plan, seats, machine, updatesUntil, exp}
app verifies Ed25519 signature with the embedded public key → unlocked, works offline
every ~14 days: POST /api/license/refresh; offline grace 30 days; refunds/revocations stop refreshing
```

- **Server**: `website/api/license/{activate,refresh,deactivate}.ts` as Vercel functions in the
  existing site project. They call the provider's license API (activation limit = seats:
  Personal maybe 3 machines, Team 5 seats) and sign the token with a private key stored in a
  Vercel environment variable. The public key is compiled into the app.
- **Machine id**: SHA-256 of the OS machine id (`/etc/machine-id`, Windows `MachineGuid`,
  macOS `IOPlatformUUID`) plus an app salt, so the raw id is never sent.
- **App**: new `src/main/license.ts` (verify, store the token encrypted, refresh, beta and trial
  dates). It goes in main because the renderer is untrusted. Add a `license` IPC group, a
  `LicenseGate` screen, a Settings → License section (status, machine, deactivate this
  machine) and a status-bar chip.
- **Updates policy** (decision): a one-time price with *unlimited* updates doesn't fund keeping up
  with agent CLIs that change monthly. Common fair model (Sublime, Tower, JetBrains fallback):
  **pay once, keep the version forever, 1 year of updates included**, renewal optional and
  discounted. The token carries `updatesUntil`, and the app compares it with each build's release date.

### 4. Trial after launch

Stable builds without a license get a **14-day trial** from first launch. The trial start is
stored encrypted and also registered with `/api/trial` by machine hash, so deleting the config
doesn't reset it. When the trial ends, the same "ended" screen appears with Buy and Enter license.

### 5. Website changes

- Done: "Limited time" tags on free plans, a countdown when `beta.endsAt` is set, and the hero pill.
- When licensing exists: switch `checkoutUrl` to provider checkout links, set real `price`s, and
  add FAQ entries ("What happens when the beta ends?", refunds, machines per license,
  updates policy). Add `/beta.json` and a "Download" page pointing at the public releases repo.
- Legal pages: EULA (shown on first run too), privacy policy (machine hash + purchase email,
  nothing else), refund policy (providers require one), terms.

### 6. Honest limits

Any client-side check in an Electron app can be patched by someone determined: the code ships in
an asar archive. The goal is to keep honest users honest and make paying the easy path.
Signed tokens stop key sharing and config edits; obfuscation and DRM aren't worth the time or
the false positives. Beta testers deserve goodwill: give a **launch discount code** to everyone
who used the beta, sent by email from the purchase/download list or shown on the "beta ended" screen.

## Phases

| Phase | Work | Needs from you |
|---|---|---|
| **A. Now** | Website limited-time labels (done). Decide the open questions below. | Decisions, beta end date |
| **B. Public beta** (~1 session) | Public releases repo + workflow push, electron-updater, beta expiry + `beta.json` + warnings/lock screen, e2e scenario with a fake clock. Release `0.1.0-beta.2`. | Fine-grained token for the releases repo |
| **C. Licensing** (~1–2 sessions) | Provider products, Vercel license functions, Ed25519 keys, `license.ts`, license UI, trial. Tests with a mocked provider. | Provider account, products, API key in Vercel |
| **D. Signing** (parallel) | Wire signing secrets into the release workflow | Apple Developer account, Windows signing account |
| **E. Launch** | `1.0.0` stable with license + trial, site prices + checkout live, beta builds expire on the date | Go-ahead |

## Decisions needed

1. **Beta end date**: recommend 6–8 weeks after the first public beta build, with in-app
   warnings from 2 weeks before.
2. **Provider**: Polar (recommended) or Lemon Squeezy, or Stripe if you want to handle VAT yourself.
3. ~~Prices~~: decided, €10.99 Personal at launch.
4. **Updates policy**: lifetime updates, or 1 year of updates with a perpetual fallback (recommended).
5. **Machines per Personal license**: recommend 3.
6. **Beta-tester discount**: how much, and for how long.
