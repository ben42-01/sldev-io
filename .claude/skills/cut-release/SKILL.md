---
name: cut-release
description: Publish a new sldev-io release with installers for Linux, Windows and macOS via the GitHub release workflow. Use when asked to release, ship, publish installers, or bump the version.
---

# Cut a release

The `.github/workflows/release.yml` workflow runs on pushes to `release/**`. It builds every OS and
publishes the installers (deb, exe, arm64 and x64 dmg) and the update files (`latest*.yml`, `.blockmap`, macOS zip) as release `v<package.json version>`
in the **public** repo `ben42-01/downloads.sldev.io` (needs the `RELEASES_TOKEN` secret), plus a
copy in the private source repo. It then **deletes every older release** (and its tag) from the
public repo, so only the newest installers can be downloaded.

Pushing is outward-facing. Confirm the version and the go-ahead with the user before pushing.

1. Make sure `master` is green: `gh run list --workflow ci.yml --limit 3`.
2. Locally: `npm run typecheck && npm test && npm run e2e -- smoke`.
3. Bump the version without creating a tag (the workflow makes it):
   `npm version <patch|minor|major|x.y.z> --no-git-tag-version`, and set the same `version` in
   `website/src/content/site.json` (the site's hero and download page show it; `npm test` checks they match).
   In `website/src/content/changelog.json`,
   make sure the top entry has this version and set its `date` (today, YYYY-MM-DD): the app shows it as
   What's new after updating, and the website's `/changelog` lists only dated entries (`npm test` checks
   the version has an entry). If `PRICES_CHECKED` in `src/shared/prices.ts` is more than a couple of
   months old, check the Anthropic and OpenAI price pages and update the table. Commit `Release vX.Y.Z`
   on master and push master.
4. Create and push the branch: `git switch -c release/X.Y.Z && git push -u origin release/X.Y.Z`.
5. Watch it: `gh run watch $(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status`.
   If a single OS fails, fix it on the branch and push again. Assets are replaced (`--clobber`).
6. Check `gh release view vX.Y.Z --repo ben42-01/downloads.sldev.io` lists the deb, the exe,
   the two dmgs (arm64, x64), the macOS zips, `latest*.yml` and `.blockmap` files, and that `curl -sI https://sldev-io.vercel.app/download/linux`
   redirects to the new version's deb (the CDN caches the redirect for up to 5 minutes).
7. Launch the published Linux build. The e2e harness runs `out/`, not the packaged app, so it can't
   catch packaging bugs. Download with `curl -LO` (the `gh` snap can't write to /tmp or hidden dirs),
   then run `dpkg-deb -x sldev-io_X.Y.Z_amd64.deb deb` and
   `timeout 12 deb/opt/sldev-io/sldev-io --no-sandbox --user-data-dir=<tmp>`. No "Failed to load native module"
   error should appear in the output.
8. Switch back to master.

**Branches:** betas are cut from `master`. `1.0.0` is cut from `master` after merging the `v1`
branch into it (see docs/go-to-production.md → Launch day). Never push `release/1.0.0` from `v1` directly.

**Betas:** use a prerelease version such as `0.2.0-beta.1` (`npm version 0.2.0-beta.1 --no-git-tag-version`)
and branch `release/0.2.0-beta.1`. Any version with a `-` is published as a GitHub pre-release, so it
never becomes "Latest". Next betas are `-beta.2`, …; the final release is plain `0.2.0`.

Builds are unsigned (no CSC_LINK / APPLE_ID secrets). Windows shows SmartScreen, and macOS needs
right-click → Open. To skip macOS, start the workflow from the Actions tab with `mac` unchecked.
