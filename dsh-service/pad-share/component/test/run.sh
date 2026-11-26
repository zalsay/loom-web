#!/bin/sh
set -eu
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
bin=$(mktemp "${TMPDIR:-/tmp}/pad-share-snapshot.XXXXXX")
trap 'rm -f -- "$bin"' EXIT
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -pedantic ${CFLAGS:-} \
    -I"$here/stubs" -I"$here/../include" -I"$here/.." \
    "$here/../snapshot.c" "$here/test_snapshot.c" -o "$bin"
"$bin"
"${CC:-cc}" -std=c11 -D_POSIX_C_SOURCE=200809L -D_DARWIN_C_SOURCE -Wall -Wextra -Werror -pedantic ${CFLAGS:-} \
    -I"$here/stubs" -I"$here/../include" -I"$here/.." \
    "$here/../upload.c" "$here/test_upload.c" -o "$bin"
"$bin"
# Compile the production request adapter with a small transport/IDF shim.
# No shim header is ever on the firmware include path.
scratch=$(mktemp -d "${TMPDIR:-/tmp}/pad-share-http.XXXXXX")
scratch=$(CDPATH='' cd -- "$scratch" && pwd -P)
case "$scratch" in /*/pad-share-http.??????) ;; *) exit 1 ;; esac
trap 'rm -f -- "$bin"; rm -rf -- "${scratch:?}"' EXIT
mkdir "$scratch/lwip" "$scratch/sd"
for shim in esp_event esp_http_server esp_netif esp_random esp_timer esp_wifi lwip/sockets; do
    : > "$scratch/$shim.h"
done
"${CC:-cc}" -std=c11 -D_POSIX_C_SOURCE=200809L -D_DARWIN_C_SOURCE -Wall -Wextra -Werror -Wno-overlength-strings ${CFLAGS:-} \
    -I"$scratch" -I"$here/stubs" -I"$here/../include" -I"$here/.." -pthread \
    "$here/../snapshot.c" "$here/../upload.c" "$here/test_http.c" -o "$bin"
(cd "$scratch/sd" && "$bin")
