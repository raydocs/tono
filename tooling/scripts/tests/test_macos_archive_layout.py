"""Exercise the production ZIP writer on fake bundles without signing or network."""
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[3]
SOURCE = (ROOT / 'tooling/scripts/package-macos-test.sh').read_text()
MATCH = re.search(r'^archive_app\(\) \{\n.*?^\}', SOURCE, re.M | re.S)

class ArchiveTests(unittest.TestCase):
    def test_stable_name_and_restapled_bytes(self):
        self.assertIsNotNone(MATCH)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            app = root / 'Tono-0.0.72-build72-arm64.app'
            resource = app / 'Contents/Resources/fixture'
            resource.parent.mkdir(parents=True)
            archive = root / 'Tono-0.0.72-build72-arm64.zip'
            for content in ['signed-before-notarization', 'stapled-after-acceptance']:
                resource.write_text(content)
                archive.unlink(missing_ok=True)
                script = '\n'.join(k + '=' + shlex.quote(str(v)) for k, v in
                                   {'build_root': root, 'artifact_app': app, 'artifact_zip': archive}.items())
                result = subprocess.run(['/bin/sh', '-eu', '-c', script + '\n' + MATCH.group() + '\narchive_app'], capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                with zipfile.ZipFile(archive) as zipped:
                    names = [n for n in zipped.namelist() if not n.startswith('__MACOSX/')]
                    self.assertTrue(names)
                    self.assertTrue(all(n.startswith('Tono.app/') for n in names))
                    self.assertEqual(zipped.read('Tono.app/Contents/Resources/fixture').decode(), content)

    def test_both_submission_and_stapling_use_same_writer(self):
        self.assertEqual(len(re.findall(r'^\s*archive_app$', SOURCE, re.M)), 2)

if __name__ == '__main__':
    unittest.main()
