#!/usr/bin/env bats
# test/manifest-ygopro-only.bats
# YGOPro-only resource-graph assertions (remove-edopro-support, task 6.2).
#
# Proves three properties, classifying sources by CONSUMER relationship —
# never by source-id string matching:
#   1. the effective resource graph has no edopro/* assembly targets
#   2. no resource source is consumed exclusively by edopro/* targets
#   3. a published release never contains an edopro directory
#
# Run from repo root:
#   tools/bats-core/bin/bats test/manifest-ygopro-only.bats

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
LIB="$REPO_ROOT/scripts/resources-lib.sh"
MANIFEST_FIXTURES="$REPO_ROOT/test/fixtures/manifests"

setup() {
  WORK="$(mktemp -d)"
  # Point MANIFEST_PATH at a fixture before sourcing so the private-override
  # merge never triggers while the lib loads.
  MANIFEST_PATH="$MANIFEST_FIXTURES/valid-minimal.json"
  source "$LIB"
}

teardown() {
  rm -rf "$WORK"
}

# ============================================================
# validate_manifest — ygopro-only graph checks (fixture-driven)
# ============================================================

@test "ygopro-only: edopro/* assembly target is rejected, naming the target" {
  # Mixed-consumer source: the EDOPro-only-source check passes (src-a also
  # feeds a ygopro target), so this isolates the target check.
  MANIFEST_PATH="$MANIFEST_FIXTURES/edopro-target.json"
  run validate_manifest "$MANIFEST_PATH"
  [ "$status" -eq 1 ]
  [[ "$output" == *"edopro/lflists"* ]]
}

@test "ygopro-only: source consumed only by edopro/* targets is rejected, naming the source" {
  # Neutral source id (no 'edopro' substring): only the consumer
  # relationship can classify legacy-pool as EDOPro-only.
  MANIFEST_PATH="$MANIFEST_FIXTURES/edopro-only-source.json"
  run validate_manifest "$MANIFEST_PATH"
  [ "$status" -eq 1 ]
  [[ "$output" == *"legacy-pool"* ]]
}

@test "ygopro-only: source id containing 'edopro' with only ygopro consumers passes" {
  # Proves classification is consumer-based, not id-string-based: a source
  # named edopro-lflists whose every consumer targets ygopro/* is legal.
  MANIFEST_PATH="$MANIFEST_FIXTURES/edopro-id-ygopro-consumers.json"
  run validate_manifest "$MANIFEST_PATH"
  [ "$status" -eq 0 ]
}

@test "ygopro-only: private override adding an EDOPro-only source fails effective-graph validation" {
  # resources-lib.sh merges the private override over the public base when
  # the default manifest path is used; validation must run against the
  # EFFECTIVE graph, so a private-only edopro consumer is rejected too.
  local dir="$WORK/merge"
  mkdir -p "$dir"
  cat > "$dir/resources.manifest.json" <<'EOF'
{
  "sources": [
    { "id": "src-a", "type": "git", "url": "https://example.com/a.git" }
  ],
  "assembly": [
    { "target": "ygopro/base", "from": "src-a" }
  ]
}
EOF
  cat > "$dir/resources.manifest.private.json" <<'EOF'
{
  "sources": [
    { "id": "private-legacy", "type": "git", "url": "https://example.com/p.git" }
  ],
  "assembly": [
    { "target": "edopro/legacy", "from": "private-legacy" }
  ]
}
EOF
  run bash -c "cd '$dir' && source '$LIB' && validate_manifest"
  [ "$status" -eq 1 ]
  # The merge must have actually run (not a vacuous pass/fail of the base).
  [ -f "$dir/resources.manifest.effective.json" ]
  [[ "$output" == *"private-legacy"* ]]
}

# ============================================================
# Real-manifest gates
# These stay red until the manifest edit lands (task 6.3); they are the
# assertions this task adds, and the edit that turns them green follows.
# ============================================================

