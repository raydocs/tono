"""verify-macos-notarization.sh refuses an app whose notarization ticket is missing.

Stub xcrun/spctl on PATH; no Apple tools, signing or network.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'verify-macos-notarization.sh'


class NotarizationTicketTests(unittest.TestCase):
    def test_missing_stapled_ticket_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            stubs = root / 'bin'
            stubs.mkdir()
            app = root / 'Tono.app'
            (app / 'Contents').mkdir(parents=True)
            (stubs / 'spctl').write_text('#!/bin/sh\nexit 0\n')
            (stubs / 'spctl').chmod(0o755)
            env = {**os.environ, 'PATH': f'{stubs}:/usr/bin:/bin'}

            def run(stapler_status):
                (stubs / 'xcrun').write_text(
                    '#!/bin/sh\n'
                    f'[ "$1 $2" = "stapler validate" ] && exit {stapler_status}\n'
                    'exit 99\n')
                (stubs / 'xcrun').chmod(0o755)
                return subprocess.run(['/bin/sh', str(SCRIPT), str(app)], env=env,
                                      capture_output=True, text=True)

            # Control: with a valid ticket the same fixture passes.
            self.assertEqual(run(0).returncode, 0)
            result = run(65)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('no valid stapled notarization ticket', result.stderr)


if __name__ == '__main__':
    unittest.main()
