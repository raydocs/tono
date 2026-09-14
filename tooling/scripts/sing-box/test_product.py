"""Shared contract checks. Optional fixed-core parser checks are not emitter tests."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


class ProductContractTests(unittest.TestCase):
    def test_selected_build_identity_stays_bound_to_unchanged_builder_candidate(self):
        release = json.loads((HERE / "release.json").read_text())
        raw = (HERE / release["build_candidate"]).read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), release["build_candidate_sha256"])
        candidate = json.loads(raw)
        self.assertEqual(candidate["source"]["commit"], release["upstream_commit"])
        self.assertEqual(candidate["build"]["go_version"], release["go_version"])
        self.assertEqual(candidate["build"]["tags"], release["tags"])
        self.assertEqual(candidate["source"]["patches"], release["patches"])
        self.assertEqual(candidate["source"]["go_mod_sha256"], release["go_mod_sha256"])
        self.assertEqual(candidate["source"]["go_sum_sha256"], release["go_sum_sha256"])
        self.assertFalse(release["automatic_fallback"])
        self.assertFalse(release["post_replay"])

    def test_template_scopes_fake_dns_and_never_restores_deprecated_stack(self):
        runtime = json.loads((HERE / "runtime-template.json").read_text())
        self.assertNotIn("stack", runtime["inbounds"][0])
        self.assertEqual(runtime["inbounds"][0]["dns_mode"], "disabled")
        self.assertFalse(runtime["inbounds"][0]["strict_route"])
        self.assertEqual(runtime["inbounds"][1]["listen"], "127.0.0.1")
        self.assertEqual(runtime["inbounds"][1]["listen_port"], 53)
        self.assertEqual(runtime["dns"]["rules"][1]["inbound"], ["Tono-TUN", "Tono-DNS", "Tono-Mixed"])
        self.assertEqual(runtime["dns"]["final"], "Tono-DoH")
        self.assertEqual(runtime["dns"]["servers"][1]["detour"], "Tono-Exit")

    @unittest.skipUnless(os.environ.get("TONO_SINGBOX_CHECK_BINARY"), "fixed-core parser not requested")
    def test_handwritten_product_shapes_pass_pinned_core_not_a_rust_emitter_receipt(self):
        binary = Path(os.environ["TONO_SINGBOX_CHECK_BINARY"]).resolve()
        release = json.loads((HERE / "release.json").read_text())
        self.assertEqual(hashlib.sha256(binary.read_bytes()).hexdigest(), release["targets"]["linux-amd64-v2"]["binary_sha256"])
        reference = json.loads((ROOT / "docs/reports/sing-box-evaluation/migration-m0/reference.json").read_text())
        runtime = json.loads((HERE / "runtime-template.json").read_text())
        runtime["outbounds"] = copy.deepcopy(reference["windows_runtime"]["outbounds"])
        runtime["experimental"]["clash_api"].update(external_controller="127.0.0.1:29191", secret=reference["input"]["controller_secret"])
        runtime["outbounds"].extend([
            {"type": "direct", "tag": "Tono-China-Direct", "bind_interface": "eth0"},
            {"type": "socks", "tag": "Tono-Home-Residential", "server": "home.example", "server_port": 1080, "version": "5", "username": "fixture", "password": "fixture", "detour": "Tono-Exit"},
            {"type": "hysteria2", "tag": "CA-only-hy2", "server": "8.8.4.4", "server_port": 8444, "password": "fixture", "tls": {"enabled": True, "server_name": "hy2.example"}},
        ])
        runtime["dns"]["servers"].append({"type": "hosts", "tag": "Tono-Hosts", "predefined": {"qq.com": ["101.1.2.3"]}})
        runtime["route"]["rules"].extend([
            {"type": "logical", "mode": "and", "rules": [{"network": "tcp", "port": 443, "domain": ["qq.com"]}, {"ip_cidr": ["101.1.2.3/32"]}], "action": "route", "outbound": "Tono-China-Direct"},
            {"network": "tcp", "process_path_regex": ["^/Applications/Reviewed.app/"], "port": [80, 443], "action": "route", "outbound": "Tono-China-Direct"},
            {"network": ["udp", "icmp"], "action": "reject"},
        ])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runtime.json"
            for interface in ("Tono", "utun199"):
                runtime["inbounds"][0]["interface_name"] = interface
                path.write_text(json.dumps(runtime))
                result = subprocess.run([binary, "check", "-c", path], cwd=directory, capture_output=True, timeout=15)
                self.assertEqual(result.returncode, 0, "fixed core rejected handwritten fixture")
            runtime["outbounds"][0]["tls"]["reality"]["public_key"] = "bad-key"
            path.write_text(json.dumps(runtime))
            result = subprocess.run([binary, "check", "-c", path], cwd=directory, capture_output=True, timeout=15)
            self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
