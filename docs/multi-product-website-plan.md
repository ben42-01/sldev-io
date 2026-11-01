# Website Refactor Plan: single product → multi-product company site

> **Status**: DRAFT — planning only, no code changes.
> **Goal**: turn the current sldev-io-only marketing site into a company site (working name: *Graft* / *SLDC-IO* / *Agora* — undecided) that advertises sldev-io now and future products later. Most likely moves to its own repo.

---

## 1. What we have today (the coupling)

The site is the **product**, not a company site. Almost everything assumes sldev-io:

| Area | Where it's baked in |
|------|---------------------|
| Names & branding | `site.name` = `sldev-io` (`src/content/site.json`); hardcoded "sldev-io" strings across `Hero`, `pages.tsx`, `index.html`, `AppMockup`, `Features`, `Docs`, `Compare`, legal pages |
| Nav / Footer | single "Download" CTA in `Nav.tsx` + `Footer.tsx`; no product selector |
| Downloads | `api/download.ts` redirects to **one** repo `ben42-01/downloads.sldev.io`; `install.sh`, `/api/stats` all point at the one product |
| Landing page | `src/App.tsx`: hero + features **of sldev-io** — there's no "products we make" layer |
| Pricing / license | `pricing.json`, `lib/pricing.ts`, `beta.json`, `api/license/*`, `public/install.sh` — all sldev-io-specific |
| Single-page routing | `pages.tsx` + `<name>/index.html` entries in `vite.config.ts` / `vercel.json` all assume product pages at top level |
| SEO/meta | `index.html` `title`/`og:` hardcode sldev-io and `sldev-io.vercel.app` |
| Legal | `legal.tsx` names "sldev-io" as *the* software; seller/address fields in `site.json` |

**Key structural fact**: the whole site is one React app with one build. There is no concept of "`/products/<product>/…`" — pages, downloads, pricing and docs are a single flat namespace.

---

## 2. Decisions to make up front

These gate most of the build, so pin them first:

1. **Company name / URL** — Graft, SLDC-IO, Agora…? Controls the repo name, brand, logo, legal entity.
2. **Repo strategy** — move `website/` into its **own repo** (recommended). The app repo keeps licensing/security/dev-focused only, and the site gets independent deploy, issues and CI. Trade-off to weigh: the app reads `/beta.json`, legal URLs, and the license API from the website — the app repo currently ships with the site URLs baked in.
3. **Domain layout** — decide whether product landing pages live at subdomains (`sldev.io`, `graft.io/products/sldev`, `sldev.graft.io`) vs. a single domain with paths. This affects DNS, Vercel config, and every hardcoded URL.
4. **Pricing/legal shared vs per product** — if future products bill separately, licensing, `/beta.json` and legal copy must be **per-product**, not global.
5. **Downloads infra** — one central downloads repo (current) per product, or one repo per product? `api/download.ts` and `api/stats.ts` assume a single repo.

---

## 3. Target architecture

```
Company brand (Graft / SLDC-IO)
├── Home      → what we make, product grid/cards
├── Products
│   ├── sldev-io   (landing, features, docs, pricing, download)
│   └── <future>   (same template, new content)
├── Company   → about, contact, legal
└── api/      → download, stats, license, beta — now product-parameterised
```

### Content-driven product "theme"
Introduce a product registry (config + optional content files) so a new product is *adding data, not code*:

```ts
// src/content/products.ts  (or .json)
products: [
  {
    slug: "sldev-io",
    name: "sldev-io",
    tagline: "The terminal-first workspace for agentic coding.",
    repo: "ben42-01/downloads.sldev.io",
    url: "…",
    features: {…}, plans: {…}, docs: {…}, legal: {…},
    download: { platforms: […], installScript: "…" }
  }
]
```

Everything that is today product-specific (`site.json`, `pricing.json`, `legal.tsx`, `download.ts`, docs, beta) resolves **from product scope** instead of a single global scope.

---

## 4. The change list (by layer)

### 4.1 Branding & shell (all components)
- Add a company identity layer above the product: company `Nav` (with a **Products** menu) and company `Footer`.
- Rename the product nav CTA "Download" → product-scoped ("Get sldev-io", "Download sldev-io").
- Company logo + per-product logo; `Logo.tsx` currently renders the sldev-io mark for everything — split into `CompanyLogo` + `ProductLogo`.
- `src/main.tsx` legacy `/#…` redirects and `document.title` concatenation in `pages.tsx` (`${page.title} · ${site.name}`) become company-scoped.

