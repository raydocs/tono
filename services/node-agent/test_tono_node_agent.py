import importlib.util
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("tono_node_agent", HERE / "tono_node_agent.py")
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class NodeAgentTest(unittest.TestCase):
    def test_reports_only_running_tono_services_and_refuses_a_non_origin_base(self):
        with tempfile.TemporaryDirectory() as tmp:
            relay_conf = Path(tmp) / "tono-relay.stream.conf"
            relay_conf.write_text("")
            running = {"tono-xray", "nginx"}
            roles = agent.detect_roles(lambda unit: unit in running, relay_conf)
        self.assertEqual(roles, ["xray", "relay"])
        self.assertEqual(
            agent.heartbeat_payload("Tokyo · Kite", roles, "203.0.113.9"),
            {"node": "Tokyo · Kite", "roles": ["xray", "relay"], "agentVersion": agent.AGENT_VERSION, "ip": "203.0.113.9"},
        )
        self.assertEqual(agent.api_base("https://api.afk.ccwu.cc/"), "https://api.afk.ccwu.cc")
        for bad in ("http://api.afk.ccwu.cc", "https://api.afk.ccwu.cc:8443", "https://api.afk.ccwu.cc/x"):
            with self.assertRaises(agent.Refusal, msg=bad):
                agent.api_base(bad)


if __name__ == "__main__":
    unittest.main()
