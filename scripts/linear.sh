#!/usr/bin/env bash
set -euo pipefail

# linear.sh, Linear GraphQL tracker backend for the Janus dev-docs issue lifecycle.
#
# Implements the operations contract in dev-docs/harness/tracker.md. The workflow
# skills and dev-docs-preflight.sh call this script; they never touch the Linear
# API directly. That seam is what makes the backend swappable.
#
# Dependencies: curl, jq. Requires $LINEAR_API_KEY in the environment.
#
# State and existence checks are ALWAYS live (every command hits Linear). The
# shared cache written by `sync` is read-only materialization for grep/reading
# only, never the source of truth, and is never consulted for gate decisions.
#
# Usage: linear.sh <command> [args]
#   id-in-use <janus-id>            exit 0 if id is taken, 1 if free
#   find-by-id <janus-id>           print linear id/identifier/url; exit 2 if ambiguous, 1 if missing
#   create-issue <janus-id> <title> create with [janus-id] title prefix; description on stdin
#   set-state <janus-id> <backlog|open|done|canceled>
#   comment <janus-id>              append a comment; body on stdin
#   fetch <janus-id>                print one issue as markdown to stdout (incl. comments)
#   sync                            materialize all Janus issues into the shared cache
#   list [lifecycle-state]          print janus-id<TAB>identifier<TAB>state<TAB>title
#                                   (filter by backlog|open|done|canceled; omit for all)

GRAPHQL_ENDPOINT="${LINEAR_API_ENDPOINT:-https://api.linear.app/graphql}"
TEAM_KEY="${JANUS_LINEAR_TEAM_KEY:-THE}"
PROJECT_NAME="${JANUS_LINEAR_PROJECT:-Janus}"

# Janus lifecycle word -> Linear workflow-state name. "Open" is the active
# work state (In Progress); the pre-capture intake state is Backlog.
BACKLOG_STATE="${JANUS_LINEAR_BACKLOG_STATE:-Backlog}"
OPEN_STATE="${JANUS_LINEAR_OPEN_STATE:-In Progress}"
DONE_STATE="${JANUS_LINEAR_DONE_STATE:-Done}"
CANCELED_STATE="${JANUS_LINEAR_CANCELED_STATE:-Canceled}"

CACHE_DIR="${JANUS_ISSUE_CACHE_DIR:-$HOME/.cache/janus/issues}"

# ── internal helpers ──────────────────────────────────────────────────────────

die() { echo "linear.sh: $*" >&2; exit 1; }

require_key() {
  [ -n "${LINEAR_API_KEY:-}" ] || die "LINEAR_API_KEY is not set. Add it to .env (see .env.example)."
}

require_jq() {
  command -v jq >/dev/null 2>&1 || die "jq is required but not found on PATH."
}

# POST a GraphQL document. Echoes the JSON response on stdout (errors checked).
# $1 = query string, $2 = optional variables JSON object.
# --http1.1 avoids intermittent curl "HTTP2 framing layer" errors against Linear.
# --retry covers transient network blips so live gate checks stay reliable.
gql() {
  local query="$1" variables="${2:-}" payload resp errmsg
  if [ -n "$variables" ]; then
    payload=$(jq -nc --arg q "$query" --argjson v "$variables" '{query:$q, variables:$v}')
  else
    payload=$(jq -nc --arg q "$query" '{query:$q}')
  fi
  resp=$(curl -sS --http1.1 --retry 3 --retry-all-errors --retry-delay 1 -X POST "$GRAPHQL_ENDPOINT" \
    -H "Authorization: ${LINEAR_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$payload") || die "network request to Linear failed"
  printf '%s' "$resp" | jq -e . >/dev/null 2>&1 \
    || { echo "linear.sh: Linear returned a non-JSON response:" >&2; printf '%s\n' "$resp" >&2; exit 1; }
  errmsg=$(printf '%s' "$resp" | jq -r '.errors // [] | map(.message) | join("; ")')
  [ -z "$errmsg" ] || die "Linear API error: $errmsg"
  printf '%s' "$resp"
}

