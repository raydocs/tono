import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from globalping_carriers import summarize  # noqa: E402

TARGET = "23.94.79.123"
PROBE = {"city": "Shanghai", "asn": 9808, "network": "China Mobile Communications Group"}


def hop(address, asn, avg):
    return {"resolvedAddress": address, "asn": [asn] if asn else [], "stats": {"rcv": 3, "avg": avg}}


SILENT = {"resolvedAddress": None, "asn": [], "stats": {"rcv": 0, "avg": None}}


class GlobalpingCarriersTest(unittest.TestCase):
    def test_hy2_port_path_that_stops_in_the_hosts_handoff_network_is_host_edge(self):
        # Shapes of Globalping mtr 2M3BTL0D6DDiTeaaE00021I4E / 22UJavQ6U3bahvY1x00021I4E
        # (2026-10-10): the host answers the control port behind Telia AS1299 and stays
        # silent on the hy2 port, whose datagrams reach a Telia router on another ECMP leg.
        measurements = {
            "udpHy2": {"results": [{"probe": PROBE, "result": {"hops": [
                hop("221.183.89.169", 9808, 23.7), hop("223.120.12.133", 58453, 203.6),
                hop("62.115.159.243", 1299, 292.0), SILENT]}}]},
            "udpControl": {"results": [{"probe": PROBE, "result": {"hops": [
                hop("221.183.89.169", 9808, 24.1), hop("223.120.12.133", 58453, 204.0),
                hop("62.115.159.245", 1299, 290.0), hop(TARGET, 36352, 291.0)]}}]},
        }

        [row] = summarize(TARGET, measurements)

        self.assertEqual(row["udpControl"]["verdict"], "target-replied")
        self.assertEqual(row["udpHy2"]["verdict"], "host-edge")


if __name__ == "__main__":
    unittest.main()
