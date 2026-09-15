"""Portable contract/static checks. These do not compile or execute Swift."""
import base64
import hashlib
import json
import plistlib
import re
import unittest
import xml.etree.ElementTree as ET

from project import ROOT, generate, identifier

REPO = ROOT.parents[1]


class IOSStaticContracts(unittest.TestCase):
    def test_project_sources_and_embed_graph(self):
        outputs, objects = generate()
        for path, expected in outputs.items():
            self.assertEqual((ROOT / path).read_text(), expected, f"Regenerate {path}")
        targets = {v["name"]: v for v in objects.values() if v["isa"] == "PBXNativeTarget"}
        self.assertEqual(set(targets), {"Tono", "PacketTunnel", "TonoTests", "TonoUITests"})
        for name, target in targets.items():
            source_phase = next(objects[p] for p in target["buildPhases"] if objects[p]["isa"] == "PBXSourcesBuildPhase")
            paths = [objects[objects[f]["fileRef"]]["path"] for f in source_phase["files"]]
            self.assertTrue(paths)
            self.assertEqual(len(paths), len(set(paths)))
            self.assertTrue(all((ROOT / p).is_file() for p in paths))
            if name == "PacketTunnel":
                self.assertFalse(any(p.startswith("App/") for p in paths))
                self.assertIn("Shared/Protection.swift", paths)
            if name == "TonoTests":
                self.assertIn("Tests/AppModelTests.swift", paths)
                resources = next(objects[p] for p in target["buildPhases"] if objects[p]["isa"] == "PBXResourcesBuildPhase")
                resource_paths = [objects[objects[f]["fileRef"]]["path"] for f in resources["files"]]
                self.assertIn("Tests/Fixtures/admission.json", resource_paths)
            for config in objects[target["buildConfigurationList"]]["buildConfigurations"]:
                settings = objects[config]["buildSettings"]
                if objects[config]["name"] == "Release":
                    self.assertNotIn("DEBUG", settings.get("SWIFT_ACTIVE_COMPILATION_CONDITIONS", ""))
        embed = objects[identifier("embed-phase")]
        self.assertEqual(embed["dstSubfolderSpec"], 13)
        self.assertEqual(objects[objects[embed["files"][0]]["fileRef"]]["path"], "PacketTunnel.appex")
        self.assertFalse(any(o["isa"] == "PBXShellScriptBuildPhase" for o in objects.values()))
        scheme = ET.fromstring(outputs["Tono.xcodeproj/xcshareddata/xcschemes/Tono.xcscheme"])
        self.assertEqual(len(scheme.findall(".//TestableReference[@skipped='NO']")), 2)
        self.assertEqual(objects[identifier("project/Release")]["buildSettings"]["IPHONEOS_DEPLOYMENT_TARGET"], "26.0")

    def test_bundle_ids_app_group_and_extension_match(self):
        with (ROOT / "Configuration/App.entitlements").open("rb") as f:
            app = plistlib.load(f)
        with (ROOT / "Configuration/PacketTunnel.entitlements").open("rb") as f:
            extension = plistlib.load(f)
        self.assertEqual(app, extension)
        self.assertEqual(app["com.apple.security.application-groups"], ["group.com.ninx.tono"])
        self.assertEqual(app["com.apple.developer.networking.networkextension"], ["packet-tunnel-provider"])
        _, objects = generate()
        self.assertEqual(objects[identifier("Tono/Release")]["buildSettings"]["PRODUCT_BUNDLE_IDENTIFIER"], "com.ninx.tono")
        self.assertEqual(objects[identifier("PacketTunnel/Release")]["buildSettings"]["PRODUCT_BUNDLE_IDENTIFIER"], "com.ninx.tono.PacketTunnel")
        with (ROOT / "Configuration/PacketTunnel-Info.plist").open("rb") as f:
            info = plistlib.load(f)
        self.assertEqual(info["NSExtension"]["NSExtensionPointIdentifier"], "com.apple.networkextension.packet-tunnel")

    def test_build_identity_matches_frozen_candidate_without_relabeling_desktop(self):
        requirement = json.loads((ROOT / "Configuration/core-requirement.json").read_text())
        candidate = json.loads((REPO / "docs/reports/sing-box-evaluation/migration-m0/candidate.json").read_text())
        self.assertEqual(requirement["upstream_commit"], candidate["source"]["commit"])
        for key in ("go_version", "cgo_enabled", "tags"):
            self.assertEqual(requirement[key], candidate["build"][key])
        for key in ("patches", "go_mod_sha256", "go_sum_sha256"):
            self.assertEqual(requirement[key], candidate["source"][key])
        self.assertIsNone(requirement["ios_artifact_sha256"])
        self.assertIsNone(requirement["ios_abi"])
        swift = (ROOT / "Shared/Admission.swift").read_text()
        self.assertIn(requirement["upstream_commit"], swift)
        self.assertIn(requirement["go_version"], swift)
        for tag in requirement["tags"]:
            self.assertIn(f'"{tag}"', swift)

    def test_policy_key_and_signed_byte_context_match_existing_client(self):
        swift = (ROOT / "Shared/Admission.swift").read_text()
        mac = (REPO / "apps/macos/Tono/Core/ManagedTrafficPolicySignature.swift").read_text()
        key = re.search(r'static let publicKey = "([^"]+)"', swift).group(1)
        self.assertIn(f'"{key}"', mac)
        context = re.search(r'static let context = "([^"]+)"', swift).group(1)
        self.assertIn(f'"{context}"', mac)
        fixture = json.loads((ROOT / "Tests/Fixtures/admission.json").read_text())
        for envelope, field in ((fixture["catalog"], "yaml"), (fixture["policy"], "json")):
            digest = base64.urlsafe_b64encode(hashlib.sha256(envelope[field].encode()).digest()).decode().rstrip("=")
            self.assertEqual(digest, envelope["sha256"])

    def test_absent_core_cannot_install_profile_or_complete_tunnel_start(self):
        controller = (ROOT / "App/TunnelController.swift").read_text()
        controller = controller.split("final class TunnelController", 1)[1]
        start = controller.split("func start(", 1)[1].split("func pause()", 1)[0]
        self.assertIn("try SingBoxIdentity.requireEmbeddedCore()", start)
        self.assertNotIn("saveToPreferences", start)
        self.assertNotIn("startVPNTunnel", start)
        provider = (ROOT / "PacketTunnel/PacketTunnelProvider.swift").read_text()
        start = provider.split("override func startTunnel", 1)[1].split("override func stopTunnel", 1)[0]
        self.assertIn("completionHandler(NSError", start)
        self.assertNotIn("completionHandler(nil)", start)
        self.assertNotIn("setTunnelNetworkSettings", provider)
        pause = controller.split("func pause()", 1)[1]
        self.assertLess(pause.index("saveToPreferences"), pause.index("stopVPNTunnel"))

    def test_privacy_declaration_and_no_credential_group_storage(self):
        with (ROOT / "Configuration/PrivacyInfo.xcprivacy").open("rb") as f:
            privacy = plistlib.load(f)
        self.assertFalse(privacy["NSPrivacyTracking"])
        self.assertTrue(all(item["NSPrivacyCollectedDataTypeLinked"] for item in privacy["NSPrivacyCollectedDataTypes"]))
        model = (ROOT / "App/AppModel.swift").read_text()
        written = re.findall(r'forKey: "([^"]+)"', model)
        self.assertLessEqual(set(written), {"diagnosticPolicy", "onDemand", "paused", "selectedLocation"})
        vault = (ROOT / "App/KeychainVault.swift").read_text()
        self.assertIn("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly", vault)
        self.assertIn("kSecAttrSynchronizable as String: false", vault)
        with (ROOT / "Configuration/App-Info.plist").open("rb") as f:
            info = plistlib.load(f)
        self.assertNotIn("NSAppTransportSecurity", info)
        self.assertEqual(info["TonoAPIBaseURL"], "https://api.afk.ccwu.cc")


if __name__ == "__main__":
    unittest.main(verbosity=2)
