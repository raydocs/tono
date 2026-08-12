#!/usr/bin/env python3
"""Tests for the edit that must not take a working exit offline.

Two failure modes are worth more than the rest. Dropping the existing client
disconnects the whole fleet the moment this runs, because that credential is the
one every current client still holds. And reporting work to do when there is none
spends a restart — the only way to add the management interface — to discover
that nothing needed adding.
"""

from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "config", Path(__file__).with_name("exit_metering_config.py")
)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def deployed_shape() -> dict:
    """What `manage-tono-reality-node.sh` installs today."""
    return {
        "log": {"loglevel": "warning"},
        "inbounds": [{
            "listen": "0.0.0.0",
            "port": 443,
            "protocol": "vless",
            "settings": {
                "clients": [{"id": "11111111-1111-4111-8111-111111111111",
                             "flow": "xtls-rprx-vision"}],
                "decryption": "none",
            },
            "streamSettings": {
                "network": "raw",
                "security": "reality",
                "realitySettings": {
                    "target": "www.bing.com:443",
                    "serverNames": ["www.bing.com"],
                    "privateKey": "REDACTED",
                    "shortIds": ["0011223344556677"],
                },
            },
        }],
        "outbounds": [{"protocol": "freedom"}],
    }


class KeepsTheExitWorking(unittest.TestCase):
    def test_the_existing_credential_is_kept(self) -> None:
        updated = module.with_metering(deployed_shape())
        clients = updated["inbounds"][0]["settings"]["clients"]
        self.assertEqual(
            [client["id"] for client in clients],
            ["11111111-1111-4111-8111-111111111111"],
            "removing this disconnects every client that still holds it",
        )

    def test_the_reality_settings_are_untouched(self) -> None:
        original = deployed_shape()
        updated = module.with_metering(original)
        self.assertEqual(
            updated["inbounds"][0]["streamSettings"],
            original["inbounds"][0]["streamSettings"],
        )

    def test_the_existing_client_gains_a_label_that_is_not_a_user_id(self) -> None:
        updated = module.with_metering(deployed_shape())
        email = updated["inbounds"][0]["settings"]["clients"][0]["email"]
        # Counters need a label or they cannot be filed at all. Filing this one
        # under a user id would put the whole fleet's shared total on one bill.
        self.assertEqual(email, module.LEGACY_CLIENT_EMAIL)

    def test_a_label_already_present_is_left_alone(self) -> None:
        original = deployed_shape()
        original["inbounds"][0]["settings"]["clients"][0]["email"] = "user-42"
        updated = module.with_metering(original)
        self.assertEqual(
            updated["inbounds"][0]["settings"]["clients"][0]["email"], "user-42"
        )


class EnablesAttribution(unittest.TestCase):
    def test_per_user_counters_are_switched_on(self) -> None:
        updated = module.with_metering(deployed_shape())
        level = updated["policy"]["levels"]["0"]
        # Without these the stats API reports per-inbound totals and nothing per
        # account, which is the situation being repaired.
        self.assertTrue(level["statsUserUplink"])
        self.assertTrue(level["statsUserDownlink"])
        self.assertIsInstance(updated["stats"], dict)

    def test_both_services_are_exposed(self) -> None:
        updated = module.with_metering(deployed_shape())
        self.assertEqual(set(updated["api"]["services"]),
                         {"HandlerService", "StatsService"})

    def test_the_api_listens_on_loopback_only(self) -> None:
        updated = module.with_metering(deployed_shape())
        inbound = next(i for i in updated["inbounds"] if i.get("tag") == module.API_INBOUND_TAG)
        # This interface adds and removes accounts. Reachable from off the host, it
        # is a way to issue oneself an identity.
        self.assertEqual(inbound["listen"], "127.0.0.1")

    def test_the_api_route_precedes_other_rules(self) -> None:
        original = deployed_shape()
        original["routing"] = {"rules": [{"type": "field", "network": "tcp,udp",
                                          "outboundTag": "direct"}]}
        updated = module.with_metering(original)
        # A catch-all ahead of it would swallow management traffic, and the API
        # would answer nothing while appearing configured.
        self.assertEqual(updated["routing"]["rules"][0]["outboundTag"], module.API_TAG)


class Idempotence(unittest.TestCase):
    def test_a_fresh_config_reports_work_to_do(self) -> None:
        self.assertTrue(module.needs_changes(deployed_shape()))

    def test_an_already_metered_config_reports_nothing_to_do(self) -> None:
        once = module.with_metering(deployed_shape())
        # Spending a restart to find out there was nothing to add is the cost this
        # avoids: adding the management interface is the only change that needs one.
        self.assertFalse(module.needs_changes(once))

    def test_applying_twice_is_identical(self) -> None:
        once = module.with_metering(deployed_shape())
        twice = module.with_metering(once)
        self.assertEqual(json.dumps(once, sort_keys=True),
                         json.dumps(twice, sort_keys=True))

    def test_no_duplicate_api_inbound_on_reapply(self) -> None:
        twice = module.with_metering(module.with_metering(deployed_shape()))
        tags = [i.get("tag") for i in twice["inbounds"]]
        self.assertEqual(tags.count(module.API_INBOUND_TAG), 1)


class RefusesWhatItCannotEdit(unittest.TestCase):
    def test_a_config_without_a_vless_inbound_is_refused(self) -> None:
        with self.assertRaises(module.Unsupported):
            module.with_metering({"inbounds": [{"protocol": "socks"}]})

    def test_a_vless_inbound_without_clients_is_refused(self) -> None:
        broken = deployed_shape()
        broken["inbounds"][0]["settings"]["clients"] = []
        with self.assertRaises(module.Unsupported):
            module.with_metering(broken)

    def test_a_config_with_no_inbounds_is_refused(self) -> None:
        with self.assertRaises(module.Unsupported):
            module.with_metering({"inbounds": []})


if __name__ == "__main__":
    unittest.main()
