#!/bin/bash
set -eo pipefail

# EAS Build runs this hook BEFORE pnpm install --frozen-lockfile.
# Problem: the lockfile was generated on Linux (Replit) and the overrides
# config hash differs on EAS's macOS runner, causing ERR_PNPM_LOCKFILE_CONFIG_MISMATCH.
# Fix: regenerate the lockfile here on the EAS machine so it matches exactly.

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
echo "eas-build-pre-install: regenerating lockfile at $REPO_ROOT"
cd "$REPO_ROOT"
pnpm install --no-frozen-lockfile
echo "eas-build-pre-install: done"
