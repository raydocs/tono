#!/bin/bash
# compute CONTRACT hash for the working tree in $1 (repo root), per tooling/scripts/build-core-helper.sh
cd "$1"; helper_dir=tooling/scripts/core-helper; repo_dir=.
files=$(awk '/^set -- \\/{f=1;next} f{ if ($0 !~ /\\$/) {print; exit} print }' tooling/scripts/build-core-helper.sh | sed -E 's/[\\"]//g; s/^[[:space:]]+//; s/[[:space:]]+$//' | grep -v '^$')
list=(); for x in $files; do x=${x//\$helper_dir/$helper_dir}; x=${x//\$repo_dir/$repo_dir}; x=${x//\$protocol_version_source/apps/macos/Tono/Core/HelperProtocolVersion.swift}; list+=("$x"); done
cat "${list[@]}" | sed -E '/^[[:space:]]*\/\//d; /^[[:space:]]*$/d' | sha256sum | cut -d' ' -f1
