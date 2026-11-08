#!/usr/bin/env bash
# Publishes sldev's skills to the public downloads repo (skills/<name>/SKILL.md), where
# `npx skills add ben42-01/downloads.sldev.io` installs them. Run it after changing a skill
# (and bumping SKILLS_VERSION in src/shared/sldevSkills.ts). It pushes only when something changed.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="${SLDEV_SKILLS_REPO:-ben42-01/downloads.sldev.io}"
npm run -s cli:build >/dev/null
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
gh repo clone "$REPO" "$work/repo" -- -q
rm -rf "$work/repo/skills"
node cli/dist/sldev.mjs skills export "$work/repo/skills"
cd "$work/repo"
git add -A skills
if git diff --cached --quiet; then
  echo "The published skills are already up to date."
  exit 0
fi
git commit -qm "Skills: sldev skills from sldev-io $(node -p "require('$OLDPWD/package.json').version")"
git push -q
echo "Published to https://github.com/$REPO/tree/HEAD/skills"
