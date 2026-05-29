#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
APP_PATH="release/mac/CRAgent.app"
DMG_PATH="release/CRAgent-${VERSION}-mac-x64.dmg"
STAGING="release/dmg-staging"
SIGN_IDENTITY="Sand Studio (S7VFHSY63S)"

echo "==> Building application..."
npm run build
export CSC_NAME="$SIGN_IDENTITY"
env -u ELECTRON_RUN_AS_NODE -u ELECTRON_MIRROR -u ELECTRON_BUILDER_BINARIES_MIRROR \
  npx electron-builder --mac dir --x64

if [[ ! -d "$APP_PATH" ]]; then
  echo "Missing $APP_PATH" >&2
  exit 1
fi

echo "==> Verifying app signature..."
codesign --verify --deep --strict "$APP_PATH"
codesign -dv --verbose=2 "$APP_PATH" 2>&1 | grep -E 'Authority=|TeamIdentifier=|Identifier='

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
