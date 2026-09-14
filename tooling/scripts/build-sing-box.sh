#!/bin/sh
# M1 offline tooling only. Never stages a product resource or starts a core.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
exec python3 "$ROOT/tooling/scripts/sing-box/certify.py" "$@"