@test "ygopro-only: real manifest has no EDOPro-only sources" {
  local edopro_only
  edopro_only=$(jq -r '
    [.assembly[]
      | .target as $t
      | .from as $from
      | (if ($from | type) == "array" then $from[] else $from end)
      | {sid: ., target: $t}] as $edges
    | [.sources[].id | . as $id
       | [$edges[] | select(.sid == $id) | .target] as $targets
       | select(($targets | length) > 0)
       | select($targets | all(. == "edopro" or startswith("edopro/")))
       | $id] | .[]
  ' "$REPO_ROOT/resources.manifest.json")
  [ -z "$edopro_only" ]
}

@test "ygopro-only: real manifest has no edopro/* assembly targets" {
  local bad_targets
  bad_targets=$(jq -r '
    [.assembly[] | select(.target == "edopro" or (.target | startswith("edopro/"))) | .target]
    | unique | .[]
  ' "$REPO_ROOT/resources.manifest.json")
  [ -z "$bad_targets" ]
}

# ============================================================
# setup_resources.sh — published-release guard
# ============================================================

@test "setup: aborts before publish when assembly produces an edopro directory" {
  # Whole-source rule over a repo whose tree contains an edopro/ subdir — no
  # rule targets edopro/*, so only the release guard catches it. The run must
  # abort before the atomic swap: nothing gets published.
  mkdir -p "$WORK/repositories/src-a/edopro"
  printf 'stale\n' > "$WORK/repositories/src-a/edopro/legacy.conf"
  printf 'data\n' > "$WORK/repositories/src-a/data.txt"
  cat > "$WORK/guard.manifest.json" <<'MANIFEST'
{
  "sources": [
    { "id": "src-a", "type": "git", "url": "https://example.com/a.git" }
  ],
  "assembly": [
    { "target": "mydir", "from": "src-a" }
  ]
}
MANIFEST
  MANIFEST_PATH="$WORK/guard.manifest.json" \
  REPOS_ROOT="$WORK/repositories" \
  RELEASES_ROOT="$WORK/resources/releases" \
    run bash "$REPO_ROOT/scripts/setup_resources.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"edopro"* ]]
  [ ! -L "$WORK/resources/current" ]
}

@test "setup: file-only rules over a repo containing edopro/ publish without an edopro dir" {
  # Guard precision: the stale edopro/ subdir stays in the repositories cache
  # (which is not scanned); the release assembles only named files and
  # publishes clean, with no edopro directory in the published tree.
  mkdir -p "$WORK/repositories/src-a/edopro"
  printf 'stale\n' > "$WORK/repositories/src-a/edopro/legacy.conf"
  printf 'data\n' > "$WORK/repositories/src-a/data.txt"
  cat > "$WORK/file-only.manifest.json" <<'MANIFEST'
{
  "sources": [
    { "id": "src-a", "type": "git", "url": "https://example.com/a.git" }
  ],
  "assembly": [
    { "target": "mydir/data.txt", "from": "src-a", "file": "data.txt" }
  ]
}
MANIFEST
  MANIFEST_PATH="$WORK/file-only.manifest.json" \
  REPOS_ROOT="$WORK/repositories" \
  RELEASES_ROOT="$WORK/resources/releases" \
    run bash "$REPO_ROOT/scripts/setup_resources.sh"
  [ "$status" -eq 0 ]
  [ -f "$WORK/resources/current/mydir/data.txt" ]
  run find -L "$WORK/resources/current" -type d -name edopro
  [ -z "$output" ]
}

# ============================================================
# Refresh cycle — the updater loop runs clone_repositories.sh +
# setup_resources.sh on an interval. One full cycle must neither
# pull any EDOPro source nor recreate EDOPro data.
# ============================================================

@test "refresh cycle: pulls no EDOPro source and recreates no edopro data" {
  # Simulate an upgraded deployment: the renamed manifest source with its
  # cache, plus a stale pre-rename repositories/edopro-lflists cache.
  mkdir -p "$WORK/repositories/project-ignis-lflists/.git"
  printf 'goat banlist\n' > "$WORK/repositories/project-ignis-lflists/GOAT.lflist.conf"
  mkdir -p "$WORK/repositories/edopro-lflists"
  printf 'stale cache\n' > "$WORK/repositories/edopro-lflists/stale-marker.conf"

  cat > "$WORK/refresh.manifest.json" <<'MANIFEST'
{
  "sources": [
    { "id": "project-ignis-lflists", "type": "git", "url": "https://example.com/lflists.git", "branch": "master" }
  ],
  "assembly": [
    { "target": "ygopro/formats/goat/lflist.conf", "from": "project-ignis-lflists", "file": "GOAT.lflist.conf" }
  ]
}
MANIFEST

  # git stub records every invocation; all calls succeed so the existing
  # cache takes the fetch+reset update path (no re-clone).
  local stub_dir call_log
  stub_dir="$(mktemp -d)"
  call_log="$stub_dir/calls.log"
  cat > "$stub_dir/git" <<'STUB'
#!/usr/bin/env bash
echo "git $*" >> "$CALL_LOG"
exit 0
STUB
  chmod +x "$stub_dir/git"

  MANIFEST_PATH="$WORK/refresh.manifest.json" \
  REPOS_ROOT="$WORK/repositories" \
  CALL_LOG="$call_log" PATH="$stub_dir:$PATH" \
    run bash "$REPO_ROOT/scripts/clone_repositories.sh"
  [ "$status" -eq 0 ]

  MANIFEST_PATH="$WORK/refresh.manifest.json" \
  REPOS_ROOT="$WORK/repositories" \
  RELEASES_ROOT="$WORK/resources/releases" \
    run bash "$REPO_ROOT/scripts/setup_resources.sh"
  [ "$status" -eq 0 ]

  # Capture the log before tearing the stub dir down.
  local log_content=""
  [ -f "$call_log" ] && log_content="$(cat "$call_log")"
  rm -rf "$stub_dir"

  # Pulls only the manifest source (fetch path) — no git invocation may
  # reference an edopro path.
  [[ "$log_content" == *"fetch"* ]]
  [[ "$log_content" == *"project-ignis-lflists"* ]]
  [[ "$log_content" != *"edopro"* ]]

  # The stale pre-rename cache is neither refreshed nor recreated nor
  # deleted by the updater — removal is a deliberate deployment step.
  [ -f "$WORK/repositories/edopro-lflists/stale-marker.conf" ]
  [ "$(cat "$WORK/repositories/edopro-lflists/stale-marker.conf")" = "stale cache" ]
  [ "$(ls "$WORK/repositories" | grep -c edopro)" -eq 1 ]

  # The published release carries the ygopro mapping and no edopro tree.
  [ -f "$WORK/resources/current/ygopro/formats/goat/lflist.conf" ]
  run find -L "$WORK/resources/current" -type d -name edopro
  [ -z "$output" ]
}
