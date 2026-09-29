#!/usr/bin/env bash
#
# Build the device bundle: a fully static app with no server.
#
# Next refuses to statically export a project containing dynamic route
# handlers, and every /api/v1 route is `force-dynamic`. On a phone those
# routes don't exist anyway — the app talks to a local dispatcher instead of
# HTTP — so they are moved aside for the duration of the build and put back
# afterwards, including on failure.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_DIR="src/app/api"
PARKED="$(mktemp -d)/api"

restore() {
  if [ -d "$PARKED" ] && [ ! -d "$API_DIR" ]; then
    mv "$PARKED" "$API_DIR"
    echo "  restored $API_DIR"
  fi
}
trap restore EXIT INT TERM

if [ -d "$API_DIR" ]; then
  mv "$API_DIR" "$PARKED"
  echo "  parked $API_DIR while exporting"
fi

# tsconfig includes .next/dev/types, and the dev server leaves a route
# validator there listing every API handler. With the handlers parked it fails
# to resolve them, so clear the generated types first — `next dev` rebuilds it.
rm -rf .next-device out .next/dev/types .next/types

# SQLite ships as a static asset rather than a bundled dependency — see the
# comment in src/lib/sqlite/wasm.ts for why.
echo "  staging SQLite WASM into public/sqlite"
rm -rf public/sqlite && mkdir -p public/sqlite
cp node_modules/@sqlite.org/sqlite-wasm/dist/index.mjs \
   node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm \
   node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3-worker1.mjs \
   node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3-opfs-async-proxy.js \
   public/sqlite/
FC_TARGET=device NEXT_PUBLIC_FC_TARGET=device npx next build

# Next 16 writes the exported site straight into distDir. Normalise it to
# out/, which is what capacitor.config.ts points at.
rm -rf out
mv .next-device out

echo
echo "  static bundle -> out/  ($(du -sh out | awk '{print $1}'))"
