#!/usr/bin/env python3
"""Unit tests for the collector. No network, no SSH."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import collect  # noqa: E402


class ProbeTargetTests(unittest.TestCase):
    def test_mainland_probe_skips_a_reported_ip_that_is_not_a_public_ip(self):
        ran: list[object] = []
        agents = [{"name": "ct", "host": "192.0.2.10", "password": "x"}]
        with mock.patch("subprocess.run", lambda cmd, **_kw: ran.append(cmd)), \
                mock.patch.object(collect, "log", lambda _msg: None):
            result = collect.probe_cn_agents("unknown", agents, port=443)
        self.assertEqual(ran, [])
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
