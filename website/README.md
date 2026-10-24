# sldev-io website

Marketing site for sldev-io. Vite + React + TypeScript, fully static, deployed on Vercel.
It is independent of the Electron app: its own `package.json` and lockfile.

```bash
cd website
npm ci
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
```

## Change the pricing

Edit [`src/content/pricing.json`](src/content/pricing.json), commit and push; Vercel redeploys.
Each entry in `plans` is one card:

| field | meaning |
|---|---|
| `price` | what it costs today. `0` shows "Free" |
| `listPrice` | regular price; shown struck through while `price` is lower |
| `checkoutUrl` | Stripe payment link. While it is empty (or `price` is 0) the button downloads the app instead |
| `ctaLabel` / `ctaLabelPaid` | button text for the free and the paid state |
| `highlight` | brand-gradient border on the featured plan |
| `features` | bullet list |

**Beta countdown**: `beta.endsAt` (`"YYYY-MM-DD"`, the last free day, UTC) turns the "Limited time
only" labels into a live countdown ("Free beta ends in 12 days · free until …"). Leave it `null` to show
just "Limited time". `beta.label` is the tag on free plans. The tags only appear while a plan has
`price: 0` and a higher `listPrice`.

**Going paid**: set `price` to the real amount, paste the Stripe payment link into `checkoutUrl`,
update `announcement` (the banner above the plans). Add or remove plans by adding or removing
objects. `faq` feeds the FAQ section too.

Other copy and links (version, download URL, supported agents, contact) live in
[`src/content/site.json`](src/content/site.json). `downloadUrl` currently points at the GitHub
releases page, which is only public if the repo is; point it at a public bucket or a download
page once installers are hosted elsewhere.

## Deploy on Vercel

1. Import the GitHub repo in Vercel.
2. Set **Root Directory** to `website`. The framework (Vite), build command and output directory
   come from `vercel.json`.
3. Add the domain under Project → Domains and update `url` in `site.json` and the `og:` tags in
   `index.html` if it is not `sldev.io`.
