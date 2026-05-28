#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
APP_PATH="release/mac/CRAgent.app"
DMG_PATH="release/CRAgent-${VERSION}-mac-x64.dmg"
STAGING="release/dmg-staging"

echo "==> Building application..."
npm run build
env -u ELECTRON_RUN_AS_NODE -u ELECTRON_MIRROR -u ELECTRON_BUILDER_BINARIES_MIRROR \
  npx electron-builder --mac dir --x64

if [[ ! -d "$APP_PATH" ]]; then
  echo "Missing $APP_PATH" >&2
  exit 1
fi

MIN_OS="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo 'unknown')"
echo "==> LSMinimumSystemVersion: $MIN_OS"

echo "==> Creating DMG..."
rm -rf "$STAGING" "$DMG_PATH"
mkdir -p "$STAGING"
cp -R "$APP_PATH" "$STAGING/"
ln -sf /Applications "$STAGING/Applications"

hdiutil create \
  -volname "CRAgent ${VERSION}" \
  -srcfolder "$STAGING" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

rm -rf "$STAGING"

echo "==> Done: $DMG_PATH"
ls -lh "$DMG_PATH"
