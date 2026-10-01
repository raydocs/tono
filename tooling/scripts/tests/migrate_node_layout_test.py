#!/usr/bin/env python3
"""The release-layout swap must put current back if the new symlink cannot be published."""

from __future__ import annotations

import hashlib
import os
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "remote" / "migrate-node-to-release-layout.sh"


class MigrateCurrentRestore(unittest.TestCase):
    def test_a_failed_symlink_restores_the_previous_current_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            install = root / "tono-xray"
            current = install / "current"
            current.mkdir(parents=True)
            (current / "config.json").write_text('{"inbounds":[]}\n', encoding="utf-8")
            xray = current / "xray"
            xray.write_text("#!/bin/sh\necho 'Xray 1.2.3'\nexit 0\n", encoding="utf-8")
            xray.chmod(0o755)
            # Destination exists, so ln -s fails after current has been moved aside.
            (install / "current.new").write_text("blocker\n", encoding="utf-8")
            artifact = root / "xray-new"
            artifact.write_text("#!/bin/sh\necho 'Xray 9.9.9'\nexit 0\n", encoding="utf-8")
            artifact.chmod(0o755)
            digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
            bindir = root / "bin"
            bindir.mkdir()
            (bindir / "id").write_text("#!/bin/sh\necho 0\n", encoding="utf-8")
            (bindir / "getent").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
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
            for name in ("id", "getent", "install"):
                (bindir / name).chmod(0o755)
            rewritten = root / "migrate.sh"
            text = SCRIPT.read_text(encoding="utf-8").replace(
                "INSTALL=/opt/tono-xray",
                f"INSTALL={install}",
                1,
            )
            rewritten.write_text(text, encoding="utf-8")
            rewritten.chmod(rewritten.stat().st_mode | stat.S_IEXEC)
            result = subprocess.run(
                ["sh", str(rewritten), str(artifact), digest],
                cwd=root,
                env={**os.environ, "PATH": f"{bindir}:{os.environ.get('PATH', '')}"},
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertTrue(current.is_dir(), result.stdout + result.stderr)
            self.assertTrue((current / "config.json").is_file(), result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
