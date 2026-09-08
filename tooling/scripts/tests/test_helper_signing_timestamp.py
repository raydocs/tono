"""Execute the Xcode helper signing phase with a fake codesign, never a keychain."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
PROJECT = ROOT / 'apps/macos/Tono.xcodeproj/project.pbxproj'

class HelperSigningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        project = json.loads(subprocess.check_output(['/usr/bin/plutil', '-convert', 'json', '-o', '-', str(PROJECT)]))
        cls.phase = next(v['shellScript'] for v in project['objects'].values()
                         if v.get('name') == 'Pin helper codesign identifier')

    def run_phase(self, allowed, identity):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            helper = root / 'Tono.app/Contents/Resources/tono-core-helper'
            helper.parent.mkdir(parents=True)
            helper.write_text('not an executable')
            fake = root / 'codesign'
            fake.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$SIGNING_ARGS"\n')
            fake.chmod(0o700)
            output = root / 'args'
            env = {**os.environ, 'PATH': tmp + ':' + os.environ['PATH'],
                   'BUILT_PRODUCTS_DIR': tmp, 'CONTENTS_FOLDER_PATH': 'Tono.app/Contents',
                   'CODE_SIGNING_ALLOWED': allowed, 'EXPANDED_CODE_SIGN_IDENTITY': identity,
                   'SIGNING_ARGS': str(output)}
            result = subprocess.run(['/bin/sh', '-eu', '-c', self.phase], env=env, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return output.read_text().splitlines()

    def test_signed_helper_has_secure_timestamp_and_pinned_identifier(self):
        args = self.run_phase('YES', 'fake-test-identity')
        self.assertIn('--timestamp', args)
        self.assertNotIn('--timestamp=none', args)
        self.assertEqual(args[args.index('--identifier') + 1], 'com.raydocs.tono.helper')
        self.assertEqual(args[args.index('--options') + 1], 'runtime')

    def test_unsigned_tests_remain_offline_adhoc(self):
        for allowed, identity in [('NO', 'unused'), ('YES', '-'), ('YES', '')]:
            args = self.run_phase(allowed, identity)
            self.assertEqual(args[args.index('--sign') + 1], '-')
            self.assertNotIn('--timestamp', args)

if __name__ == '__main__':
    unittest.main()
