#!/bin/bash
set -eo pipefail

# ── 1. Install keyboard extension provisioning profile ──────────────────────
if [ -n "${APPLE_EXT_PROFILE_BASE64:-}" ]; then
  echo "📱 Installing keyboard extension provisioning profile on build machine..."
  echo "$APPLE_EXT_PROFILE_BASE64" | base64 --decode > /tmp/ext_profile.mobileprovision

  UUID=$(security cms -D -i /tmp/ext_profile.mobileprovision 2>/dev/null \
    | grep -A1 "<key>UUID</key>" \
    | grep "<string>" \
    | sed 's/.*<string>\(.*\)<\/string>.*/\1/')

  if [ -z "$UUID" ]; then
    echo "❌ Failed to extract UUID from provisioning profile — check APPLE_EXT_PROFILE_BASE64"
    exit 1
  fi

  PROFILE_DIR="$HOME/Library/MobileDevice/Provisioning Profiles"
  mkdir -p "$PROFILE_DIR"
  cp /tmp/ext_profile.mobileprovision "$PROFILE_DIR/$UUID.mobileprovision"
  echo "✅ Installed extension profile: UUID=$UUID"
else
  echo "ℹ️  APPLE_EXT_PROFILE_BASE64 not set — skipping extension profile installation"
fi

# ── 2. Regenerate pnpm lockfile (Linux → macOS hash mismatch fix) ──────────
# The lockfile was generated on Linux (Replit) and the overrides config hash
# differs on EAS's macOS runner, causing ERR_PNPM_LOCKFILE_CONFIG_MISMATCH.
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
echo "eas-build-pre-install: regenerating lockfile at $REPO_ROOT"
cd "$REPO_ROOT"
pnpm install --no-frozen-lockfile
echo "eas-build-pre-install: done"
