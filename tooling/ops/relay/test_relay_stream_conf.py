"""Static checks of tono-relay.stream.conf (decision 086, H1-F5 Option A).

While macOS protection is armed without a tunnel, the helper's PF admits the
control plane only to the relays on TCP 2053. That bound is only as narrow as
this file: the relay must forward the API and release SNIs alone, refuse every
other name, never terminate TLS, and listen on 2053 only (tono-xray owns 443).

Run: python3 -m unittest discover -s tooling/ops/relay -p 'test_*.py'
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

CONF = Path(__file__).resolve().parent / "tono-relay.stream.conf"
ADMITTED = {"api.afk.ccwu.cc", "releases.afk.ccwu.cc"}


def strip_comments(text: str) -> str:
    return "\n".join(line.split("#", 1)[0] for line in text.splitlines())


def block(text: str, header: str) -> str:
    """The body of the first `header { ... }` block (no nested braces here)."""
    match = re.search(re.escape(header) + r"\s*\{([^{}]*)\}", text)
    if match is None:
        raise AssertionError(f"no block {header!r}")
    return match.group(1)


def map_entries(text: str, variable: str) -> dict[str, str]:
    body = block(text, f"map $ssl_preread_server_name ${variable}")
    entries: dict[str, str] = {}
    for statement in body.split(";"):
        words = statement.split()
        if not words:
            continue
        if len(words) != 2:
            raise AssertionError(f"unexpected map statement {statement.strip()!r}")
        key, value = words
        if key in entries:
            raise AssertionError(f"duplicate map key {key!r}")
        entries[key] = value
    return entries


class RelayStreamConfTest(unittest.TestCase):
    def test_only_the_api_and_release_snis_are_forwarded_and_the_rest_is_refused(self):
        text = strip_comments(CONF.read_text())

        upstream = map_entries(text, "tono_relay_upstream")
        named = {key: value for key, value in upstream.items() if key != "default"}
        # Exact names only: no wildcard, regex, or hostnames-mode entry could
        # widen the allow-list beyond the two Tono hosts.
        self.assertEqual(set(named), ADMITTED)
        self.assertFalse(any(key[0] in "~*." or "*" in key for key in upstream))
        self.assertNotRegex(block(text, "map $ssl_preread_server_name $tono_relay_upstream"),
                            r"\b(hostnames|volatile|include)\b")
        self.assertEqual(set(named.values()), {"tono_control_plane"})
        # Every other SNI, and a ClientHello without one, goes to a closed
        # loopback port: the connection is refused, nothing is forwarded.
        self.assertEqual(upstream.get("default"), "127.0.0.1:9")

        # The upstream is the Cloudflare edge for those hosts, on 443.
        servers = re.findall(r"^\s*server\s+(\S+?)(?:\s+\w+)*\s*;",
                             block(text, "upstream tono_control_plane"), re.M)
        self.assertTrue(servers)
        self.assertTrue(all(server.endswith(":443") for server in servers))

        server = block(text, "server")
        listens = re.findall(r"^\s*listen\s+(\S+)", server, re.M)
        self.assertEqual(sorted(listens), sorted(["2053", "[::]:2053"]))
        self.assertRegex(server, r"(?m)^\s*ssl_preread\s+on\s*;")
        self.assertRegex(server, r"(?m)^\s*proxy_pass\s+\$tono_relay_upstream\s*;")
        # TLS passes through: no certificate, no key, no termination.
        self.assertNotRegex(text, r"\bssl_certificate(_key)?\b")
        self.assertNotRegex(text, r"\blisten\s+\S*\b443\b")


if __name__ == "__main__":
    unittest.main()
