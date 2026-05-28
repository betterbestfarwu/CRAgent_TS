#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"

echo "==> Building application..."
npm run build

echo "==> Packaging Windows installer (x64)..."
export CSC_IDENTITY_AUTO_DISCOVERY=false
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
env -u ELECTRON_RUN_AS_NODE -u ELECTRON_MIRROR \
  npx electron-builder --win nsis --x64

INSTALLER="release/CRAgent-${VERSION}-win-x64.exe"
if [[ -f "$INSTALLER" ]]; then
  echo "==> Done: $INSTALLER"
  ls -lh "$INSTALLER"
else
  echo "==> Build finished. Installers in release/:"
  ls -lh release/*.exe 2>/dev/null || ls -lh release/
fi
