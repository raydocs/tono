"""The versioned timer cadence and its installer must agree, and the installer must read systemd back."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
DROPIN = HERE / "systemd" / "10-tono-cadence.conf"
INSTALLER = HERE.parents[1] / "tooling" / "scripts" / "remote" / "ensure-exit-agent-cadence.sh"


def directives(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]


class CadenceDropIn(unittest.TestCase):
    def test_dropin_resets_then_sets_sixty_seconds(self) -> None:
        self.assertEqual(["[Timer]", "OnUnitInactiveSec=", "OnUnitInactiveSec=60s"],
                         directives(DROPIN.read_text(encoding="utf-8")))

    def test_dropin_does_not_define_the_unit_contract(self) -> None:
        text = "\n".join(directives(DROPIN.read_text(encoding="utf-8")))
        for forbidden in ("[Unit]", "[Service]", "[Install]", "ExecStart", "User=", "OnBootSec", "WantedBy"):
            self.assertNotIn(forbidden, text)

    def test_installer_writes_the_same_directives(self) -> None:
        script = INSTALLER.read_text(encoding="utf-8")
        desired = script.split('DESIRED="', 1)[1].split('"', 1)[0]
        self.assertEqual(directives(DROPIN.read_text(encoding="utf-8")), directives(desired))
        self.assertIn("/etc/systemd/system/$UNIT.d", script)
        self.assertIn("UNIT=tono-exit-agent.timer", script)

    def run_installer(self, root: Path, timers: str) -> subprocess.CompletedProcess:
        bindir = root / "bin"
        bindir.mkdir()
        log = root / "calls"
        (bindir / "systemctl").write_text(
            "#!/bin/sh\n"
            f"echo \"$*\" >> {log}\n"
            "case \"$1\" in\n"
            f"  show) printf '%s\\n' '{timers}' ;;\n"
            "esac\nexit 0\n", encoding="utf-8")
        (bindir / "systemctl").chmod(0o755)
        script = INSTALLER.read_text(encoding="utf-8")
        script = script.replace('[ "$(id -u)" = 0 ] || fail "must run as root"', ":", 1)
        script = script.replace("DIR=/etc/systemd/system/$UNIT.d", f"DIR={root}/$UNIT.d", 1)
        rewritten = root / "ensure.sh"
        rewritten.write_text(script, encoding="utf-8")
        result = subprocess.run(["sh", str(rewritten)], env={**os.environ, "PATH": f"{bindir}:{os.environ['PATH']}"},
                                capture_output=True, text=True, timeout=20)
        result.calls = log.read_text() if log.exists() else ""  # type: ignore[attr-defined]
        return result

    def test_installer_installs_and_verifies(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = self.run_installer(root, "{ OnUnitInactiveUSec=1min ; next_elapse=0 }")
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertIn("daemon-reload", result.calls)  # type: ignore[attr-defined]
            written = (root / "tono-exit-agent.timer.d" / "10-tono-cadence.conf").read_text()
            self.assertEqual(directives(DROPIN.read_text()), directives(written))
            again = self.run_installer_again(root)
            self.assertIn("leaving this host alone", again.stdout)

    def run_installer_again(self, root: Path) -> subprocess.CompletedProcess:
        (root / "bin" / "systemctl").unlink()
        (root / "bin").rmdir()
        return self.run_installer(root, "{ OnUnitInactiveUSec=1min ; next_elapse=0 }")

    def test_installer_fails_when_another_dropin_overrides_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self.run_installer(Path(tmp), "{ OnUnitInactiveUSec=5min ; next_elapse=0 }")
            self.assertNotEqual(0, result.returncode)
            self.assertIn("does not report OnUnitInactiveSec=60s", result.stderr)


if __name__ == "__main__":
    unittest.main()
