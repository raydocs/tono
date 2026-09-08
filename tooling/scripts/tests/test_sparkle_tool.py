#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('sparkle_tool', Path(__file__).resolve().parents[1] / 'find-sparkle-sign-update.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class SparkleToolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def file(self, relative, mode=0o700):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('fixture, never executed')
        path.chmod(mode)
        return path

    def test_owner_only_executable_is_valid(self):
        modern = self.file('sparkle/Sparkle/bin/sign_update')
        self.assertEqual(tool.find_signer(self.root), modern.resolve())

    def test_legacy_dsa_does_not_compete_with_modern_signer(self):
        self.file('sparkle/Sparkle/bin/old_dsa_scripts/sign_update', 0o755)
        modern = self.file('sparkle/Sparkle/bin/sign_update', 0o755)
        self.assertEqual(tool.find_signer(self.root), modern.resolve())

    def test_legacy_only_is_not_a_modern_signer(self):
        self.file('sparkle/Sparkle/bin/old_dsa_scripts/sign_update')
        with self.assertRaises(ValueError): tool.find_signer(self.root)

    def test_two_modern_artifacts_are_ambiguous(self):
        self.file('old/bin/sign_update')
        self.file('new/bin/sign_update')
        with self.assertRaises(ValueError): tool.find_signer(self.root)

    def test_nonexecutable_is_refused(self):
        self.file('sparkle/Sparkle/bin/sign_update', 0o600)
        with self.assertRaises(ValueError): tool.find_signer(self.root)

    def test_missing_artifacts_are_refused(self):
        with self.assertRaises(ValueError): tool.find_signer(self.root / 'missing')


if __name__ == '__main__':
    unittest.main()
