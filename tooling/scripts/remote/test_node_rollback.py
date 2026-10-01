"""A read-only recovery snapshot must restore the live artifact's original mode."""

import base64
import json
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("manage-tono-node-v2.sh")


class RollbackMetadata(unittest.TestCase):
    def restore_fixture(self, root, operations):
        tx_id = "a" * 32
        (root / "transactions" / tx_id).mkdir(parents=True)
        request = {"op": "verify-restored", "transactionId": tx_id, "desired": {
            "mode": "extend", "servicePort": 443, "configPath": str(root / "config.json"),
            "serviceName": "fixture.service", "realityTarget": "front.invalid",
            "enableBbr": False, "allowFirewallChange": False,
        }}
        source = SCRIPT.read_text().replace(
            '[[ $(id -u) == 0 ]] || fail "root or passwordless sudo required"', ":", 1
        ).replace("ROOT=/var/lib/tono-node;", f"ROOT={shlex.quote(str(root))};", 1)
        source = source.replace("/etc/systemd/system/", str(root / "units") + "/")
        functions = source.rsplit('case "$op"', 1)[0]
        framed = "TONO_REQUEST_B64=" + shlex.quote(base64.b64encode(json.dumps(request).encode()).decode()) + "\n"
        fixture = '''
systemctl() { case "$1" in is-enabled) echo enabled;; is-active) echo active;; esac; }
TX="$TXROOT/$(jget transactionId)"
backup
(cd "$TX/backup"; sha256sum -c manifest.sha256 >/dev/null)
''' + operations + '''
printf 'restored-pending-verification\\n' >"$TX/status"
verify_restored
'''
        return subprocess.run(["bash"], input=framed + functions + fixture,
                              capture_output=True, text=True, timeout=10)

    def test_readonly_backup_restores_original_config_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "config.json"
            config.write_text('{"original":true}')
            config.chmod(0o640)
            result = self.restore_fixture(root, '''
printf '{"replacement":true}' >"$config"
restore_one config "$config"
''')
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual('{"original":true}', config.read_text())
            self.assertEqual(0o640, config.stat().st_mode & 0o777)
            snapshot = root / "transactions" / ("a" * 32) / "backup" / "config" / "value"
            self.assertEqual(0o440, snapshot.stat().st_mode & 0o777)

    def test_restoring_a_unit_symlink_does_not_chmod_its_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config.json").write_text('{}')
            target = root / "unit-target"
            target.write_text("fixture unit")
            target.chmod(0o640)
            units = root / "units"
            units.mkdir()
            unit = units / "fixture.service"
            unit.symlink_to(target)
            result = self.restore_fixture(root, f"restore_one unit {shlex.quote(str(unit))}\n")
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertTrue(unit.is_symlink())
            self.assertEqual(target, unit.resolve())
            self.assertEqual(0o640, target.stat().st_mode & 0o777)


if __name__ == "__main__":
    unittest.main()
