#!/usr/bin/env bash
set -euo pipefail

# dev-docs-preflight.sh — Single precondition gate for Janus lifecycle commands.
# Run before every lifecycle command to verify all automatable preconditions.
#
# Usage: dev-docs-preflight.sh <command> [id]
#
# Each check prints " ok  <description>" on success or "FAIL <description>" on
# failure. The script fails fast on the first violation. Manual-only checks
# print as reminders after all auto checks pass.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── internal helpers ──────────────────────────────────────────────────────────

ok()  { echo " ok  $1"; }
fail() { echo "FAIL $1"; }

# Scan active-artifact directories for non-example Markdown files.
# Returns 0 if clean, 1 if active work exists (prints file list to stderr).
check_active_artifacts() {
  local found=0
  local id_pat='^id: +["'"'"']?example["'"'"']? *$'
  for dir in \
    dev-docs/designs/proposed \
    dev-docs/plans/proposed \
    dev-docs/plans/approved; do
    local full_dir="$REPO_ROOT/$dir"
    if [ -d "$full_dir" ]; then
      for f in "$full_dir"/*.md; do
        [ -e "$f" ] || continue
        local stem
        stem="$(basename "$f" .md)"
        if [ "$stem" = "example" ] || head -5 "$f" | grep -qE "$id_pat"; then
          continue
        fi
        echo "  $dir/$(basename "$f")" >&2
        found=1
      done
    fi
  done
  return "$found"
}

# Check whether an issue id is already used across backlog/, open/, and closed/.
# Prints the matching path if found. Returns 0 if found, 1 if not.
check_issue_id_used() {
  local id="$1"
  for dir in dev-docs/issues/backlog dev-docs/issues/open dev-docs/issues/closed; do
    local full_dir="$REPO_ROOT/$dir"
    if [ -d "$full_dir" ]; then
      for f in "$full_dir"/*.md; do
        [ -e "$f" ] || continue
        # Try frontmatter id first (handles quoted and unquoted)
        if head -10 "$f" | grep -qE "^id: +[\"']?$id[\"']? *$"; then
          echo "$dir/$(basename "$f")"
          return 0
        fi
        # Fallback to filename stem for local issues without id field
        local stem
        stem="$(basename "$f" .md)"
        stem="${stem#[0-9][0-9][0-9][0-9]-}"
        if [ "$stem" = "$id" ]; then
          echo "$dir/$(basename "$f")"
          return 0
        fi
      done
    fi
  done
  return 1
}

# Extract a frontmatter field value from a file.
frontmatter_field() {
  local file="$1" field="$2"
  head -30 "$file" | grep -E "^${field}:" | head -1 | sed "s/^${field}: *//"
}

# Parse a YAML list field (plans, designs) into lines.
frontmatter_list() {
  local file="$1" field="$2"
  frontmatter_field "$file" "$field" | tr -d '[]' | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$' || true
}

# ── tracker (Linear) integration ──────────────────────────────────────────────
# Open issues may live in the tracker (Linear) or as local files in
# dev-docs/issues/open/. id-resolution, id-uniqueness, and issue-existence
# checks are dual-path (local first, then tracker) so both stores coexist as
# peers. See dev-docs/harness/tracker.md. State and existence checks against
# Linear are always live (never use the cache).

LINEAR_SH="$REPO_ROOT/scripts/linear.sh"
BACKLOG_STATE_NAME="${JANUS_LINEAR_BACKLOG_STATE:-Backlog}"
DONE_STATE_NAME="${JANUS_LINEAR_DONE_STATE:-Done}"
CANCELED_STATE_NAME="${JANUS_LINEAR_CANCELED_STATE:-Canceled}"

# True when the Linear backend can be consulted: key present and script exists.
issue_tracker_available() {
  [ -n "${LINEAR_API_KEY:-}" ] && [ -x "$LINEAR_SH" ]
}

# Is a janus id already in use anywhere? Local dirs first, then Linear.
# Returns: 0 if used (prints where), 1 if free, 2 if the tracker errored.
tracker_id_in_use() {
  local id="$1" local_hit
  if local_hit=$(check_issue_id_used "$id"); then
    printf '%s\n' "$local_hit"
    return 0
  fi
  issue_tracker_available || return 1
  local out rc
  out=$("$LINEAR_SH" id-in-use "$id" 2>&1) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "linear: $id"
    return 0
  fi
  case "$out" in
    *available:*) return 1 ;;
    *) printf '%s\n' "$out" >&2; return 2 ;;
  esac
}

