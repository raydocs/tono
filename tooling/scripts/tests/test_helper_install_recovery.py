#!/usr/bin/env python3
"""Run production backup/restore functions on temporary files, never launchd."""
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
SOURCE = Path(os.environ.get('TONO_INSTALL_RECOVERY_SOURCE', ROOT / 'tooling/scripts/test-helper-install-lifecycle.sh')).read_text()
FUNCTIONS = []
for name in ('backup_one', 'restore_one', 'restore'):
    match = re.search(r'^' + name + r'\(\) \{\n.*?^\}', SOURCE, re.M | re.S)
    FUNCTIONS.append(match.group() if match else name + '() { return 127; }')
FUNCTIONS = '\n'.join(FUNCTIONS).replace('/bin/launchctl', '"$fake_launchctl"')
assert '/bin/launchctl' not in FUNCTIONS

@unittest.skipUnless(sys.platform == 'darwin', 'uses macOS stat metadata format')
class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tono-install-recovery-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.backup = self.root / 'backup'
        self.backup.mkdir()
        self.targets = {}
        for name in ('helper', 'mihomo', 'uid', 'plist'):
            target = self.root / ('installed-' + name)
            target.write_text('original-' + name)
            target.chmod(0o640)
            self.targets[name] = target
            saved = self.backup / name
            saved.write_bytes(target.read_bytes())
            saved.chmod(0o640)
        fake = self.root / 'fake-launchctl'
        fake.write_text('#!/bin/sh\ncase "$1" in\nbootout) exit "${FAIL_BOOTOUT:-0}";;\nbootstrap) exit "${FAIL_BOOTSTRAP:-0}";;\n*) exit 0;;\nesac\n')
        fake.chmod(0o700)
        values = {'backup': str(self.backup), 'was_loaded': 'yes', 'label': 'test-only', 'fake_launchctl': str(fake)}
        values.update({name + '_path': str(path) for name, path in self.targets.items()})
        self.setup = '\n'.join(k + '=' + shlex.quote(v) for k, v in values.items())

    def run_shell(self, command, **env):
        return subprocess.run(['/bin/zsh', '-c', self.setup + '\n' + FUNCTIONS + '\n' + command],
                              env={**os.environ, **env}, capture_output=True, text=True)

    def candidate_files(self):
        for path in self.targets.values():
            path.write_text('candidate')
            path.chmod(0o600)

    def test_failed_backup_preserves_original(self):
        blocker = self.root / 'blocker'
        blocker.write_text('not a directory')
        result = self.run_shell('backup_one "$helper_path" ' + shlex.quote(str(blocker / 'saved')))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.targets['helper'].read_text(), 'original-helper')

    def test_missing_backup_is_not_proof_of_original_absence(self):
        (self.backup / 'helper').unlink()
        result = self.run_shell('restore_one "$helper_path" "$backup/helper"')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.targets['helper'].read_text(), 'original-helper')

    def test_explicit_absence_can_remove_a_new_file(self):
        (self.backup / 'helper').unlink()
        self.targets['helper'].unlink()
        result = self.run_shell('backup_one "$helper_path" "$backup/helper" && print candidate > "$helper_path" && restore_one "$helper_path" "$backup/helper"')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.targets['helper'].exists())

    def test_bootout_failure_keeps_candidate_and_backup(self):
        self.candidate_files()
        result = self.run_shell('restore', FAIL_BOOTOUT='17')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.targets['helper'].read_text(), 'candidate')
        self.assertTrue((self.backup / 'helper').exists())

    def test_bootstrap_failure_keeps_recovery_material(self):
        self.candidate_files()
        result = self.run_shell('restore', FAIL_BOOTSTRAP='17')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.backup / 'helper').exists())
        self.assertEqual(self.targets['helper'].read_text(), 'original-helper')

    def test_success_restores_bytes_modes_and_removes_backup(self):
        self.candidate_files()
        result = self.run_shell('restore')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.backup.exists())
        for name, path in self.targets.items():
            self.assertEqual(path.read_text(), 'original-' + name)
            self.assertEqual(path.stat().st_mode & 0o777, 0o640)

    def test_token_cannot_precede_successful_restoration(self):
        token = SOURCE.index('print "  bundle token: $token"')
        self.assertIn('trap - EXIT\nrestore || exit 1\n', SOURCE[:token])

if __name__ == '__main__':
    unittest.main()
