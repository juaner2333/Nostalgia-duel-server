#!/usr/bin/env bats

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"

@test "Docker final stage includes the default resource manifest" {
  run awk '
    /^FROM / { stage++; next }
    stage == 2 &&
      $1 == "COPY" &&
      $2 == "--from=server-builder" &&
      $3 == "/server/resources.manifest.json" &&
      $4 == "./resources.manifest.json" { copied = 1 }
    END { exit copied ? 0 : 1 }
  ' "$REPO_ROOT/Dockerfile"

  [ "$status" -eq 0 ]
}
