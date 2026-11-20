#!/usr/bin/env bash
# Protects ben42-01/sldev-io once it is public (or on GitHub Pro): rulesets need one of the two.
# Safe to run again: it replaces its own rulesets by name.
#
#   1. "Protect main lines": master, v1 and release/** can't be deleted or force-pushed, by anyone (the owner
#      included; turn the ruleset off in Settings → Rules for a deliberate history rewrite).
#   2. "Master needs green CI": changes to master go through a pull request with CI passing. The owner
#      (repository admin) can bypass it, so direct pushes to master keep working for you and nobody else.
#   3. Actions on pull requests from forks wait for your approval, for every outside contributor.
set -euo pipefail
REPO=${REPO:-ben42-01/sldev-io}

replace_ruleset() { # <name> <json>
  local id
  id=$(gh api "repos/$REPO/rulesets" -q ".[] | select(.name == \"$1\") | .id")
  if [ -n "$id" ]; then
    gh api -X PUT "repos/$REPO/rulesets/$id" --input - <<<"$2" >/dev/null
  else
    gh api -X POST "repos/$REPO/rulesets" --input - <<<"$2" >/dev/null
  fi
  echo "ruleset: $1"
}

replace_ruleset "Protect main lines" '{
  "name": "Protect main lines",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH", "refs/heads/v1", "refs/heads/release/**"], "exclude": [] } },
  "rules": [{ "type": "deletion" }, { "type": "non_fast_forward" }],
  "bypass_actors": []
}'

# Job names from .github/workflows/ci.yml; update them here when CI's jobs change.
replace_ruleset "Master needs green CI" '{
  "name": "Master needs green CI",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false, "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [{ "context": "check" }, { "context": "website" }, { "context": "cli-site" }] } }
  ],
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }]
}'

gh api -X PUT "repos/$REPO/actions/permissions/fork-pr-contributor-approval" -f approval_policy=all_external_contributors >/dev/null
echo "actions: fork pull requests wait for approval"

echo "collaborators:"
gh api "repos/$REPO/collaborators" -q '.[] | "  \(.login) (\(.role_name))"'
