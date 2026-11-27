#!/usr/bin/env python3
"""Non-prod Xray capabilities probe for RFC PR 0 (node-side residential SOCKS5).

Verifies on a given Xray binary (without geoip.dat / geosite.dat):
  A. Existing static/legacy/u: clients keep reaching `direct` (freedom Index 0)
  B. Unbound `h:` identities hit static catch-all `home-blackhole` fail-closed
  C. Dynamic `ado` + replace-all `adrules` (`-append=false`) + `domainStrategy: "AsIs"`
     preserves open `u:` streams and forwards domain names verbatim (ATYP=0x03)
  D. Literal private/CGNAT/loopback/link-local CIDRs for `h:` hit `home-blackhole`
  E. Per-tenant unbind (`rmu` -> replace rules -> `rmo`) behavior on open streams & `u:`
  F. Unified `StatsService` per-user counters for both `u:` and `h:`
  G. CLI vs HTTP/2-gRPC `RoutingService/TestRoute` availability
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import socket
import socketserver
import struct
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

API_TAG = "api"
API_INBOUND_TAG = "tono-api"
VLESS_INBOUND_TAG = "vless-in"
HOME_BLACKHOLE_TAG = "home-blackhole"
DIRECT_OUTBOUND_TAG = "direct"

# Exact 9 literal private/loopback/link-local/CGNAT CIDRs from RFC §4.2
PRIVATE_HOME_CIDRS: tuple[str, ...] = (
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "100.64.0.0/10",
    "fc00::/7",
    "fe80::/10",
    "::1/128",
)

PRIVATE_PROBE_TARGETS: tuple[tuple[str, int], ...] = (
    ("10.0.0.1", 80),
    ("172.16.0.1", 80),
    ("192.168.1.1", 80),
    ("169.254.169.254", 80),
    ("100.64.0.1", 80),
    ("::1", 80),
    ("fc00::1", 80),
    ("fe80::1", 80),
)


def free_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def build_base_xray_config(
    api_port: int,
    vless_port: int,
    static_clients: list[dict[str, str]],
    *,
    allow_loopback_direct_for_harness: bool = False,
) -> dict[str, Any]:
    """Build static Xray config matching exit_metering_config.py + RFC §4.2 guards.

    When `allow_loopback_direct_for_harness=True`, `direct` permits `127.0.0.1/32`
    so the offline probe can reach the local mock direct echo server on Xray >=
    26.11 (where `freedom`'s default `finalRules` otherwise blocks loopback).
    Static `-test` config validation runs with `allow_loopback_direct_for_harness=False`.
    """
    direct_outbound: dict[str, Any] = {"tag": DIRECT_OUTBOUND_TAG, "protocol": "freedom"}
    if allow_loopback_direct_for_harness:
        direct_outbound["settings"] = {
            "finalRules": [{"action": "allow", "ip": ["127.0.0.1/32"]}],
        }
    return {
        "log": {"loglevel": "warning"},
        "stats": {},
        "policy": {
            "levels": {
                "0": {
                    "statsUserUplink": True,
                    "statsUserDownlink": True,
                }
            }
        },
        "api": {
            "tag": API_TAG,
            "services": ["HandlerService", "RoutingService", "StatsService"],
        },
        "inbounds": [
            {
                "tag": API_INBOUND_TAG,
                "listen": "127.0.0.1",
                "port": api_port,
                "protocol": "dokodemo-door",
                "settings": {"address": "127.0.0.1"},
            },
            {
                "tag": VLESS_INBOUND_TAG,
                "listen": "127.0.0.1",
                "port": vless_port,
                "protocol": "vless",
                "settings": {
                    "decryption": "none",
                    "clients": list(static_clients),
                },
                "streamSettings": {"network": "tcp", "security": "none"},
                "sniffing": {"enabled": False},
            },
        ],
        "outbounds": [
            direct_outbound,
            {"tag": HOME_BLACKHOLE_TAG, "protocol": "blackhole"},
        ],
        "routing": {
            "domainStrategy": "AsIs",
            "rules": build_routing_rules([]),
        },
    }


def build_routing_rules(home_bindings: list[tuple[str, list[str], str]]) -> list[dict[str, Any]]:
    """Build exact ordered rule list for atomic full-table replace-all.

    `home_bindings` is a list of `(rule_tag, user_labels, outbound_tag)` tuples.
    Order invariant:
      1. API inbound -> api
      2. regexp:^h: + 9 literal private CIDRs -> home-blackhole
      3. per-line h: user labels -> home:<id>:<gen>
      4. regexp:^h: catch-all -> home-blackhole
    """
    rules: list[dict[str, Any]] = [
        {
            "type": "field",
            "ruleTag": "tono-api-rule",
            "inboundTag": [API_INBOUND_TAG],
            "outboundTag": API_TAG,
        },
        {
            "type": "field",
            "ruleTag": "tono-home-private-cidrs",
            "user": ["regexp:^h:"],
            "ip": list(PRIVATE_HOME_CIDRS),
            "outboundTag": HOME_BLACKHOLE_TAG,
        },
    ]
    for rule_tag, users, outbound_tag in home_bindings:
        rules.append(
            {
                "type": "field",
                "ruleTag": rule_tag,
                "user": list(users),
                "outboundTag": outbound_tag,
            }
        )
    rules.append(
        {
            "type": "field",
            "ruleTag": "tono-home-catchall",
            "user": ["regexp:^h:"],
            "outboundTag": HOME_BLACKHOLE_TAG,
        }
    )
    return rules


def encode_vless_tcp_request(client_uuid: str, host: str, port: int) -> bytes:
    """Encode VLESS v0 TCP request header (command 0x01, no addons)."""
    raw_uuid = uuid.UUID(client_uuid).bytes
    header = bytearray(b"\x00")
    header += raw_uuid
    header += b"\x00\x01"
    header += struct.pack(">H", port)
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        domain_bytes = host.encode("ascii")
        if not 1 <= len(domain_bytes) <= 255:
            raise ValueError(f"invalid domain length: {host}")
        header.append(2)
        header.append(len(domain_bytes))
        header += domain_bytes
    else:
        if addr.version == 4:
            header.append(1)
            header += addr.packed
        else:
            header.append(3)
            header += addr.packed
    return bytes(header)


def parse_socks5_connect_request(buf: bytes) -> tuple[int, str, int] | None:
    """Parse RFC 1928 SOCKS5 CONNECT request header from buffer, or None if incomplete."""
    if len(buf) < 4:
        return None
    ver, cmd, _rsv, atyp = buf[0], buf[1], buf[2], buf[3]
    if ver != 5 or cmd != 1:
        raise ValueError(f"unexpected SOCKS5 request header ver={ver} cmd={cmd}")
    if atyp == 1:
        if len(buf) < 4 + 4 + 2:
            return None
        addr = str(ipaddress.IPv4Address(buf[4:8]))
        port = struct.unpack(">H", buf[8:10])[0]
        return atyp, addr, port
    if atyp == 3:
        if len(buf) < 5:
            return None
        dlen = buf[4]
        if len(buf) < 5 + dlen + 2:
            return None
        addr = buf[5 : 5 + dlen].decode("utf-8", "replace")
        port = struct.unpack(">H", buf[5 + dlen : 7 + dlen])[0]
        return atyp, addr, port
    if atyp == 4:
        if len(buf) < 4 + 16 + 2:
            return None
        addr = str(ipaddress.IPv6Address(buf[4:20]))
        port = struct.unpack(">H", buf[20:22])[0]
        return atyp, addr, port
    raise ValueError(f"unsupported SOCKS5 atyp={atyp}")


def parse_supported_api_commands(api_output: str) -> set[str]:
    cmds = set(re.findall(r"^\s+([a-z][a-z0-9]+)\s+", api_output, re.MULTILINE))
    # Usage banner (`\txray api <command>`) matches the indented token pattern.
    cmds.discard("xray")
    return cmds


def classify_capabilities(summary: dict[str, Any]) -> dict[str, Any]:
    """Derive structured PR 0 decision gates from raw probe check results."""
    checks = summary.get("checks", {})
    all_core_routing_ok = all(
        bool(checks.get(name, {}).get("passed"))
        for name in (
            "test_without_geoip",
            "non_h_clients_intact",
            "static_h_catchall_fail_closed",
            "ado_plus_replace_all_rules_and_asis",
            "literal_private_cidrs_blocked",
            "stats_unified_u_and_h",
        )
    )
    check_e = checks.get("replace_all_revocation_and_rmo_stream_cancellation", {})
    cli_cmds = set(summary.get("api_commands", []))
    return {
        "core_routing_fail_closed_ready": all_core_routing_ok
        and bool(check_e.get("new_conn_rejected_after_rmu"))
        and bool(check_e.get("u_stream_survived_unbind")),
        "adrules_replace_all_supported": bool(checks.get("ado_plus_replace_all_rules_and_asis", {}).get("replace_all_verified")),
        "rmo_cancels_established_stream": bool(check_e.get("rmo_cancels_established_stream")),
        "cli_testroute_supported": "testroute" in cli_cmds,
        "grpc_testroute_supported": bool(checks.get("testroute_availability", {}).get("grpc_testroute_available")),
    }


def _pb_varint(n: int) -> bytes:
    out = bytearray()
    while n >= 0x80:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)
    return bytes(out)


def _pb_bytes(field_no: int, val: bytes) -> bytes:
    return _pb_varint((field_no << 3) | 2) + _pb_varint(len(val)) + val


def _pb_str(field_no: int, val: str) -> bytes:
    return _pb_bytes(field_no, val.encode("utf-8"))


def _pb_int(field_no: int, val: int) -> bytes:
    return _pb_varint((field_no << 3) | 0) + _pb_varint(val)


def encode_test_route_request(
    *,
    inbound_tag: str,
    user: str,
    target_domain: str = "",
    target_ip: str = "",
    target_port: int = 443,
) -> bytes:
    ctx = bytearray()
    if inbound_tag:
        ctx += _pb_str(1, inbound_tag)
    ctx += _pb_int(2, 2)  # TCP
    if target_ip:
        ctx += _pb_bytes(4, ipaddress.ip_address(target_ip).packed)
    if target_port:
        ctx += _pb_int(6, target_port)
    if target_domain:
        ctx += _pb_str(7, target_domain)
    if user:
        ctx += _pb_str(9, user)
    req = bytearray()
    req += _pb_bytes(1, bytes(ctx))
    req += _pb_str(2, "outbound")
    return bytes(req)


def _decode_routing_context(data: bytes) -> dict[str, Any]:
    i = 0
    res: dict[str, Any] = {}
    while i < len(data):
        tag = 0
        shift = 0
        while True:
            b = data[i]
            i += 1
            tag |= (b & 0x7F) << shift
            if not (b & 0x80):
                break
            shift += 7
        fn, wt = tag >> 3, tag & 7
        if wt == 0:
            v = 0
            shift = 0
            while True:
                b = data[i]
                i += 1
                v |= (b & 0x7F) << shift
                if not (b & 0x80):
                    break
                shift += 7
            res[f"f{fn}"] = v
        elif wt == 2:
            ln = 0
            shift = 0
            while True:
                b = data[i]
                i += 1
                ln |= (b & 0x7F) << shift
                if not (b & 0x80):
                    break
                shift += 7
            val = data[i : i + ln]
            i += ln
            if fn == 12:
                res["outbound_tag"] = val.decode("utf-8", "replace")
            elif fn == 11:
                res.setdefault("outbound_group_tags", []).append(val.decode("utf-8", "replace"))
            else:
                res.setdefault(f"f{fn}", []).append(val.hex())
        else:
            raise ValueError(f"unsupported protobuf wire type {wt}")
    return res


def grpc_test_route(api_port: int, **ctx_kwargs: Any) -> dict[str, Any]:
    """Call /xray.app.router.command.RoutingService/TestRoute over pure stdlib h2c."""
    body = encode_test_route_request(**ctx_kwargs)
    frame_payload = b"\x00" + struct.pack(">I", len(body)) + body

    def h2_frame(ftype: int, flags: int, sid: int, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))[1:]
            + bytes([ftype, flags])
            + struct.pack(">I", sid & 0x7FFFFFFF)
            + payload
        )

    def enc_int(val: int, prefix_bits: int, mask: int) -> bytes:
        max_v = (1 << prefix_bits) - 1
        if val < max_v:
            return bytes([mask | val])
        out = bytearray([mask | max_v])
        val -= max_v
        while val >= 128:
            out.append((val & 0x7F) | 0x80)
            val >>= 7
        out.append(val)
        return bytes(out)

    def enc_str(val: bytes) -> bytes:
        return enc_int(len(val), 7, 0x00) + val

    hdrs = bytearray([0x83, 0x86])  # :method POST, :scheme http
    hdrs += enc_int(4, 4, 0x00) + enc_str(b"/xray.app.router.command.RoutingService/TestRoute")
    hdrs += enc_int(1, 4, 0x00) + enc_str(f"127.0.0.1:{api_port}".encode("ascii"))
    hdrs += enc_int(31, 4, 0x00) + enc_str(b"application/grpc")
    hdrs += b"\x00" + enc_str(b"te") + enc_str(b"trailers")

    with socket.create_connection(("127.0.0.1", api_port), timeout=3.0) as sock:
        sock.sendall(b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n")
        sock.sendall(h2_frame(0x04, 0x00, 0, b""))
        sock.sendall(h2_frame(0x01, 0x04, 1, bytes(hdrs)))
        sock.sendall(h2_frame(0x00, 0x01, 1, frame_payload))
        data_bytes = bytearray()
        sock.settimeout(2.0)
        buf = b""
        done = False
        saw_headers = False
        while not done:
            while len(buf) < 9:
                chunk = sock.recv(4096)
                if not chunk:
                    done = True
                    break
                buf += chunk
            if len(buf) < 9:
                break
            length = int.from_bytes(buf[:3], "big")
            ftype, flags = buf[3], buf[4]
            sid = int.from_bytes(buf[5:9], "big") & 0x7FFFFFFF
            while len(buf) < 9 + length:
                chunk = sock.recv(4096)
                if not chunk:
                    done = True
                    break
                buf += chunk
            if len(buf) < 9 + length:
                break
            payload = buf[9 : 9 + length]
            buf = buf[9 + length :]
            if ftype == 0x04 and (flags & 0x01) == 0:
                sock.sendall(h2_frame(0x04, 0x01, 0, b""))
            elif ftype == 0x01 and sid == 1:
                saw_headers = True
                if flags & 0x01:
                    done = True
            elif ftype == 0x00 and sid == 1:
                data_bytes += payload
            elif ftype == 0x03 and sid == 1:
                done = True
            elif ftype == 0x07:
                done = True
        raw = bytes(data_bytes)
        if len(raw) >= 5:
            msg_len = struct.unpack(">I", raw[1:5])[0]
            decoded = _decode_routing_context(raw[5 : 5 + msg_len])
            decoded["grpc_ok"] = True
            return decoded
        return {"grpc_ok": saw_headers, "outbound_tag": "", "raw_len": len(raw)}


class _DirectEchoHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        self.server.hits.append(self.client_address[0])  # type: ignore[attr-defined]
        while True:
            line = self.rfile.readline()
            if not line:
                break
            self.wfile.write(b"DIRECT:" + line)
            self.wfile.flush()


class _ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


class _MockSocks5Server(_ThreadedTCPServer):
    def __init__(self, server_address: tuple[str, int], expected_user: str, expected_pass: str) -> None:
        self.expected_user = expected_user
        self.expected_pass = expected_pass
        self.lock = threading.Lock()
        self.connections: list[dict[str, Any]] = []
        self.open_events = 0
        self.closed_events = 0
        super().__init__(server_address, _MockSocks5Handler)


class _MockSocks5Handler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        srv: _MockSocks5Server = self.server  # type: ignore[assignment]
        sock = self.request
        sock.settimeout(5.0)
        closed_recorded = False
        with srv.lock:
            srv.open_events += 1
        try:
            greeting = self._recv_exact(sock, 2)
            if not greeting or greeting[0] != 5:
                return
            methods = self._recv_exact(sock, greeting[1])
            if 0x02 not in methods:
                sock.sendall(b"\x05\xff")
                return
            sock.sendall(b"\x05\x02")

            # RFC 1929 username/password
            ver = self._recv_exact(sock, 1)
            if not ver or ver[0] != 1:
                return
            ulen = self._recv_exact(sock, 1)[0]
            uname = self._recv_exact(sock, ulen).decode("utf-8", "replace")
            plen = self._recv_exact(sock, 1)[0]
            upass = self._recv_exact(sock, plen).decode("utf-8", "replace")
            if uname != srv.expected_user or upass != srv.expected_pass:
                sock.sendall(b"\x01\x01")
                return
            sock.sendall(b"\x01\x00")

            # RFC 1928 request
            req_buf = bytearray(self._recv_exact(sock, 4))
            while True:
                try:
                    parsed = parse_socks5_connect_request(bytes(req_buf))
                except ValueError:
                    return
                if parsed is not None:
                    break
                chunk = sock.recv(64)
                if not chunk:
                    return
                req_buf += chunk
            atyp, dst_addr, dst_port = parsed
            with srv.lock:
                srv.connections.append(
                    {
                        "username": uname,
                        "password_len": len(upass),
                        "atyp": atyp,
                        "dst_addr": dst_addr,
                        "dst_port": dst_port,
                    }
                )
            # Success reply (bound 0.0.0.0:0)
            sock.sendall(b"\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00")

            # Interactive echo loop
            sock.settimeout(0.5)
            f_in = sock.makefile("rb", buffering=0)
            prefix = f"SOCKS5:{dst_addr}:".encode("utf-8")
            while True:
                try:
                    line = f_in.readline()
                except TimeoutError:
                    continue
                if not line:
                    break
                sock.sendall(prefix + line)
                with srv.lock:
                    pass
        except (OSError, ValueError):
            pass
        finally:
            if not closed_recorded:
                with srv.lock:
                    srv.closed_events += 1
                closed_recorded = True

    @staticmethod
    def _recv_exact(sock: socket.socket, n: int) -> bytes:
        buf = bytearray()
        while len(buf) < n:
            chunk = sock.recv(n - len(buf))
            if not chunk:
                raise EOFError("unexpected EOF")
            buf += chunk
        return bytes(buf)


class _VlessStream:
    def __init__(self, vless_port: int, client_uuid: str, target_host: str, target_port: int, timeout: float) -> None:
        self.sock = socket.create_connection(("127.0.0.1", vless_port), timeout=timeout)
        self.sock.settimeout(timeout)
        self._resp_header_read = False
        self._buf = bytearray()
        self.sock.sendall(encode_vless_tcp_request(client_uuid, target_host, target_port))

    def _consume_vless_resp_header(self) -> None:
        if self._resp_header_read:
            return
        while len(self._buf) < 2:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise EOFError("closed before VLESS response header")
            self._buf += chunk
        ver, addons_len = self._buf[0], self._buf[1]
        while len(self._buf) < 2 + addons_len:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise EOFError("closed inside VLESS addons")
            self._buf += chunk
        del self._buf[: 2 + addons_len]
        if ver != 0:
            raise ValueError(f"unexpected VLESS response version {ver}")
        self._resp_header_read = True

    def ping_line(self, payload: bytes) -> str:
        self.sock.sendall(payload)
        self._consume_vless_resp_header()
        while b"\n" not in self._buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise EOFError("closed while awaiting echo line")
            self._buf += chunk
        idx = self._buf.index(b"\n") + 1
        line = bytes(self._buf[:idx])
        del self._buf[:idx]
        return line.decode("utf-8", "replace").rstrip("\r\n")

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


def _vless_dial_expect_blocked(vless_port: int, client_uuid: str, host: str, port: int, timeout: float) -> tuple[bool, str]:
    stream: _VlessStream | None = None
    try:
        stream = _VlessStream(vless_port, client_uuid, host, port, timeout)
        reply = stream.ping_line(b"PROBE_BLOCK\n")
        return False, f"unexpectedly echoed: {reply}"
    except (EOFError, OSError, TimeoutError) as exc:
        return True, f"{type(exc).__name__}: {exc}"
    finally:
        if stream is not None:
            stream.close()


def _run_cmd(args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, env=env, capture_output=True, text=True, timeout=10)


def _write_temp_json(tmp_dir: str, name: str, data: Any) -> str:
    path = os.path.join(tmp_dir, name)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle)
    os.chmod(path, 0o600)
    return path


def _adu_vless_client(xray_bin: str, env: dict[str, str], addr: str, tmp_dir: str, tag: str, email: str, cid: str) -> subprocess.CompletedProcess[str]:
    path = _write_temp_json(
        tmp_dir,
        f"adu-{email.replace(':', '_')}.json",
        {
            "inbounds": [
                {
                    "tag": tag,
                    "listen": "127.0.0.1",
                    "port": 1,
                    "protocol": "vless",
                    "settings": {
                        "decryption": "none",
                        "clients": [{"email": email, "id": cid}],
                    },
                }
            ]
        },
    )
    return _run_cmd([xray_bin, "api", "adu", f"--server={addr}", path], env)


def run_probe(xray_bin: str, version_label: str | None, timeout: float) -> dict[str, Any]:
    xray_path = Path(xray_bin).resolve()
    if not xray_path.is_file():
        raise FileNotFoundError(f"xray binary not found: {xray_bin}")

    with tempfile.TemporaryDirectory(prefix="tono-xray-pr0-") as tmp_dir:
        empty_assets = os.path.join(tmp_dir, "empty-assets")
        os.mkdir(empty_assets, 0o700)
        staging = os.path.join(tmp_dir, "staging")
        os.mkdir(staging, 0o700)
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "XRAY_LOCATION_ASSET": empty_assets,
        }

        ver_proc = _run_cmd([str(xray_path), "version"], env)
        api_proc = _run_cmd([str(xray_path), "api"], env)
        adrules_help = _run_cmd([str(xray_path), "help", "api", "adrules"], env)
        api_cmds = sorted(parse_supported_api_commands(f"{api_proc.stdout}\n{api_proc.stderr}"))

        api_port = free_tcp_port()
        vless_port = free_tcp_port()
        direct_port = free_tcp_port()
        socks_port = free_tcp_port()

        uuids = {
            "shared-legacy": str(uuid.uuid4()),
            "user-42": str(uuid.uuid4()),
            "u:1001:dev1:gen1": str(uuid.uuid4()),
            "h:1001:dev1:gen1": str(uuid.uuid4()),
            "h:2002:dev2:gen1": str(uuid.uuid4()),
        }

        prod_cfg = build_base_xray_config(
            api_port=api_port,
            vless_port=vless_port,
            static_clients=[
                {"email": "shared-legacy", "id": uuids["shared-legacy"]},
                {"email": "user-42", "id": uuids["user-42"]},
            ],
            allow_loopback_direct_for_harness=False,
        )
        prod_cfg_path = _write_temp_json(tmp_dir, "config-prod.json", prod_cfg)
        test_proc = _run_cmd([str(xray_path), "run", "-test", "-c", prod_cfg_path], env)
        checks: dict[str, Any] = {
            "test_without_geoip": {
                "passed": test_proc.returncode == 0,
                "returncode": test_proc.returncode,
                "stdout": test_proc.stdout.strip(),
                "stderr": test_proc.stderr.strip(),
            }
        }
        if test_proc.returncode != 0:
            raise RuntimeError(f"xray run -test failed: {test_proc.stderr}")

        runtime_cfg = build_base_xray_config(
            api_port=api_port,
            vless_port=vless_port,
            static_clients=[
                {"email": "shared-legacy", "id": uuids["shared-legacy"]},
                {"email": "user-42", "id": uuids["user-42"]},
            ],
            allow_loopback_direct_for_harness=True,
        )
        cfg_path = _write_temp_json(tmp_dir, "config.json", runtime_cfg)

        direct_srv = _ThreadedTCPServer(("127.0.0.1", direct_port), _DirectEchoHandler)
        direct_srv.hits = []  # type: ignore[attr-defined]
        socks_srv = _MockSocks5Server(("127.0.0.1", socks_port), "user_a", "pass_a")
        t_dir = threading.Thread(target=direct_srv.serve_forever, daemon=True)
        t_sock = threading.Thread(target=socks_srv.serve_forever, daemon=True)
        t_dir.start()
        t_sock.start()

        xray_proc = subprocess.Popen(
            [str(xray_path), "run", "-c", cfg_path],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        addr = f"127.0.0.1:{api_port}"
        try:
            for _ in range(80):
                try:
                    with socket.create_connection(("127.0.0.1", api_port), timeout=0.1):
                        break
                except OSError:
                    time.sleep(0.05)
            else:
                raise TimeoutError("xray API port did not come up")

            # Add u:1001, h:1001 (ruleless initially), h:2002 (permanently ruleless)
            for label in ("u:1001:dev1:gen1", "h:1001:dev1:gen1", "h:2002:dev2:gen1"):
                r = _adu_vless_client(str(xray_path), env, addr, staging, VLESS_INBOUND_TAG, label, uuids[label])
                if r.returncode != 0 or "Added 1 user(s)" not in r.stdout:
                    raise RuntimeError(f"adu failed for {label}: {r.stdout} {r.stderr}")

            # Check A: non-h clients intact
            non_h_results: dict[str, str] = {}
            for label in ("shared-legacy", "user-42", "u:1001:dev1:gen1"):
                s = _VlessStream(vless_port, uuids[label], "127.0.0.1", direct_port, timeout)
                try:
                    non_h_results[label] = s.ping_line(b"HELLO_DIRECT\n")
                finally:
                    s.close()
            checks["non_h_clients_intact"] = {
                "passed": all(v == "DIRECT:HELLO_DIRECT" for v in non_h_results.values()),
                "replies": non_h_results,
            }

            # Check B: static catch-all blocks unbound h:
            h2_dom_blocked, h2_dom_err = _vless_dial_expect_blocked(
                vless_port, uuids["h:2002:dev2:gen1"], "canary-home.invalid", 443, timeout
            )
            h2_ip_blocked, h2_ip_err = _vless_dial_expect_blocked(
                vless_port, uuids["h:2002:dev2:gen1"], "198.51.100.10", 8080, timeout
            )
            checks["static_h_catchall_fail_closed"] = {
                "passed": h2_dom_blocked and h2_ip_blocked and len(socks_srv.connections) == 0,
                "domain_blocked": h2_dom_blocked,
                "domain_detail": h2_dom_err,
                "ip_blocked": h2_ip_blocked,
                "ip_detail": h2_ip_err,
                "socks_hits": len(socks_srv.connections),
            }

            # Check G pre-check & live u_pre_reload stream before adrules
            u_pre_stream = _VlessStream(vless_port, uuids["u:1001:dev1:gen1"], "127.0.0.1", direct_port, timeout)
            pre_ping = u_pre_stream.ping_line(b"PRE_ADRULES\n")

            ado_path = _write_temp_json(
                staging,
                "ado-line1.json",
                {
                    "outbounds": [
                        {
                            "tag": "home:line1:gen1",
                            "protocol": "socks",
                            "settings": {
                                "servers": [
                                    {
                                        "address": "127.0.0.1",
                                        "port": socks_port,
                                        "users": [{"user": "user_a", "pass": "pass_a"}],
                                    }
                                ]
                            },
                        }
                    ]
                },
            )
            ado_proc = _run_cmd([str(xray_path), "api", "ado", f"--server={addr}", ado_path], env)
            rules_4 = build_routing_rules([("tono-home-line1-gen1", ["h:1001:dev1:gen1"], "home:line1:gen1")])
            adr_path = _write_temp_json(staging, "adr-4.json", {"routing": {"rules": rules_4}})
            adr_proc = _run_cmd([str(xray_path), "api", "adrules", f"--server={addr}", adr_path], env)
            lsrules_proc = _run_cmd([str(xray_path), "api", "lsrules", f"--server={addr}"], env)
            lsrules_json = json.loads(lsrules_proc.stdout)
            observed_rule_tags = [r.get("ruleTag") for r in lsrules_json.get("rules", [])]

            post_ping = u_pre_stream.ping_line(b"POST_ADRULES\n")
            u_pre_stream.close()

            # Test AsIs domain + non-private IP on h:1001, plus isolation of h:2002
            s_dom = _VlessStream(vless_port, uuids["h:1001:dev1:gen1"], "canary-home.invalid", 443, timeout)
            try:
                dom_reply = s_dom.ping_line(b"PING_DOM\n")
            finally:
                s_dom.close()

            s_ip = _VlessStream(vless_port, uuids["h:1001:dev1:gen1"], "198.51.100.10", 8080, timeout)
            try:
                ip_reply = s_ip.ping_line(b"PING_IP\n")
            finally:
                s_ip.close()

            h2_still_blocked, h2_still_err = _vless_dial_expect_blocked(
                vless_port, uuids["h:2002:dev2:gen1"], "canary-home.invalid", 443, timeout
            )

            expected_4_tags = [
                "tono-api-rule",
                "tono-home-private-cidrs",
                "tono-home-line1-gen1",
                "tono-home-catchall",
            ]
            replace_ok = (
                ado_proc.returncode == 0
                and adr_proc.returncode == 0
                and observed_rule_tags == expected_4_tags
            )
            conns = list(socks_srv.connections)
            dom_socks_ok = (
                len(conns) >= 1
                and conns[0]["atyp"] == 3
                and conns[0]["dst_addr"] == "canary-home.invalid"
                and conns[0]["dst_port"] == 443
                and conns[0]["username"] == "user_a"
            )
            ip_socks_ok = (
                len(conns) >= 2
                and conns[1]["atyp"] == 1
                and conns[1]["dst_addr"] == "198.51.100.10"
                and conns[1]["dst_port"] == 8080
            )
            checks["ado_plus_replace_all_rules_and_asis"] = {
                "passed": (
                    replace_ok
                    and pre_ping == "DIRECT:PRE_ADRULES"
                    and post_ping == "DIRECT:POST_ADRULES"
                    and dom_reply == "SOCKS5:canary-home.invalid:PING_DOM"
                    and ip_reply == "SOCKS5:198.51.100.10:PING_IP"
                    and dom_socks_ok
                    and ip_socks_ok
                    and h2_still_blocked
                    and len(conns) == 2
                ),
                "replace_all_verified": replace_ok,
                "observed_rule_tags": observed_rule_tags,
                "u_stream_survived_adrules": pre_ping == "DIRECT:PRE_ADRULES" and post_ping == "DIRECT:POST_ADRULES",
                "asis_domain_reply": dom_reply,
                "non_private_ip_reply": ip_reply,
                "socks_records_count": len(conns),
                "socks_records": conns,
                "unbound_h_isolated": h2_still_blocked,
                "unbound_h_detail": h2_still_err,
            }

            # TestRoute probe BEFORE teardown (Check G + CIDR route confirmation)
            testroute_domain = grpc_test_route(
                api_port,
                inbound_tag=VLESS_INBOUND_TAG,
                user="h:1001:dev1:gen1",
                target_domain="canary-home.invalid",
                target_port=443,
            )
            testroute_unbound = grpc_test_route(
                api_port,
                inbound_tag=VLESS_INBOUND_TAG,
                user="h:2002:dev2:gen1",
                target_domain="canary-home.invalid",
                target_port=443,
            )
            testroute_u = grpc_test_route(
                api_port,
                inbound_tag=VLESS_INBOUND_TAG,
                user="u:1001:dev1:gen1",
                target_domain="example.com",
                target_port=443,
            )

            # Check D: all 9 private/special CIDRs blocked (live dial + TestRoute)
            direct_hits_before = len(direct_srv.hits)
            socks_hits_before = len(socks_srv.connections)
            cidr_probes: list[tuple[str, int]] = [("127.0.0.1", direct_port), *PRIVATE_PROBE_TARGETS]
            cidr_results: list[dict[str, Any]] = []
            for host, port in cidr_probes:
                blocked, detail = _vless_dial_expect_blocked(
                    vless_port, uuids["h:1001:dev1:gen1"], host, port, timeout
                )
                tr = grpc_test_route(
                    api_port,
                    inbound_tag=VLESS_INBOUND_TAG,
                    user="h:1001:dev1:gen1",
                    target_ip=host,
                    target_port=port,
                )
                cidr_results.append(
                    {
                        "target": f"{host}:{port}",
                        "vless_blocked": blocked,
                        "detail": detail,
                        "testroute_outbound": tr.get("outbound_tag"),
                    }
                )
            direct_hits_delta = len(direct_srv.hits) - direct_hits_before
            socks_hits_delta = len(socks_srv.connections) - socks_hits_before
            checks["literal_private_cidrs_blocked"] = {
                "passed": (
                    direct_hits_delta == 0
                    and socks_hits_delta == 0
                    and all(
                        r["vless_blocked"] and r["testroute_outbound"] == HOME_BLACKHOLE_TAG
                        for r in cidr_results
                    )
                ),
                "direct_hits_delta": direct_hits_delta,
                "socks_hits_delta": socks_hits_delta,
                "targets": cidr_results,
            }

            # Check E: active stream behavior during rmu -> adrules (3 rules) -> rmo
            u_live = _VlessStream(vless_port, uuids["u:1001:dev1:gen1"], "127.0.0.1", direct_port, timeout)
            h_live = _VlessStream(vless_port, uuids["h:1001:dev1:gen1"], "canary-home.invalid", 443, timeout)
            u_ping_before = u_live.ping_line(b"U_BEFORE\n")
            h_ping_before = h_live.ping_line(b"H_BEFORE\n")
            with socks_srv.lock:
                socks_closed_before = socks_srv.closed_events

            rmu_proc = _run_cmd([str(xray_path), "api", "rmu", f"--server={addr}", f"-tag={VLESS_INBOUND_TAG}", "h:1001:dev1:gen1"], env)
            rules_3 = build_routing_rules([])
            adr3_path = _write_temp_json(staging, "adr-3.json", {"routing": {"rules": rules_3}})
            adr3_proc = _run_cmd([str(xray_path), "api", "adrules", f"--server={addr}", adr3_path], env)
            rmo_proc = _run_cmd([str(xray_path), "api", "rmo", f"--server={addr}", "home:line1:gen1"], env)

            time.sleep(0.35)
            with socks_srv.lock:
                socks_closed_after = socks_srv.closed_events
            upstream_socks_closed = socks_closed_after > socks_closed_before

            # Probe open h_live stream after rmo
            try:
                h_ping_after_reply = h_live.ping_line(b"H_AFTER_RMO\n")
                rmo_cancels_established = False
                h_after_detail = f"stream stayed open and echoed: {h_ping_after_reply}"
            except (EOFError, OSError, TimeoutError) as exc:
                rmo_cancels_established = True
                h_after_detail = f"stream closed/errored: {type(exc).__name__}: {exc}"
            finally:
                h_live.close()

            # Probe brand-new dial with removed h:1001 UUID
            new_conn_rejected, new_conn_detail = _vless_dial_expect_blocked(
                vless_port, uuids["h:1001:dev1:gen1"], "canary-home.invalid", 443, timeout
            )

            # Confirm live u_stream survived teardown untouched
            u_ping_after = u_live.ping_line(b"U_AFTER\n")
            u_live.close()

            checks["replace_all_revocation_and_rmo_stream_cancellation"] = {
                "passed": (
                    rmu_proc.returncode == 0
                    and adr3_proc.returncode == 0
                    and rmo_proc.returncode == 0
                    and new_conn_rejected
                    and u_ping_before == "DIRECT:U_BEFORE"
                    and h_ping_before == "SOCKS5:canary-home.invalid:H_BEFORE"
                    and u_ping_after == "DIRECT:U_AFTER"
                ),
                "rmu_stdout": rmu_proc.stdout.strip(),
                "rmo_stdout": rmo_proc.stdout.strip(),
                "upstream_socks_closed_on_rmo": upstream_socks_closed,
                "rmo_cancels_established_stream": rmo_cancels_established,
                "established_stream_detail": h_after_detail,
                "new_conn_rejected_after_rmu": new_conn_rejected,
                "new_conn_detail": new_conn_detail,
                "u_stream_survived_unbind": u_ping_before == "DIRECT:U_BEFORE" and u_ping_after == "DIRECT:U_AFTER",
            }

            # Check F: unified u: + h: statsquery
            stats_proc = _run_cmd([str(xray_path), "api", "statsquery", f"--server={addr}", "--reset=false"], env)
            stats_data = json.loads(stats_proc.stdout) if stats_proc.stdout.strip() else {}
            stat_map = {item.get("name"): int(item.get("value", 0)) for item in stats_data.get("stat", []) if "name" in item}
            u_up = stat_map.get("user>>>u:1001:dev1:gen1>>>traffic>>>uplink", 0)
            u_down = stat_map.get("user>>>u:1001:dev1:gen1>>>traffic>>>downlink", 0)
            h_up = stat_map.get("user>>>h:1001:dev1:gen1>>>traffic>>>uplink", 0)
            h_down = stat_map.get("user>>>h:1001:dev1:gen1>>>traffic>>>downlink", 0)
            checks["stats_unified_u_and_h"] = {
                "passed": u_up > 0 and u_down > 0 and h_up > 0 and h_down > 0,
                "u_uplink": u_up,
                "u_downlink": u_down,
                "h_uplink": h_up,
                "h_downlink": h_down,
            }

            # Check G: TestRoute CLI vs h2c gRPC
            checks["testroute_availability"] = {
                "passed": True,
                "cli_testroute_present": "testroute" in api_cmds,
                "grpc_testroute_available": (
                    testroute_domain.get("outbound_tag") == "home:line1:gen1"
                    and testroute_unbound.get("outbound_tag") == HOME_BLACKHOLE_TAG
                    and testroute_u.get("outbound_tag", "") == ""
                ),
                "sample_bound_h": testroute_domain,
                "sample_unbound_h": testroute_unbound,
                "sample_u_default_fallthrough": testroute_u,
            }

            summary: dict[str, Any] = {
                "version_label": version_label or (ver_proc.stdout.splitlines()[0] if ver_proc.stdout else str(xray_path)),
                "xray_version_output": ver_proc.stdout.strip(),
                "api_commands": api_cmds,
                "adrules_has_append_flag": "-append" in adrules_help.stdout,
                "checks": checks,
            }
            summary["verdict"] = classify_capabilities(summary)
            return summary
        finally:
            xray_proc.terminate()
            try:
                xray_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                xray_proc.kill()
                xray_proc.wait(timeout=5)
            direct_srv.shutdown()
            direct_srv.server_close()
            socks_srv.shutdown()
            socks_srv.server_close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Probe Xray capabilities for RFC PR 0.")
    parser.add_argument("--xray-bin", required=True, help="Path to xray executable")
    parser.add_argument("--version-label", default="", help="Optional human label (e.g. v26.3.27)")
    parser.add_argument("--json-out", default="", help="Optional path to write JSON report")
    parser.add_argument("--timeout", type=float, default=2.5, help="Socket/stream timeout in seconds")
    args = parser.parse_args(argv)

    summary = run_probe(args.xray_bin, args.version_label or None, args.timeout)
    payload = json.dumps(summary, indent=2, sort_keys=False)
    if args.json_out:
        out_path = Path(args.json_out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(payload + "\n", encoding="utf-8")
    print(payload)
    verdict = summary["verdict"]
    return 0 if (verdict["core_routing_fail_closed_ready"] and verdict["adrules_replace_all_supported"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
