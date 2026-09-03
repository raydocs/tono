#!/usr/bin/env python3
"""Tests for the fleet audit's two silent answers.

A substring match on the catalog text audits a different node than the one asked
about, and then reports that other machine's Reality credentials as this one's —
green, with no indication anywhere that the wrong entry was read.

And a node that meters nothing passes every other check here, because there was
no check that touched metering. Five nodes carried customer traffic for weeks in
exactly that state.

Run with: python3 tooling/scripts/tests/test_check_node_in_fleet.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "fleet", Path(__file__).resolve().parents[1] / "check-node-in-fleet.py"
)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

# Two nodes whose names share a prefix, plus a proxy group carrying the shorter
# name. All three are real shapes: the fleet has "Los Angeles · Lagoon" and
# "Los Angeles · Lagoon（家宽测试）" today.
#
# The longer name is published first on purpose. A substring search finds it when
# asked for the shorter one, which is the whole defect: the audit then compares
# the wrong machine's Reality credentials and reports them as a match.
CATALOG = """\
port: 7890
proxies:
  - name: "Los Angeles · Mesa Verde"
    type: vless
    server: 179.255.154.18
    port: 8443
    uuid: {{TONO_CLIENT_UUID}}
    servername: www.bing.com
    reality-opts:
      public-key: verde-public-key
      short-id: 8899aabbccddeeff
  - name: "Los Angeles · Mesa"
    type: vless
    server: 179.255.154.17
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    servername: www.bing.com
    reality-opts:
      public-key: mesa-public-key
      short-id: 0011223344556677
proxy-groups:
  - name: "Los Angeles · Mesa"
    type: select
"""

# Nothing orders the keys of a mapping, and publish-managed-catalog.rb ships
# whatever the source held: a node whose first key is `type`, and a node written
# as one flow mapping. An entry recognised only by a leading `- name:` folds both
# into the entry above, and the audit then reports the neighbour's credentials.
UNORDERED_CATALOG = """\
proxies:
  - type: vless
    name: "Tokyo · Kanda"
    server: 179.255.154.20
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    servername: www.bing.com
    reality-opts:
      public-key: kanda-public-key
      short-id: aabbccddeeff0011
  - {name: "Osaka · Namba", type: vless, uuid: {{TONO_CLIENT_UUID}}, port: 8443}