# Does an open (plannable/closeable) issue exist for this id? Local open/ first,
# then Linear. Returns: 0 if it exists and is not terminal, 1 if missing,
# 2 if the tracker errored or the id is ambiguous, 3 if terminal (Done/Canceled),
# 4 if captured but not opened (Backlog).
tracker_issue_exists_open() {
  local id="$1"
  if [ -f "$REPO_ROOT/dev-docs/issues/open/$id.md" ]; then
    echo "dev-docs/issues/open/$id.md"
    return 0
  fi
  issue_tracker_available || return 1
  local out rc state
  out=$("$LINEAR_SH" find-by-id "$id" 2>&1) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    state=$(printf '%s\n' "$out" | sed -n 's/^state: //p')
    case "$state" in
      "$BACKLOG_STATE_NAME") return 4 ;;
      "$DONE_STATE_NAME"|"$CANCELED_STATE_NAME") return 3 ;;
      *) echo "linear: $id"; return 0 ;;
    esac
  fi
  # Exact marker: linear.sh prints "team/project not found" on a tracker
  # outage, so a loose *"not found"* would wrongly classify that as "missing".
  case "$out" in
    *"find-by-id: not found"*) return 1 ;;
    *) printf '%s\n' "$out" >&2; return 2 ;;
  esac
}

# ── usage ──────────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: dev-docs-preflight.sh <command> [id]

Verify all automatable preconditions for a Janus lifecycle command.
Exits 0 if all checks pass, 1 if any check fails.

Commands:
  create-stack <name>       Check stack file doesn't already exist.
  update-stack <name>       Check stack file exists, has name and description.
  start-issue [id]          Check id uniqueness (Linear or local).
  open-issue <id>           Check backlog issue exists (local backlog/ or Linear Backlog), open target clear.
  plan-issue <id>           Check no active artifacts, issue exists (Linear or open/).
  approve-plan [id]         Check plan in proposed/, approved+done targets clear, has issue field, originating issue exists.
  implement-plan [id]       Check plan in approved/, done target clear, has issue field, originating issue exists.
  design-plan [id]          Check plan in approved/, done target clear. Manual: implementation complete, acceptance passed.
  approve-design [id]       Check design in proposed/, approved target clear.
  close-plan [id]           Check plan in approved/, done target clear. Manual: implementation complete, acceptance passed, designs approved.
  close-issue <id>          Check issue exists (Linear or open/), all plans in done/, closed target available. Manual: designs approved.
EOF
}

# ── per-command check functions ───────────────────────────────────────────────

check_create_stack() {
  local name="$1"
  test ! -f "$REPO_ROOT/dev-docs/stacks/$name.md" \
    || { fail "stack already exists: dev-docs/stacks/$name.md"; return 1; }
  ok "stack target available: dev-docs/stacks/$name.md"
}

check_update_stack() {
  local name="$1"
  test -f "$REPO_ROOT/dev-docs/stacks/$name.md" \
    || { fail "stack not found: dev-docs/stacks/$name.md"; return 1; }
  ok "stack exists: dev-docs/stacks/$name.md"
  local desc
  desc=$(frontmatter_field "$REPO_ROOT/dev-docs/stacks/$name.md" "description")
  test -n "$desc" || { fail "stack frontmatter missing 'description' field"; return 1; }
  ok "stack has description"
}

check_start_issue() {
  local id="$1"
  local used rc
  used=$(tracker_id_in_use "$id") && rc=0 || rc=$?
  case "$rc" in
    0) fail "id already used: $used"; return 1 ;;
    2) fail "could not verify id uniqueness (tracker error, see above)"; return 1 ;;
    *) ok "id available: $id" ;;
  esac
}

check_open_issue() {
  local id="$1" rc state out
  if [ -f "$REPO_ROOT/dev-docs/issues/backlog/$id.md" ]; then
    test ! -f "$REPO_ROOT/dev-docs/issues/open/$id.md" \
      || { fail "open target already exists: dev-docs/issues/open/$id.md"; return 1; }
    ok "backlog issue exists: dev-docs/issues/backlog/$id.md"
    ok "open target available"
    return 0
  fi
  if [ -f "$REPO_ROOT/dev-docs/issues/open/$id.md" ]; then
    fail "issue already open: dev-docs/issues/open/$id.md"
    return 1
  fi
  if [ -f "$REPO_ROOT/dev-docs/issues/closed/$id.md" ]; then
    fail "issue already closed: dev-docs/issues/closed/$id.md"
    return 1
  fi
  issue_tracker_available \
    || { fail "issue not found: $id (backlog/, open/, closed/, or Linear)"; return 1; }
  out=$("$LINEAR_SH" find-by-id "$id" 2>&1) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    state=$(printf '%s\n' "$out" | sed -n 's/^state: //p')
    case "$state" in
      "$BACKLOG_STATE_NAME") ok "tracker issue exists in backlog: $id" ;;
      "$DONE_STATE_NAME"|"$CANCELED_STATE_NAME") \
        fail "issue is in a terminal state: $id (cannot open)"; return 1 ;;
      *) fail "issue is already open: $id ($state)"; return 1 ;;
    esac
    return 0
  fi
  case "$out" in
    *"find-by-id: not found"*) \
      fail "issue not found: $id (backlog/, open/, closed/, or Linear)"; return 1 ;;
    *) printf '%s\n' "$out" >&2; \
      fail "could not verify issue (tracker error or ambiguous id): $id"; return 1 ;;
  esac
}

