#!/usr/bin/env python3
"""Tests for manage-tono-hy2-node.sh bandwidth configuration patching."""

from __future__ import annotations

import json
import os
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
                {
                    "changed": True,
                    "ignoreClientBandwidth": True,
                    "upMbps": 200,
                    "downMbps": 300,
                    "previous": {"ignoreClientBandwidth": False, "upMbps": 500, "downMbps": 500},
                    "serverCapAboveClientCatalogMax": False,
                },
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
                {
                    "changed": True,
                    "ignoreClientBandwidth": True,
                    "upMbps": None,
                    "downMbps": None,
                    "previous": {"ignoreClientBandwidth": None, "upMbps": None, "downMbps": None},
                    "serverCapAboveClientCatalogMax": False,
                },
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

    def test_crlf_trailing_space_noop_case_and_overflow_guards(self) -> None:
        code = extract_bandwidth_python()
        with tempfile.TemporaryDirectory() as tmp:
            crlf_cfg = pathlib.Path(tmp) / "crlf.yaml"
            crlf_cfg.write_bytes(
                b"listen: :443\r\nbandwidth:   # server cap\r\n  up: 500 Mbps\r\n  down: 500 mbps\r\nignoreClientBandwidth: false\r\n"
            )
            r_noop = subprocess.run(
                ["python3", "-c", code, str(crlf_cfg), "false", "500", "500"],
                capture_output=True,
                text=True,
            )
            self.assertEqual(0, r_noop.returncode, r_noop.stderr)
            out_noop = json.loads(r_noop.stdout)
            self.assertFalse(out_noop["changed"])
            self.assertFalse(out_noop["serverCapAboveClientCatalogMax"])
            self.assertIn(b"500 Mbps\r\n", crlf_cfg.read_bytes())

            r_upd = subprocess.run(
                ["python3", "-c", code, str(crlf_cfg), "", "600", ""],
                capture_output=True,
                text=True,
            )
            self.assertEqual(0, r_upd.returncode, r_upd.stderr)
            out_upd = json.loads(r_upd.stdout)
            self.assertTrue(out_upd["changed"])
            self.assertTrue(out_upd["serverCapAboveClientCatalogMax"])
            self.assertEqual(600, out_upd["upMbps"])
            self.assertEqual(500, out_upd["previous"]["upMbps"])
            updated = crlf_cfg.read_text(encoding="utf-8")
            self.assertEqual(1, updated.count("bandwidth:"), updated)

            script_src = SCRIPT.read_text(encoding="utf-8")
            fail_fn = re.search(r"^fail\(\) \{\n.*?\n\}", script_src, re.M | re.S)
            val_fn = re.search(r"^validate_bandwidth_mbps\(\) \{\n.*?\n\}", script_src, re.M | re.S)
            assert fail_fn and val_fn

            def run_validate(val: str) -> subprocess.CompletedProcess[str]:
                return subprocess.run(
                    [
                        "bash",
                        "-c",
                        f'{fail_fn.group(0)}\n{val_fn.group(0)}\nvalidate_bandwidth_mbps "$1"',
                        "bash",
                        val,
                    ],
                    capture_output=True,
                    text=True,
                )

            for valid_val in ("10", "100", "1000"):
                self.assertEqual(0, run_validate(valid_val).returncode, valid_val)
            self.assertNotEqual(0, run_validate("18446744073709552616").returncode)

            # Inline comments on existing up/down values (with CRLF) allow updating the other side.
            comment_cfg = pathlib.Path(tmp) / "comment.yaml"
            comment_cfg.write_bytes(
                b"listen: :443\r\nbandwidth:\r\n  up: 500 mbps # provider cap\r\n  down: 500 mbps # dl cap\r\nignoreClientBandwidth: false\r\n"
            )
            r_cmt = subprocess.run(
                ["python3", "-c", code, str(comment_cfg), "", "", "200"],
                capture_output=True,
                text=True,
            )
            self.assertEqual(0, r_cmt.returncode, r_cmt.stderr)
            out_cmt = json.loads(r_cmt.stdout)
            self.assertEqual(500, out_cmt["upMbps"])
            self.assertEqual(200, out_cmt["downMbps"])

            # Duplicate nested up/down keys refuse cleanly on both bw update and ignore-only update.
            for dup_body, args in (
                ("listen: :443\nbandwidth:\n  up: 500 mbps\n  up: 300 mbps\n  down: 500 mbps\n", ["", "", "200"]),
                ("listen: :443\nbandwidth:\n  up: 500 mbps\n  down: 500 mbps\n  down: 400 mbps\nignoreClientBandwidth: false\n", ["true", "", ""]),
            ):
                dup_cfg = pathlib.Path(tmp) / "dup_nested.yaml"
                dup_cfg.write_text(dup_body, encoding="utf-8")
                r_dup_n = subprocess.run(
                    ["python3", "-c", code, str(dup_cfg), *args],
                    capture_output=True,
                    text=True,
                )
                self.assertNotEqual(0, r_dup_n.returncode, args)

            # Ignore-only toggle with non-mbps unit reports "unknown" instead of false.
            raw_unit_cfg = pathlib.Path(tmp) / "raw_unit.yaml"
            raw_unit_cfg.write_text(
                "listen: :443\nbandwidth:\n  up: 1 gbps\n  down: 500 mbps\nignoreClientBandwidth: false\n",
                encoding="utf-8",
            )
            r_ig_gbps = subprocess.run(
                ["python3", "-c", code, str(raw_unit_cfg), "true", "", ""],
                capture_output=True,
                text=True,
            )
            self.assertEqual(0, r_ig_gbps.returncode, r_ig_gbps.stderr)
            out_ig_gbps = json.loads(r_ig_gbps.stdout)
            self.assertEqual("unknown", out_ig_gbps["serverCapAboveClientCatalogMax"])
            self.assertEqual({"up": "1 gbps"}, out_ig_gbps["rawUnits"])

    def _run_set_bandwidth_harness(self, config_text: str, args: list[str], mode: str = "ok") -> tuple[subprocess.CompletedProcess[str], pathlib.Path, str]:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = pathlib.Path(tmpdir)
            install_root = tmp / "opt" / "tono-hy2"
            current_dir = install_root / "current"
            xray_dir = tmp / "opt" / "tono-xray" / "current"
            stub_bin = tmp / "bin"
            systemd_dir = tmp / "etc" / "systemd" / "system"
            for d in (current_dir, xray_dir, stub_bin, systemd_dir):
                d.mkdir(parents=True, exist_ok=True)
            conf = current_dir / "config.yaml"
            conf.write_text(config_text, encoding="utf-8")
            xray_conf = xray_dir / "config.json"
            xray_conf.write_text("{}", encoding="utf-8")
            (systemd_dir / "tono-hy2.service").write_text("[Unit]\n", encoding="utf-8")

            log_file = tmp / "ops.log"
            state_dir = tmp / "state"
            state_dir.mkdir()
            (state_dir / "restarts").write_text("0", encoding="utf-8")
            (state_dir / "hy2_restarts").write_text("0", encoding="utf-8")

            real_chmod = shutil.which("chmod") or "/bin/chmod"
            (stub_bin / "id").write_text("#!/bin/sh\necho 0\n")
            (stub_bin / "sleep").write_text("#!/bin/sh\nexit 0\n")
            (stub_bin / "chown").write_text("#!/bin/sh\nexit 0\n")
            (stub_bin / "getent").write_text("#!/bin/sh\nexit 0\n")
            (stub_bin / "chmod").write_text(
                f"""#!/bin/bash
echo "chmod $*" >> "{log_file}"
if [[ "${{STUB_CHMOD_FAIL:-0}}" == "1" && "$*" == *"config.yaml"* ]]; then
  n=$(cat "{state_dir}/chmod_calls" 2>/dev/null || echo 0)
  n=$((n + 1))
  echo "$n" > "{state_dir}/chmod_calls"
  if [[ "$n" == "1" ]]; then
    exit 1
  fi
fi
exec "{real_chmod}" "$@"
"""
            )
            (stub_bin / "ss").write_text(
                f"""#!/bin/bash
if [[ "{mode}" == "health_fail_rollback_ok" ]]; then
  n=$(cat "{state_dir}/hy2_restarts")
  if [[ "$n" == "1" ]]; then
    exit 0
  fi
fi
if [[ "{mode}" == "health_fail_rollback_fail" ]]; then
  exit 0
fi
echo "UNCONN 0 0 0.0.0.0:443 0.0.0.0:*"
"""
            )
            (stub_bin / "systemctl").write_text(
                f"""#!/bin/bash
echo "systemctl $*" >> "{log_file}"
cmd=${{1:-}}
unit=${{2:-}}
case "$cmd" in
  is-active)
    exit 0
    ;;
  reset-failed)
    exit 0
    ;;
  show)
    if [[ "$unit" == "tono-xray.service" ]]; then
      echo 4242
      exit 0
    fi
    if [[ "$*" == *"NRestarts"* ]]; then
      echo 0
    else
      echo 9001
    fi
    exit 0
    ;;
  restart)
    n=$(cat "{state_dir}/hy2_restarts")
    n=$((n + 1))
    echo "$n" > "{state_dir}/hy2_restarts"
    if [[ "{mode}" == "restart_fail_first" && "$n" == "1" ]]; then
      exit 1
    fi
    if [[ "{mode}" == "health_fail_rollback_fail" && "$n" -ge "2" ]]; then
      exit 1
    fi
    exit 0
    ;;
esac
exit 0
"""
            )
            for p in stub_bin.iterdir():
                p.chmod(0o755)

            harness_script = tmp / "manage.sh"
            body = SCRIPT.read_text(encoding="utf-8")
            body = body.replace('XRAY_CONFIG="/opt/tono-xray/current/config.json"', f'XRAY_CONFIG="{xray_conf}"')
            body = body.replace('INSTALL_ROOT="/opt/tono-hy2"', f'INSTALL_ROOT="{install_root}"')
            body = body.replace('SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"', f'SERVICE_PATH="{systemd_dir}/$SERVICE_NAME"')
            body = body.replace('AUTH_SERVICE_PATH="/etc/systemd/system/$AUTH_SERVICE_NAME"', f'AUTH_SERVICE_PATH="{systemd_dir}/$AUTH_SERVICE_NAME"')
            harness_script.write_text(body, encoding="utf-8")
            harness_script.chmod(0o755)

            env = dict(**os.environ)
            env["PATH"] = f"{stub_bin}:{env.get('PATH', '')}"
            env["TONO_HY2_SETTLE_SEC"] = "0"
            if mode == "chmod_fail":
                env["STUB_CHMOD_FAIL"] = "1"
            res = subprocess.run(["bash", str(harness_script), "set-bandwidth", *args], capture_output=True, text=True, env=env)
            log = log_file.read_text(encoding="utf-8") if log_file.exists() else ""
            # Read residual state before temp cleanup.
            leftovers = [p.name for p in current_dir.iterdir() if ".bw." in p.name or ".bak." in p.name]
            final_conf = conf.read_text(encoding="utf-8")
            return res, conf, json.dumps({"log": log, "leftovers": leftovers, "final_conf": final_conf})

    def test_set_bandwidth_transactions_rollback_noop_and_dry_run(self) -> None:
        # 1. Happy path + xray PID + no temp leaks.
        res, _, meta_raw = self._run_set_bandwidth_harness(
            SAMPLE_WITH_BW, ["--ignore-client-bandwidth", "true", "--up-mbps", "600"]
        )
        meta = json.loads(meta_raw)
        self.assertEqual(0, res.returncode, res.stderr)
        out = json.loads(res.stdout)
        self.assertTrue(out["changed"])
        self.assertTrue(out["serverCapAboveClientCatalogMax"])
        self.assertEqual(4242, out["xrayPid"])
        self.assertEqual([], meta["leftovers"])
        self.assertIn("up: 600 mbps", meta["final_conf"])

        # 2. systemctl restart fails -> rollback restores original config and verifies healthy.
        res_rf, _, meta_rf = self._run_set_bandwidth_harness(
            SAMPLE_WITH_BW, ["--down-mbps", "200"], mode="restart_fail_first"
        )
        meta_rf = json.loads(meta_rf)
        self.assertEqual(1, res_rf.returncode)
        self.assertIn("restored previous config and verified healthy", res_rf.stderr)
        self.assertEqual(SAMPLE_WITH_BW, meta_rf["final_conf"])
        self.assertIn("systemctl reset-failed tono-hy2.service", meta_rf["log"])
        self.assertEqual([], meta_rf["leftovers"])

        # 3. chmod fails after live swap -> rollback restores original config and verifies healthy.
        res_cf, _, meta_cf = self._run_set_bandwidth_harness(
            SAMPLE_WITH_BW, ["--down-mbps", "200"], mode="chmod_fail"
        )
        meta_cf = json.loads(meta_cf)
        self.assertEqual(1, res_cf.returncode)
        self.assertIn("restored previous config and verified healthy", res_cf.stderr)
        self.assertEqual(SAMPLE_WITH_BW, meta_cf["final_conf"])

        # 4. Health check fails AND rollback fails -> exit 2 and preserve backup file.
        res_ff, _, meta_ff = self._run_set_bandwidth_harness(
            SAMPLE_WITH_BW, ["--down-mbps", "200"], mode="health_fail_rollback_fail"
        )
        meta_ff = json.loads(meta_ff)
        self.assertEqual(2, res_ff.returncode)
        self.assertIn("rollback also failed", res_ff.stderr)
        self.assertTrue(any(".bak." in name for name in meta_ff["leftovers"]))

        # 5. No-op and --dry-run never restart tono-hy2.
        res_noop, _, meta_noop = self._run_set_bandwidth_harness(
            SAMPLE_WITH_BW, ["--ignore-client-bandwidth", "false", "--up-mbps", "500"]
        )
        self.assertEqual(0, res_noop.returncode, res_noop.stderr)
        self.assertNotIn("systemctl restart", json.loads(meta_noop)["log"])

        res_dry, _, meta_dry = self._run_set_bandwidth_harness(
            SAMPLE_WITH_BW, ["--dry-run", "--down-mbps", "250"]
        )
        self.assertEqual(0, res_dry.returncode, res_dry.stderr)
        self.assertTrue(json.loads(res_dry.stdout)["dryRun"])
        self.assertNotIn("systemctl restart", json.loads(meta_dry)["log"])
        self.assertEqual(SAMPLE_WITH_BW, json.loads(meta_dry)["final_conf"])


if __name__ == "__main__":
    unittest.main()
