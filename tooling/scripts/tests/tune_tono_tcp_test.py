#!/usr/bin/env python3
"""A drop-in that matches the desired text is not success if the kernel still has the old values."""

from __future__ import annotations

import os
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "remote" / "tune-tono-tcp.sh"

DESIRED = (
    "net.ipv4.tcp_rmem = 4096 131072 16777216\n"
    "net.ipv4.tcp_wmem = 4096 16384 16777216\n"
    "net.core.rmem_max = 16777216\n"
    "net.core.wmem_max = 16777216\n"
    "net.ipv4.tcp_slow_start_after_idle = 0"
)


class TuneTonoTcp(unittest.TestCase):
    def test_a_matching_dropin_is_not_success_when_sysctl_did_not_apply(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            etc = root / "sysctl.d"
            etc.mkdir()
            dropin = etc / "99-tono-tcp.conf"
            dropin.write_text(DESIRED, encoding="utf-8")
            prev = etc / ".99-tono-tcp.previous"
            bindir = root / "bin"
            bindir.mkdir()
            (bindir / "id").write_text("#!/bin/sh\necho 0\n", encoding="utf-8")
            (bindir / "sysctl").write_text(textwrap.dedent("""\
                #!/bin/sh
                if [ "$1" = "-n" ]; then
                  case "$2" in
                    net.ipv4.tcp_rmem) echo "4096 131072 6291456" ;;
                    net.ipv4.tcp_wmem) printf '4096\\t16384\\t4194304\\n' ;;
                    net.core.rmem_max) echo 212992 ;;
                    net.core.wmem_max) echo 212992 ;;
                    net.ipv4.tcp_slow_start_after_idle) echo 1 ;;
                    *) echo 0 ;;
                  esac
                  exit 0
                fi
                exit 0
                """), encoding="utf-8")
            for name in ("id", "sysctl"):
                (bindir / name).chmod(0o755)
            rewritten = root / "tune.sh"
            text = SCRIPT.read_text(encoding="utf-8")
            text = text.replace(
                '[ "$(id -u)" = 0 ] || fail "must run as root"',
                ":",
                1,
            )
            text = text.replace("/etc/sysctl.d/99-tono-tcp.conf", str(dropin), 1)
            text = text.replace("/etc/sysctl.d/.99-tono-tcp.previous", str(prev), 1)
            rewritten.write_text(text, encoding="utf-8")
            rewritten.chmod(rewritten.stat().st_mode | stat.S_IEXEC)
            result = subprocess.run(
                ["sh", str(rewritten)],
                cwd=root,
                env={**os.environ, "PATH": f"{bindir}:{os.environ.get('PATH', '')}"},
                capture_output=True,
                text=True,
                timeout=20,
            )
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("did not take effect", result.stderr)


if __name__ == "__main__":
    unittest.main()
