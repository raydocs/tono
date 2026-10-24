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
    "net.core.default_qdisc = fq\n"
    "net.ipv4.tcp_congestion_control = bbr\n"
    "net.ipv4.tcp_rmem = 4096 131072 16777216\n"
    "net.ipv4.tcp_wmem = 4096 16384 16777216\n"
    "net.core.rmem_max = 16777216\n"
    "net.core.wmem_max = 16777216\n"
    "net.ipv4.tcp_slow_start_after_idle = 0\n"
    "net.ipv4.tcp_mtu_probing = 1\n"
    "net.ipv4.tcp_fastopen = 3"
)

LIVE_PROFILE = {
    "net.core.default_qdisc": "fq",
    "net.ipv4.tcp_congestion_control": "bbr",
    "net.ipv4.tcp_rmem": "4096\\t131072\\t16777216",
    "net.ipv4.tcp_wmem": "4096\\t16384\\t16777216",
    "net.core.rmem_max": "16777216",
    "net.core.wmem_max": "16777216",
    "net.ipv4.tcp_slow_start_after_idle": "0",
    "net.ipv4.tcp_mtu_probing": "1",
    "net.ipv4.tcp_fastopen": "3",
}


def run_with_fake_kernel(root: Path, live: dict[str, str], dropin_text: str | None) -> subprocess.CompletedProcess:
    """Run the script against a temp sysctl.d and a sysctl that reports `live`."""
    etc = root / "sysctl.d"
    etc.mkdir()
    dropin = etc / "99-tono-tcp.conf"
    if dropin_text is not None:
        dropin.write_text(dropin_text, encoding="utf-8")
    prev = etc / ".99-tono-tcp.previous"
    bindir = root / "bin"
    bindir.mkdir()
    cases = "".join(f'    {k}) printf \'{v}\\n\' ;;\n' for k, v in live.items())
    (bindir / "sysctl").write_text(
        "#!/bin/sh\nif [ \"$1\" = \"-n\" ]; then\n  case \"$2\" in\n" + cases
        + "    *) echo 0 ;;\n  esac\nfi\nexit 0\n", encoding="utf-8")
    (bindir / "modprobe").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    for name in ("sysctl", "modprobe"):
        (bindir / name).chmod(0o755)
    text = SCRIPT.read_text(encoding="utf-8")
    text = text.replace('[ "$(id -u)" = 0 ] || fail "must run as root"', ":", 1)
    text = text.replace("/etc/sysctl.d/99-tono-tcp.conf", str(dropin), 1)
    text = text.replace("/etc/sysctl.d/.99-tono-tcp.previous", str(prev), 1)
    rewritten = root / "tune.sh"
    rewritten.write_text(text, encoding="utf-8")
    return subprocess.run(
        ["sh", str(rewritten)], cwd=root,
        env={**os.environ, "PATH": f"{bindir}:{os.environ.get('PATH', '')}"},
        capture_output=True, text=True, timeout=20)


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


    def test_the_script_codifies_the_full_high_bdp_profile(self) -> None:
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('DESIRED="' + DESIRED + '"', text)
        for key in LIVE_PROFILE:
            self.assertIn(key, text.split("KEYS=", 1)[1].splitlines()[0], key)

    def test_a_host_already_on_the_profile_is_left_alone(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = run_with_fake_kernel(Path(tmp), LIVE_PROFILE, DESIRED)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("leaving this host alone", result.stdout)

    def test_a_kernel_still_on_cubic_is_not_success(self) -> None:
        live = dict(LIVE_PROFILE, **{"net.ipv4.tcp_congestion_control": "cubic"})
        with tempfile.TemporaryDirectory() as tmp:
            result = run_with_fake_kernel(Path(tmp), live, DESIRED)
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("tcp_congestion_control", result.stderr)

    def test_missing_mtu_probing_or_fastopen_is_not_success(self) -> None:
        for key in ("net.ipv4.tcp_mtu_probing", "net.ipv4.tcp_fastopen"):
            live = dict(LIVE_PROFILE, **{key: "0"})
            with tempfile.TemporaryDirectory() as tmp:
                result = run_with_fake_kernel(Path(tmp), live, None)
                self.assertNotEqual(result.returncode, 0, key)
                self.assertIn(key, result.stderr)


if __name__ == "__main__":
    unittest.main()
