#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
IOS_DIR="$ROOT/ios/App"
ARCHIVE_PATH="$IOS_DIR/build/CRAgent.xcarchive"
EXPORT_DIR="$ROOT/release/ios"
IPA_PATH="$EXPORT_DIR/CRAgent-${VERSION}-ios.ipa"
EXPORT_PLIST="$IOS_DIR/ExportOptions.plist"
TEAM_ID="${DEVELOPMENT_TEAM:-S7VFHSY63S}"
METHOD="${EXPORT_METHOD:-development}"

preflight_signing() {
  if ! xcodebuild -checkFirstLaunchStatus 2>/dev/null; then
    echo "==> Xcode first-launch setup is incomplete. Open Xcode once, then retry."
    exit 1
  fi

  local has_ios_cert=0
  if security find-identity -v -p codesigning 2>/dev/null | grep -qE 'Apple Development|iPhone Developer|iPhone Distribution|Apple Distribution'; then
    has_ios_cert=1
  fi

  if [[ "$has_ios_cert" -eq 0 ]]; then
    cat <<EOF
==> iOS code signing is not configured on this Mac.

To install CRAgent on a physical iPad you need an Apple Developer account in Xcode:
  1. Open Xcode -> Settings (Cmd+,) -> Accounts
  2. Click "+" and sign in with your Apple ID (team: ${TEAM_ID})
  3. Select the team and click "Manage Certificates..." -> "+" -> Apple Development
  4. Connect your iPad via USB (or register its UDID for ad-hoc builds)
  5. Re-run: npm run pack:ipad

Optional export methods:
  EXPORT_METHOD=development   install on registered devices via Xcode/ios-deploy (default)
  EXPORT_METHOD=ad-hoc        install on specific device UDIDs
  EXPORT_METHOD=app-store     upload to TestFlight / App Store

EOF
    exit 1
  fi
}

seed_spm_cache() {
  local cache_dir="$HOME/Library/Caches/org.swift.swiftpm/artifacts"
  local base="https://github.com/ionic-team/capacitor-swift-pm/releases/download/8.3.4"
  mkdir -p "$cache_dir"

  for name in Capacitor Cordova; do
    local key="https___github_com_ionic_team_capacitor_swift_pm_releases_download_8_3_4_${name}_xcframework_zip"
    local dest="$cache_dir/$key"
    if [[ -s "$dest" ]]; then
      continue
    fi
    echo "==> Downloading ${name}.xcframework for SPM cache..."
    curl -L --retry 3 --retry-delay 5 -o "$dest" "${base}/${name}.xcframework.zip"
  done
}

ensure_ios_platform() {
  if xcodebuild -project "$IOS_DIR/App.xcodeproj" -scheme App -showdestinations 2>&1 | grep -q "platform:iOS Simulator"; then
    return 0
  fi
  echo "==> iOS platform not ready; downloading via Xcode (this can take a while)..."
  xcodebuild -downloadPlatform iOS
}

write_export_plist() {
  cat > "$EXPORT_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>${METHOD}</string>
  <key>teamID</key>
  <string>${TEAM_ID}</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>compileBitcode</key>
  <false/>
  <key>destination</key>
  <string>export</string>
</dict>
</plist>
EOF
}

echo "==> Building web assets and syncing Capacitor iOS..."
npm run cap:sync:ios

preflight_signing
seed_spm_cache
ensure_ios_platform

echo "==> Archiving CRAgent for iOS (iPhone + iPad)..."
rm -rf "$IOS_DIR/build" "$EXPORT_DIR"
mkdir -p "$EXPORT_DIR"

xcodebuild \
  -project "$IOS_DIR/App.xcodeproj" \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates \
  -archivePath "$ARCHIVE_PATH" \
  archive

write_export_plist

echo "==> Exporting installable IPA..."
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_PLIST" \
  -allowProvisioningUpdates

if [[ -f "$EXPORT_DIR/App.ipa" ]]; then
  mv "$EXPORT_DIR/App.ipa" "$IPA_PATH"
fi

echo "==> Done: $IPA_PATH"
ls -lh "$IPA_PATH"
