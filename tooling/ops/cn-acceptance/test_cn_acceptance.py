import os
import ssl
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cn_acceptance as cn  # noqa: E402


class CnAcceptanceClassificationTest(unittest.TestCase):
    def test_answer_outside_cloudflare_is_reported_as_poisoned(self):
        # One Cloudflare address plus a bogon, the shape of a poisoned answer in the mainland.
        result, code, reason = cn.classify_addresses(["104.20.26.170", "127.0.0.2"])

        self.assertEqual((result, code), ("FAIL", "not-cloudflare"))
        self.assertIn("127.0.0.2 (bogon)", reason)

    def test_reset_during_tls_handshake_reads_as_sni_filtering(self):
        result, code, _ = cn.classify_error("tls", ConnectionResetError(104, "Connection reset by peer"))

        self.assertEqual((result, code), ("FAIL", "tls-reset"))

    def test_certificate_failure_without_a_local_ca_store_is_unknown_not_interception(self):
        error = ssl.SSLCertVerificationError(1, "certificate verify failed")

        result, code, _ = cn.classify_error("tls", error, ca_store_ok=False)

        self.assertEqual((result, code), ("UNKNOWN", "local-ca-store"))

    def test_health_answer_from_a_captive_portal_fails(self):
        result, code, _ = cn.classify_health(200, b"<html><title>Wi-Fi login</title></html>")

        self.assertEqual((result, code), ("FAIL", "unexpected-body"))

    def test_unpublished_manifest_404_from_the_release_host_still_proves_the_path(self):
        # What releases.afk.ccwu.cc answers on 2026-10-10: the release Worker's own 404.
        result, code, _ = cn.classify_update("manifest", 404, b"Not found")

        self.assertEqual((result, code), ("PASS", "no-manifest"))

    def test_tcp_connects_on_a_transparent_proxy_network_are_unknown(self):
        # The agent orb accepts every TCP connect locally in ~0 ms, even to TEST-NET.
        result, code, _ = cn.classify_tcp_series([0, 1, 0], intercepted=True)

        self.assertEqual((result, code), ("UNKNOWN", "tcp-intercepted"))

    def test_hy2_probe_report_maps_to_pass(self):
        # Real hy2_probe.py stdout (fake hysteria printing the v2.12.2 log lines).
        stdout = ('{"schema": "tono.hy2-probe.v1", "attempts": 2, "handshakeOk": 2, "ok": 2, '
                  '"connectMs": {"min": 148.2, "median": 148.2, "max": 148.2}, "failures": {}, "verdict": "ok"}\n')

        result, code, reason = cn.classify_hy2(stdout, 0)

        self.assertEqual((result, code, reason), ("PASS", "hy2-ok", "2/2 handshakes, 2/2 tunnelled connects, median 148.2 ms"))

    def test_identity_keeps_only_the_address_prefix(self):
        payload = {"ip": "223.104.5.77", "org": "AS9808 China Mobile", "country": "CN", "city": "Shanghai"}

        identity = cn.parse_identity("https://ipinfo.io/json", payload)

        self.assertEqual((identity["asn"], identity["ipPrefix"]), (9808, "223.104.5.0/24"))
        self.assertNotIn("223.104.5.77", repr(identity))

    def test_sign_in_that_only_works_through_a_relay_is_relay_only(self):
        verdict = cn.customer_verdict([("system_dns", "FAIL"), ("pinned", "FAIL"), ("pinned", "FAIL"),
                                       ("relay", "PASS"), ("relay", "FAIL")])

        self.assertEqual(verdict, "relay-only")


if __name__ == "__main__":
    unittest.main()
