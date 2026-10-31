#!/usr/bin/env bash
#
# gh-stats — a read-only Git + GitHub status dashboard for the current repo.
#
# Shows: repository, current branch (incl. ahead/behind of its upstream),
# working tree (staged / unstaged / untracked with +/- counts), the last
# commit, latest release, open issues, the last 3 GitHub Actions runs and
# any open PRs for the branch.
#
# Requirements
#   - git (local sections always work)
#   - the `gh` CLI, installed and authenticated (GitHub sections only;
#     the rest of the dashboard still renders without it)
#
# Guarantees
#   - Every command is read-only: git status/log/rev-parse/diff and
#     gh run list / gh release list / gh api search/issues / gh pr list /
#     gh repo view. It never modifies the repo, index, refs or remote.
#
# Usage
#   bash scripts/gh-stats.sh            # from anywhere inside a git repo
#   npm run gh-stats
#   NO_COLOR=1 bash scripts/gh-stats.sh # plain output
#   bash scripts/gh-stats.sh --no-color
#
set -u

# ---------------------------------------------------------------------------
# terminal & color setup
# ---------------------------------------------------------------------------
USE_COLOR=1
for a in "$@"; do [[ "$a" == "--no-color" ]] && USE_COLOR=0; done
[[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]] || USE_COLOR=0

if (( USE_COLOR )); then
  R=$'\033[0m'; B=$'\033[1m'; D=$'\033[2m'
  RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLU=$'\033[34m'
  MAG=$'\033[35m'; CYN=$'\033[36m'; GRY=$'\033[90m'
  BORDER=$CYN
else
  R=''; B=''; D=''; RED=''; GRN=''; YEL=''; BLU=''; MAG=''; CYN=''; GRY=''; BORDER=''
fi

# box width = terminal width − 2, clamped to [60, 100]
if [[ -t 1 ]]; then COLS=$(tput cols 2>/dev/null || echo 80); else COLS=80; fi
W=$(( COLS - 2 )); (( W < 60 )) && W=60; (( W > 100 )) && W=100
INNER=$(( W - 4 ))

LINE=$(printf '─%.0s' $(seq 1 $((W - 2))))

box_top() { printf '%s╭%s╮%s\n' "$BORDER" "$LINE" "$R"; }
box_mid() { printf '%s├%s┤%s\n' "$BORDER" "$LINE" "$R"; }
box_bot() { printf '%s╰%s╯%s\n' "$BORDER" "$LINE" "$R"; }

# trunc — UTF-8 aware truncation with a trailing "…"
trunc() {
  local s=$1 m=$2
  (( ${#s} > m )) && s="${s:0:$((m-1))}…"
  printf '%s' "$s"
}

# row — one line inside the box. $1 is the plain text (padding is computed
# from it); $2 is an optional colorized twin of the same characters.
row() {
  local plain=$1 colored=${2:-$1}
  local p=$(( INNER - ${#plain} )); (( p < 1 )) && p=1
  printf '%s│ %s%*s%s │%s\n' "$BORDER" "$colored" "$p" '' "$BORDER" "$R"
}

# section — a bold cyan section label inside the box
section() {
  local label=$1
  row "  $label" "  ${B}${CYN}${label}${R}"
}

fmt_dur() { # seconds -> "37s" / "4m2s" / "1h3m"
  local s=$1 m
  if   (( s >= 3600 )); then m=$((s / 60));  printf '%dh%dm' $((m / 60)) $((m % 60))
  elif (( s >= 60 ));   then printf '%dm%ds' $((s / 60)) $((s % 60))
  else printf '%ds' "$s"; fi
}

fmt_age() { # seconds since a run finished -> "38s" / "2h" / "3d 1h"
  local s=$1
  (( s < 0 )) && s=0
  if   (( s >= 2 * 86400 )); then printf '%dd' $((s / 86400))
  elif (( s >= 86400 ));     then printf '%dd %dh' $((s / 86400)) $(((s % 86400) / 3600))
  elif (( s >= 3600 ));      then printf '%dh' $((s / 3600))
  elif (( s >= 60 ));        then printf '%dm' $((s / 60))
  else printf '%ds' "$s"; fi
}

# pick_glyph — status/conclusion -> glyph (g) + colorized glyph (gc)
pick_glyph() {
  local st=$1 co=$2
  if [[ "$st" == "completed" ]]; then
    case "$co" in
      success)           g='✓'; gc="${GRN}✓${R}" ;;
      failure|timed_out) g='✗'; gc="${RED}✗${R}" ;;
      cancelled)         g='⊘'; gc="${YEL}⊘${R}" ;;
      skipped|neutral)   g='○'; gc="${GRY}○${R}" ;;
      action_required)   g='●'; gc="${MAG}●${R}" ;;
      *)                 g='?'; gc="${MAG}?${R}" ;;
    esac
  else
    case "$st" in
      in_progress) g='◔'; gc="${BLU}◔${R}" ;;
      queued)      g='◌'; gc="${CYN}◌${R}" ;;
      *)           g='…'; gc="${BLU}…${R}" ;;
    esac
  fi
}

