#!/usr/bin/env python3
"""A config written during xray run -test must be the one the new current link serves."""

from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "remote" / "migrate-node-to-release-layout.sh"


class MigrateConfigRestage(unittest.TestCase):
    def test_a_config_written_during_the_binary_test_is_published(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            install = root / "tono-xray"
            current = install / "current"
            current.mkdir(parents=True)
            source = current / "config.json"
            source.write_text(
                '{"inbounds":[{"tag":"tono-vless","port":443}]}\n',
                encoding="utf-8",
            )
            old = current / "xray"
            old.write_text("#!/bin/sh\necho 'Xray 1.2.3'\nexit 0\n", encoding="utf-8")
            old.chmod(0o755)
            marker = root / "tested"
            artifact = root / "xray-new"
            artifact.write_text(textwrap.dedent("""\
                #!/bin/sh
                if [ "$1" = "version" ]; then
                  echo "Xray 9.9.9"
                  exit 0
                fi
                if [ ! -f "$MIGRATE_MARKER" ]; then
                  printf '%s\\n' '{"inbounds":[{"tag":"tono-vless","port":443}],"added":true}' > "$MIGRATE_SOURCE"
                  : > "$MIGRATE_MARKER"
                fi
                exit 0
                """), encoding="utf-8")
            artifact.chmod(0o755)
            digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
            bindir = root / "bin"
            bindir.mkdir()
            (bindir / "id").write_text("#!/bin/sh\necho 0\n", encoding="utf-8")
            (bindir / "getent").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            (bindir / "systemctl").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            (bindir / "ss").write_text("#!/bin/sh\necho LISTEN\n", encoding="utf-8")
            (bindir / "install").write_text(textwrap.dedent("""\
                #!/bin/sh
                dirs=0
                pos=""
                while [ $# -gt 0 ]; do
                  case "$1" in
                    -d) dirs=1; shift ;;
                    -m|-o|-g) shift 2 ;;
                    -*) shift ;;
                    *) pos="$pos $1"; shift ;;
                  esac
                done
                set -- $pos
                if [ "$dirs" = 1 ]; then
                  mkdir -p "$@"
                  exit 0
                fi
                dest=$(eval "echo \\$$#")
                src=$(eval "echo \\$$(($#-1))")
                cp "$src" "$dest"
                chmod 0755 "$dest"
                """), encoding="utf-8")
            for name in ("id", "getent", "systemctl", "ss", "install"):
                (bindir / name).chmod(0o755)
            rewritten = root / "migrate.sh"
            text = SCRIPT.read_text(encoding="utf-8").replace(
                "INSTALL=/opt/tono-xray",
                f"INSTALL={install}",
                1,
            )
            rewritten.write_text(text, encoding="utf-8")
            result = subprocess.run(
                ["sh", str(rewritten), str(artifact), digest],
                cwd=root,
                env={
                    **os.environ,
                    "PATH": f"{bindir}:{os.environ.get('PATH', '')}",
                    "MIGRATE_SOURCE": str(source),
                    "MIGRATE_MARKER": str(marker),
                },
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertTrue(current.is_symlink(), result.stdout + result.stderr)
            published = json.loads(current.joinpath("config.json").read_text(encoding="utf-8"))
            self.assertTrue(published.get("added"), result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
