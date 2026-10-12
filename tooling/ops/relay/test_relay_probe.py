"""Tests for relay-probe.py against a local TLS server standing in for the relay.

Run: python3 tooling/ops/relay/test_relay_probe.py (needs the `openssl` CLI for a
throwaway certificate).
"""

from __future__ import annotations

import http.server
import importlib.util
import json
import shutil
import ssl
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("relay_probe", HERE / "relay-probe.py")
relay_probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay_probe)

HOST = "relay-probe.test"


class Health(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (stdlib name)
        body = json.dumps({"ok": True, "service": "api"}).encode()
        self.send_response(200 if self.path == relay_probe.PROBE_PATH else 404)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@unittest.skipUnless(shutil.which("openssl"), "openssl CLI not available")
class RelayProbeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        cls.cert = Path(cls.dir.name, "cert.pem")
        key = Path(cls.dir.name, "key.pem")
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
            "-nodes", "-days", "1", "-subj", f"/CN={HOST}", "-addext", f"subjectAltName=DNS:{HOST}",
            "-keyout", str(key), "-out", str(cls.cert),
        ], check=True, capture_output=True)
        server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server_context.load_cert_chain(cls.cert, key)
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Health)
        cls.server.socket = server_context.wrap_socket(cls.server.socket, server_side=True)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.relay = ("127.0.0.1", cls.server.server_address[1])

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.dir.cleanup()

    def test_default_verification_reports_an_untrusted_certificate_as_a_failure(self):
        # The default context trusts the system store only: a relay that hands
        # back anything but a publicly valid certificate for the host is down.
        result = relay_probe.probe(self.relay, HOST, timeout=5)
        self.assertIsNone(result["httpStatus"])
        self.assertTrue(result["error"].startswith("tls verify:"), result["error"])

    def test_a_verified_health_answer_through_the_relay_is_a_clean_report(self):
        trusted = ssl.create_default_context(cafile=str(self.cert))
        result = relay_probe.probe(self.relay, HOST, context=trusted, timeout=5)
        self.assertEqual(result["httpStatus"], 200)
        self.assertIsNone(result["error"])
        self.assertIsInstance(result["latencyMs"], int)
        self.assertEqual(set(result), {"observedAt", "httpStatus", "latencyMs", "error"})


if __name__ == "__main__":
    unittest.main()