# Resolve the Linear team id for TEAM_KEY (cached per process).
_RESOLVED_TEAM=""
resolve_team_id() {
  [ -n "$_RESOLVED_TEAM" ] && { printf '%s' "$_RESOLVED_TEAM"; return 0; }
  local id
  id=$(gql '{ teams { nodes { id key name } } }' \
    | jq -r --arg k "$TEAM_KEY" '.data.teams.nodes[] | select(.key==$k) | .id')
  [ -n "$id" ] || die "team not found for key '$TEAM_KEY' (set JANUS_LINEAR_TEAM_KEY)"
  _RESOLVED_TEAM="$id"
  printf '%s' "$id"
}

# Resolve the project id for PROJECT_NAME within the team (cached).
_RESOLVED_PROJECT=""
resolve_project_id() {
  [ -n "$_RESOLVED_PROJECT" ] && { printf '%s' "$_RESOLVED_PROJECT"; return 0; }
  local tid pid
  tid=$(resolve_team_id)
  pid=$(gql 'query($tid:String!){ team(id:$tid){ projects { nodes { id name } } } }' \
    "{\"tid\":\"$tid\"}" \
    | jq -r --arg n "$PROJECT_NAME" '.data.team.projects.nodes[] | select(.name==$n) | .id')
  [ -n "$pid" ] || die "project not found for name '$PROJECT_NAME' in team '$TEAM_KEY' (set JANUS_LINEAR_PROJECT)"
  _RESOLVED_PROJECT="$pid"
  printf '%s' "$pid"
}

# Resolve a workflow-state id by state name within the team. $1 = state name.
resolve_state_id() {
  local tid name sid
  tid=$(resolve_team_id)
  name="$1"
  sid=$(gql 'query($tid:String!){ team(id:$tid){ states { nodes { id name type } } } }' \
    "{\"tid\":\"$tid\"}" \
    | jq -r --arg n "$name" '.data.team.states.nodes[] | select(.name==$n) | .id')
  [ -n "$sid" ] || die "workflow state not found: '$name' (configure the state in Linear or set JANUS_LINEAR_*_STATE)"
  printf '%s' "$sid"
}

# Map a Janus lifecycle word to a Linear state name.
lifecycle_to_state_name() {
  case "$1" in
    backlog)  printf '%s' "$BACKLOG_STATE" ;;
    open)     printf '%s' "$OPEN_STATE" ;;
    done)     printf '%s' "$DONE_STATE" ;;
    canceled) printf '%s' "$CANCELED_STATE" ;;
    *) die "unknown lifecycle state '$1' (expected backlog|open|done|canceled)" ;;
  esac
}

