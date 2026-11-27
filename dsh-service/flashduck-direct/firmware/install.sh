#!/bin/sh
# Creates only a sibling IDF project in a clean checkout. Never builds/flashes.
set -eu
here=$(CDPATH='' cd "$(dirname "$0")" && pwd -P)
up=$(CDPATH='' cd "${1:?Pass the Flashduck repository root}" && pwd -P)
pin=9d4316e3f1f7ef693be4d62f4b1aa020a3daedf4
[ "$(git -C "$up" rev-parse HEAD)" = "$pin" ] || { echo 'Wrong upstream revision' >&2; exit 1; }
[ -z "$(git -C "$up" status --porcelain --untracked-files=all -- firmware/duckclaw)" ] || { echo 'Upstream DuckClaw sources must be clean' >&2; exit 1; }
[ ! -e "$up/firmware/duckclaw/main/duckclaw_secrets.h" ] || { echo 'Use a fresh checkout without build-time secrets' >&2; exit 1; }
out="$up/firmware/duckclaw_direct"
mkdir "$out" # deliberately refuses to overwrite a prior installation
mkdir "$out/main"
cp "$here/CMakeLists.txt" "$here/sdkconfig.defaults" "$up/firmware/duckclaw/LICENSE" "$out/"
# Use only the verified upstream gap after phy_init, before ota_0. Never place
# direct provisioning in default NVS (it may already contain user secrets).
awk '/^ota_0,/{print "duck_keys, data, nvs, 0x12000, 0x6000"} {print}' \
    "$up/firmware/duckclaw/partitions.csv" > "$out/partitions.csv"
cp "$here/src/"* "$out/main/"
printf 'Created dedicated project: %s\nNo board was contacted.\n' "$out"
