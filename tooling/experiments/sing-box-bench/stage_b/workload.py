"""Owned local services and bounded socket workloads. No product FSM is modeled."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import http.server
import json
import socket
import socketserver
import ssl
import struct
import threading
import time
from pathlib import Path

from configs import DNS_ENDPOINT, NAMES, ORIGIN, SERVER

CHUNK = b"Z" * 65536
MAX_BYTES = 32 * 1024 * 1024


def request(port=18080, size=4096, address=ORIGIN, path=None, timeout=5, first=None):
    start = time.monotonic_ns()
    result = {"status": "FAIL", "port": port, "requested_bytes": size,
              "start_ns": start, "received_bytes": 0, "ttfb_ms": None}
    deadline = time.monotonic() + timeout
    try:
        if not 0 <= size <= MAX_BYTES:
            raise ValueError("byte budget")
        with socket.socket() as sock:
            def receive():
                sock.settimeout(max(.001, deadline - time.monotonic()))
                if time.monotonic() >= deadline:
                    raise TimeoutError("whole-request deadline")
                return sock.recv(min(65536, size + 8192))
            sock.settimeout(timeout)
            sock.connect((address, port))
            result["kernel_connect_ms"] = (time.monotonic_ns() - start) / 1e6
            target = path or f"/bytes/{size}"
            sock.sendall(f"GET {target} HTTP/1.1\r\nHost: synthetic.test\r\nConnection: close\r\n\r\n".encode())
            buffer = receive()
            if buffer:
                result["ttfb_ms"] = (time.monotonic_ns() - start) / 1e6
            if buffer and first is not None:
                first.set()
            while b"\r\n\r\n" not in buffer:
                if not buffer or len(buffer) > 8192:
                    raise ValueError("missing/oversized HTTP header")
                more = receive()
                if not more:
                    raise ValueError("truncated HTTP header")
                buffer += more
            headers, body = buffer.split(b"\r\n\r\n", 1)
            code = int(headers.split(b" ", 2)[1])
            result["http_status"] = code
            if code != 200:
                raise ValueError(f"HTTP {code}")
            length = next(int(line.split(b":", 1)[1]) for line in headers.split(b"\r\n")
                          if line.lower().startswith(b"content-length:"))
            if length != size:
                raise ValueError("wrong Content-Length")
            while True:
                if body != b"Z" * len(body):
                    raise ValueError("payload mismatch")
                result["received_bytes"] += len(body)
                if result["received_bytes"] >= size:
                    break
                body = receive()
                if not body:
                    raise ValueError("truncated payload")
            if result["received_bytes"] != size:
                raise ValueError("byte cap exceeded")
            result["status"] = "PASS"
    except Exception as error:
        result["status"] = "TIMEOUT" if isinstance(error, TimeoutError) else "FAIL"
        result["error"] = repr(error)
    result["end_ns"] = time.monotonic_ns()
    result["elapsed_ms"] = (result["end_ns"] - start) / 1e6
    return result


def dns_query(name, qtype=1, tcp=False):
    start = time.monotonic_ns()
    packet = struct.pack("!HHHHHH", 0xBEEF, 0x100, 1, 0, 0, 0)
    packet += b"".join(bytes([len(part)]) + part.encode() for part in name.split("."))
    packet += b"\x00" + struct.pack("!HH", qtype, 1)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM if tcp else socket.SOCK_DGRAM) as sock:
        sock.settimeout(2)
        sock.connect((DNS_ENDPOINT, 53))
        sock.sendall(struct.pack("!H", len(packet)) + packet if tcp else packet)
        if tcp:
            length = sock.recv(2)
            if len(length) != 2:
                raise ValueError("truncated DNS/TCP frame")
            remaining = struct.unpack("!H", length)[0]
            response = b""
            while remaining:
                data = sock.recv(remaining)
                if not data:
                    raise ValueError("truncated DNS/TCP body")
                response += data
                remaining -= len(data)
        else:
            response = sock.recv(4096)
    ident, flags, questions, answers, _, _ = struct.unpack("!HHHHHH", response[:12])
    assert ident == 0xBEEF and flags & 0x8000 and questions == 1
    addresses = []
    pos = 12
    def skip_name(pos):
        while response[pos]:
            if response[pos] & 0xC0 == 0xC0:
                return pos + 2
            pos += response[pos] + 1
        return pos + 1
    pos = skip_name(pos) + 4
    ttls = []
    for _ in range(answers):
        pos = skip_name(pos)
        kind, _, ttl, size = struct.unpack("!HHIH", response[pos:pos + 10])
        pos += 10
        if kind == 1 and size == 4:
            addresses.append(socket.inet_ntoa(response[pos:pos + size]))
            ttls.append(ttl)
        if kind == 28 and size == 16:
            addresses.append(socket.inet_ntop(socket.AF_INET6, response[pos:pos + size]))
        pos += size
    return {"name": name, "qtype": qtype, "tcp": tcp, "addresses": addresses,
            "rcode": flags & 15, "ttls": ttls, "elapsed_ms": (time.monotonic_ns() - start) / 1e6}


class HTTP(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            if self.path == "/slow":
                time.sleep(.4)
            if self.path == "/failure":
                self.send_error(503)
                return
            count = int(self.path.rsplit("/", 1)[-1]) if self.path.startswith("/bytes/") else 4096
            if not 0 <= count <= MAX_BYTES:
                self.send_error(413)
                return
            self.send_response(200)
            self.send_header("Content-Length", str(count))
            self.end_headers()
            while count:
                block = CHUNK[:min(count, len(CHUNK))]
                self.wfile.write(block)
                count -= len(block)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, *_):
        pass


class DNS(socketserver.BaseRequestHandler):
    def handle(self):
        data, sock = self.request
        pos, labels = 12, []
        while data[pos]:
            length = data[pos]
            labels.append(data[pos + 1:pos + 1 + length].decode())
            pos += length + 1
        qtype = struct.unpack("!H", data[pos + 1:pos + 3])[0]
        known = ".".join(labels) in NAMES
        answers = int(known and qtype == 1)
        response = data[:2] + struct.pack("!HHHHH", 0x8180 if known else 0x8183, 1, answers, 0, 0)
        response += data[12:pos + 5]
        if answers:
            response += b"\xc0\x0c" + struct.pack("!HHIH", 1, 1, 60, 4) + socket.inet_aton(ORIGIN)
        sock.sendto(response, self.client_address)


def fixture(directory):
    servers = []
    # Python's default backlog of five would measure fixture SYN drops at concurrency 16.
    http.server.ThreadingHTTPServer.request_queue_size = 128
    for port in [18080, 18081, 18082]:
        server = http.server.ThreadingHTTPServer((ORIGIN, port), HTTP)
        server.daemon_threads = True
        servers.append(server)
    tls = http.server.ThreadingHTTPServer(("127.0.0.1", 34443), HTTP)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = context.maximum_version = ssl.TLSVersion.TLSv1_3
    context.load_cert_chain(directory / "leaf.pem", directory / "leaf.key")
    tls.socket = context.wrap_socket(tls.socket, server_side=True)
    servers.extend([tls, socketserver.UDPServer((SERVER, 5300), DNS)])
    for server in servers:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    threading.Event().wait()


def load(case):
    samples = []
    if case == "proof":
        with ThreadPoolExecutor(max_workers=2) as pool:
            samples = list(pool.map(lambda port: request(port=port, path="/slow"), [18080, 18081]))
    elif case == "short":
        with ThreadPoolExecutor(max_workers=16) as pool:
            samples = list(pool.map(lambda _: request(), range(32)))
    elif case == "bulk":
        samples = [request(port=18081, size=8 * 1024 * 1024) for _ in range(3)]
    elif case == "mixed":
        first = threading.Event()
        with ThreadPoolExecutor(max_workers=2) as pool:
            big = pool.submit(request, port=18081, size=MAX_BYTES, timeout=10, first=first)
            first.wait(3)
            for _ in range(32):
                samples.append(request())
                time.sleep(.02)
            samples.append(big.result())
    else:
        raise ValueError(case)
    return {"case": case, "samples": samples,
            "status": "PASS" if all(s["status"] == "PASS" for s in samples) else "FAIL"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["fixture", "request", "dns", "load"])
    parser.add_argument("--directory", type=Path)
    parser.add_argument("--spec", default="{}")
    args = parser.parse_args()
    spec = json.loads(args.spec)
    if args.action == "fixture":
        fixture(args.directory)
        return
    value = {"request": request, "dns": dns_query, "load": load}[args.action](**spec)
    print(json.dumps(value))
    # Negative parity controls inspect this structured status; no empty-error success.
    return 0 if value.get("status", "PASS") == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
