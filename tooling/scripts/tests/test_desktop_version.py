import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "desktop_version", Path(__file__).resolve().parents[1] / "verify-desktop-version.py"
)
version = importlib.util.module_from_spec(spec)
spec.loader.exec_module(version)


class DesktopVersionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.write("apps/windows/app/package.json", json.dumps({"version": "0.0.72"}))
        self.write("apps/windows/app/src-tauri/tauri.conf.json", json.dumps({"version": "0.0.72"}))
        self.write("apps/windows/app/src-tauri/Cargo.toml", '[package]\nversion = "0.0.72"\n')
        self.write("apps/windows/app/Cargo.lock", 'version = 4\n[[package]]\nname = "tono-windows"\nversion = "0.0.72"\n')
        self.project = "apps/macos/Tono.xcodeproj/project.pbxproj"
        self.write(self.project, "\n".join(
            self.config(name, "com.raydocs.tono", "0.0.72", "72")
            for name in ("Debug", "Release")
        ) + self.config("Debug", "com.raydocs.tono.tests", "1.0", "1"))

    def write(self, path, text):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)

    @staticmethod
    def config(name, bundle, marketing, build):
        return f'''isa = XCBuildConfiguration;
            buildSettings = {{
                PRODUCT_BUNDLE_IDENTIFIER = {bundle};
                MARKETING_VERSION = {marketing};
                CURRENT_PROJECT_VERSION = {build};
            }};
            name = {name};'''

    def test_checks_all_six_product_surfaces_but_not_test_bundle(self):
        self.assertEqual(len(version.verify(self.root, "0.0.72")), 6)

    def test_detects_windows_manifest_and_lockfile_drift(self):
        for path in ["package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "Cargo.lock"]:
            with self.subTest(path=path):
                file = self.root / "apps/windows/app" / path
                original = file.read_text()
                file.write_text(original.replace("0.0.72", "0.0.71"))
                with self.assertRaisesRegex(ValueError, "disagree"):
                    version.verify(self.root)
                file.write_text(original)

    def test_detects_mac_release_version_and_build_drift(self):
        file = self.root / self.project
        original = file.read_text()
        for old, new in [("MARKETING_VERSION = 0.0.72", "MARKETING_VERSION = 0.0.71"),
                         ("CURRENT_PROJECT_VERSION = 72", "CURRENT_PROJECT_VERSION = 73")]:
            with self.subTest(field=old):
                file.write_text(original.replace(old, new, 1))
                with self.assertRaisesRegex(ValueError, "disagree"):
                    version.verify(self.root)
        file.write_text(original)

    def test_missing_release_configuration_cannot_pass(self):
        self.write(self.project, self.config("Debug", "com.raydocs.tono", "0.0.72", "72"))
        with self.assertRaisesRegex(ValueError, "both macOS"):
            version.verify(self.root)

    def test_matching_but_wrong_candidate_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "expected product version"):
            version.verify(self.root, "0.0.73")

    def test_duplicate_local_cargo_package_is_rejected(self):
        file = self.root / "apps/windows/app/Cargo.lock"
        file.write_text(file.read_text() + '\n[[package]]\nname = "tono-windows"\nversion = "0.0.71"\n')
        with self.assertRaisesRegex(ValueError, "exactly one"):
            version.verify(self.root)


if __name__ == "__main__":
    unittest.main()
