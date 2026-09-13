"""Harness checks, not native Tono regression tests. Run in an isolated namespace."""
import argparse
import copy
import http.server
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import run
from configs import client_config
from workload import HTTP, request


class StageBTests(unittest.TestCase):
    def test_actual_http_failure_deadline_and_corruption_cannot_pass(self):
        class Fixture(HTTP):
            def do_GET(self):
                if self.path == "/corrupt":
                    self.send_response(200)
                    self.send_header("Content-Length", "4")
                    self.end_headers()
                    self.wfile.write(b"ZZZX")
                else:
                    super().do_GET()
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
        worker = threading.Thread(target=server.serve_forever)
        worker.start()
        options = {"port": server.server_port, "address": "127.0.0.1"}
        try:
            success = request(size=4, **options)
            self.assertEqual((success["status"], success["received_bytes"]), ("PASS", 4))
            failure = request(path="/failure", **options)
            self.assertEqual((failure["status"], failure["http_status"]), ("FAIL", 503))
            self.assertEqual(request(path="/slow", timeout=.03, **options)["status"], "TIMEOUT")
            self.assertEqual(request(size=4, path="/corrupt", **options)["status"], "FAIL")
        finally:
            server.shutdown()
            server.server_close()
            worker.join()

    def test_sing_box_pair_differs_only_in_explicit_stack(self):
        identity = {name: "synthetic" for name in ["uuid", "password", "short_id", "controller", "public_key"]}
        gvisor = client_config("gvisor", Path("/synthetic"), identity)
        go = client_config("go", Path("/synthetic"), identity)
        self.assertEqual(gvisor["inbounds"][1]["stack"], "gvisor")
        self.assertEqual(go["inbounds"][1]["stack"], "go")
        gvisor["inbounds"][1]["stack"] = "go"
        self.assertEqual(gvisor, go)
        self.assertFalse(go["inbounds"][1]["multi_queue"])
        for outbound in go["outbounds"]:
            self.assertNotIn("multiplex", outbound)
            self.assertNotIn("insecure", outbound["tls"])

    def test_empty_inner_failure_is_not_a_passed_parity_gate(self):
        with tempfile.TemporaryDirectory(prefix="tono-b-selftest-") as directory:
            args = argparse.Namespace(output=Path(directory), action="parity", host_ns="old",
                                      mihomo=Path("unused"), sing_box=Path("unused"))
            with patch("run.os.getpid", return_value=1), patch("run.os.readlink", return_value="new"), \
                    patch("run.signal.signal"), patch("run.sha", return_value="test"), \
                    patch("run.snapshot", return_value={}), patch("run.Experiment", side_effect=AssertionError()):
                self.assertEqual(run.inner(args), 1)
            result = json.loads((Path(directory) / "results.json").read_text())
            self.assertEqual(result["status"], "FAIL")
            self.assertFalse(result["gate_passed"])


if __name__ == "__main__":
    unittest.main()
