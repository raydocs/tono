"""verify-macos-notarization.sh checks the Tono.app inside the zip customers download.

Uses the script's test-only TONO_NOTARIZATION_TOOLS_DIR: stub xcrun/spctl, and a
ditto that is the real /usr/bin/ditto on macOS (CI policy-tests) or an unzip
stand-in elsewhere. No signing, notarization or network.
"""
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'verify-macos-notarization.sh'
DITTO = ('#!/bin/sh\nexec /usr/bin/ditto "$@"\n' if Path('/usr/bin/ditto').exists() else
         '#!/bin/sh\n[ "$1 $2" = "-x -k" ] || exit 9\nexec unzip -q "$3" -d "$4"\n')
STUBS = {
    'ditto': DITTO,
    'xcrun': '#!/bin/sh\n[ "$1 $2" = "stapler validate" ] || exit 9\nexit "${STUB_STAPLER:-0}"\n',
    'spctl': '#!/bin/sh\n[ "$1 $2 $3" = "-a -t exec" ] || exit 9\nexit "${STUB_SPCTL:-0}"\n',
}


def write_zip(path, bundle, link=None):
    with zipfile.ZipFile(path, 'w') as archive:
        for name in (f'{bundle}/', f'{bundle}/Contents/'):
            info = zipfile.ZipInfo(name)
            info.create_system, info.external_attr = 3, (stat.S_IFDIR | 0o755) << 16
            archive.writestr(info, '')
        archive.writestr(f'{bundle}/Contents/Info.plist', '<plist/>')
        if link:
            info = zipfile.ZipInfo('Tono.app')
            info.create_system, info.external_attr = 3, (stat.S_IFLNK | 0o755) << 16
            archive.writestr(info, link)


class ShippedZipTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        tools = self.root / 'tools'
        tools.mkdir()
        for name, body in STUBS.items():
            (tools / name).write_text(body)
            (tools / name).chmod(0o755)
        self.env = {**os.environ, 'TONO_NOTARIZATION_TOOLS_DIR': str(tools), 'TMPDIR': str(self.root)}

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, bundle='Tono.app', link=None, **stubs):
        archive = self.root / 'Tono-0.0.75-build75-arm64.zip'
        write_zip(archive, bundle, link)
        return subprocess.run(['/bin/sh', str(SCRIPT), str(archive)], env={**self.env, **stubs},
                              capture_output=True, text=True)

    def test_stapled_accepted_zip_passes(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([p.name for p in self.root.iterdir() if p.name.startswith('tono-notarization.')], [])

    def test_zip_without_tono_app_fails(self):
        result = self.run_script(bundle='Other.app')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('does not hold a Tono.app bundle', result.stderr)

    def test_symlinked_tono_app_fails(self):
        result = self.run_script(bundle='Real.app', link='Real.app')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('FATAL', result.stderr)

    def test_missing_stapled_ticket_fails(self):
        result = self.run_script(STUB_STAPLER='65')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('no valid stapled notarization ticket', result.stderr)

    def test_gatekeeper_rejection_fails(self):
        result = self.run_script(STUB_SPCTL='3')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Gatekeeper does not accept', result.stderr)


if __name__ == '__main__':
    unittest.main()
