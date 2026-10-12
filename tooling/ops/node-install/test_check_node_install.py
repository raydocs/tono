"""Stub tests for check-node-install.py.

A fake node root holds the canonical units and the real node agent; systemctl,
nginx and logrotate are shell stubs on PATH. Run:
  python3 tooling/ops/node-install/test_check_node_install.py
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
CHECK = HERE / "check-node-install.py"
RELAY = REPO / "tooling" / "ops" / "relay"
AGENT = REPO / "services" / "node-agent"

# Synthetic credentials; neither may ever appear in the output.
EXIT_TOKEN = "exit-agent-SYNTHETIC-7f3a9c"
NODE_TOKEN = "tna1.AAAAAAAAAAAAAAAA." + "B" * 43

RELAY_PROBE_STUB = '''
DEFAULT_ADDR = "127.0.0.1:2053"
DEFAULT_HOST = "api.afk.ccwu.cc"
def parse_addr(raw):
    host, _, port = raw.rpartition(":")
    return host, int(port)
def probe(relay, host):
    return {"observedAt": 1, "httpStatus": 200, "latencyMs": 42, "error": None}
'''

SYSTEMCTL_STUB = '''#!/bin/sh
# Timer states come from $STATE_DIR/<unit>.<verb> when present.
state_dir="__STATE__"
case "$1" in
  is-enabled) f="$state_dir/$2.is-enabled"; s=enabled ;;
  is-active)
    [ "$2" = --quiet ] && exit 0
    f="$state_dir/$2.is-active"; s=active ;;
  show) printf 'LoadState=loaded\\nResult=success\\n'; exit 0 ;;
  *) exit 3 ;;
esac
[ -f "$f" ] && s=$(cat "$f")
echo "$s"
[ "$s" = enabled ] || [ "$s" = active ]
'''

LOGROTATE_STUB = '''#!/bin/sh
case "$1" in
  --version) echo "logrotate 3.22.0" ;;
  -d)
    echo "reading config file /etc/logrotate.d/00-tono-relay"
    echo "considering log /var/log/nginx/tono-relay.log"
    [ -f "__STATE__/logrotate.dup" ] && echo "error: nginx:1 duplicate log entry for /var/log/nginx/tono-relay.log"
    exit 0 ;;
esac
'''


def put(root: Path, absolute: str, data: str, mode: int) -> Path:
    path = root / absolute.lstrip("/")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data)
    path.chmod(mode)
    return path


class CheckNodeInstallTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.root = self.tmp / "root"
        self.state = self.tmp / "state"
        self.bin = self.tmp / "bin"
        for d in (self.root, self.state, self.bin):
            d.mkdir(mode=0o755)
        r = self.root
        put(r, "/opt/tono-relay-probe/relay-probe.py", RELAY_PROBE_STUB, 0o755)
        for name in ("tono-relay-probe.service", "tono-relay-probe.timer"):
            put(r, f"/etc/systemd/system/{name}", (RELAY / name).read_text(), 0o644)
        put(r, "/etc/tono-exit-agent/env",
            f"TONO_HOME_AGENT_TOKEN={EXIT_TOKEN}\nTONO_API_BASE=https://api.afk.ccwu.cc\n", 0o600)
        put(r, "/etc/nginx/tono-relay.stream.conf", (RELAY / "tono-relay.stream.conf").read_text(), 0o644)
        put(r, "/etc/logrotate.d/00-tono-relay", (RELAY / "tono-relay.logrotate").read_text(), 0o644)
        put(r, "/etc/logrotate.conf", "include /etc/logrotate.d\n", 0o644)
        put(r, "/opt/tono-node-agent/tono_node_agent.py", (AGENT / "tono_node_agent.py").read_text(), 0o644)
        for name in ("tono-node-agent.service", "tono-node-agent.timer"):
            put(r, f"/etc/systemd/system/{name}", (AGENT / name).read_text(), 0o644)
        put(r, "/etc/tono/node-agent.conf", (AGENT / "node-agent.conf.example").read_text(), 0o644)
        put(r, "/etc/tono/node-agent.token", NODE_TOKEN + "\n", 0o600)
        put(self.bin, "/systemctl", SYSTEMCTL_STUB.replace("__STATE__", str(self.state)), 0o755)
        put(self.bin, "/logrotate", LOGROTATE_STUB.replace("__STATE__", str(self.state)), 0o755)
        put(self.bin, "/nginx", "#!/bin/sh\necho 'nginx: configuration file test is successful'\n", 0o755)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_check(self) -> subprocess.CompletedProcess:
        env = {"PATH": f"{self.bin}:/usr/bin:/bin", "LANG": "C"}
        return subprocess.run(
            [sys.executable, "-I", str(CHECK), "relay-probe", "relay-logrotate", "node-agent",
             "--root", str(self.root), "--expect-uid", str(os.getuid())],
            env=env, capture_output=True, text=True, timeout=60,
        )

    def assert_no_secret(self, result: subprocess.CompletedProcess) -> None:
        for secret in (EXIT_TOKEN, NODE_TOKEN, NODE_TOKEN[:20]):
            self.assertNotIn(secret, result.stdout)
            self.assertNotIn(secret, result.stderr)

    def test_complete_install_passes_without_printing_secrets(self) -> None:
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("FAIL", result.stdout)
        self.assertIn("smoke probe through 127.0.0.1:2053: HTTP 200", result.stdout)
        self.assertIn("/etc/tono/node-agent.token holds one well-formed tna1 token", result.stdout)
        self.assertIn("would report roles xray,hy2,relay (not sent)", result.stdout)
        self.assert_no_secret(result)

    def test_broken_install_fails_each_check_without_printing_secrets(self) -> None:
        r = self.root
        (r / "etc/tono/node-agent.token").chmod(0o644)
        (r / "etc/tono-exit-agent/env").write_text(f"TONO_API_BASE=https://api.afk.ccwu.cc\n#{EXIT_TOKEN}\n")
        (r / "etc/tono/node-agent.conf").write_text(
            f"TONO_API_BASE=https://api.afk.ccwu.cc\nTONO_NODE_NAME=x\nLD_PRELOAD={NODE_TOKEN}\n")
        (self.state / "tono-relay-probe.timer.is-active").write_text("inactive\n")
        (self.state / "logrotate.dup").write_text("")
        result = self.run_check()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        fails = [line for line in result.stdout.splitlines() if line.startswith("FAIL ")]
        expected = [
            "FAIL relay-probe: /etc/tono-exit-agent/env does not set TONO_HOME_AGENT_TOKEN",
            "FAIL relay-probe: tono-relay-probe.timer not active (inactive)",
            "FAIL relay-logrotate: logrotate -d: error: nginx:1 duplicate log entry for "
            "/var/log/nginx/tono-relay.log",
            "FAIL node-agent: /etc/tono/node-agent.token: mode 0644, want 0600",
            "FAIL node-agent: /etc/tono/node-agent.conf: config line 3 is not one of "
            "TONO_API_BASE, TONO_NODE_NAME",
        ]
        self.assertEqual(fails, expected, result.stdout)
        self.assert_no_secret(result)


if __name__ == "__main__":
    unittest.main()
