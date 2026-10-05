"""Exercise the production metadata writer, not a Swift/build substitute."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'apps/macos/scripts/write-build-source.sh'


class BuildSourceTests(unittest.TestCase):
    def test_sequence_floor_is_a_bounded_build_input(self):
        with tempfile.TemporaryDirectory() as temporary:
            env = dict(os.environ, SRCROOT=str(ROOT / 'apps/macos'),
                       BUILT_PRODUCTS_DIR=temporary,
                       UNLOCALIZED_RESOURCES_FOLDER_PATH='Tono.app/Contents/Resources',
                       CONFIGURATION='Release', TONO_UPDATE_RELEASE_SEQUENCE='9007199254740991')
            output = Path(temporary) / env['UNLOCALIZED_RESOURCES_FOLDER_PATH'] / 'tono-build-source.json'
            subprocess.run(['sh', str(SCRIPT)], env=env, check=True)
            value = json.loads(output.read_text())
            self.assertEqual(value['releaseSequence'], 9007199254740991)
            self.assertEqual(value['commit'], subprocess.check_output(
                ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip())
            env['TONO_UPDATE_RELEASE_SEQUENCE'] = '9007199254740992'
            self.assertNotEqual(subprocess.run(['sh', str(SCRIPT)], env=env,
                                              capture_output=True).returncode, 0)
            env['TONO_UPDATE_RELEASE_SEQUENCE'] = '1.5'
            self.assertNotEqual(subprocess.run(['sh', str(SCRIPT)], env=env,
                                              capture_output=True).returncode, 0)
            env.pop('TONO_UPDATE_RELEASE_SEQUENCE')
            subprocess.run(['sh', str(SCRIPT)], env=env, check=True)
            self.assertIsNone(json.loads(output.read_text())['releaseSequence'])

    def test_rebuilding_the_helper_binary_does_not_mark_the_build_dirty(self):
        # Packaging recompiles the tracked helper binary from tracked sources
        # before the app is built, so every CI build used to record dirty:true.
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary) / 'repo'
            helper = repo / 'apps/macos/Tono/Resources/tono-core-helper'
            source = repo / 'apps/macos/Tono/App.swift'
            helper.parent.mkdir(parents=True)
            helper.write_bytes(b'committed helper')
            source.write_text('// committed\n')
            git = ['git', '-C', str(repo), '-c', 'user.name=t', '-c', 'user.email=t@example.invalid']
            subprocess.run(['git', 'init', '-q', str(repo)], check=True)
            subprocess.run(git + ['add', '-A'], check=True)
            subprocess.run(git + ['commit', '-q', '-m', 'base'], check=True)
            env = dict(os.environ, SRCROOT=str(repo / 'apps/macos'),
                       BUILT_PRODUCTS_DIR=str(Path(temporary) / 'out'),
                       UNLOCALIZED_RESOURCES_FOLDER_PATH='Tono.app/Contents/Resources',
                       CONFIGURATION='Release')
            output = Path(temporary) / 'out/Tono.app/Contents/Resources/tono-build-source.json'

            def dirty():
                subprocess.run(['sh', str(SCRIPT)], env=env, check=True)
                return json.loads(output.read_text())['dirty']

            self.assertIs(dirty(), False)
            helper.write_bytes(b'rebuilt helper')
            self.assertIs(dirty(), False)
            source.write_text('// edited\n')
            self.assertIs(dirty(), True)


if __name__ == '__main__':
    unittest.main()
