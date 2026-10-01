"""Exercise the real read-only verifier with a healthy fixture transaction."""

import base64
import hashlib
import json
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("manage-tono-node-v2.sh")


class JournalVerification(unittest.TestCase):
    def verify(self, journal_body):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tx_id = "a" * 32
            tx = root / "transactions" / tx_id
            tx.mkdir(parents=True)
            (root / "current").symlink_to(tx)
            config = root / "config.json"
            config.write_text('{"inbounds":[]}')
            files = {
                "id": tx_id, "status": "activation-pending", "client": "\n\n\n",
                "expected-hash": hashlib.sha256(config.read_bytes()).hexdigest(),
                "prior-mainpid": "1", "activation-time": "1", "iface": "fixture0",
                "net-before": "0 0 0 0 0",
            }
            for name, value in files.items():
                (tx / name).write_text(value + "\n")
            stats = root / "net" / "fixture0" / "statistics"
            stats.mkdir(parents=True)
            for name in ("rx_dropped", "tx_dropped", "rx_errors", "tx_errors"):
                (stats / name).write_text("0")
            request = {"op": "verify", "transactionId": tx_id, "expected": {}, "desired": {
                "mode": "extend", "servicePort": 443, "configPath": str(config),
                "serviceName": "fixture.service", "realityTarget": "front.invalid",
                "enableBbr": False, "allowFirewallChange": False,
            }}
            source = SCRIPT.read_text().replace(
                '[[ $(id -u) == 0 ]] || fail "root or passwordless sudo required"', ":", 1
            ).replace("ROOT=/var/lib/tono-node;", f"ROOT={shlex.quote(str(root))};", 1)
            source = source.replace("/sys/class/net/", str(root / "net") + "/")
            functions, dispatch = source.rsplit('case "$op"', 1)
            stubs = '''
service_xray() { :; }
systemctl() {
  if [[ $1 == show ]]; then
    case "$3" in MainPID) echo 42;; ExecMainStartTimestamp) echo '2026-01-01 00:00:00 UTC';; esac
  fi
}
ss() { echo 'LISTEN users:(("xray",pid=42,fd=3))'; }
free() { echo 'Mem: 1024 1 1023'; }
nproc() { echo 999999; }
nstat() { echo 'TcpRetransSegs 0'; }
journalctl() {
''' + journal_body + "\n}\n"
            framed = "TONO_REQUEST_B64=" + shlex.quote(base64.b64encode(json.dumps(request).encode()).decode()) + "\n"
            return subprocess.run(
                ["bash"], input=framed + functions + stubs + 'case "$op"' + dispatch,
                capture_output=True, text=True, timeout=10,
            )

    def test_an_empty_error_journal_does_not_rollback_a_healthy_restart(self):
        # journalctl prints its informational empty-result banner unless quiet.
        result = self.verify('[[ " $* " == *" --quiet "* ]] || echo "-- No entries --"')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertTrue(json.loads(result.stdout)["healthy"])

    def test_a_real_error_entry_still_rejects_verification(self):
        result = self.verify("echo 'xray: failed to start listener'")
        self.assertNotEqual(0, result.returncode)
        self.assertIn("journal errors", result.stderr)

    def test_an_unreadable_journal_cannot_report_healthy(self):
        result = self.verify("return 1")
        self.assertNotEqual(0, result.returncode)


if __name__ == "__main__":
    unittest.main()
