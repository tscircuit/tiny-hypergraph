#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec bun run "${ROOT_DIR}/scripts/benchmarking/srj18-pipeline7.ts" "$@"
