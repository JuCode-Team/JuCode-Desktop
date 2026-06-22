#!/usr/bin/env bash
# Build the jucode engine (release) from the sibling JuCode-CLI checkout and stage
# it as a Tauri sidecar named with the host target triple, so `tauri build` can
# bundle it next to the app binary.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="${JUCODE_CLI_DIR:-$ROOT/../JuCode-CLI}"
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"

if [ ! -f "$CLI/Cargo.toml" ]; then
	echo "JuCode-CLI checkout not found at $CLI (set JUCODE_CLI_DIR to override)" >&2
	exit 1
fi

cargo build --release --manifest-path "$CLI/Cargo.toml" --bin jucode
mkdir -p "$ROOT/src-tauri/binaries"
cp "$CLI/target/release/jucode" "$ROOT/src-tauri/binaries/jucode-$TRIPLE"
echo "staged engine sidecar: src-tauri/binaries/jucode-$TRIPLE"
