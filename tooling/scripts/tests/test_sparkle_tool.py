#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import tempfile
import os
import subprocess
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


ROOT = Path(__file__).resolve().parents[3]


class LocalReleaseSignerTests(unittest.TestCase):
    def test_finds_the_pinned_offline_signer_with_an_empty_app_package_graph(self):
        project = (ROOT / 'apps/macos/Tono.xcodeproj/project.pbxproj').read_text()
        self.assertNotIn('XCRemoteSwiftPackageReference', project)
        source = (ROOT / 'tooling/scripts/release-macos.sh').read_text()
        block = source.split('sparkle_version=2.9.6', 1)[1].split('named="$out/$archive_name"', 1)[0]
        block = 'sparkle_version=2.9.6' + block
        # Replace platform commands with offline adapters. The real finder and
        # production shell selection run; no build/release entry point runs.
        for name in ('xcodebuild', 'curl', 'shasum', 'ditto', 'codesign'):
            block = block.replace('/usr/bin/' + name, name)
        with tempfile.TemporaryDirectory(prefix='tono-local-signer-') as directory:
            adapters = r'''
set -uo pipefail
print() { printf '%s\n' "$*"; }
fail() { printf '%s\n' "$*" >&2; exit 1; }
xcodebuild() { touch "$out/used-app-package-graph"; }
curl() {
  printf '%s\n' "$@" > "$out/download-arguments"
  while [ "$#" -gt 0 ]; do
    if [ "$1" = --output ]; then shift; printf 'fixture archive' > "$1"; return 0; fi
    shift
  done
  return 1
}
shasum() {
  [ "$*" = '-a 256 -c -' ] || return 1
  IFS= read -r receipt
  [ "$receipt" = "8d5fb41d960b43f4a68aa14126bf62b098544ec8d191cdcc73eb14e63a8e7606  $sparkle_archive" ] || return 1
  touch "$out/checked-archive-pin"
}
ditto() {
  [ -f "$out/checked-archive-pin" ] || return 1
  [ "$1 $2" = '-x -k' ] || return 1
  mkdir -p "$4/Sparkle/bin/old_dsa_scripts"
  printf '#!/bin/sh\nexit 0\n' > "$4/Sparkle/bin/sign_update"
  cp "$4/Sparkle/bin/sign_update" "$4/Sparkle/bin/old_dsa_scripts/sign_update"
  chmod 755 "$4/Sparkle/bin/sign_update" "$4/Sparkle/bin/old_dsa_scripts/sign_update"
}
codesign() {
  [ "$1 $2" = '--verify --strict' ] || return 1
  [ -x "$3" ] || return 1
  touch "$out/verified-signer"
}
'''
            result = subprocess.run(
                ['bash', '-c', adapters + block + '\nprintf "%s\\n" "$sign_update"'],
                env={**os.environ, 'repo_root': str(ROOT), 'out': directory},
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            signer = Path(result.stdout.strip().splitlines()[-1])
            self.assertEqual(signer.name, 'sign_update')
            self.assertEqual(signer.parent.name, 'bin')
            self.assertTrue(signer.is_file(), result.stdout + result.stderr)
            self.assertFalse(Path(directory, 'used-app-package-graph').exists())
            self.assertTrue(Path(directory, 'verified-signer').exists())
            arguments = Path(directory, 'download-arguments').read_text().splitlines()
            self.assertIn('https://github.com/sparkle-project/Sparkle/releases/download/2.9.6/Sparkle-for-Swift-Package-Manager.zip', arguments)


if __name__ == '__main__':
    unittest.main()