# shortstat <text> -> "FILES INS DEL" parsed from `git diff --shortstat`
shortstat() {
  local t=$1 f=0 i=0 d=0 n
  [[ -z "$t" ]] && { echo "0 0 0"; return; }
  n=$(printf '%s\n' "$t" | sed -n 's/^ *\([0-9][0-9]*\) file.*/\1/p'); [[ -n $n ]] && f=$n
  n=$(printf '%s\n' "$t" | sed -n 's/.* \([0-9][0-9]*\) insertion.*/\1/p'); [[ -n $n ]] && i=$n
  n=$(printf '%s\n' "$t" | sed -n 's/.* \([0-9][0-9]*\) deletion.*/\1/p'); [[ -n $n ]] && d=$n
  echo "$f $i $d"
}

n_files() { (( $1 == 1 )) && printf '%s file' "$1" || printf '%s files' "$1"; }

# ---------------------------------------------------------------------------
# collect data (all read-only)
# ---------------------------------------------------------------------------
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  printf 'gh-stats: not inside a git repository\n' >&2
  exit 1
}
cd "$ROOT" || exit 1

# branch / HEAD state
NOCOMMITS=0
git rev-parse --verify -q HEAD >/dev/null 2>&1 || NOCOMMITS=1
RB=$(git symbolic-ref -q --short HEAD 2>/dev/null || true)   # ref branch, "" when detached
BRANCH=$RB
DETACHED=0
if [[ -z "$BRANCH" ]]; then
  DETACHED=1
  BRANCH=$(git rev-parse --short HEAD 2>/dev/null || true)
  [[ -z "$BRANCH" ]] && BRANCH='fresh repo'
fi

# upstream + ahead/behind
UPSTREAM=''
if [[ -n "$RB" ]] && git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
  UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}')
fi
BEHIND=0; AHEAD=0
if [[ -n "$UPSTREAM" ]]; then
  read -r _b _a < <(git rev-list --left-right --count '@{upstream}...HEAD' 2>/dev/null) || true
  BEHIND=${_b:-0}; AHEAD=${_a:-0}
fi

# working tree (porcelain v1: XY<space>path)
STAGED=(); UNSTAGED=(); UNTRACKED=()
while IFS= read -r line; do
  x=${line:0:1}; y=${line:1:1}; p=${line:3}
  if [[ "$x" == '?' ]]; then
    UNTRACKED+=("$p")
  else
    [[ "$x" != ' ' ]] && STAGED+=("$p")
    [[ "$y" != ' ' ]] && UNSTAGED+=("$p")
  fi
done < <(git status --porcelain=v1 2>/dev/null)