"""


class CatalogLookup(unittest.TestCase):
    def test_a_prefix_name_reads_its_own_entry(self) -> None:
        exact, near = module.catalog_lookup(CATALOG, "Los Angeles · Mesa")
        self.assertEqual(1, len(exact))
        fields = module.catalog_fields(exact[0])
        # The credentials of the shorter-named node, not of the one after it.
        self.assertEqual("mesa-public-key", fields["public-key"])
        self.assertEqual("0011223344556677", fields["short-id"])
        self.assertEqual("443", fields["port"])
        self.assertEqual("{{TONO_CLIENT_UUID}}", fields["uuid"])
        self.assertEqual(["Los Angeles · Mesa Verde"], near)

    def test_the_longer_name_reads_its_own_entry(self) -> None:
        exact, _ = module.catalog_lookup(CATALOG, "Los Angeles · Mesa Verde")
        self.assertEqual("verde-public-key", module.catalog_fields(exact[0])["public-key"])

    def test_a_near_miss_is_reported_rather_than_resolved(self) -> None:
        # The name the operator typed is published nowhere. Auditing whichever
        # entry happens to contain it is how a mismatch between the hub registry
        # and the catalog reads as a healthy node.
        exact, near = module.catalog_lookup(CATALOG, "Los Angeles · Mesa V")
        self.assertEqual([], exact)
        self.assertEqual(["Los Angeles · Mesa", "Los Angeles · Mesa Verde"], near)

    def test_an_unpublished_node_has_no_near_miss(self) -> None:
        self.assertEqual(([], []), module.catalog_lookup(CATALOG, "Tokyo · Sakura"))

    def test_a_proxy_group_is_not_a_node(self) -> None:
        # A group can carry a node's name, and reading one as a node reports a
        # published node with no credentials at all.
        self.assertEqual(
            ["Los Angeles · Mesa Verde", "Los Angeles · Mesa"],
            [name for name, _ in module.catalog_proxies(CATALOG)],
        )

    def test_an_entry_whose_first_key_is_not_name_is_its_own_entry(self) -> None:
        self.assertEqual(
            ["Tokyo · Kanda", "Osaka · Namba"],
            [name for name, _ in module.catalog_proxies(UNORDERED_CATALOG)],
        )
        exact, _ = module.catalog_lookup(UNORDERED_CATALOG, "Tokyo · Kanda")
        self.assertEqual(1, len(exact))
        fields = module.catalog_fields(exact[0])
        # Its own port and its own Reality credentials, not the next entry's.
        self.assertEqual("443", fields["port"])
        self.assertEqual("kanda-public-key", fields["public-key"])
        self.assertEqual("{{TONO_CLIENT_UUID}}", fields["uuid"])

    def test_a_flow_mapping_node_is_published_and_read_as_one(self) -> None:
        # publish-managed-catalog.rb splices this shape verbatim, so an audit
        # that cannot see it calls a node the publisher published missing.
        exact, near = module.catalog_lookup(UNORDERED_CATALOG, "Osaka · Namba")
        self.assertEqual(1, len(exact))
        self.assertEqual([], near)
        fields = module.catalog_fields(exact[0])
        self.assertEqual("{{TONO_CLIENT_UUID}}", fields["uuid"])
        self.assertEqual("8443", fields["port"])

    def test_a_nested_sequence_does_not_start_a_new_entry(self) -> None:
        nested = ("proxies:\n  - name: One\n    uuid: {{TONO_CLIENT_UUID}}\n"
                  "    alpn:\n      - h2\n      - http/1.1\n  - name: Two\n")
        self.assertEqual(["One", "Two"], [name for name, _ in module.catalog_proxies(nested)])

    def test_a_duplicated_name_is_not_silently_picked(self) -> None:
        # Two entries under one name is a catalog the operator has to repair, so
        # the caller is handed both rather than the first one that matched.
        proxies = CATALOG.partition("proxy-groups:")[0]
        exact, _ = module.catalog_lookup(
            proxies + "  - name:" + proxies.split("  - name:")[-1], "Los Angeles · Mesa")
        self.assertEqual(2, len(exact))


class MeasuredFronts(unittest.TestCase):
    def test_the_default_front_is_measured_usable(self) -> None:
        self.assertIn(module.REALITY_FRONTS["default"], module.REALITY_FRONTS["usable"])
        self.assertIs(True, module.front_verdict(module.REALITY_FRONTS["default"])[0])

    def test_a_measured_unusable_front_fails_the_audit(self) -> None:
        for domain in module.REALITY_FRONTS["unusable"]:
            for host in (domain, f"www.{domain}"):
                verdict, detail = module.front_verdict(host)
                self.assertIs(False, verdict, host)
                self.assertIn(host, detail)

    def test_an_unmeasured_front_is_neither_pass_nor_fail(self) -> None:
        # Reported, not counted against the node: nobody has stood inside the
        # market and tried it.
        self.assertIsNone(module.front_verdict("www.example.com")[0])


class MeteringProbe(unittest.TestCase):
    """The probe text is run for real, against a stubbed node layout."""

    def setUp(self) -> None:
        if not shutil.which("bash"):
            self.skipTest("bash unavailable")
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.install = os.path.join(self.root, "opt/tono-xray/current")
        self.state = os.path.join(self.root, "var/lib/tono-exit-agent")
        os.makedirs(self.install)
        os.makedirs(self.state)
        self.probe = self.audit(lambda script: (True, ""))[1]

    def audit(self, answer) -> tuple[list[tuple[str, bool | None, str]], str]:
        """The rows, and the probe that was sent, with the SSH edge replaced."""
        sent: list[str] = []

        def stub(host, script, timeout=45):
            sent.append(script)
            return answer(script)

        original = module.node
        module.node = stub
        try:
            return module.metering_rows("stub"), sent[0]
        finally:
            module.node = original

    def stub_node(self, config: dict, stats: dict, state_age: float | None) -> None:
        Path(self.install, "config.json").write_text(json.dumps(config))
        answer = Path(self.root, "stats.json")
        answer.write_text(json.dumps(stats))
        binary = Path(self.install, "xray")
        binary.write_text(f'#!/bin/sh\n[ "$2" = statsquery ] || exit 1\nexec cat {answer}\n')
        binary.chmod(0o755)
        if state_age is not None:
            written = Path(self.state, "state.json")
            written.write_text("{}")
            os.utime(written, (time.time() - state_age, time.time() - state_age))

    def rows(self) -> list[tuple[str, bool | None, str]]:
        script = (self.probe
                  .replace("/opt/tono-xray/current", self.install)
                  .replace(module.METER_STATE, os.path.join(self.state, "state.json")))
        result = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=60)
        # A probe that also writes to stderr would leave the record it prints
        # interleaved with whatever the remote shell had to say about it.
        self.assertEqual("", result.stderr)
        return self.audit(lambda _: (True, result.stdout))[0]

    def test_reading_the_counters_never_resets_them(self) -> None:
        # The agent bills the delta between its own reads. An audit that reset
        # the counters would forgive whatever every account had used since the
        # agent's last run, and nothing downstream could tell.
        self.assertIn("--reset=false", self.probe)
        self.assertNotIn("--reset=true", self.probe)

    def test_a_metered_and_reporting_node_passes(self) -> None:
        self.stub_node(
            {"policy": {"levels": {"0": {"statsUserUplink": True, "statsUserDownlink": True}}},
             "api": {"tag": "api", "services": ["HandlerService", "StatsService"]},
             "inbounds": [{"protocol": "vless", "port": 443},
                          {"tag": "tono-api", "listen": "127.0.0.1", "port": 10085,
                           "protocol": "dokodemo-door"}]},
            {"stat": [{"name": "user>>>u:42>>>traffic>>>uplink", "value": "12345"},
                      {"name": "inbound>>>tono-vless>>>traffic>>>uplink", "value": "999"}]},
            state_age=30,
        )
        self.assertEqual([True, True], [state for _, state, _ in self.rows()])

    def test_the_stack_the_node_script_installs_fails(self) -> None:
        # What manage-tono-reality-node.sh leaves behind: one unlabelled client,
        # and no api/stats/policy sections at all.
        self.stub_node(
            {"inbounds": [{"protocol": "vless", "port": 443,
                           "settings": {"clients": [{"id": "11111111-1111-4111-8111-111111111111"}]}}]},
            {"stat": []},
            state_age=None,
        )
        rows = self.rows()
        self.assertEqual([False, False], [state for _, state, _ in rows])
        for missing in ("stats-options", "api-services", "api-inbound"):
            self.assertIn(missing, rows[0][2])

    def test_a_management_api_off_the_loopback_fails(self) -> None:
        # That interface can issue identities, so binding it to a routable
        # address is not a working meter, it is an open door.
        self.stub_node(
            {"policy": {"levels": {"0": {"statsUserUplink": True, "statsUserDownlink": True}}},
             "api": {"tag": "api", "services": ["HandlerService", "StatsService"]},
             "inbounds": [{"tag": "tono-api", "listen": "0.0.0.0", "port": 10085,
                           "protocol": "dokodemo-door"}]},
            {"stat": [{"name": "user>>>u:42>>>traffic>>>uplink", "value": "12345"}]},
            state_age=30,
        )
        self.assertIs(False, self.rows()[0][1])

    def test_traffic_on_the_shared_pre_account_client_is_not_metering(self) -> None:
        # services/exit-agent/reconcile_and_report.py bills only labels carrying
        # `u:` and drops the rest, so the shared pre-account client's bytes reach
        # no invoice. Counting them here reports a node that bills nobody as one
        # that meters — the exact state this row exists to catch.
        self.stub_node(
            {"policy": {"levels": {"0": {"statsUserUplink": True, "statsUserDownlink": True}}},
             "api": {"tag": "api", "services": ["HandlerService", "StatsService"]},
             "inbounds": [{"tag": "tono-api", "listen": "127.0.0.1", "port": 10085,
                           "protocol": "dokodemo-door"}]},
            {"stat": [{"name": "user>>>shared-legacy>>>traffic>>>uplink", "value": "84211"},
                      {"name": "user>>>shared-legacy>>>traffic>>>downlink", "value": "99123"}]},
            state_age=30,
        )
        rows = self.rows()
        self.assertIs(True, rows[0][1])
        self.assertIs(False, rows[1][1])
        self.assertIn("every per-account counter is zero", rows[1][2])

    def test_a_probe_that_cannot_be_read_is_a_failure_not_an_unknown(self) -> None:
        # The box answered the round-trip just above this call. A probe that then
        # comes back unreadable is a node whose metering nobody can demonstrate,
        # and `??` leaves the run reporting "fully onboarded".
        rows = self.audit(lambda _: (True, "nonsense"))[0]
        self.assertEqual([False, False], [state for _, state, _ in rows])

    def test_counters_at_zero_and_a_stale_agent_are_both_reported(self) -> None:
        metered = {"policy": {"levels": {"0": {"statsUserUplink": True, "statsUserDownlink": True}}},
                   "api": {"tag": "api", "services": ["HandlerService", "StatsService"]},
                   "inbounds": [{"tag": "tono-api", "listen": "127.0.0.1", "port": 10085,
                                 "protocol": "dokodemo-door"}]}
        # Billing nobody: the counters exist and every one of them is zero.
        self.stub_node(metered, {"stat": [{"name": "user>>>u:9>>>traffic>>>uplink", "value": "0"}]},
                       state_age=30)
        rows = self.rows()
        self.assertIs(True, rows[0][1])
        self.assertIs(False, rows[1][1])
        # Counting, but nothing has collected it since well before the last run.
        self.stub_node(metered, {"stat": [{"name": "user>>>u:9>>>traffic>>>uplink", "value": "77"}]},
                       state_age=module.METER_STATE_MAX_AGE * 4)
        self.assertIs(False, self.rows()[1][1])


if __name__ == "__main__":
    unittest.main()