# Print all Janus project issues as JSONL (one compact JSON object per line):
#   {id, identifier, janusId, title, state, url, description}
# janusId is parsed from the leading [id] title prefix, or empty when absent.
# JSONL (not TSV) so multiline descriptions survive the round-trip without
# @tsv's newline escaping mangling the cache.
project_issues_jsonl() {
  local pid
  pid=$(resolve_project_id) || exit 1
  gql 'query($pid:String!){ project(id:$pid){ issues { nodes { id identifier title url state { name } description } } } }' \
    "{\"pid\":\"$pid\"}" \
    | jq -c '
        .data.project.issues.nodes[]
        | (.title | try capture("^\\[(?<j>[^\\]]+)\\]") catch null) as $m
        | {id, identifier, janusId:($m.j // ""), title, state:(.state.name // ""), url, description:(.description // "")}
      '
}

# Print TSV linearId<TAB>identifier<TAB>title<TAB>state<TAB>url for each issue
# whose parsed janus id equals $1 (zero, one, or many lines).
# Only single-line fields are emitted, so @tsv is safe here.
matches_for_janus_id() {
  local jid="$1"
  project_issues_jsonl \
    | jq -r --arg j "$jid" 'select(.janusId==$j) | [.id,.identifier,.title,.state,.url] | @tsv'
}

# Resolve a single Linear id for a janus id, or die on missing/ambiguous.
# $1 = janus id. Echoes the Linear id on stdout.
one_linear_id() {
  local jid="$1" m n lid
  m=$(matches_for_janus_id "$jid")
  n=$(printf '%s\n' "$m" | grep -c . || true)
  [ "$n" -ge 1 ] || die "issue not found: $jid"
  [ "$n" -eq 1 ] || { echo "linear.sh: ambiguous id '$jid' ($n matches):" >&2; printf '%s\n' "$m" >&2; exit 2; }
  lid=$(printf '%s\n' "$m" | head -1 | cut -f1)
  printf '%s' "$lid"
}

# ── commands ──────────────────────────────────────────────────────────────────

cmd_id_in_use() {
  local jid="$1" m
  m=$(matches_for_janus_id "$jid")
  if [ -n "$m" ]; then
    echo "used: $jid" >&2
    printf '%s\n' "$m" >&2
    return 0   # taken
  fi
  echo "available: $jid" >&2
  return 1     # free
}

cmd_find_by_id() {
  local jid="$1" m n
  m=$(matches_for_janus_id "$jid")
  n=$(printf '%s\n' "$m" | grep -c . || true)
  if [ "$n" -eq 0 ]; then
    echo "find-by-id: not found: $jid" >&2
    return 1
  fi
  if [ "$n" -gt 1 ]; then
    echo "find-by-id: ambiguous: $jid matches $n issues" >&2
    printf '%s\n' "$m" >&2
    return 2
  fi
  local lid ident title state url
  { IFS=$'\t' read -r lid ident title state url; } <<< "$m"
  cat <<EOF
linear_id: $lid
identifier: $ident
state: $state
title: $title
url: $url
EOF
}

cmd_create_issue() {
  local jid="$1" title="$2" desc="" tid pid sid input
  if [ ! -t 0 ]; then desc=$(cat || true); fi
  tid=$(resolve_team_id)
  pid=$(resolve_project_id)
  sid=$(resolve_state_id "$BACKLOG_STATE")
  input=$(jq -nc \
    --arg teamId "$tid" --arg projectId "$pid" --arg stateId "$sid" \
    --arg title "[$jid] $title" --arg description "$desc" \
    '{teamId:$teamId, projectId:$projectId, stateId:$stateId, title:$title, description:$description}')
  gql 'mutation($input:IssueCreateInput!){ issueCreate(input:$input){ success issue { id identifier title url state { name } } } }' \
    "{\"input\":$input}" \
    | jq -r '"created: \(.data.issueCreate.issue.identifier)  \(.data.issueCreate.issue.title)\nurl: \(.data.issueCreate.issue.url)\nstate: \(.data.issueCreate.issue.state.name)"'
}

cmd_set_state() {
  local jid="$1" word="$2" statename sid lid input
  statename=$(lifecycle_to_state_name "$word")
  sid=$(resolve_state_id "$statename")
  lid=$(one_linear_id "$jid")
  input=$(jq -nc --arg stateId "$sid" '{stateId:$stateId}')
  gql 'mutation($id:String!,$input:IssueUpdateInput!){ issueUpdate(id:$id,input:$input){ issue { identifier state { name } } } }' \
    "{\"id\":\"$lid\",\"input\":$input}" \
    | jq -r '"updated: \(.data.issueUpdate.issue.identifier) -> \(.data.issueUpdate.issue.state.name)"'
}

cmd_comment() {
  local jid="$1" body="" lid input
  if [ ! -t 0 ]; then body=$(cat || true); fi
  lid=$(one_linear_id "$jid")
  input=$(jq -nc --arg issueId "$lid" --arg body "$body" '{issueId:$issueId, body:$body}')
  gql 'mutation($input:CommentCreateInput!){ commentCreate(input:$input){ success } }' "{\"input\":$input}" >/dev/null
  echo "commented on: $jid"
}

cmd_fetch() {
  local jid="$1" lid
  lid=$(one_linear_id "$jid")
  gql 'query($id:String!){ issue(id:$id){ identifier title url state { name } description comments { nodes { body createdAt user { name } } } } }' \
    "{\"id\":\"$lid\"}" \
    | jq -r --arg jid "$jid" '
        "---",
        "janus_id: " + $jid,
        "linear_id: " + (.data.issue.identifier // ""),
        "state: " + (.data.issue.state.name // ""),
        "url: " + (.data.issue.url // ""),
        "title: " + (.data.issue.title // ""),
        "---",
        "",
        (.data.issue.description // ""),
        "",
        "## Comments",
        ""
      ,
      ( .data.issue.comments.nodes[]
        | "### " + ((.user.name) // "unknown") + " on " + (.createdAt // "") + "\n\n" + (.body // "") + "\n"
      )
      '
}

cmd_sync() {
  mkdir -p "$CACHE_DIR"
  local count=0 removed=0 line present=""
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    local ident jid fname f
    ident=$(printf '%s' "$line" | jq -r '.identifier')
    jid=$(printf '%s' "$line" | jq -r '.janusId')
    fname="${jid:-$ident}.md"
    f="$CACHE_DIR/$fname"
    {
      printf '%s\n' "---"
      printf 'janus_id: %s\n' "$(printf '%s' "$line" | jq -r '.janusId')"
      printf 'linear_id: %s\n' "$ident"
      printf 'state: %s\n' "$(printf '%s' "$line" | jq -r '.state')"
      printf 'url: %s\n' "$(printf '%s' "$line" | jq -r '.url')"
      printf 'title: %s\n' "$(printf '%s' "$line" | jq -r '.title')"
      printf '%s\n' "---"
      printf '\n'
      printf '%s' "$line" | jq -r '.description'
      printf '\n'
    } > "$f.tmp.$$"
    mv -f "$f.tmp.$$" "$f"
    present="${present}${fname}"$'\n'
    count=$((count+1))
  done < <(project_issues_jsonl)
  for cf in "$CACHE_DIR"/*.md; do
    [ -e "$cf" ] || continue
    local base
    base=$(basename "$cf")
    printf '%s' "$present" | grep -qxF "$base" || { rm -f "$cf"; removed=$((removed+1)); }
  done
  echo "synced $count issue(s) to $CACHE_DIR (removed $removed stale)"
}

# Optional $1 filters by lifecycle word (backlog|open|done|canceled), mapped to
# the backend state name. Omit it to list every issue carrying a janus id.
cmd_list() {
  local word="${1:-}" state_name=""
  if [ -n "$word" ]; then
    state_name=$(lifecycle_to_state_name "$word")
  fi
  project_issues_jsonl \
    | jq -r --arg st "$state_name" \
        'select(.janusId!="" and ($st=="" or .state==$st)) | [.janusId,.identifier,.state,.title] | @tsv'
}

# ── dispatch ──────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: linear.sh <command> [args]

Linear tracker backend for the Janus dev-docs issue lifecycle. State and
existence checks are always live. The cache written by 'sync' is read-only.

Commands:
  id-in-use <janus-id>            exit 0 if taken, 1 if free
  find-by-id <janus-id>           print linear id/identifier/url; 2 if ambiguous, 1 if missing
  create-issue <janus-id> <title> create with [janus-id] title prefix; description on stdin
  set-state <janus-id> <backlog|open|done|canceled>
  comment <janus-id>              append a comment; body on stdin
  fetch <janus-id>                print one issue as markdown to stdout (incl. comments)
  sync                            materialize all Janus issues into the shared cache
  list [lifecycle-state]          print janus-id<TAB>identifier<TAB>state<TAB>title
                                  (filter by backlog|open|done|canceled; omit for all)
EOF
}

main() {
  require_jq
  local cmd="${1:-}"
  [ -n "$cmd" ] || { usage >&2; exit 1; }
  shift || true
  case "$cmd" in
    id-in-use)
      require_key; [ $# -ge 1 ] || die "id-in-use requires <janus-id>"; cmd_id_in_use "$1" ;;
    find-by-id)
      require_key; [ $# -ge 1 ] || die "find-by-id requires <janus-id>"; cmd_find_by_id "$1" ;;
    create-issue)
      require_key; [ $# -ge 2 ] || die "create-issue requires <janus-id> <title>"; cmd_create_issue "$1" "$2" ;;
    set-state)
      require_key; [ $# -ge 2 ] || die "set-state requires <janus-id> <state>"; cmd_set_state "$1" "$2" ;;
    comment)
      require_key; [ $# -ge 1 ] || die "comment requires <janus-id>"; cmd_comment "$1" ;;
    fetch)
      require_key; [ $# -ge 1 ] || die "fetch requires <janus-id>"; cmd_fetch "$1" ;;
    sync)
      require_key; cmd_sync ;;
    list)
      require_key; cmd_list "${1:-}" ;;
    -h|--help|help) usage ;;
    *) die "unknown command '$cmd' (see --help)" ;;
  esac
}

main "$@"
