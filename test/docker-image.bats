#!/usr/bin/env bats
# test/docker-image.bats
# Contract tests for the application image (bundle-nostalgia-resources-with-app).
#
# The production image must:
#   - validate the complete fixed resource root before producing artifacts
#   - carry nostalgia-resources/ directly (lock, CDB, both LFList/script trees)
#   - start the Node.js service directly (no manifest, updater, release
#     symlink, entrypoint script or EDOPro asset)
#
# Run from repo root:
#   bats test/docker-image.bats

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"

# Every Docker instruction between FROM lines, grouped by stage. Continuation
# lines (trailing backslash) are joined so multi-line RUN/COPY instructions can
# be asserted as one string.
stages() {
  awk '
    /^FROM / { stage++; next }
    stage > 0 && /^[A-Za-z_]+ / {
      line = $0
      while (line ~ /\\$/) {
        if ((getline nextLine) <= 0) break
        line = line " " nextLine
      }
      print stage ":" line
    }
  ' "$REPO_ROOT/Dockerfile"
}

@test "Docker build stage runs the full nostalgia-resources check before artifacts" {
  run stages
  [[ "$output" == *"npm run check:nostalgia-resources"* ]]
}

@test "Docker final stage copies the complete bundled resource root" {
  run stages
  [[ "$output" == *"COPY --from=server-builder /server/nostalgia-resources ./nostalgia-resources"* ]]
}

@test "Docker final stage carries the lock, CDB and both format trees" {
  # Every required resource file must be inside nostalgia-resources/ so the
  # single COPY carries them all; none may come from resources/current or
  # a release directory.
  run stages
  [[ "$output" != *"resources/current"* ]]
  [[ "$output" != *"resources/releases"* ]]
  [[ "$output" != *"resources.manifest"* ]]
}

@test "Docker container starts Node.js directly" {
  run stages
  [[ "$output" == *'CMD ["dumb-init", "node", "./src/index.js"]'* ]]
}

@test "Dockerfile has no updater, entrypoint, release or EDOPro assets" {
  run stages
  [[ "$output" != *"clone_repositories"* ]]
  [[ "$output" != *"setup_resources"* ]]
  [[ "$output" != *"entrypoint"* ]]
  [[ "$output" != *"scripts/"* ]]
  [[ "$output" != *"edopro"* ]]
  [[ "$output" != *"repositories"* ]]
}

@test "repo keeps no resource pipeline scripts or manifest" {
  [ ! -e "$REPO_ROOT/scripts/clone_repositories.sh" ]
  [ ! -e "$REPO_ROOT/scripts/setup_resources.sh" ]
  [ ! -e "$REPO_ROOT/scripts/resources-lib.sh" ]
  [ ! -e "$REPO_ROOT/scripts/entrypoint.sh" ]
  [ ! -e "$REPO_ROOT/resources.manifest.json" ]
}
