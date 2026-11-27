#!/usr/bin/env python3
"""Tests for manage-tono-hy2-node.sh bandwidth configuration patching."""

from __future__ import annotations

import json
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "remote" / "manage-tono-hy2-node.sh"

SAMPLE_WITH_BW = """\
listen: :443
tls:
  cert: /opt/tono-hy2/current/cert.pem
  key: /opt/tono-hy2/current/key.pem
auth:
  type: http
  http:
    url: http://127.0.0.1:18765/auth
bandwidth:
  up: 500 mbps
  down: 500 mbps
ignoreClientBandwidth: false
disableUDP: false
"""

SAMPLE_LEGACY = """\
listen: :443
auth:
  type: http
  http:
    url: http://127.0.0.1:18765/auth
disableUDP: false
"""


def extract_bandwidth_python() -> str:
    text = SCRIPT.read_text(encoding="utf-8")
    m = re.search(
        r'patch_hy2_config_bandwidth\(\).*?python3 - "\$path" "\$ignore_client" "\$up_mbps" "\$down_mbps" <<\'PY\'\n(.*?)\nPY',
        text,
        re.S,
    )
    if not m:
        raise AssertionError("could not find patch_hy2_config_bandwidth inline python")
    return m.group(1)


class ManageHy2BandwidthTests(unittest.TestCase):
    def test_bash_syntax_is_valid(self) -> None:
        r = subprocess.run(["bash", "-n", str(SCRIPT)], capture_output=True, text=True)
        self.assertEqual(0, r.returncode, r.stderr)

    def test_updates_existing_bandwidth_and_ignore_flag_idempotently(self) -> None:
        code = extract_bandwidth_python()
        with tempfile.TemporaryDirectory() as tmp:
            cfg = pathlib.Path(tmp) / "config.yaml"
            cfg.write_text(SAMPLE_WITH_BW, encoding="utf-8")
            r = subprocess.run(
                ["python3", "-c", code, str(cfg), "true", "200", "300"],
                capture_output=True,
                text=True,
            )
            self.assertEqual(0, r.returncode, r.stderr)
            out = json.loads(r.stdout)
            self.assertEqual(
                {"changed": True, "ignoreClientBandwidth": True, "upMbps": 200, "downMbps": 300},
                out,
            )
            updated = cfg.read_text(encoding="utf-8")
            self.assertIn("  up: 200 mbps\n  down: 300 mbps\n", updated)
            self.assertIn("ignoreClientBandwidth: true\n", updated)
            self.assertIn("url: http://127.0.0.1:18765/auth\n", updated)

            # Second run with same values is a no-op.
            r2 = subprocess.run(
                ["python3", "-c", code, str(cfg), "true", "200", "300"],
                capture_output=True,
                text=True,
            )
            self.assertEqual(0, r2.returncode, r2.stderr)
            self.assertFalse(json.loads(r2.stdout)["changed"])

    def test_inserts_ignore_client_bandwidth_on_legacy_config_and_guards_half_bw(self) -> None:
        code = extract_bandwidth_python()
        with tempfile.TemporaryDirectory() as tmp:
            cfg = pathlib.Path(tmp) / "config.yaml"
            cfg.write_text(SAMPLE_LEGACY, encoding="utf-8")
            # Adding only ignoreClientBandwidth works without fabricating bandwidth numbers.
            r = subprocess.run(
                ["python3", "-c", code, str(cfg), "true", "", ""],
                capture_output=True,
                text=True,
            )
            self.assertEqual(0, r.returncode, r.stderr)
            out = json.loads(r.stdout)
            self.assertEqual(
                {"changed": True, "ignoreClientBandwidth": True, "upMbps": None, "downMbps": None},
                out,
            )
            self.assertIn("ignoreClientBandwidth: true\ndisableUDP: false\n", cfg.read_text(encoding="utf-8"))

            # Half bandwidth on legacy config without existing block refuses cleanly.
            r_half = subprocess.run(
                ["python3", "-c", code, str(cfg), "", "100", ""],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(0, r_half.returncode)

    def test_bandwidth_at_eof_without_newline_and_validation_guards(self) -> None:
        code = extract_bandwidth_python()
        with tempfile.TemporaryDirectory() as tmp:
            eof_cfg = pathlib.Path(tmp) / "eof.yaml"
            eof_cfg.write_text(
                "listen: :443\nbandwidth:\n  up: 500 mbps\n  down: 500 mbps",
                encoding="utf-8",
            )
            r = subprocess.run(
                ["python3", "-c", code, str(eof_cfg), "", "", "150"],
                capture_output=True,
                text=True,
            )
            self.assertEqual(0, r.returncode, r.stderr)
            updated = eof_cfg.read_text(encoding="utf-8")
            self.assertEqual(1, updated.count("down:"), updated)
            self.assertEqual("listen: :443\nbandwidth:\n  up: 500 mbps\n  down: 150 mbps\n", updated)

            dup_ig = pathlib.Path(tmp) / "dup_ig.yaml"
            dup_ig.write_text(
                "listen: :443\nignoreClientBandwidth: true\nignoreClientBandwidth: false\n",
                encoding="utf-8",
            )
            r_dup = subprocess.run(
                ["python3", "-c", code, str(dup_ig), "true", "", ""],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(0, r_dup.returncode)

            gbps_cfg = pathlib.Path(tmp) / "gbps.yaml"
            gbps_cfg.write_text(
                "listen: :443\nbandwidth:\n  up: 1 gbps\n  down: 500 mbps\n",
                encoding="utf-8",
            )
            r_unit = subprocess.run(
                ["python3", "-c", code, str(gbps_cfg), "", "", "200"],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(0, r_unit.returncode)


if __name__ == "__main__":
    unittest.main()