### 4.2 Routing / pages
- Decide canonical path scheme, e.g. `/` = company home, `/products/sldev-io/*` = product pages, `/company/*` or `/about` for company info.
- **Today** the top-level paths (`/features`, `/pricing`, `/docs`, `/download`) are the product pages. Plan for either:
  - **(a) subdomain per product** (cleanest separation; more DNS/Vercel), or
  - **(b) path-prefixed** `/products/<slug>/…` with redirects from the old `/features` etc. so existing sldev-io deep links keep working.
- `pages.tsx`, the `<name>/index.html` set, `vite.config.ts` `pages` array, and `vercel.json` rewrites all need to be regenerated from the product registry rather than hand-listed — otherwise every product doubles the boilerplate.

### 4.3 Downloads & stats (`api/`)
- `api/download.ts` — make the **repo a parameter** (from product scope), e.g. `/api/download?product=sldev-io&os=windows`. The vercel rewrite `/download/:os` becomes product-aware.
- `api/stats.ts` — same: per-product download counts. Consider querying multiple repos.
- `public/install.sh` + `installCommand` in `lib/download.ts` — per-product script/URL (currently `curl …/install.sh`).

### 4.4 Pricing, beta, licensing
- `pricing.json` + `lib/pricing.ts` — scoped per product. Each product can carry its own `plans`, `beta`, `faq`.
- `/beta.json` (`vite.config.ts` plugin) — product aware, or published per product path. **The app reads `/beta.json`** — keep a compatible URL or update the app to read the product-scoped one in the same change.
- `api/license/*` + `_licenseToken.ts` / `_polar.ts` — **the app depends on these URLs**; if paths change, the app must be updated in lockstep. Verify what the app hardcodes before moving anything.
- Legal copy (`legal.tsx`, `site.json.legal`) — company-level identity (seller, address, refunds/terms) plus per-product software clauses.

### 4.5 Landing page (`App.tsx`) and content
- Company home: product grid ("What we build"), company narrative, single company FAQ.
- sldev-io content (features, story, workflows, app mockup) moves to the product scope, so future products reuse the same components with new content.
- Content files (`docs.tsx`, `changelog.json`, `pricing.json`, `site.json`) restructure: split company vs product data.

### 4.6 Meta / SEO / assets
- `index.html` per-page meta: company-scoped on home, product-scoped on product pages (currently one global `og:` set).
- `favicon`, `og.png`, fonts, brand tokens (`styles.css`) — company brand on the shell, product brand on product pages.

---

## 5. The repo move (recommended path)

**Recommended**: move `website/` into its own standalone repo (e.g. `github.com/<you>/graft-website`) with its own README, CI, Vercel project and issue tracker.

Steps:
1. `git subtree split` or copy `website/` into the new repo; keep `website/api/license` (the app's license/verify endpoints) discoverable — decide if those stay with the site or move to the app repo.
2. Create the new Vercel project pointing at the new repo **root** (no more root-directory = `website`). Remove the old Vercel project or repoint.
3. Move the license/beta endpoints the **app** consumes, and update the app's hardcoded URLs (`src/main/license.ts`, `beta.ts`, `updater.ts`) **in the same release** as the site move, or the shipped app stops validating/beta-checking.
4. Set up domain(s) + DNS for the company brand.
5. Cut over: update `AGENTS.md` website section, the install/README references, and the app's "What's new"/links.

> ⚠️ **Lockstep requirement**: the running app depends on several website URLs (`/beta.json`, `/api/license/*`, download redirects, legal pages, `/install.sh`). Any path/domain change must ship **app + site together**, or be done behind compatible redirects. This is the biggest hidden risk of the fan-out.

---

## 6. Suggested phases

- **Phase 0 — decisions**: name/brand, repo move, domain scheme, per-product pricing yes/no. (Blocks everything.)
- **Phase 1 — company shell**: company Nav/Footer/Logo, company home with a product card for sldev-io; move sldev-io content into product scope; add product-based routing. No change to existing sldev-io URLs (redirects keep compatibility).
- **Phase 2 — per-product plumbing**: parameterise downloads/stats/beta/license/pricing/legal by product; update the app in lockstep.
- **Phase 3 — second product + polish**: prove the model by onboarding the next product; per-product meta/SEO; docs generator from registry.
- **Phase 4 — repo move**: cut the site into its own repo + Vercel project, update all references and the app.

---

## 7. Open questions for you

1. **Company name + final brand** — this decides the repo/domain/brand work before anything else.
2. **Domain layout** — `graft.io/products/sldev-io` (paths) vs `sldev.graft.io` (subdomains)?
3. **Do future products bill/pric/license independently?** (drives whether legal/pricing/beta stay global or per-product)
4. **Is the license/verify API part of this site, or should it move to dedicated infra?** The app depends on it.
5. **Keep old sldev-io URLs working?** (redirect strategy) — I'd recommend yes.

*(No files were changed — this is a plan only.)*