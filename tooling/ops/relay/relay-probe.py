#!/usr/bin/env python3
"""End-to-end check of this node's Tono API relay (decision 077).

Runs on a relay node from `tono-relay-probe.timer` every five minutes. It makes
one full HTTPS request to the API *through the local relay port*: TCP to
127.0.0.1:2053, TLS with SNI `api.afk.ccwu.cc` and the default certificate
verification (system CA store, hostname check), `GET /api/v1/health`, and the
Worker's own `{"ok": true, "service": "api"}` answer. That is the path a client
in a broken carrier takes, minus the carrier; the Worker's cron TCP probe only
proves the port is open.

The result goes to `POST /api/v1/home/relay-probe` on the normal API origin
(not through the relay, so a broken relay is still reported), signed with the
exit agent's node token. The control plane maps the token to this node's relay
and decides ok itself. Nothing here can turn verification off.

Environment (systemd `EnvironmentFile=/etc/tono-exit-agent/env`):
  TONO_HOME_AGENT_TOKEN   the exit node token (required, never logged)
  TONO_API_BASE           https://api.afk.ccwu.cc (required, HTTPS origin on 443)
  TONO_RELAY_PROBE_ADDR   relay address to dial, default 127.0.0.1:2053
  TONO_RELAY_PROBE_HOST   SNI / Host to request, default api.afk.ccwu.cc
"""

from __future__ import annotations

import http.client
import json
import os
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_HOST = "api.afk.ccwu.cc"
DEFAULT_ADDR = "127.0.0.1:2053"
PROBE_PATH = "/api/v1/health"
REPORT_PATH = "/api/v1/home/relay-probe"
TIMEOUT_S = 15
ERROR_MAX = 200
# Zone browser-integrity rejects a bare urllib UA with CF 403/1010.
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) tono-relay-probe/1.0"


class RelayHTTPSConnection(http.client.HTTPSConnection):
    """HTTPS to `host` (SNI and certificate checked against it) over TCP to `relay`."""

    def __init__(self, host: str, port: int, relay: tuple[str, int], timeout: float,
                 context: ssl.SSLContext):
        super().__init__(host, port, timeout=timeout, context=context)
        self._relay = relay

    def connect(self) -> None:
        raw = socket.create_connection(self._relay, self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except BaseException:
            raw.close()
            raise


def parse_addr(raw: str) -> tuple[str, int]:
    host, sep, port = raw.rpartition(":")
    if not sep or not host or not port.isdigit() or not 0 < int(port) < 65536:
        raise ValueError(f"bad relay address {raw!r}")
    return host.strip("[]"), int(port)


def describe(error: BaseException) -> str:
    if isinstance(error, ssl.SSLCertVerificationError):
        text = f"tls verify: {error.verify_message or error.reason}"
    elif isinstance(error, ssl.SSLError):
        text = f"tls: {error.reason or error}"
    elif isinstance(error, (socket.timeout, TimeoutError)):
        text = "timeout"
    elif isinstance(error, ConnectionRefusedError):
        text = "connect: refused"
    elif isinstance(error, OSError):
        text = f"connect: {error.strerror or error}"
    else:
        text = f"{type(error).__name__}: {error}"
    return " ".join(text.split())[:ERROR_MAX]


def probe(relay: tuple[str, int], host: str = DEFAULT_HOST, port: int | None = None,
          context: ssl.SSLContext | None = None, timeout: float = TIMEOUT_S) -> dict:
    """One request through the relay. Returns the report body; never raises for a network fault."""
    context = context or ssl.create_default_context()
    observed_at = int(time.time())
    started = time.monotonic()
    conn = RelayHTTPSConnection(host, port or relay[1], relay, timeout, context)
    result = {"observedAt": observed_at, "httpStatus": None, "latencyMs": None, "error": None}
    try:
        conn.request("GET", PROBE_PATH, headers={"accept": "application/json", "user-agent": USER_AGENT})
        response = conn.getresponse()
        payload = response.read(4096)
        result["httpStatus"] = response.status
        result["latencyMs"] = max(0, round((time.monotonic() - started) * 1000))
        if response.status == 200:
            try:
                body = json.loads(payload)
            except ValueError:
                body = None
            if not (isinstance(body, dict) and body.get("ok") is True and body.get("service") == "api"):
                result["error"] = "unexpected body: not the Tono API health answer"
    except (OSError, http.client.HTTPException) as error:
        result["error"] = describe(error)
    finally:
        conn.close()
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never forward the node token to a redirected destination."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "redirects are disabled", headers, fp)


def api_base(raw: str) -> str:
    raw = raw.strip().rstrip("/")
    parsed = urllib.parse.urlsplit(raw)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.port not in (None, 443) or parsed.path or parsed.query or parsed.fragment):
        raise ValueError("TONO_API_BASE must be an HTTPS origin on port 443")
    return raw


def report(base: str, token: str, body: dict) -> int:
    request = urllib.request.Request(
        base + REPORT_PATH,
        data=json.dumps(body).encode(),
        method="POST",
        headers={"content-type": "application/json", "accept": "application/json", "user-agent": USER_AGENT},
    )
    request.add_unredirected_header("Authorization", f"Bearer {token}")
    with urllib.request.build_opener(NoRedirect).open(request, timeout=TIMEOUT_S) as response:
        return response.status


def main() -> int:
    token = os.environ.get("TONO_HOME_AGENT_TOKEN", "").strip()
    if not token:
        print("relay-probe: TONO_HOME_AGENT_TOKEN must be set", file=sys.stderr)
        return 2
    try:
        base = api_base(os.environ.get("TONO_API_BASE", ""))
        relay = parse_addr(os.environ.get("TONO_RELAY_PROBE_ADDR", "") or DEFAULT_ADDR)
    except ValueError as error:
        print(f"relay-probe: {error}", file=sys.stderr)
        return 2
    host = os.environ.get("TONO_RELAY_PROBE_HOST", "").strip() or DEFAULT_HOST
    result = probe(relay, host)
    print("relay-probe: " + json.dumps(result, sort_keys=True))
    try:
        status = report(base, token, result)
    except urllib.error.HTTPError as error:
        print(f"relay-probe: report refused: HTTP {error.code}", file=sys.stderr)
        return 1
    except (OSError, urllib.error.URLError) as error:
        print(f"relay-probe: report not delivered: {describe(error)}", file=sys.stderr)
        return 1
    print(f"relay-probe: reported, HTTP {status}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