check_plan_issue() {
  local id="$1" rc
  if ! check_active_artifacts; then
    fail "active artifacts found (see above)"
    return 1
  fi
  ok "no active artifacts"
  tracker_issue_exists_open "$id" >/dev/null && rc=0 || rc=$?
  case "$rc" in
    0) ok "issue exists: $id" ;;
    1) fail "issue not found: $id (Linear or dev-docs/issues/open/)"; return 1 ;;
    3) fail "issue is in a terminal state: $id (Done/Canceled cannot be planned)"; return 1 ;;
    4) fail "issue is captured but not opened: $id (run /open-issue <id> first)"; return 1 ;;
    *) fail "could not verify issue (tracker error or ambiguous id): $id"; return 1 ;;
  esac
}

check_approve_plan() {
  local id="$1"
  test -f "$REPO_ROOT/dev-docs/plans/proposed/$id.md" \
    || { fail "plan not found: dev-docs/plans/proposed/$id.md"; return 1; }
  ok "plan exists: dev-docs/plans/proposed/$id.md"
  test ! -f "$REPO_ROOT/dev-docs/plans/approved/$id.md" \
    || { fail "approved plan already exists: dev-docs/plans/approved/$id.md"; return 1; }
  ok "approved target available"
  test ! -f "$REPO_ROOT/dev-docs/plans/done/$id.md" \
    || { fail "done plan already exists: dev-docs/plans/done/$id.md"; return 1; }
  ok "done target available"
  local issue_id
  issue_id=$(frontmatter_field "$REPO_ROOT/dev-docs/plans/proposed/$id.md" "issue")
  test -n "$issue_id" \
    || { fail "plan frontmatter missing 'issue' field"; return 1; }
  ok "plan references issue: $issue_id"
  local orc
  tracker_issue_exists_open "$issue_id" >/dev/null && orc=0 || orc=$?
  case "$orc" in
    0) ok "originating issue exists: $issue_id" ;;
    1) fail "originating issue not found: $issue_id (Linear or dev-docs/issues/open/)"; return 1 ;;
    3) fail "originating issue is terminal: $issue_id (Done/Canceled)"; return 1 ;;
    4) fail "originating issue is captured but not opened: $issue_id (run /open-issue <issue_id> first)"; return 1 ;;
    *) fail "could not verify originating issue (tracker error or ambiguous): $issue_id"; return 1 ;;
  esac
}

check_implement_plan() {
  local id="$1"
  test -f "$REPO_ROOT/dev-docs/plans/approved/$id.md" \
    || { fail "plan not found: dev-docs/plans/approved/$id.md"; return 1; }
  ok "plan exists: dev-docs/plans/approved/$id.md"
  test ! -f "$REPO_ROOT/dev-docs/plans/done/$id.md" \
    || { fail "done plan already exists: dev-docs/plans/done/$id.md"; return 1; }
  ok "done target available"
  local issue_id
  issue_id=$(frontmatter_field "$REPO_ROOT/dev-docs/plans/approved/$id.md" "issue")
  test -n "$issue_id" \
    || { fail "plan frontmatter missing 'issue' field"; return 1; }
  ok "plan references issue: $issue_id"
  local orc
  tracker_issue_exists_open "$issue_id" >/dev/null && orc=0 || orc=$?
  case "$orc" in
    0) ok "originating issue exists: $issue_id" ;;
    1) fail "originating issue not found: $issue_id (Linear or dev-docs/issues/open/)"; return 1 ;;
    3) fail "originating issue is terminal: $issue_id (Done/Canceled)"; return 1 ;;
    4) fail "originating issue is captured but not opened: $issue_id (run /open-issue <issue_id> first)"; return 1 ;;
    *) fail "could not verify originating issue (tracker error or ambiguous): $issue_id"; return 1 ;;
  esac
}

