"""Synthetic, isolated configurations, not a Tono policy/configuration adapter."""
import copy
import json
from pathlib import Path
import secrets
import subprocess
import uuid

SERVER = "10.203.0.1"
ORIGIN = "203.0.113.10"
DNS_ENDPOINT = "172.19.0.2"
NAMES = ["reality.bench.test", "hy2.bench.test", "blocked.bench.test"]
TUN = "bench-tun"


def write(path, data):
    Path(path).write_text(json.dumps(data, indent=2) + "\n")
    Path(path).chmod(0o600)


def credentials(directory, binary):
    directory.mkdir(mode=0o700)
    def openssl(*args):
        subprocess.run(["openssl", *args], check=True, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=10)
    for name in ["ca", "wrong-ca"]:
        openssl("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
                "-nodes", "-keyout", str(directory / f"{name}.key"), "-out",
                str(directory / f"{name}.pem"), "-days", "2", "-subj",
                f"/CN=Tono owned experiment {name}", "-addext", "basicConstraints=critical,CA:TRUE")
    openssl("req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
            "-nodes", "-keyout", str(directory / "leaf.key"), "-out",
            str(directory / "leaf.csr"), "-subj", "/CN=hy2.test")
    (directory / "leaf.ext").write_text(
        "subjectAltName=DNS:hy2.test,DNS:reality.test\nextendedKeyUsage=serverAuth\n")
    openssl("x509", "-req", "-in", str(directory / "leaf.csr"), "-CA",
            str(directory / "ca.pem"), "-CAkey", str(directory / "ca.key"),
            "-set_serial", "2", "-days", "2", "-extfile", str(directory / "leaf.ext"),
            "-out", str(directory / "leaf.pem"))
    keys = subprocess.check_output([str(binary), "generate", "reality-keypair"], text=True, timeout=5)
    keypair = dict(line.split(": ", 1) for line in keys.strip().splitlines())
    data = {"uuid": str(uuid.uuid4()), "password": secrets.token_hex(24),
            "short_id": secrets.token_hex(8), "controller": secrets.token_hex(24),
            "private_key": keypair["PrivateKey"], "public_key": keypair["PublicKey"]}
    write(directory / "identity.json", data)
    for path in directory.iterdir():
        path.chmod(0o600)
    return data


def server_config(directory, identity):
    return {
        "log": {"level": "warn", "timestamp": False},
        "dns": {"servers": [{"type": "hosts", "tag": "local",
                             "predefined": {name: ORIGIN for name in NAMES}}]},
        "inbounds": [
            {"type": "vless", "tag": "reality-in", "listen": SERVER, "listen_port": 24443,
             "users": [{"uuid": identity["uuid"], "flow": "xtls-rprx-vision"}],
             "tls": {"enabled": True, "server_name": "reality.test",
                     "reality": {"enabled": True, "private_key": identity["private_key"],
                                 "short_id": [identity["short_id"]],
                                 "handshake": {"server": "127.0.0.1", "server_port": 34443}}}},
            {"type": "hysteria2", "tag": "hy2-in", "listen": SERVER, "listen_port": 24444,
             "up_mbps": 100, "down_mbps": 100,
             "users": [{"name": "synthetic", "password": identity["password"]}],
             "tls": {"enabled": True, "min_version": "1.3", "max_version": "1.3",
                     "certificate_path": str(directory / "leaf.pem"),
                     "key_path": str(directory / "leaf.key")}}],
        "outbounds": [{"type": "direct", "tag": "direct"}],
        "route": {"default_domain_resolver": "local", "final": "direct"},
        "experimental": {"clash_api": {"external_controller": "127.0.0.1:19091",
                                       "secret": identity["controller"]}}}