read -r SF SI SD <<<"$(shortstat "$(git diff --cached --shortstat 2>/dev/null)")"
read -r UF UI UD <<<"$(shortstat "$(git diff --shortstat 2>/dev/null)")"
CLEAN=$(( ${#STAGED[@]} == 0 && ${#UNSTAGED[@]} == 0 && ${#UNTRACKED[@]} == 0 ))

# repository identity + GitHub availability
GH_AVAIL=0; GH_AUTH=0
if command -v gh >/dev/null 2>&1; then
  GH_AVAIL=1
  gh auth status >/dev/null 2>&1 && GH_AUTH=1
fi

OWNER_REPO=''
if (( GH_AUTH )); then
  OWNER_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
fi
if [[ -z "$OWNER_REPO" ]]; then
  ORIGIN=$(git config --get remote.origin.url 2>/dev/null || true)
  OWNER_REPO=$(printf '%s\n' "$ORIGIN" | sed -E 's#.*github\.com[:/]([^/]+/[^/]+)(\.git)?$#\1#')
  [[ "$OWNER_REPO" == "$ORIGIN" ]] && OWNER_REPO=''
fi

STARS=''
if (( GH_AUTH )) && [[ -n "$OWNER_REPO" ]]; then
  STARS=$(gh repo view --json stargazerCount -q .stargazerCount 2>/dev/null || true)
fi

# last commit
SHA=''; SHORT=''; SUBJ=''; AUTHOR=''; DATE=''
if (( ! NOCOMMITS )); then
  SHA=$(git rev-parse HEAD 2>/dev/null)
  SHORT=$(git rev-parse --short HEAD 2>/dev/null)
  SUBJ=$(git log -1 --format=%s 2>/dev/null)
  AUTHOR=$(git log -1 --format=%an 2>/dev/null)
  DATE=$(git log -1 --format=%ar 2>/dev/null)
fi

# last 3 Actions runs for the current branch
RUNS=(); RUN_ERROR=0
if (( GH_AVAIL && GH_AUTH )); then
  local_args=(run list --limit 3)
  [[ -n "$RB" ]] && local_args+=(--branch "$RB")
  RUN_OUTPUT=$(gh "${local_args[@]}" --json status,conclusion,workflowName,displayTitle,headBranch,event,headSha,createdAt,updatedAt \
    --jq '.[] | [.status, (.conclusion // ""), .workflowName, .displayTitle, .headBranch, .event, (.headSha[0:7]),
           ((.updatedAt | fromdateiso8601) - (.createdAt | fromdateiso8601) | floor),
           (now - (.updatedAt | fromdateiso8601) | floor)] | @tsv' 2>/dev/null) || RUN_ERROR=1
  if [[ -n "$RUN_OUTPUT" ]]; then
    while IFS=$'\t' read -r st co wf title br ev sha dur age; do
      RUNS+=("$st|$co|$wf|$title|$br|$ev|$sha|$dur|$age")
    done <<< "$RUN_OUTPUT"
  fi
fi

# latest release
RELEASE=''; RELEASE_ERROR=0
if (( GH_AVAIL && GH_AUTH )) && [[ -n "$OWNER_REPO" ]]; then
  RELEASE=$(gh release list --limit 1 --json tagName,name,publishedAt,isPrerelease \
    --jq '.[] | [.tagName, (.name // ""), (.publishedAt[0:10] // ""), (.isPrerelease | tostring)] | @tsv' \
    2>/dev/null) || RELEASE_ERROR=1
fi

# open issue count and five most recently updated issues
ISSUE_COUNT=''; ISSUES=(); ISSUE_ERROR=0
if (( GH_AVAIL && GH_AUTH )) && [[ -n "$OWNER_REPO" ]]; then
  ISSUE_OUTPUT=$(gh api search/issues --method GET -f "q=repo:$OWNER_REPO is:issue is:open" \
    -f sort=updated -f order=desc -f per_page=5 \
    --jq '.total_count, (.items[] | [.number, .title] | @tsv)' 2>/dev/null) || ISSUE_ERROR=1
  if [[ -n "$ISSUE_OUTPUT" ]]; then
    ISSUE_COUNT=${ISSUE_OUTPUT%%$'\n'*}
    if [[ "$ISSUE_OUTPUT" == *$'\n'* ]]; then
      ISSUE_ROWS=${ISSUE_OUTPUT#*$'\n'}
      while IFS=$'\t' read -r num title; do
        ISSUES+=("$num|$title")
      done <<< "$ISSUE_ROWS"
    fi
  fi
fi

# open PRs for the current branch
PRS=()
if (( GH_AVAIL && GH_AUTH )) && [[ -n "$RB" ]] && [[ -n "$OWNER_REPO" ]]; then
  while IFS=$'\t' read -r num title; do
    PRS+=("$num|$title")
  done < <(gh pr list --head "$RB" --state open --json number,title \
    -q '.[] | [.number, .title] | @tsv' 2>/dev/null || true)
fi

# ---------------------------------------------------------------------------
# render
# ---------------------------------------------------------------------------
box_top

row "  GitHub Stats" "  ${B}GitHub Stats${R}"

if [[ -n "$OWNER_REPO" ]]; then
  if [[ -n "$STARS" ]]; then
    row "  $OWNER_REPO  ★ $STARS" "  ${B}${CYN}$OWNER_REPO${R}  ${D}★ $STARS${R}"
  else
    row "  $OWNER_REPO" "  ${B}${CYN}$OWNER_REPO${R}"
  fi
else
  row "  local repository (no GitHub remote detected)" "  ${D}local repository${R} ${GRY}(no GitHub remote detected)${R}"
fi

br_plain="  branch $BRANCH"
br_color="  ${B}branch${R} ${B}${CYN}${BRANCH}${R}"
if (( DETACHED )); then
  br_plain+=" (detached)"
  br_color+=" ${D}(detached)${R}"
fi
if [[ -n "$UPSTREAM" ]]; then
  br_plain+=" · ${BEHIND}↓ ${AHEAD}↑"
  br_color+=" · ${YEL}${BEHIND}↓${R} ${GRN}${AHEAD}↑${R}"
else
  br_plain+=" · no upstream"
  br_color+=" · ${D}no upstream${R}"
fi
row "$br_plain" "$br_color"

box_mid

section "Working tree"
if (( CLEAN )); then
  row "  ✓  working tree clean" "  ${B}${GRN}✓${R}  working tree clean"
else
  if (( ${#STAGED[@]} )); then
    L=$(printf '%-9s' 'Staged')
    row "  $L $(n_files "$SF")  +$SI −$SD" \
        "  ${B}${L}${R} ${B}${CYN}$(n_files "$SF")${R}  ${GRN}+$SI${R} ${RED}−$SD${R}"
    n=0
    for p in "${STAGED[@]}"; do
      if (( n == 15 )); then row "  …and $(( ${#STAGED[@]} - 15 )) more" "  ${D}…and $(( ${#STAGED[@]} - 15 )) more${R}"; break; fi
      pt=$(trunc "$p" $((INNER - 5)))
      row "  + $pt" "  ${GRN}${B}+${R} ${D}$pt${R}"
      ((n++))
    done
  fi
  if (( ${#UNSTAGED[@]} )); then
    L=$(printf '%-9s' 'Modified')
    row "  $L $(n_files "$UF")  +$UI −$UD" \
        "  ${B}${L}${R} ${B}${CYN}$(n_files "$UF")${R}  ${GRN}+$UI${R} ${RED}−$UD${R}"
    n=0
    for p in "${UNSTAGED[@]}"; do
      if (( n == 15 )); then row "  …and $(( ${#UNSTAGED[@]} - 15 )) more" "  ${D}…and $(( ${#UNSTAGED[@]} - 15 )) more${R}"; break; fi
      pt=$(trunc "$p" $((INNER - 5)))
      row "  ~ $pt" "  ${YEL}${B}~${R} ${D}$pt${R}"
      ((n++))
    done
  fi
  if (( ${#UNTRACKED[@]} )); then
    L=$(printf '%-9s' 'Untracked')
    row "  $L $(n_files "${#UNTRACKED[@]}")" "  ${B}${L}${R} ${B}${CYN}$(n_files "${#UNTRACKED[@]}")${R}"
    n=0
    for p in "${UNTRACKED[@]}"; do
      if (( n == 15 )); then row "  …and $(( ${#UNTRACKED[@]} - 15 )) more" "  ${D}…and $(( ${#UNTRACKED[@]} - 15 )) more${R}"; break; fi
      pt=$(trunc "$p" $((INNER - 5)))
      row "  ? $pt" "  ${GRY}?${R} ${D}$pt${R}"
      ((n++))
    done
  fi
fi

box_mid

section "Last commit"
if (( NOCOMMITS )); then
  row "  — no commits yet" "  ${D}— no commits yet${R}"
else
  t=$(trunc "$SUBJ" $((INNER - 12)))
  row "  ◉  $SHORT  $t" "  ${B}${CYN}◉  $SHORT${R}  ${B}${t}${R}"
  ma=$(trunc "$AUTHOR" $((INNER - 6)))
  row "  $ma · $DATE" "  ${D}$ma · $DATE${R}"
  if [[ -n "$OWNER_REPO" ]]; then
    url=$(trunc "https://github.com/$OWNER_REPO/commit/$SHA" $((INNER - 2)))
    row "  $url" "  ${GRY}$url${R}"
  fi
fi

box_mid

section "Latest release"
if (( ! GH_AVAIL )); then
  row "  — 'gh' CLI not found" "  ${D}— 'gh' CLI not found${R}"
elif (( ! GH_AUTH )); then
  row "  — 'gh' not authenticated — run 'gh auth login'" "  ${D}— 'gh' not authenticated${R} ${GRY}(run 'gh auth login')${R}"
elif [[ -z "$OWNER_REPO" ]]; then
  row "  — no GitHub repository detected" "  ${D}— no GitHub repository detected${R}"
elif (( RELEASE_ERROR )); then
  row "  — could not load releases" "  ${D}— could not load releases${R}"
elif [[ -z "$RELEASE" ]]; then
  row "  — no releases yet" "  ${D}— no releases yet${R}"
else
  IFS=$'\t' read -r release_tag release_name release_date release_prerelease <<< "$RELEASE"
  release_label="$release_tag"
  [[ -n "$release_name" && "$release_name" != "$release_tag" ]] && release_label+=" · $release_name"
  [[ -n "$release_date" ]] && release_label+=" · $release_date"
  if [[ "$release_prerelease" == "true" ]]; then release_label+=" (pre-release)"; fi
  release_label=$(trunc "$release_label" $((INNER - 4)))
  row "  $release_label" "  ${B}${CYN}$release_tag${R}${D}${release_label#"$release_tag"}${R}"
fi

box_mid

section "Open issues"
if (( ! GH_AVAIL )); then
  row "  — 'gh' CLI not found" "  ${D}— 'gh' CLI not found${R}"
elif (( ! GH_AUTH )); then
  row "  — 'gh' not authenticated — run 'gh auth login'" "  ${D}— 'gh' not authenticated${R} ${GRY}(run 'gh auth login')${R}"
elif [[ -z "$OWNER_REPO" ]]; then
  row "  — no GitHub repository detected" "  ${D}— no GitHub repository detected${R}"
elif (( ISSUE_ERROR )); then
  row "  — could not load open issues" "  ${D}— could not load open issues${R}"
elif [[ -z "$ISSUE_COUNT" || "$ISSUE_COUNT" == "0" ]]; then
  row "  ✓  no open issues" "  ${B}${GRN}✓${R}  no open issues"
else
  row "  $ISSUE_COUNT open issues · recently updated" "  ${B}${CYN}$ISSUE_COUNT${R} open issues · recently updated"
  for issue in "${ISSUES[@]}"; do
    IFS='|' read -r num title <<< "$issue"
    t=$(trunc "$title" $((INNER - 12)))
    row "  #$num  $t" "  ${B}${BLU}#$num${R}  $t"
  done
fi

box_mid

section "GitHub Actions — last 3 runs"
if (( ! GH_AVAIL )); then
  row "  — 'gh' CLI not found (install and authenticate for runs)" "  ${D}— 'gh' CLI not found${R} ${GRY}(install and authenticate for runs)${R}"
elif (( ! GH_AUTH )); then
  row "  — 'gh' not authenticated — run 'gh auth login'" "  ${D}— 'gh' not authenticated${R} ${GRY}(run 'gh auth login')${R}"
elif (( RUN_ERROR )); then
  row "  — could not load workflow runs" "  ${D}— could not load workflow runs${R}"
elif (( ${#RUNS[@]} == 0 )); then
  row "  — no workflow runs yet" "  ${D}— no workflow runs yet${R}"
else
  for run in "${RUNS[@]}"; do
    IFS='|' read -r st co wf title br ev sha dur age <<<"$run"
    dur_f=$(fmt_dur "$dur")
    age_f=$(fmt_age "$age")
    pick_glyph "$st" "$co"
    meta="· $br · $ev · $dur_f · ${age_f} ago"
    meta_c="${D}· $br · $ev · $dur_f · ${age_f} ago${R}"
    wf_c="${B}${CYN}${wf}${R}"
    tmax=$(( INNER - 8 - ${#wf} - ${#meta} ))
    (( tmax < 12 )) && tmax=12
    t=$(trunc "$title" "$tmax")
    row "  $g $wf $t  $meta" "  $gc $wf_c $t  $meta_c"
  done
fi

if (( ${#PRS[@]} > 0 )); then
  box_mid
  section "Open pull requests on $BRANCH"
  n=0
  for pr in "${PRS[@]}"; do
    IFS='|' read -r num title <<<"$pr"
    t=$(trunc "$title" $((INNER - 16)))
    row "  #$num  $t" "  ${B}${BLU}#$num${R}  $t"
    ((n++))
    (( n == 5 )) && break
  done
fi

box_bot