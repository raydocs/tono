#!/usr/bin/env python3
"""Unit tests for the collector. No network, no SSH."""
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


class ProbeTargetTests(unittest.TestCase):
    def test_mainland_probe_skips_a_reported_ip_that_is_not_a_public_ip(self):
        ran: list[object] = []
        agents = [{"name": "ct", "host": "192.0.2.10", "password": "x"}]
        with mock.patch("subprocess.run", lambda cmd, **_kw: ran.append(cmd)), \
                mock.patch.object(collect, "log", lambda _msg: None):
            result = collect.probe_cn_agents("unknown", agents, port=443)
        self.assertEqual(ran, [])
        self.assertIsNone(result)


class RemoteQualityScriptTests(unittest.TestCase):
    def test_node_tools_are_digest_pinned_and_github_only(self) -> None:
        captured: dict[str, str] = {}

        def fake_run(cmd, input=None, **kwargs):  # noqa: A002
            captured["script"] = input
            # A digest mismatch leaves the tool absent, so the script reports missing.
            stdout = "===SECURITY_CHECK===\nmissing\n===BACKTRACE===\nmissing\n===END===\n"
            return subprocess.CompletedProcess(cmd, 0, stdout=stdout, stderr="")

        node = {"name": "n1", "host": "192.0.2.10", "password": "x"}
        with mock.patch.object(collect.subprocess, "run", side_effect=fake_run):
            result = collect.run_on_node_via_ssh(node)

        # A missing securityCheck is not evidence of a clean IP.
        self.assertEqual(result["quality"], "unknown")

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


class MainlandAgentTests(unittest.TestCase):
    """Only a dial that ran on the agent is evidence; an agent proves its own path first."""

    AGENTS = [
        {"name": "ct", "host": "198.51.100.1", "password": "x"},
        {"name": "cu", "host": "198.51.100.2", "password": "x"},
        {"name": "cm", "host": "198.51.100.3", "password": "x"},
    ]
    ALL = ("198.51.100.1", "198.51.100.2", "198.51.100.3")

    @staticmethod
    def _run(by_host: dict):
        def fake_run(cmd, **_kw):
            host = next(a for a in cmd if a.startswith("root@"))[len("root@"):]
            out = by_host[host]
            if isinstance(out, Exception):
                raise out
            rc, stdout, stderr = out
            return subprocess.CompletedProcess(cmd, rc, stdout=stdout, stderr=stderr)
        return fake_run

    def _quiet(self, by_host: dict):
        return (
            mock.patch.object(collect.subprocess, "run", side_effect=self._run(by_host)),
            mock.patch.object(collect.time, "sleep", lambda _s: None),
            mock.patch.object(collect, "log", lambda _msg: None),
        )

    def probe(self, by_host: dict, agents: list[dict] | None = None):
        run, sleep, log = self._quiet(by_host)
        with run, sleep, log:
            return collect.probe_cn_agents("1.0.0.1", agents or self.AGENTS, port=443)

    def test_ssh_that_never_dials_is_not_evidence(self):
        timed_out = (255, "", "ssh: connect to host 198.51.100.1 port 22: Connection timed out\n")
        refused = (255, "", "ssh: connect to host 198.51.100.2 port 22: Connection refused\n")
        denied = (5, "", "Permission denied, please try again.\n")
        result = self.probe({"198.51.100.1": timed_out, "198.51.100.2": refused, "198.51.100.3": denied})
        self.assertIsNone(result)

    def test_ssh_timeout_exception_is_not_evidence(self):
        exc = subprocess.TimeoutExpired(cmd="ssh", timeout=25)
        self.assertIsNone(self.probe({host: exc for host in self.ALL}))

    def test_a_dial_that_ran_and_failed_is_a_blocked_vote(self):
        failed = (0, "EXIT:1\n", "")
        result = self.probe({host: failed for host in self.ALL})
        self.assertEqual(
            (result["status"], result["ok"], result["fail"], result["total"]),
            ("LIKELY_BLOCKED", 0, 3, 3),
        )

    def test_agents_that_did_not_dial_leave_the_verdict_to_the_rest(self):
        result = self.probe({
            "198.51.100.1": (255, "", "ssh: connect to host 198.51.100.1 port 22: Connection timed out\n"),
            "198.51.100.2": (0, "EXIT:0\n", ""),
            "198.51.100.3": (0, "EXIT:0\n", ""),
        })
        self.assertEqual((result["status"], result["total"]), ("OK", 2))
        self.assertEqual(result["detail"]["ct"]["error"], "probe_did_not_run")
        self.assertFalse(result["detail"]["ct"]["ok"])

    def test_host_key_failure_is_still_reported_as_such(self):
        result = self.probe({
            "198.51.100.1": (255, "", collect.HOST_KEY_FAILED + "\n"),
            "198.51.100.2": (0, "EXIT:1\n", ""),
            "198.51.100.3": (0, "EXIT:1\n", ""),
        })
        self.assertEqual(result["detail"]["ct"]["error"], "host_key_unverified")
        self.assertEqual(result["total"], 2)

    def test_canary_drops_the_agents_that_cannot_reach_it(self):
        by_host = {
            "198.51.100.1": (0, "EXIT:0\n", ""),
            "198.51.100.2": (0, "EXIT:1\n", ""),
            "198.51.100.3": (255, "", "ssh: connect to host 198.51.100.3 port 22: Connection timed out\n"),
        }
        run, sleep, log = self._quiet(by_host)
        with run, sleep, log:
            healthy = collect.healthy_cn_agents(self.AGENTS)
        self.assertEqual([agent["name"] for agent in healthy], ["ct"])

    def test_canary_dial_targets_the_canary_not_a_node(self):
        seen: list[str] = []

        def fake_run(cmd, **_kw):
            seen.append(cmd[-1])
            return subprocess.CompletedProcess(cmd, 0, stdout="EXIT:0\n", stderr="")

        with mock.patch.object(collect.subprocess, "run", side_effect=fake_run), \
                mock.patch.object(collect.time, "sleep", lambda _s: None):
            collect.healthy_cn_agents(self.AGENTS[:1], "203.0.113.5", 8443)
        self.assertIn("203.0.113.5 8443", seen[0])

    def test_no_healthy_agent_means_no_mainland_verdict_with_the_reason(self):
        block = collect.classify_block(
            None,
            {"ok": True, "rate": 1.0, "total": 3, "success": 3},
            {"ok": True, "rate": 1.0},
            mainland_note="大陆探针全部未通过自检（连不上 canary）；本轮不判定被墙",
        )
        self.assertNotEqual(block["status"], "LIKELY_BLOCKED")
        self.assertEqual(block["mainland"]["status"], "UNPROBED")
        self.assertIn("自检", block["mainland"]["note"])
