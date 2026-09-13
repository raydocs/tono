import copy
import unittest

from run_b3 import budget, validated


class RunnerTest(unittest.TestCase):
    def test_http2_requires_protocol_reuse_and_live_multiplex_evidence(self):
        sample = {"status": "PASS", "http_proto": "HTTP/2.0", "tls_alpn": "h2", "got_conn_reused": True,
                  "connection_id": "one", "done": True, "events": [{"active": 2}]}
        value = {"status": "PASS", "expected_events": 1, "warmup": [{"status": "PASS", "connection_id": "one"}],
                 "samples": [copy.deepcopy(sample), copy.deepcopy(sample)]}
        self.assertTrue(validated(value, 2, "h2"))
        value["samples"][1]["connection_id"] = "other"
        self.assertFalse(validated(value, 2, "h2"))
        value["samples"][1]["connection_id"] = "one"
        value["samples"][1]["tls_alpn"] = "http/1.1"
        self.assertFalse(validated(value, 2, "h2"))
        self.assertFalse(validated(value, 2, "h2", cancel=True))

    def test_all_batches_and_diagnostics_fit_payload_budget(self):
        self.assertEqual(budget()["application_bytes_upper"], 226905088)
        self.assertLess(budget()["application_bytes_upper"], 256 << 20)


if __name__ == "__main__":
    unittest.main()
