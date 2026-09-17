"""Offline unit tests. Mock build info is NOT a real sing-box build/check receipt."""

import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import certify as c


BUILD_INFO = """/tmp/sing-box: go1.27.1
\tpath\tgithub.com/sagernet/sing-box/cmd/sing-box
\tmod\tgithub.com/sagernet/sing-box\t(devel)
\tdep\tgithub.com/sagernet/sing-tun\tv0.9.4-0.20260912075549-869f0a4d76af\th1:synthetic
\tbuild\t-buildmode=exe
\tbuild\t-compiler=gc
\tbuild\t-trimpath=true
\tbuild\t-tags=with_clash_api,with_gvisor,with_quic,with_utls
\tbuild\tCGO_ENABLED=0
\tbuild\tGOOS=linux
\tbuild\tGOARCH=amd64
\tbuild\tGOAMD64=v2
\tbuild\tvcs=git
\tbuild\tvcs.revision=93fff5954390367dd456cad3cbd79be54f8b941f
\tbuild\tvcs.modified=false
"""


class CertificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.fixture = c.read_json(c.M0 / "reference.json")
        self.path = self.root / "fixture.json"

    def reject_fixture(self, code):
        self.path.write_text(json.dumps(self.fixture))
        with self.assertRaisesRegex(c.Refusal, "^" + code + "$"):
            c.synthetic_fixture(self.path)

    def test_frozen_reference_preserves_asymmetric_selection(self):
        fixture = c.synthetic_fixture(c.M0 / "reference.json")
        self.assertEqual(fixture["expected_dial_endpoints"],
                         [{"host": "9.9.9.9", "port": 8443, "transport": "tcp"}])
        self.assertEqual(fixture["windows_runtime"]["outbounds"][2]["outbounds"],
                         ["Fixture Beta", "Fixture Alpha"])
        self.assertNotIn("flow", fixture["windows_runtime"]["outbounds"][1])
        self.assertEqual(c.pins()["source"]["patches"], [])

    def test_empty_home_key_is_still_a_requirement(self):
        self.fixture["input"]["catalog_routing"]["homeSocks5"] = ""
        self.reject_fixture("TONO_SINGBOX_UNSUPPORTED_HOME_ROUTE")

    def test_empty_direct_plan_cannot_erase_defaults(self):
        self.fixture["input"]["direct_plan"] = {}
        self.fixture["input"]["derived_requirements"] = ["nativeAppDirect"]
        self.reject_fixture("TONO_SINGBOX_UNSUPPORTED_POLICY")

    def test_nonempty_policy_is_not_filtered(self):
        self.fixture["input"]["policy_document"]["webDomains"] = ["private.example"]
        self.reject_fixture("TONO_SINGBOX_UNSUPPORTED_POLICY")

    def test_unknown_required_capability_is_not_ignored(self):
        self.fixture["input"]["derived_requirements"] = ["future-required-capability"]
        self.reject_fixture("TONO_SINGBOX_UNSUPPORTED_POLICY")

    def test_unselected_hy2_is_not_filtered(self):
        self.fixture["input"]["nodes"][0]["type"] = "hysteria2"
        self.reject_fixture("TONO_SINGBOX_UNSUPPORTED_TRANSPORT")

    def test_missing_fingerprint_is_not_defaulted(self):
        del self.fixture["input"]["nodes"][1]["client-fingerprint"]
        self.reject_fixture("TONO_SINGBOX_UNSUPPORTED_FINGERPRINT")

    def test_runtime_unknown_fields_and_boolean_type_are_rejected(self):
        self.fixture["windows_runtime"]["inbounds"][0]["auto_route"] = 1
        self.reject_fixture("TONO_SINGBOX_INVALID_FIXTURE")
        self.fixture = c.read_json(c.M0 / "reference.json")
        self.fixture["windows_runtime"]["route"]["unknown"] = "DIRECT"
        self.reject_fixture("TONO_SINGBOX_INVALID_FIXTURE")

    def test_json_duplicate_keys_do_not_override_protection(self):
        self.path.write_bytes(b'{"secret":"do-not-log", "secret":"replacement"}')
        with self.assertRaisesRegex(c.Refusal, "^TONO_SINGBOX_INVALID_JSON$"):
            c.read_json(self.path)

    def test_json_hash_binds_bytes_not_reserialized_object(self):
        self.path.write_bytes(b'{"a":1}\n')
        digest = hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.assertEqual(c.read_json(self.path, digest), {"a": 1})
        self.path.write_bytes(b'{ "a": 1 }\n')
        with self.assertRaisesRegex(c.Refusal, "^TONO_SINGBOX_HASH_MISMATCH$"):
            c.read_json(self.path, digest)

    def test_output_symlink_cannot_stage_in_product_tree(self):
        link = self.root / "product"
        link.symlink_to(c.ROOT, target_is_directory=True)
        with self.assertRaisesRegex(c.Refusal, "^TONO_SINGBOX_INVALID_OUTPUT$"):
            c.external_directory(link / "unexpected-m1-output")
        self.assertEqual(c.external_directory(self.root / "new-output"), self.root / "new-output")

    def test_build_info_rejects_wrong_architecture_and_extra_tags(self):
        candidate = c.pins()
        target = c.target_for(candidate, "linux-amd64-v2")
        with patch.object(c, "command", return_value=BUILD_INFO) as cmd:
            identity = c.build_info(Path("/go"), Path("/core"), candidate, target)
            self.assertEqual(identity["settings"]["GOAMD64"], "v2")
            cmd.return_value = BUILD_INFO.replace("GOAMD64=v2", "GOAMD64=v1")
            with self.assertRaisesRegex(c.Refusal, "^TONO_SINGBOX_BUILD_IDENTITY_MISMATCH$"):
                c.build_info(Path("/go"), Path("/core"), candidate, target)
            cmd.return_value = BUILD_INFO.replace("with_utls", "with_utls,with_extra")
            with self.assertRaises(c.Refusal):
                c.build_info(Path("/go"), Path("/core"), candidate, target)

    def test_source_dirty_or_module_drift_is_rejected(self):
        candidate = c.pins()
        with patch.object(c, "command", side_effect=[candidate["source"]["commit"], "?? ignored.go"]):
            with self.assertRaisesRegex(c.Refusal, "^TONO_SINGBOX_SOURCE_DIRTY$"):
                c.source_identity(self.root, candidate)
        (self.root / "go.mod").write_text("module modified")
        with patch.object(c, "command", side_effect=[candidate["source"]["commit"], "", "H go.mod"]):
            with self.assertRaisesRegex(c.Refusal, "^TONO_SINGBOX_MODULE_MISMATCH$"):
                c.source_identity(self.root, candidate)

    def test_go_version_drift_and_inherited_flags_cannot_change_build(self):
        with patch.object(c, "command", return_value="go version go1.27.2 linux/amd64"):
            with self.assertRaisesRegex(c.Refusal, "^TONO_SINGBOX_TOOLCHAIN_MISMATCH$"):
                c.go_identity(Path("/go"), c.pins())
        with patch.dict(c.os.environ, GOFLAGS="-tags=unsafe", GOOS="windows", GOAMD64="v4", GOWORK="/bad"):
            env = c.clean_env(Path("/go"), c.target_for(c.pins(), "darwin-arm64"))
            self.assertEqual((env["GOOS"], env["GOARCH"], env["GOFLAGS"], env["GOWORK"]),
                             ("darwin", "arm64", "", "off"))
            self.assertNotIn("GOAMD64", env)
            self.assertEqual(env["GOPROXY"], "off")

    def test_build_manifest_and_tampered_binary_verification(self):
        args = SimpleNamespace(source=self.root / "source", go=Path("/trusted/go"),
                               output=self.root / "build", target="linux-amd64-v2")
        calls = []

        def fake_command(argv, **kwargs):
            calls.append((argv, kwargs))
            if argv[1] == "build":
                Path(argv[argv.index("-o") + 1]).write_bytes(b"synthetic-not-a-core")
            return ""

        with patch.object(c, "go_identity"), patch.object(c, "source_identity"), \
                patch.object(c, "build_info", return_value={"synthetic": True}), \
                patch.object(c, "command", side_effect=fake_command):
            result = c.build(args)
            self.assertEqual(calls[1][0][2:5], ["-mod=readonly", "-trimpath", "-buildvcs=true"])
            self.assertEqual(calls[1][1]["env"]["GOAMD64"], "v2")
            self.assertEqual(calls[1][0][-1], "./cmd/sing-box")
            args.manifest = args.output / "manifest.json"
            args.manifest_sha256 = result["manifest_sha256"]
            args.binary = args.output / "sing-box"
            self.assertEqual(c.verify(args)["status"], "identity-verified-not-qualified")
            args.binary.write_bytes(b"changed-binary")
            with self.assertRaisesRegex(c.Refusal, "^TONO_SINGBOX_HASH_MISMATCH$"):
                c.verify(args)
            args.binary.write_bytes(b"synthetic-not-a-core")
            args.target = "windows-amd64-v2"
            with self.assertRaisesRegex(c.Refusal, "^TONO_SINGBOX_BUILD_IDENTITY_MISMATCH$"):
                c.verify(args)

    def test_watchdog_and_redacted_failure_never_become_success(self):
        with self.assertRaisesRegex(c.Refusal, "^TONO_SINGBOX_TIMEOUT$"):
            c.command([sys.executable, "-c", "import time; time.sleep(5)"], seconds=0.05)
        stdout = io.StringIO()
        argv = ["certify", "build", "--go", "/missing", "--source", "/missing",
                "--target", "linux-amd64-v2", "--output", str(self.root / "out")]

        def rejected(_):
            c.command([sys.executable, "-c", "import sys; print('secret-and-UUID'); sys.exit(1)"])

        with patch.object(sys, "argv", argv), patch.object(c, "build", side_effect=rejected), \
                contextlib.redirect_stdout(stdout):
            self.assertEqual(c.main(), 1)
        self.assertEqual(json.loads(stdout.getvalue()),
                         {"ok": False, "error": "TONO_SINGBOX_COMMAND_REJECTED"})
        self.assertNotIn("secret-and-UUID", stdout.getvalue())

    def test_check_receipt_redacts_runtime_and_cleans_staging_on_failure(self):
        binary = self.root / "core"
        binary.write_bytes(b"not-executed-unit-test-only")
        args = SimpleNamespace(fixture=c.M0 / "reference.json", binary=binary,
                               output=self.root / "check", target="linux-amd64-v2")
        captured = []

        def fake_check(argv, **kwargs):
            self.assertEqual(argv[1:3], ["check", "-c"])
            raw = argv[3].read_bytes()
            captured.append(raw)
            runtime = json.loads(raw)
            self.assertEqual(runtime["route"]["rules"][0], {"ip_version": 6, "action": "reject"})
            if kwargs.get("expected_exit") == 1:
                self.assertEqual(runtime["outbounds"][0]["tls"]["reality"]["public_key"], "invalid")
                return "invalid public_key"
            return ""

        with patch.object(c, "verify", return_value={"binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest()}), \
                patch.object(c, "command", side_effect=fake_check):
            report = c.check(args)
        self.assertEqual(report["checks"][0]["runtime_sha256"], hashlib.sha256(captured[0]).hexdigest())
        self.assertNotEqual(report["checks"][0]["runtime_sha256"], report["checks"][1]["runtime_sha256"])
        self.assertEqual(json.loads(captured[1])["inbounds"][0]["interface_name"], "utun199")
        self.assertEqual(list(args.output.iterdir()), [args.output / "check.json"])
        text = (args.output / "check.json").read_text()
        self.assertNotIn("AAECAw", text)
        self.assertNotIn("Fixture Beta", text)
        self.assertNotIn("22222222", text)
        args.output = self.root / "failed-check"
        with patch.object(c, "verify", return_value={"binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest()}), \
                patch.object(c, "command", side_effect=c.Refusal("TONO_SINGBOX_COMMAND_REJECTED")):
            with self.assertRaises(c.Refusal):
                c.check(args)
        self.assertEqual(list(args.output.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
