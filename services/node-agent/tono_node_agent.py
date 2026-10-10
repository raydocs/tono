#!/usr/bin/env python3
"""Tono node agent v1: one heartbeat to the control plane (backlog A20, D7-A).

Reports this node's name, its primary outbound address, the Tono services it
runs (xray / hy2 / relay) and the agent version. The token is per node, issued
once by an owner in the ops console API, and only ever authenticates this
heartbeat; it cannot list, publish or change any node. Run from the systemd
timer next to this file. Python 3 standard library only.

Configuration is a root-owned file (default /etc/tono/node-agent.conf, see
node-agent.conf.example) of KEY=value lines; only these keys are accepted:
  TONO_API_BASE      bare HTTPS origin, e.g. https://api.afk.ccwu.cc
  TONO_NODE_NAME     the node's catalog name, exactly as in the ops console
The token comes only from the systemd credential node-agent-token
($CREDENTIALS_DIRECTORY/node-agent-token). The environment is not read for
configuration, and no output line ever carries a configured value, a path,
file contents or exception text.
"""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable

AGENT_VERSION = "1.0.0"
HEARTBEAT_PATH = "/api/v1/node-agent/heartbeat"
RELAY_CONF = Path("/etc/nginx/tono-relay.stream.conf")
SYSTEMCTL = "/usr/bin/systemctl"
CHILD_ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C"}
# The exact token grammar (see the control plane's node-agent.ts). Anything
# else is refused before it can reach an HTTP header, so a malformed file can
# never surface the token in an exception message or the journal.
CONFIG_PATH = Path("/etc/tono/node-agent.conf")
CONFIG_KEYS = ("TONO_API_BASE", "TONO_NODE_NAME")
CONFIG_MAX_BYTES = 4096
TOKEN_SHAPE = re.compile(r"tna1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}")


class Refusal(RuntimeError):
    """Configuration this agent will not send a token with.

    Messages are fixed text naming a variable at most. They never include an
    environment value, a path, file contents or another exception's text: any
    of those may be the token, and this line goes to the journal.
    """


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never forward the node token to a redirected destination."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "redirects are disabled", headers, fp)


def api_base(raw: str) -> str:
    raw = raw.strip().rstrip("/")
    try:
        parsed = urllib.parse.urlsplit(raw)
        port = parsed.port
    except ValueError as error:
        raise Refusal("TONO_API_BASE must be an HTTPS origin on port 443") from None
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise Refusal("TONO_API_BASE must be an HTTPS origin on port 443")
    return raw


def unit_active(unit: str) -> bool:
    """Only the exit code is kept. The child gets a fixed minimal environment and
    no output channel, so nothing in this service's environment (a token pasted
    into the wrong variable included) can be echoed into the journal by it."""
    return subprocess.run(
        [SYSTEMCTL, "is-active", "--quiet", unit],
        check=False,
        timeout=10,
        env=CHILD_ENV,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).returncode == 0


def detect_roles(active: Callable[[str], bool] = unit_active, relay_conf: Path = RELAY_CONF) -> list[str]:
    roles = []
    if active("tono-xray"):
        roles.append("xray")
    if active("tono-hy2"):
        roles.append("hy2")
    if relay_conf.exists() and active("nginx"):
        roles.append("relay")
    return roles


def outbound_ip() -> str | None:
    """The source address the kernel picks for the internet. No packet is sent."""
    for family, target in ((socket.AF_INET, "1.1.1.1"), (socket.AF_INET6, "2606:4700:4700::1111")):
        try:
            with socket.socket(family, socket.SOCK_DGRAM) as probe:
                probe.connect((target, 53))
                return probe.getsockname()[0]
        except OSError:
            continue
    return None


def heartbeat_payload(node: str, roles: list[str], ip: str | None) -> dict:
    payload: dict = {"node": node, "roles": roles, "agentVersion": AGENT_VERSION}
    if ip:
        payload["ip"] = ip
    return payload


def load_config(path: Path) -> dict[str, str]:
    """Allow-listed KEY=value lines. Errors name a line number at most."""
    try:
        raw = path.read_bytes()
    except (OSError, ValueError) as error:
        raise Refusal(f"cannot read the config file ({type(error).__name__})") from None
    if len(raw) > CONFIG_MAX_BYTES:
        raise Refusal("the config file is too large")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise Refusal("the config file is not UTF-8") from None
    config: dict[str, str] = {}
    for number, line in enumerate(text.splitlines(), start=1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        key = key.strip()
        if not sep or key not in CONFIG_KEYS:
            raise Refusal(f"config line {number} is not one of {', '.join(CONFIG_KEYS)}")
        if key in config:
            raise Refusal(f"config line {number} repeats a key")
        config[key] = value.strip()
    missing = [key for key in CONFIG_KEYS if not config.get(key)]
    if missing:
        raise Refusal(f"the config file must set {', '.join(missing)}")
    node = config["TONO_NODE_NAME"]
    if len(node) > 200 or any(ord(char) < 32 or ord(char) == 127 for char in node):
        raise Refusal("TONO_NODE_NAME is not a catalog name")
    return config


def read_token(path: Path) -> str:
    try:
        text = path.read_text()
    except (OSError, ValueError) as error:
        raise Refusal(
            f"cannot read the node-agent-token credential ({type(error).__name__})"
        ) from None
    token = text[:-1] if text.endswith("\n") else text
    if not TOKEN_SHAPE.fullmatch(token):
        raise Refusal("the node-agent-token credential must hold exactly one tna1 token on one line")
    return token


def config_path(argv: list[str]) -> Path:
    if not argv:
        return CONFIG_PATH
    if len(argv) == 2 and argv[0] == "--config":
        return Path(argv[1])
    raise Refusal("usage: tono_node_agent.py [--config PATH]")


def main(argv: list[str] | None = None) -> int:
    """Every exit path prints a secret-free line; no exception text is echoed."""
    try:
        return run(sys.argv[1:] if argv is None else argv)
    except Exception as error:  # noqa: BLE001 - the message may carry a secret
        print(f"heartbeat failed: {type(error).__name__}", file=sys.stderr)
        return 1


def run(argv: list[str]) -> int:
    try:
        config = load_config(config_path(argv))
        base = api_base(config["TONO_API_BASE"])
        node = config["TONO_NODE_NAME"]
        credentials = os.environ.get("CREDENTIALS_DIRECTORY", "")
        if not credentials:
            raise Refusal("no systemd credentials: run from tono-node-agent.service")
        token = read_token(Path(credentials) / "node-agent-token")
    except Refusal as error:
        print(f"refused: {error}", file=sys.stderr)
        return 2
    payload = heartbeat_payload(node, detect_roles(), outbound_ip())
    request = urllib.request.Request(
        base + HEARTBEAT_PATH,
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
    )
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
            print(f"ok {response.status}: roles={','.join(payload['roles']) or '-'}")
            return 0
    except urllib.error.HTTPError as error:
        print(f"heartbeat refused: HTTP {error.code}", file=sys.stderr)
    except urllib.error.URLError as error:
        print(f"heartbeat failed: {type(error.reason).__name__}", file=sys.stderr)
    except OSError as error:
        print(f"heartbeat failed: {type(error).__name__}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
