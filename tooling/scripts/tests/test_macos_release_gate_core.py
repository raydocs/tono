"""The release gate must check exactly the executables the app embeds."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[3]
PBXPROJ = (ROOT / 'apps/macos/Tono.xcodeproj/project.pbxproj').read_text()
GATE = (ROOT / 'tooling/scripts/verify-release-gate.sh').read_text()


class ReleaseGateCoreTests(unittest.TestCase):
    def test_gate_checks_the_embed_executables_phase(self):
        phase = re.search(r'/\* Embed Executables \*/ = \{\n(.*?)\n\t\t\};', PBXPROJ, re.S)
        self.assertIsNotNone(phase)
        # dstSubfolderSpec 7 is the bundle's Resources folder.
        self.assertIn('dstSubfolderSpec = 7;', phase.group(1))
        self.assertIn('dstPath = "";', phase.group(1))
        embedded = sorted(re.findall(r'/\* (\S+) in Embed Executables \*/', phase.group(1)))
        self.assertTrue(embedded)
        gate_list = re.search(r'^for embedded in (.*); do$', GATE, re.M)
        self.assertIsNotNone(gate_list)
        self.assertEqual(sorted(gate_list.group(1).split()),
                         ['Contents/Resources/' + name for name in embedded])


if __name__ == '__main__':
    unittest.main()
