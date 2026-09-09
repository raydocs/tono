import unittest

from collect import mainland_agent_probe_script, parse_mainland_agent_output


class MainlandAgentProbe(unittest.TestCase):
    def test_script_does_tls_not_just_syn(self):
        script = mainland_agent_probe_script("203.0.113.9", 443, "www.microsoft.com")
        self.assertIn("wrap_socket", script)
        self.assertIn("create_connection", script)
        self.assertNotIn("/dev/tcp", script)

    def test_tcp_without_tls_is_not_success(self):
        tcp_ok, tls_ok = parse_mainland_agent_output("TCP:0\nTLS:1\n")
        self.assertTrue(tcp_ok)
        self.assertFalse(tls_ok)

    def test_tcp_and_tls_is_echo_ok(self):
        tcp_ok, tls_ok = parse_mainland_agent_output("TCP:0\nTLS:0\n")
        self.assertTrue(tcp_ok)
        self.assertTrue(tls_ok)


if __name__ == "__main__":
    unittest.main()
