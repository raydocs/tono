import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from hy2_probe import parse_ping_output  # noqa: E402


class Hy2ProbeTest(unittest.TestCase):
    def test_timestamp_order_does_not_hide_the_tunnelled_connect_time(self):
        # Real `hysteria ping` v2.12.2 JSON log against a local server; the "connected"
        # line carries the epoch timestamp and the duration under the same "time" key.
        # The last line puts the duration first, as a different encoder order would.
        output = "\n".join([
            '{"level":"info","time":1791627750522.118,"msg":"ping mode"}',
            '{"level":"info","time":1791627750528.0295,"msg":"connected to server","addr":"127.0.0.1:44443",'
            '"udpEnabled":true,"tx":0}',
            '{"level":"info","time":1791627750528.0466,"msg":"connecting","addr":"1.1.1.1:443"}',
            '{"level":"info","time":"148.214018ms","msg":"connected","time":1791627750529.2644}',
        ])

        result = parse_ping_output(output, 0)

        self.assertEqual(result, {"handshake": True, "ok": True, "connectMs": 148.2, "failure": None, "detail": ""})


if __name__ == "__main__":
    unittest.main()
