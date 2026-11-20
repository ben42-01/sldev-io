# Funding sldev-io

Since 2026-11-20 sldev-io is free and open source (Apache-2.0). This note says why, and how it can still pay for
itself without bringing back a paywall.

## Why free

- The market for agent workspaces is full of free tools, many of them open source. A €10.99 one-time price was a
  reason not to try sldev-io rather than a reason to choose it.
- Developers trust what they can read. sldev-io runs agents with access to their code, terminals and credentials, so
  open source is a feature in itself.
- Stars on GitHub are the distribution channel: they decide what shows up in "awesome" lists, trending pages and
  search. A private repo collects none.

## Rules that stay true

- Nothing in the app is locked, trialled or hidden behind a payment or a sponsorship.
- No telemetry, ever. A new network request still means updating `/privacy` first (see AGENTS.md).
- Support links (Star on GitHub, Sponsor) live in Settings → About, the command palette, the README and the website,
  and nowhere more pushy than that: no nag screens, no popups.

## Now: stars and GitHub Sponsors

- Star and Sponsor links: `sourceUrl` and `sponsorUrl` in `website/src/content/site.json`.
- GitHub Sponsors on a personal account: GitHub takes no fee. Tiers to start with: $3 (thanks, name in the README),
  $10 (name on the website), $50/month for companies (logo on the README and the website).
- `.github/FUNDING.yml` (`github: ben42-01`) makes GitHub show the Sponsor button once the repo is public and Sponsors
  is turned on for the account.

## Later, if it grows (ideas, not plans)

Ordered by how well they fit a free, local-first tool:

1. **Company sponsorships.** Agent vendors and dev-tool companies sponsor projects that show their product working.
   sldev-io is agent-agnostic, so a "Supported by" row with several vendors fits better than one exclusive partner.
2. **Paid support or setup for teams.** An hourly or fixed-price offer to set up the Software Factory, evals and
   rules for a team's repository. The code stays the same for everyone.
3. **Hosted extras that cost money to run.** Anything that needs a server (shared boards across machines without
   git, team dashboards) could be a paid service next to the free app. Only if people ask for it, and never by
   moving a local feature to the server.
4. **Bounties and grants.** Open-source funds (GitHub Accelerator, NLnet, Sovereign Tech Fund, vendor grant programs)
   pay for specific work.

Recommended against: an "open core" app with paid features, ads, selling data, or a license key that comes back later.
Each would undo the trust that going open source is meant to build.
