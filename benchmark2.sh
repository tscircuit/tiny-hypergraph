#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ARGS=()
for arg in "$@"; do
  case "$arg" in
    --verbose|-v) ;;
    *) ARGS+=("$arg") ;;
  esac
done

if [ "${#ARGS[@]}" -eq 0 ]; then
  exec bun run "${ROOT_DIR}/scripts/benchmarking/cm5io.ts" --verbose
fi

exec bun run "${ROOT_DIR}/scripts/benchmarking/cm5io.ts" --verbose "${ARGS[@]}"