def client_config(kind, directory, identity, variant="normal"):
    sni = "wrong.test" if variant == "wrong-sni" else "hy2.test"
    ca = directory / ("wrong-ca.pem" if variant == "wrong-ca" else "ca.pem")
    # Wrong short ID retains a syntactically valid Reality identity, but must fail auth.
    short_id = ("ff" * 8 if identity["short_id"] != "ff" * 8 else "00" * 8) \
        if variant == "wrong-reality" else identity["short_id"]
    blocked = "blocked.bench.test"
    if kind == "mihomo":
        data = {
            "mixed-port": 1080, "allow-lan": False, "bind-address": "127.0.0.1",
            "external-controller": "127.0.0.1:19090", "secret": identity["controller"],
            "mode": "rule", "log-level": "warning", "ipv6": False,
            "find-process-mode": "off", "profile": {"store-selected": False, "store-fake-ip": False},
            "tun": {"enable": True, "device": TUN, "stack": "gvisor", "mtu": 1500,
                    "auto-route": False,
                    "auto-detect-interface": False, "dns-hijack": ["any:53", "tcp://any:53"]},
            "dns": {"enable": True, "listen": "127.0.0.1:1053", "ipv6": False,
                    "enhanced-mode": "fake-ip", "fake-ip-range": "198.18.0.1/15",
                    "fake-ip-filter": [], "nameserver": [f"udp://{SERVER}:5300"],
                    "default-nameserver": [f"{SERVER}:5300"]},
            "proxies": [
                {"type": "vless", "name": "reality", "server": SERVER, "port": 24443,
                 "uuid": identity["uuid"], "flow": "xtls-rprx-vision", "tls": True,
                 "servername": "reality.test", "client-fingerprint": "chrome", "udp": True,
                 "interface-name": "bench-link", "reality-opts": {
                     "public-key": identity["public_key"], "short-id": short_id}},
                {"type": "hysteria2", "name": "hy2", "server": SERVER, "port": 24444,
                 "password": identity["password"], "sni": sni, "up": "100 Mbps", "down": "100 Mbps",
                 "interface-name": "bench-link"}],
            "rules": [f"DOMAIN,{blocked},REJECT", "DST-PORT,18080,reality",
                      "DST-PORT,18081,hy2", "MATCH,REJECT"]}
        if variant == "reload":
            data["rules"].insert(1, "DST-PORT,18082,reality")
        return data
    data = {
        "log": {"level": "warn", "timestamp": False},
        "dns": {"servers": [
            {"type": "fakeip", "tag": "fake", "inet4_range": "198.18.0.0/15"},
            {"type": "udp", "tag": "local", "server": SERVER, "server_port": 5300}],
            "rules": [{"query_type": ["A", "AAAA"], "action": "route", "server": "fake"}],
            "strategy": "ipv4_only", "final": "local"},
        "inbounds": [
            {"type": "mixed", "tag": "smoke-only", "listen": "127.0.0.1", "listen_port": 1080},
            {"type": "tun", "tag": "tun-in", "interface_name": TUN, "mtu": 1500,
             "address": ["198.18.0.1/30"], "auto_route": False, "dns_mode": "hijack",
             # Suppress implicit address-wide hijack: fake-IP may allocate .2 itself.
             # Only port 53 is DNS, via the explicit first route rule below.
             "dns_address": [DNS_ENDPOINT],
             "stack": kind, "multi_queue": False}],
        "outbounds": [
            {"type": "vless", "tag": "reality", "server": SERVER, "server_port": 24443,
             "uuid": identity["uuid"], "flow": "xtls-rprx-vision", "bind_interface": "bench-link",
             "tls": {"enabled": True, "server_name": "reality.test",
                     "utls": {"enabled": True, "fingerprint": "chrome"},
                     "reality": {"enabled": True, "public_key": identity["public_key"], "short_id": short_id}}},
            {"type": "hysteria2", "tag": "hy2", "server": SERVER, "server_port": 24444,
             "password": identity["password"], "up_mbps": 100, "down_mbps": 100,
             "bind_interface": "bench-link", "disable_chrome_parrot": True,
             "tls": {"enabled": True, "server_name": sni, "certificate_path": str(ca),
                     "min_version": "1.3", "max_version": "1.3"}}],
        "route": {"default_domain_resolver": "local", "rules": [
            {"port": 53, "action": "hijack-dns"},
            {"domain": blocked, "action": "reject"},
            {"action": "resolve", "server": "local"},
            {"port": 18080, "action": "route", "outbound": "reality"},
            {"port": 18081, "action": "route", "outbound": "hy2"},
            {"action": "reject"}]},
        "experimental": {"clash_api": {"external_controller": "127.0.0.1:19090",
                                       "secret": identity["controller"]}}}
    if variant == "reload":
        data["route"]["rules"].insert(-1, {"port": 18082, "action": "route", "outbound": "reality"})
    return copy.deepcopy(data)