check_design_plan() {
  local id="$1"
  test -f "$REPO_ROOT/dev-docs/plans/approved/$id.md" \
    || { fail "plan not found: dev-docs/plans/approved/$id.md"; return 1; }
  ok "plan exists: dev-docs/plans/approved/$id.md"
  test ! -f "$REPO_ROOT/dev-docs/plans/done/$id.md" \
    || { fail "done plan already exists: dev-docs/plans/done/$id.md"; return 1; }
  ok "done target available"
  echo ""
  echo "Manual checks remaining:"
  echo "  - Implementation appears complete"
  echo "  - Acceptance checks have passed or have been supplied by the developer"
}

check_approve_design() {
  local id="$1"
  test -f "$REPO_ROOT/dev-docs/designs/proposed/$id.md" \
    || { fail "design not found: dev-docs/designs/proposed/$id.md"; return 1; }
  ok "design exists: dev-docs/designs/proposed/$id.md"
  test ! -f "$REPO_ROOT/dev-docs/designs/approved/$id.md" \
    || { fail "approved design already exists: dev-docs/designs/approved/$id.md"; return 1; }
  ok "approved target available"
}

check_close_plan() {
  local id="$1"
  test -f "$REPO_ROOT/dev-docs/plans/approved/$id.md" \
    || { fail "plan not found: dev-docs/plans/approved/$id.md"; return 1; }
  ok "plan exists: dev-docs/plans/approved/$id.md"
  test ! -f "$REPO_ROOT/dev-docs/plans/done/$id.md" \
    || { fail "done plan already exists: dev-docs/plans/done/$id.md"; return 1; }
  ok "done target available"
  echo ""
  echo "Manual checks remaining:"
  echo "  - Implementation appears complete"
  echo "  - Acceptance checks have passed or have been supplied by the developer"
  echo "  - Required realized designs are approved, or plan records none required"
}

check_close_issue() {
  local id="$1" erc
  tracker_issue_exists_open "$id" >/dev/null && erc=0 || erc=$?
  case "$erc" in
    0) ok "issue exists: $id" ;;
    1) fail "issue not found: $id (Linear or dev-docs/issues/open/)"; return 1 ;;
    3) fail "issue is already in a terminal state: $id"; return 1 ;;
    4) fail "issue is captured but not opened: $id (run /open-issue <id> first)"; return 1 ;;
    *) fail "could not verify issue (tracker error or ambiguous id): $id"; return 1 ;;
  esac
  # No plans for this issue may remain in approved/
  local issue_re="^issue: +[\"']?$id[\"']? *$"
  local full_dir
  for full_dir in "$REPO_ROOT"/dev-docs/plans/approved/*.md; do
    [ -e "$full_dir" ] || continue
    local stem
    stem="$(basename "$full_dir" .md)"
    [ "$stem" = "example" ] && continue
    if head -20 "$full_dir" | grep -qE "$issue_re"; then
      fail "plan still in approved/: $stem"
      return 1
    fi
  done
  ok "no plans for this issue remain in approved/"
  # Closed target filename available
  test ! -f "$REPO_ROOT/dev-docs/issues/closed/${id}.md" \
    || { fail "closed target already exists: dev-docs/issues/closed/${id}.md"; return 1; }
  ok "closed target available"
  echo ""
  echo "Manual checks remaining:"
  echo "  - All realized designs are in dev-docs/designs/approved/"
}

# ── dispatch ──────────────────────────────────────────────────────────────────

cmd="${1:-}"

# Require an id argument for commands that need it
case "$cmd" in
  create-stack|update-stack|plan-issue|open-issue|close-issue)
    if [ -z "${2:-}" ]; then
      echo "Error: '$cmd' requires an id argument." >&2
      echo "" >&2
      usage
      exit 2
    fi
    ;;
esac

case "$cmd" in
  create-stack)         check_create_stack "${2:-}";;
  update-stack)         check_update_stack "${2:-}";;
  start-issue)          check_start_issue "${2:-}";;
  open-issue)           check_open_issue "${2:-}";;
  plan-issue)           check_plan_issue "${2:-}";;
  approve-plan)         check_approve_plan "${2:-}";;
  implement-plan)       check_implement_plan "${2:-}";;
  design-plan)          check_design_plan "${2:-}";;
  approve-design)       check_approve_design "${2:-}";;
  close-plan)           check_close_plan "${2:-}";;
  close-issue)          check_close_issue "${2:-}";;
  --help|"")            usage;;
  *)                    echo "Unknown command: $cmd" >&2; echo "" >&2; usage; exit 2;;
esac

# Print summary on success
echo ""
echo "All preflight checks passed."
