#!/usr/bin/env python3
"""Exercise argument refusal before the lifecycle runner's privileged work."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "test-helper-install-lifecycle.sh"
ZSH = os.environ.get("TONO_TEST_ZSH_PATH", "/bin/zsh")


class InstallArgumentsTests(unittest.TestCase):
    def test_missing_option_value_exits_instead_of_repeating_shift(self):
        def refused(option):
            with tempfile.TemporaryFile() as errors:
                result = subprocess.run(
                    [ZSH, "-f", str(SCRIPT), option],
                    stdout=subprocess.DEVNULL, stderr=errors, timeout=2,
                )
                errors.seek(0)
                message = errors.read(4096).decode()
            self.assertEqual(result.returncode, 2, option)
            self.assertIn("usage:", message)
            self.assertNotIn("shift count", message)

        refused("--app")
        refused("--script")
        refused("--expect-version")


if __name__ == "__main__":
    unittest.main()
