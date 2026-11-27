#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p .runtime
for ext in html js wasm data; do
  curl --proto '=https' --fail --silent --show-error --location --retry 2 --max-time 180 \
    "https://simulator.esp-claw.com/runtime/esp_claw_sim.$ext" -o ".runtime/esp_claw_sim.$ext"
done
(cd .runtime && shasum -a 256 -c ../runtime.sha256)
