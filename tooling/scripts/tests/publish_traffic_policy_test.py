#!/usr/bin/env python3
"""The traffic-policy publisher must not send the admin token to a caller-supplied origin."""

from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "publish-traffic-policy.mjs"


class PublishTrafficPolicyPin(unittest.TestCase):
    def test_an_unpinned_api_origin_is_refused_before_the_token_is_read(self) -> None:
        refused = subprocess.run(
            ["node", str(SCRIPT), "--policy", "/nonexistent-policy.json", "--api", "https://evil.example"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        self.assertEqual(refused.returncode, 1, refused.stderr)
        self.assertIn("refusing to send the admin token", refused.stderr)
        self.assertNotIn("no admin token", refused.stderr)

        with_userinfo = subprocess.run(
            ["node", str(SCRIPT), "--policy", "/nonexistent-policy.json", "--api", "https://api.afk.ccwu.cc.evil.example"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        self.assertEqual(with_userinfo.returncode, 1, with_userinfo.stderr)
        self.assertIn("refusing to send the admin token", with_userinfo.stderr)

        pinned = subprocess.run(
            ["node", str(SCRIPT), "--policy", "/nonexistent-policy.json"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        self.assertEqual(pinned.returncode, 1, pinned.stderr)
        self.assertNotIn("refusing to send the admin token", pinned.stderr)
        self.assertIn("could not read a policy", pinned.stderr)


if __name__ == "__main__":
    unittest.main()
