"""`clash_rules.py` must prove the core it started, not whatever answers the port."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import clash_rules  # noqa: E402

FIXTURE = json.loads(clash_rules.FIXTURE.read_text())
FIXTURE_SECRET = FIXTURE["runtime"]["experimental"]["clash_api"]["secret"]
# The controller address every replay used before #1684's review.
OLD_CONTROLLER_PORT = 29391


class StaleCore(BaseHTTPRequestHandler):
    """An earlier replay's core: it still serves the fixture to its own secret."""

    def do_GET(self):
        if self.headers.get("Authorization") != f"Bearer {FIXTURE_SECRET}":
            self.send_response(401)
            self.end_headers()
            return
        body = json.dumps({"rules": FIXTURE["rules"]}).encode()
        self.send_response(200)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


class ClashRulesReplayTests(unittest.TestCase):
    def test_a_leftover_listener_does_not_pass_for_a_core_that_failed_to_start(self):
        server = HTTPServer(("127.0.0.1", OLD_CONTROLLER_PORT), StaleCore)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        with tempfile.TemporaryDirectory() as work:
            core = Path(work) / "sing-box"
            core.write_text("#!/bin/sh\nsleep 0.5\necho 'listen: address already in use'\nexit 1\n")
            core.chmod(0o755)
            with mock.patch.object(
                clash_rules, "free_ports", create=True, side_effect=lambda count: [OLD_CONTROLLER_PORT] * count
            ):
                with self.assertRaises(SystemExit):
                    clash_rules.live_rules(str(core), FIXTURE["runtime"])


if __name__ == "__main__":
    unittest.main()
