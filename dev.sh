#!/usr/bin/env bash
set -euo pipefail

exec bun scripts/runner.ts dev "$@"
