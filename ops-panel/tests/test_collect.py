#!/usr/bin/env python3
"""Unit tests for the quality collector's remote script. No network."""
from __future__ import annotations

import re
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import collect  # noqa: E402


class RemoteQualityScriptTests(unittest.TestCase):
    def test_node_tools_are_digest_pinned_and_github_only(self) -> None:
        captured: dict[str, str] = {}

        def fake_run(cmd, input=None, **kwargs):  # noqa: A002
            captured["script"] = input
            return subprocess.CompletedProcess(cmd, 0, stdout="===END===\n", stderr="")

        node = {"name": "n1", "host": "192.0.2.10", "password": "x"}
        with mock.patch.object(collect.subprocess, "run", side_effect=fake_run):
            collect.run_on_node_via_ssh(node)

        script = captured["script"]
        downloads = re.findall(r'^dl (\S+) "([^"]+)" "([^"]*)"', script, re.M)
        self.assertEqual({name for name, _, _ in downloads}, {"securityCheck", "backtrace"})
        for name, url, digest in downloads:
            self.assertTrue(url.startswith("https://github.com/oneclickvirt/"), url)
            self.assertRegex(digest, r"^[0-9a-f]{64}$", name)
        self.assertIn("sha256sum -c", script)
        self.assertNotIn("cdn.spiritlhl.net", script)
        # Nothing already on the node is trusted without re-checking the digest.
        self.assertNotIn('if [ -x "$f" ] && [ -s "$f" ]; then return 0; fi', script)


if __name__ == "__main__":
    unittest.main()
