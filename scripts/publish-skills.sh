#!/usr/bin/env bash
# Publishes sldev's skills to the public downloads repo (skills/<name>/SKILL.md), where
# `npx skills add ben42-01/downloads.sldev.io` installs them. Run it after changing a skill
# (and bumping SKILLS_VERSION in src/shared/sldevSkills.ts). It pushes only when something changed.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="${SLDEV_SKILLS_REPO:-ben42-01/downloads.sldev.io}"
version="$(node -p "require('./package.json').version")"
npm run -s cli:build >/dev/null
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# plain git (gh as a snap can't write under /tmp); push with your usual GitHub credentials
git clone -q "https://github.com/$REPO.git" "$work/repo"
rm -rf "$work/repo/skills"
node cli/dist/sldev.mjs skills export "$work/repo/skills"
cd "$work/repo"
# never commit anywhere but the clone
[ "$(git rev-parse --show-toplevel)" = "$(cd "$work/repo" && pwd -P)" ] || { echo "not in the clone" >&2; exit 1; }
git add -A skills
if git diff --cached --quiet; then
  echo "The published skills are already up to date."
  exit 0
fi
git commit -qm "Skills: sldev skills from sldev-io $version"
git push -q
echo "Published to https://github.com/$REPO/tree/HEAD/skills"
