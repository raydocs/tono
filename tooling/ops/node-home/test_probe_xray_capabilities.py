"""Offline unit tests for probe_xray_capabilities.py helpers."""

from __future__ import annotations

import ipaddress
import os
import struct
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from probe_xray_capabilities import (  # noqa: E402
    API_INBOUND_TAG,
    API_TAG,
    DIRECT_OUTBOUND_TAG,
    HOME_BLACKHOLE_TAG,
    PRIVATE_HOME_CIDRS,
    build_base_xray_config,
    build_routing_rules,
    classify_capabilities,
    encode_test_route_request,
    encode_vless_tcp_request,
    parse_socks5_connect_request,
    parse_supported_api_commands,
)


class ProbeXrayCapabilitiesTest(unittest.TestCase):
    def test_base_config_preserves_static_clients_and_fail_closed_guards(self) -> None:
        cfg = build_base_xray_config(
            api_port=10085,
            vless_port=443,
            static_clients=[{"email": "shared-legacy", "id": "11111111-1111-4111-8111-111111111111"}],
        )
        self.assertEqual(cfg["outbounds"][0]["tag"], DIRECT_OUTBOUND_TAG)
        self.assertEqual(cfg["outbounds"][1]["tag"], HOME_BLACKHOLE_TAG)
        self.assertEqual(cfg["outbounds"][1]["protocol"], "blackhole")
        self.assertEqual(cfg["routing"]["domainStrategy"], "AsIs")
        vless_inbound = cfg["inbounds"][1]
        self.assertFalse(vless_inbound["sniffing"]["enabled"])
        self.assertEqual(vless_inbound["settings"]["clients"][0]["email"], "shared-legacy")
        rules = cfg["routing"]["rules"]
        self.assertEqual(len(rules), 3)
        self.assertEqual(rules[0]["inboundTag"], [API_INBOUND_TAG])
        self.assertEqual(rules[0]["outboundTag"], API_TAG)
        self.assertEqual(rules[1]["user"], ["regexp:^h:"])
        self.assertEqual(tuple(rules[1]["ip"]), PRIVATE_HOME_CIDRS)
        self.assertEqual(rules[1]["outboundTag"], HOME_BLACKHOLE_TAG)
        self.assertEqual(rules[2]["user"], ["regexp:^h:"])
        self.assertEqual(rules[2]["outboundTag"], HOME_BLACKHOLE_TAG)

    def test_build_routing_rules_inserts_dynamic_bindings_before_catchall(self) -> None:
        rules = build_routing_rules([
            ("tono-home-line1-gen1", ["h:1001:d1:g1"], "home:line1:gen1"),
            ("tono-home-line2-gen2", ["h:2002:d2:g2"], "home:line2:gen2"),
        ])
        self.assertEqual(
            [(r["ruleTag"], r["outboundTag"]) for r in rules],
            [
                ("tono-api-rule", "api"),
                ("tono-home-private-cidrs", "home-blackhole"),
                ("tono-home-line1-gen1", "home:line1:gen1"),
                ("tono-home-line2-gen2", "home:line2:gen2"),
                ("tono-home-catchall", "home-blackhole"),
            ],
        )

    def test_encode_vless_tcp_request_domain_ipv4_ipv6(self) -> None:
        cid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        raw_uuid = uuid.UUID(cid).bytes
        dom = encode_vless_tcp_request(cid, "canary-home.invalid", 443)
        self.assertEqual(dom[:19], b"\x00" + raw_uuid + b"\x00\x01")
        self.assertEqual(struct.unpack(">H", dom[19:21])[0], 443)
        self.assertEqual(dom[21], 2)
        self.assertEqual(dom[22], len(b"canary-home.invalid"))
        self.assertEqual(dom[23:], b"canary-home.invalid")

        v4 = encode_vless_tcp_request(cid, "198.51.100.10", 8080)
        self.assertEqual(v4[21], 1)
        self.assertEqual(v4[22:], ipaddress.IPv4Address("198.51.100.10").packed)

        v6 = encode_vless_tcp_request(cid, "fc00::1", 80)
        self.assertEqual(v6[21], 3)
        self.assertEqual(v6[22:], ipaddress.IPv6Address("fc00::1").packed)

    def test_parse_socks5_connect_request_handles_incomplete_and_atyp(self) -> None:
        self.assertIsNone(parse_socks5_connect_request(b"\x05\x01\x00"))
        self.assertIsNone(parse_socks5_connect_request(b"\x05\x01\x00\x03\x05ab"))
        atyp, host, port = parse_socks5_connect_request(b"\x05\x01\x00\x03\x0bexample.com\x01\xbb") or (0, "", 0)
        self.assertEqual((atyp, host, port), (3, "example.com", 443))

        atyp4, host4, port4 = parse_socks5_connect_request(
            b"\x05\x01\x00\x01" + ipaddress.IPv4Address("198.51.100.10").packed + struct.pack(">H", 8080)
        ) or (0, "", 0)
        self.assertEqual((atyp4, host4, port4), (1, "198.51.100.10", 8080))

    def test_parse_supported_api_commands_and_classify_capabilities(self) -> None:
        cmds = parse_supported_api_commands(
            "Usage:\n\txray api <command>\n\tado  Add outbounds\n\trmo  Remove outbounds\n\tadrules  Add rules\n"
        )
        self.assertEqual(cmds, {"ado", "rmo", "adrules"})

        summary = {
            "api_commands": ["ado", "adrules", "lsrules", "rmo"],
            "checks": {
                "test_without_geoip": {"passed": True},
                "non_h_clients_intact": {"passed": True},
                "static_h_catchall_fail_closed": {"passed": True},
                "ado_plus_replace_all_rules_and_asis": {"passed": True, "replace_all_verified": True},
                "literal_private_cidrs_blocked": {"passed": True},
                "stats_unified_u_and_h": {"passed": True},
                "replace_all_revocation_and_rmo_stream_cancellation": {
                    "passed": True,
                    "rmo_cancels_established_stream": False,
                    "new_conn_rejected_after_rmu": True,
                    "u_stream_survived_unbind": True,
                },
                "testroute_availability": {"grpc_testroute_available": True},
            },
        }
        verdict = classify_capabilities(summary)
        self.assertTrue(verdict["core_routing_fail_closed_ready"])
        self.assertTrue(verdict["adrules_replace_all_supported"])
        self.assertFalse(verdict["rmo_cancels_established_stream"])
        self.assertFalse(verdict["cli_testroute_supported"])
        self.assertTrue(verdict["grpc_testroute_supported"])

    def test_encode_test_route_request_contains_user_and_target(self) -> None:
        payload = encode_test_route_request(
            inbound_tag="vless-in",
            user="h:1001:dev1:gen1",
            target_domain="canary-home.invalid",
            target_port=443,
        )
        self.assertIn(b"h:1001:dev1:gen1", payload)
        self.assertIn(b"canary-home.invalid", payload)


if __name__ == "__main__":
    unittest.main()
