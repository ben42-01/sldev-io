---
name: cut-release
description: Publish a new sldev-io release with installers for Linux, Windows and macOS via the GitHub release workflow. Use when asked to release, ship, publish installers, or bump the version.
---

# Cut a release

The `.github/workflows/release.yml` workflow runs on pushes to `release/**`. It builds every OS and
attaches the installers plus `SHA256SUMS.txt` to the GitHub release `v<package.json version>`.

Pushing is outward-facing. Confirm the version and the go-ahead with the user before pushing.

1. Make sure `master` is green: `gh run list --workflow ci.yml --limit 3`.
2. Locally: `npm run typecheck && npm test && npm run e2e -- smoke`.
3. Bump the version without creating a tag (the workflow makes it):
   `npm version <patch|minor|major|x.y.z> --no-git-tag-version`, then commit
   `Release vX.Y.Z` on master and push master.
4. Create and push the branch: `git switch -c release/X.Y.Z && git push -u origin release/X.Y.Z`.
5. Watch it: `gh run watch $(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status`.
   If a single OS fails, fix it on the branch and push again. Assets are replaced (`--clobber`).
6. Check `gh release view vX.Y.Z` lists AppImage, deb, rpm, exe, dmg (x64 + arm64), zip and checksums.
7. Switch back to master.

**Betas:** use a prerelease version such as `0.2.0-beta.1` (`npm version 0.2.0-beta.1 --no-git-tag-version`)
and branch `release/0.2.0-beta.1`. Any version with a `-` is published as a GitHub pre-release, so it
never becomes "Latest". Next betas are `-beta.2`, …; the final release is plain `0.2.0`.

Builds are unsigned (no CSC_LINK / APPLE_ID secrets). Windows shows SmartScreen, and macOS needs
right-click → Open. To skip macOS, start the workflow from the Actions tab with `mac` unchecked.
