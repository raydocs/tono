import contextlib
import importlib.util
import io
import os
import tempfile
import unittest
from unittest import mock
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

        token = "tna1." + "A" * 16 + "." + "b" * 43
        good = "TONO_API_BASE=https://api.afk.ccwu.cc\nTONO_NODE_NAME=Tokyo · Kite\n"

        def run_with(config_text: str, token_text: str) -> str:
            with tempfile.TemporaryDirectory() as tmp:
                config = Path(tmp) / "node-agent.conf"
                config.write_text(config_text)
                (Path(tmp) / "node-agent-token").write_text(token_text)
                stderr = io.StringIO()
                with mock.patch.dict(os.environ, {"CREDENTIALS_DIRECTORY": tmp}), \
                        contextlib.redirect_stderr(stderr):
                    self.assertNotEqual(agent.main(["--config", str(config)]), 0)
            self.assertNotIn(token[5:], stderr.getvalue())
            return stderr.getvalue()

        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "node-agent.conf").write_text(good)
            (Path(tmp) / "node-agent-token").write_text(token + "\n")
            self.assertEqual(agent.load_config(Path(tmp) / "node-agent.conf")["TONO_NODE_NAME"], "Tokyo · Kite")
            self.assertEqual(agent.read_token(Path(tmp) / "node-agent-token"), token)
        # The token twice in the credential, the token as an unknown key, a token-shaped
        # value where the API base belongs: each refused, none echoed.
        self.assertIn("refused", run_with(good, f"{token}\n{token}\n"))
        self.assertIn("config line 3", run_with(good + f"LD_PRELOAD={token}\n", token))
        self.assertIn("config line 1", run_with(f"{token}=1\n", token))
        self.assertIn("refused", run_with(f"TONO_API_BASE={token}\nTONO_NODE_NAME=x\n", token))

        # A child process sees neither this environment nor the journal: a stub
        # systemctl that dumps its env and args writes nothing that reaches fd 1/2.
        with tempfile.TemporaryDirectory() as tmp:
            stub = Path(tmp) / "systemctl"
            stub.write_text('#!/bin/sh\nenv >&2\necho "$@"\nexit 0\n')
            stub.chmod(0o755)
            with open(Path(tmp) / "fds", "w+b") as sink, mock.patch.object(agent, "SYSTEMCTL", str(stub)), \
                    mock.patch.dict(os.environ, {"SYSTEMD_LOG_LEVEL": token, "SYSTEMD_LOG_TARGET": token}):
                saved = [os.dup(1), os.dup(2)]
                os.dup2(sink.fileno(), 1)
                os.dup2(sink.fileno(), 2)
                try:
                    active = agent.unit_active("tono-xray")
                finally:
                    os.dup2(saved[0], 1)
                    os.dup2(saved[1], 2)
                    for fd in saved:
                        os.close(fd)
                sink.seek(0)
                leaked = sink.read().decode(errors="replace")
        self.assertTrue(active)
        self.assertNotIn(token[5:], leaked)


if __name__ == "__main__":
    unittest.main()
