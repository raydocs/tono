#!/usr/bin/env python3
"""Handshake ceilings must reject a count of zero."""

import unittest

from bench import limit_failures


class HandshakeFloorTest(unittest.TestCase):
    def test_zero_handshakes_fail_while_one_stays_under_the_ceiling(self):
        rows = [
            {
                "profile": "tono-fixed",
                "protocol": "vless",
                "cold_ms": 40,
                "dns_ms": 80,
                "handshakes": 0,
                "dns_handshakes": 1,
                "fake_ip_handshakes": 0,
            },
            {
                "profile": "sing-box",
                "protocol": "vless",
                "cold_ms": 40,
                "dns_ms": 120,
                "handshakes": 1,
                "dns_handshakes": 0,
            },
            {
                "profile": "tono-fixed",
                "protocol": "hysteria2",
                "cold_ms": 4,
                "handshakes": 0,
                "fake_ip_handshakes": 0,
            },
        ]
        limits = {
            "vless/tono-fixed/cold_ms": 120,
            "vless/tono-fixed/dns_ms": 180,
            "vless/tono-fixed/handshakes": 1,
            "vless/tono-fixed/dns_handshakes": 2,
            "vless/tono-fixed/fake_ip_handshakes": 0,
            "vless/sing-box/cold_ms": 120,
            "vless/sing-box/dns_ms": 180,
            "vless/sing-box/handshakes": 1,
            "vless/sing-box/dns_handshakes": 2,
            "hysteria2/tono-fixed/cold_ms": 40,
            "hysteria2/tono-fixed/fake_ip_handshakes": 0,
        }
        failed = "\n".join(limit_failures(rows, limits))
        self.assertIn("vless/tono-fixed/handshakes", failed)
        self.assertIn("vless/sing-box/dns_handshakes", failed)
        self.assertNotIn("vless/tono-fixed/dns_handshakes", failed)
        self.assertNotIn("vless/tono-fixed/cold_ms", failed)
        self.assertNotIn("hysteria2/tono-fixed/handshakes", failed)
        self.assertNotIn("fake_ip_handshakes", failed)

        over = "\n".join(limit_failures(
            [{"profile": "tono-fixed", "protocol": "vless", "cold_ms": None, "handshakes": 2}],
            {"vless/tono-fixed/cold_ms": 120, "vless/tono-fixed/handshakes": 1},
        ))
        self.assertIn("vless/tono-fixed/cold_ms", over)
        self.assertIn("vless/tono-fixed/handshakes", over)


if __name__ == "__main__":
    unittest.main()
