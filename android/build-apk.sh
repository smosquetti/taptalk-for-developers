#!/usr/bin/env bash
#
# Builds the web app as a static export, bundles it into the Android project
# as assets/webapp, and builds a debug APK.
#
# Prerequisites:
#   - Android SDK with platform android-37 and build-tools 36.0.0
#     (sdk.dir written to local.properties automatically, or set ANDROID_HOME)
#   - JDK 17+
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT/android"
ASSETS_WEBAPP="$ANDROID_DIR/app/src/main/assets/webapp"

echo "==> [1/5] Building Next.js static export (out/)"
cd "$ROOT"
npm run build

echo "==> [2/5] Bundling web app into Android assets (assets/webapp)"
rm -rf "$ASSETS_WEBAPP"
mkdir -p "$ASSETS_WEBAPP"
cp -r "$ROOT/out/." "$ASSETS_WEBAPP/"
du -sh "$ASSETS_WEBAPP" | sed 's/^/    /'

# The WebView loads the app from file:///android_asset/webapp/, so the
# static export's root-absolute references must become relative ones.
echo "==> [3/5] Rewriting absolute URLs to relative (file:// compatible)"
# HTML pages: asset refs, favicon, nav anchors. The bare home link only
# occurs as the full attribute href="/".
sed -i \
    -e 's#"/_next/#"_next/#g' \
    -e 's#"/quiz"#"quiz.html"#g' \
    -e 's#"/favicon#"_favicon#g' \
    -e 's#href="/"#href="index.html"#g' \
    "$ASSETS_WEBAPP"/*.html
# JS chunks: Turbopack chunk base path, vocabulary fetch, client-side nav
# links (deliberately NO bare '"/"' rewrite — Next internals use it as
# path logic, e.g. .txt normalization and router segments).
sed -i \
    -e 's#"/_next/#"_next/#g' \
    -e 's#"/quiz"#"quiz.html"#g' \
    -e 's#"/vocabulary.json"#"vocabulary.json"#g' \
    -e 's#href:"/"#href:"index.html"#g' \
    "$ASSETS_WEBAPP"/_next/static/chunks/*.js

echo "==> [4/5] Building Android APK"
cd "$ANDROID_DIR"
if [ ! -f local.properties ]; then
    for d in "${ANDROID_HOME:-}" "$HOME/Android/Sdk" "$HOME/Library/Android/sdk" /usr/local/android-sdk; do
        if [ -n "$d" ] && [ -d "$d" ]; then
            echo "sdk.dir=$(cd "$d" && pwd)" > local.properties
            echo "    wrote local.properties -> $(cd "$d" && pwd)"
            break
        fi
    done
fi
[ -f local.properties ] || { echo "ERROR: no Android SDK found (set ANDROID_HOME)."; exit 1; }
./gradlew assembleDebug

echo "==> [5/5] Done"
APK="$(find "$ANDROID_DIR/app/build/outputs/apk/debug" -name '*.apk' | head -n 1)"
echo "APK: $APK"
du -h "$APK" | sed 's/^/    /'
