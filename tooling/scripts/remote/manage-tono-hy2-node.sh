#!/bin/bash
set -euo pipefail

umask 077

# Complement role: Hysteria2 beside an existing tono-xray TCP Reality service.
# This script must never stop, replace, or rewrite tono-xray.
# Catalog hy2 blocks use password: {{TONO_CLIENT_UUID}}. The node must accept
# every VLESS client UUID, not a single shared secret. Auth is a localhost
# HTTP checker so the password never appears in `ps` (unlike command auth).

XRAY_SERVICE="tono-xray.service"
XRAY_CONFIG="/opt/tono-xray/current/config.json"
SERVICE_NAME="tono-hy2.service"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"
AUTH_SERVICE_NAME="tono-hy2-auth.service"
AUTH_SERVICE_PATH="/etc/systemd/system/$AUTH_SERVICE_NAME"
INSTALL_ROOT="/opt/tono-hy2"
SERVICE_USER="tono-hy2"
CERT_CN="www.microsoft.com"
AUTH_HTTP_URL="http://127.0.0.1:18765/auth"
AUTH_HTTP_PY="$INSTALL_ROOT/auth-http.py"
AUTH_ALLOWLIST="$INSTALL_ROOT/auth-allow.sha256"

fail() {
  printf 'Tono hy2 operation failed: %s\n' "$1" >&2
  exit 1
}

require_root() {
  [[ $(id -u) -eq 0 ]] || fail "root or passwordless sudo is required"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is unavailable: $1"
}

validate_port() {
  [[ $1 =~ ^[0-9]+$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535)) || fail "invalid UDP port"
}

platform() {
  [[ -r /etc/os-release ]] || fail "missing /etc/os-release"
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}:${VERSION_ID:-}" in
    ubuntu:22.04|ubuntu:24.04|debian:12|debian:13) ;;
    *) fail "only Ubuntu 22.04/24.04 and Debian 12/13 are supported" ;;
  esac
  case "$(uname -m)" in
    x86_64|aarch64) ;;
    *) fail "only x86_64 and aarch64 hosts are supported" ;;
  esac
  [[ -d /run/systemd/system ]] || fail "systemd is not running"
}

udp_port_in_use() {
  ss -H -lun "sport = :$1" 2>/dev/null | grep -q .
}

xray_is_active() {
  systemctl is-active --quiet "$XRAY_SERVICE"
}

hy2_config_path() {
  if [[ -f $INSTALL_ROOT/current/config.yaml && ! -L $INSTALL_ROOT/current/config.yaml ]]; then
    printf '%s\n' "$INSTALL_ROOT/current/config.yaml"
  elif [[ -f $INSTALL_ROOT/config.yaml && ! -L $INSTALL_ROOT/config.yaml ]]; then
    printf '%s\n' "$INSTALL_ROOT/config.yaml"
  else
    return 1
  fi
}

hy2_is_installed() {
  [[ -e $SERVICE_PATH || -e $INSTALL_ROOT/current || -f $INSTALL_ROOT/config.yaml ]]
}

collect_auth_secrets() {
  python3 - "$XRAY_CONFIG" "$(hy2_config_path 2>/dev/null || true)" "$INSTALL_ROOT/auth" <<'PY'
import hashlib, json, pathlib, re, sys

xray_path, hy2_conf, extra_auth = sys.argv[1], sys.argv[2], sys.argv[3]
secrets = []
path = pathlib.Path(xray_path)
if not path.is_file() or path.is_symlink():
    raise SystemExit("existing tono-xray config is required; hy2 does not replace Reality")
config = json.loads(path.read_text())
for inbound in config.get("inbounds") or []:
    if inbound.get("protocol") != "vless":
        continue
    for client in (inbound.get("settings") or {}).get("clients") or []:
        uuid = client.get("id")
        if isinstance(uuid, str) and len(uuid) == 36:
            secrets.append(uuid)
if not secrets:
    raise SystemExit("xray vless clients missing")
for extra in (hy2_conf, extra_auth):
    extra_path = pathlib.Path(extra)
    if extra and extra_path.is_file() and not extra_path.is_symlink():
        text = extra_path.read_text()
        match = re.search(r"(?m)^(?:password:\s*)(\S+)\s*$", text)
        if match:
            secrets.append(match.group(1).strip().strip("\"'"))
        elif extra_path == pathlib.Path(extra_auth):
            stripped = text.strip()
            if stripped:
                secrets.append(stripped)
seen = []
for secret in secrets:
    if secret and secret not in seen:
        seen.append(secret)
for secret in seen:
    print(hashlib.sha256(secret.encode()).hexdigest())
print(f"COUNT {len(seen)} {sum(1 for s in secrets if len(s) == 36)}", file=sys.stderr)
PY
}

write_allowlist() {
  local tmp hashes count
  tmp=$(mktemp)
  hashes=$(collect_auth_secrets 2>"$tmp") || fail "could not read xray identities for hy2"
  count=$(printf '%s\n' "$hashes" | grep -c '^[a-f0-9]\{64\}$' || true)
  ((count >= 1)) || fail "hy2 allowlist would be empty"
  printf '%s\n' "$hashes" | grep '^[a-f0-9]\{64\}$' | sort -u >"$AUTH_ALLOWLIST.new"
  chown root:"$SERVICE_USER" "$AUTH_ALLOWLIST.new"
  chmod 0640 "$AUTH_ALLOWLIST.new"
  mv "$AUTH_ALLOWLIST.new" "$AUTH_ALLOWLIST"
  awk '/^COUNT /{print $2}' "$tmp"
  rm -f "$tmp"
}

wait_localhost_tcp() {
  local port=${1:-}
  local label=${2:-localhost listener}
  validate_port "$port"
  local ready=false
  for _ in $(seq 1 50); do
    if ss -H -ltn "sport = :$port" 2>/dev/null | grep -q '127.0.0.1'; then
      ready=true
      break
    fi
    sleep 0.2
  done
  [[ $ready == true ]] || fail "$label is not listening on 127.0.0.1:$port"
}

wait_hy2_active() {
  local _i
  for _i in $(seq 1 50); do
    if systemctl is-active --quiet "$SERVICE_NAME"; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

verify_http_auth() {
  python3 - "$XRAY_CONFIG" <<'PY'
import json, pathlib, urllib.request, uuid, sys

config = json.loads(pathlib.Path(sys.argv[1]).read_text())
known = None
for inbound in config.get("inbounds") or []:
    if inbound.get("protocol") != "vless":
        continue
    for client in (inbound.get("settings") or {}).get("clients") or []:
        ident = client.get("id")
        if isinstance(ident, str) and len(ident) == 36:
            known = ident
            break
    if known:
        break
if not known:
    raise SystemExit("xray vless clients missing")

def post(auth):
    req = urllib.request.Request(
        "http://127.0.0.1:18765/auth",
        data=json.dumps({"auth": auth}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=3) as resp:
        return json.loads(resp.read().decode())

accepted = bool(post(known).get("ok"))
rejected = not bool(post(str(uuid.uuid4())).get("ok"))
print(json.dumps({"knownUuidAccepted": accepted, "randomRejected": rejected}))
PY
}

install_auth_http() {
  cat >"$AUTH_HTTP_PY" <<'PY'
#!/usr/bin/env python3
import hashlib
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ALLOW = Path("/opt/tono-hy2/auth-allow.sha256")


def allowed():
    if not ALLOW.is_file():
        return set()
    return {line.strip() for line in ALLOW.read_text().splitlines() if len(line.strip()) == 64}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def do_POST(self):
        if self.path != "/auth":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length < 2 or length > 4096:
            self.send_response(400)
            self.end_headers()
            return
        try:
            body = json.loads(self.rfile.read(length).decode())
            auth = body.get("auth")
            if not isinstance(auth, str) or not auth:
                raise ValueError("auth")
        except Exception:
            payload = b'{"ok":false,"id":""}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        digest = hashlib.sha256(auth.encode()).hexdigest()
        ok = digest in allowed()
        payload = json.dumps({"ok": ok, "id": digest[:12] if ok else ""}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 18765), Handler).serve_forever()
PY
  chown root:root "$AUTH_HTTP_PY"
  chmod 0755 "$AUTH_HTTP_PY"

  cat >"$AUTH_SERVICE_PATH" <<EOF
[Unit]
Description=Tono hy2 localhost identity check
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
ExecStart=/usr/bin/python3 $AUTH_HTTP_PY
Restart=on-failure
RestartSec=1s
UMask=0077
NoNewPrivileges=true
PrivateDevices=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadOnlyPaths=$AUTH_ALLOWLIST $AUTH_HTTP_PY
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictRealtime=true
IPAddressAllow=127.0.0.1/32 ::1/128
IPAddressDeny=any

[Install]
WantedBy=multi-user.target
EOF
  chown root:root "$AUTH_SERVICE_PATH"
  chmod 0644 "$AUTH_SERVICE_PATH"
}

patch_hy2_config_http_auth() {
  local path=${1:-}
  [[ -n $path && -f $path && ! -L $path ]] || fail "hy2 config is missing"
  python3 - "$path" "$AUTH_HTTP_URL" <<'PY' || return 1
import pathlib, re, sys
path, url = sys.argv[1], sys.argv[2]
text = pathlib.Path(path).read_text()
block = "auth:\n  type: http\n  http:\n    url: %s\n" % url
replaced, count = re.subn(r"(?m)^auth:\n(?:  .*\n)+", block, text, count=1)
if count != 1:
    raise SystemExit("hy2 auth block is missing or not unique")
pathlib.Path(path).write_text(replaced)
PY
}

sync_identities() {
  require_root
  local dry_run=${1:-}
  platform
  for command_name in awk chmod chown cp grep install mktemp mv python3 seq ss systemctl; do
    require_command "$command_name"
  done
  xray_is_active || fail "tono-xray must stay running; hy2 identity sync does not replace Reality"
  hy2_is_installed || fail "tono-hy2 is not installed"
  local conf
  conf=$(hy2_config_path) || fail "tono-hy2 config is missing"
  local xray_pid
  xray_pid=$(systemctl show "$XRAY_SERVICE" -p MainPID --value)
  if [[ $dry_run == dry-run ]]; then
    local tmp count
    tmp=$(mktemp)
    collect_auth_secrets >/dev/null 2>"$tmp" || fail "could not read xray identities for hy2"
    count=$(awk '/^COUNT /{print $2}' "$tmp")
    rm -f "$tmp"
    printf '{"xrayClients":%s,"xrayPid":%s,"xrayUntouched":true,"dryRun":true}\n' "$count" "$xray_pid"
    return
  fi
  if ! getent group "$SERVICE_USER" >/dev/null; then
    fail "tono-hy2 user is missing"
  fi
  # Existing Dedirock/Tokyo units stay as-is; this path never rewrites tono-hy2.service.
  local backup="$conf.pre-http-auth"
  cp -a "$conf" "$backup"
  install_auth_http
  local count
  count=$(write_allowlist)
  systemctl daemon-reload
  systemctl enable --now "$AUTH_SERVICE_NAME" >/dev/null 2>&1
  wait_localhost_tcp 18765 "hy2 auth checker"
  if ! patch_hy2_config_http_auth "$conf"; then
    mv -f "$backup" "$conf"
    fail "hy2 auth block could not be patched"
  fi
  systemctl restart "$SERVICE_NAME" >/dev/null
  if ! wait_hy2_active; then
    mv -f "$backup" "$conf"
    systemctl restart "$SERVICE_NAME" >/dev/null || true
    fail "hy2 did not come back after identity sync; restored previous config"
  fi
  systemctl is-active --quiet "$AUTH_SERVICE_NAME" || fail "hy2 auth checker did not start"
  local xray_pid_after
  xray_pid_after=$(systemctl show "$XRAY_SERVICE" -p MainPID --value)
  [[ $xray_pid_after == "$xray_pid" ]] || fail "tono-xray pid changed during hy2 identity sync"
  local verify
  verify=$(verify_http_auth) || fail "hy2 HTTP auth check failed"
  printf '{"allowlist":%s,"xrayPid":%s,"xrayUntouched":true,"auth":"http",%s}\n' \
    "$count" "$xray_pid_after" "$(printf '%s' "$verify" | sed 's/^{//;s/}$//')"
}

preflight() {
  require_root
  local port=${1:-}
  validate_port "$port"
  platform
  for command_name in getent grep install openssl python3 sha256sum ss systemctl; do
    require_command "$command_name"
  done

  local os_id arch occupied existing_hy2 xray_active ufw_active
  # shellcheck disable=SC1091
  . /etc/os-release
  os_id="${ID}-${VERSION_ID}"
  arch=$(uname -m)
  occupied=false
  udp_port_in_use "$port" && occupied=true
  existing_hy2=false
  if hy2_is_installed; then
    existing_hy2=true
  fi
  xray_active=false
  xray_is_active && xray_active=true
  ufw_active=false
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    ufw_active=true
  fi

  printf '{"os":"%s","arch":"%s","port":%s,"udpPortInUse":%s,"existingHy2":%s,"xrayActive":%s,"ufwActive":%s}\n' \
    "$os_id" "$arch" "$port" "$occupied" "$existing_hy2" "$xray_active" "$ufw_active"
}

rollback_deployment() {
  require_root
  local deployment_id=${1:-}
  [[ $deployment_id =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || fail "invalid deployment identifier"
  systemctl is-active --quiet "$XRAY_SERVICE" || fail "refusing to roll back hy2 while tono-xray is not active"
  local release="$INSTALL_ROOT/releases/$deployment_id"
  local current=""
  if [[ -L "$INSTALL_ROOT/current" ]]; then
    current=$(readlink -f "$INSTALL_ROOT/current")
  fi
  if [[ -z $current && ! -e $release && ! -e $SERVICE_PATH ]]; then
    printf '{"rolledBack":true,"deploymentId":"%s","xrayUntouched":true}\n' "$deployment_id"
    return
  fi
  if [[ -n $current && $current != "$release" ]]; then
    fail "refusing to roll back a hy2 deployment that is not current"
  fi
  systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl disable --now "$AUTH_SERVICE_NAME" >/dev/null 2>&1 || true
  rm -f "$SERVICE_PATH" "$AUTH_SERVICE_PATH" "$INSTALL_ROOT/current" "$AUTH_HTTP_PY" "$AUTH_ALLOWLIST"
  rm -rf "$release"
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl is-active --quiet "$XRAY_SERVICE" || fail "tono-xray was disturbed during hy2 rollback"
  printf '{"rolledBack":true,"deploymentId":"%s","xrayUntouched":true}\n' "$deployment_id"
}

apply_deployment() {
  require_root
  local deployment_id=${1:-}
  local version=${2:-}
  local artifact=${3:-}
  local expected_sha256=${4:-}
  local port=${5:-}
  [[ $deployment_id =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || fail "invalid deployment identifier"
  [[ $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "invalid pinned hysteria version"
  [[ $artifact =~ ^/tmp/tono-hy2-artifact-[a-f0-9]{24}$ ]] || fail "invalid uploaded artifact path"
  [[ $expected_sha256 =~ ^[a-f0-9]{64}$ ]] || fail "invalid artifact digest"
  validate_port "$port"
  platform
  for command_name in awk chmod chown getent groupadd grep install ln mv openssl python3 readlink seq sha256sum ss systemctl useradd; do
    require_command "$command_name"
  done
  xray_is_active || fail "tono-xray must stay running; hy2 is a complement"
  [[ -f $artifact && ! -L $artifact ]] || fail "uploaded hysteria artifact is not a regular file"
  [[ $(sha256sum "$artifact" | awk '{ print $1 }') == "$expected_sha256" ]] || fail "uploaded hysteria artifact digest mismatch"
  [[ ! -e $SERVICE_PATH && ! -e $INSTALL_ROOT/current && ! -f $INSTALL_ROOT/config.yaml ]] || fail "an existing tono-hy2 installation requires an explicit rotation workflow"
  ! udp_port_in_use "$port" || fail "the selected UDP port is already in use"

  local release committed=0
  release="$INSTALL_ROOT/releases/$deployment_id"

  cleanup_apply() {
    local status=$?
    rm -f "$artifact"
    if ((status != 0 && committed == 0)); then
      systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
      systemctl disable --now "$AUTH_SERVICE_NAME" >/dev/null 2>&1 || true
      rm -f "$SERVICE_PATH" "$SERVICE_PATH.new" "$INSTALL_ROOT/current" "$INSTALL_ROOT/current.new"
      rm -f "$AUTH_SERVICE_PATH" "$AUTH_HTTP_PY" "$AUTH_ALLOWLIST"
      rm -rf "$release"
      systemctl daemon-reload >/dev/null 2>&1 || true
      systemctl reset-failed "$SERVICE_NAME" "$AUTH_SERVICE_NAME" >/dev/null 2>&1 || true
    fi
    trap - EXIT
    exit "$status"
  }
  trap cleanup_apply EXIT

  if ! getent group "$SERVICE_USER" >/dev/null; then
    groupadd --system "$SERVICE_USER"
  fi
  if ! getent passwd "$SERVICE_USER" >/dev/null; then
    useradd --system --gid "$SERVICE_USER" --home-dir /nonexistent --shell /usr/sbin/nologin "$SERVICE_USER"
  fi

  install -d -m 0755 -o root -g root "$INSTALL_ROOT" "$INSTALL_ROOT/releases"
  install -d -m 0750 -o root -g "$SERVICE_USER" "$release"
  install -m 0755 -o root -g root "$artifact" "$release/hysteria"

  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -days 3650 -nodes \
    -keyout "$release/key.pem" -out "$release/cert.pem" \
    -subj "/CN=$CERT_CN" \
    -addext "subjectAltName=DNS:$CERT_CN" >/dev/null 2>&1 ||
    fail "could not issue the hy2 certificate with a SAN"
  chown root:"$SERVICE_USER" "$release/key.pem" "$release/cert.pem"
  chmod 0640 "$release/key.pem"
  chmod 0644 "$release/cert.pem"
  openssl x509 -in "$release/cert.pem" -noout -ext subjectAltName 2>/dev/null | grep -q "DNS:$CERT_CN" ||
    fail "hy2 certificate SAN is missing"

  local fingerprint
  fingerprint=$(openssl x509 -in "$release/cert.pem" -noout -fingerprint -sha256 | sed 's/^.*=//')
  [[ $fingerprint =~ ^([0-9A-F]{2}:){31}[0-9A-F]{2}$ ]] || fail "could not read the hy2 certificate fingerprint"

  install_auth_http
  write_allowlist >/dev/null

  cat >"$release/config.yaml" <<EOF
listen: :$port
tls:
  cert: $INSTALL_ROOT/current/cert.pem
  key: $INSTALL_ROOT/current/key.pem
auth:
  type: http
  http:
    url: $AUTH_HTTP_URL
masquerade:
  type: proxy
  proxy:
    url: https://$CERT_CN/
    rewriteHost: true
EOF
  chown root:"$SERVICE_USER" "$release/config.yaml"
  chmod 0640 "$release/config.yaml"

  cat >"$SERVICE_PATH.new" <<EOF
[Unit]
Description=Tono managed Hysteria2 node
After=network-online.target $XRAY_SERVICE $AUTH_SERVICE_NAME
Wants=network-online.target
Requires=$AUTH_SERVICE_NAME

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
ExecStart=$INSTALL_ROOT/current/hysteria server -c $INSTALL_ROOT/current/config.yaml
Restart=on-failure
RestartSec=2s
TimeoutStopSec=15s
LimitNOFILE=1048576
MemoryMax=80M
UMask=0077
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateDevices=true
PrivateTmp=true
ProtectControlGroups=true
ProtectHome=true
ProtectKernelModules=true
ProtectKernelTunables=true
ProtectSystem=strict
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
RestrictRealtime=true
RestrictSUIDSGID=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
EOF
  chown root:root "$SERVICE_PATH.new"
  chmod 0644 "$SERVICE_PATH.new"
  mv "$SERVICE_PATH.new" "$SERVICE_PATH"
  ln -s "$release" "$INSTALL_ROOT/current.new"
  mv -T "$INSTALL_ROOT/current.new" "$INSTALL_ROOT/current"
  systemctl daemon-reload
  systemctl enable --now "$AUTH_SERVICE_NAME" >/dev/null 2>&1
  wait_localhost_tcp 18765 "hy2 auth checker"
  systemctl enable --now "$SERVICE_NAME" >/dev/null 2>&1

  local ready=false
  for _ in $(seq 1 50); do
    if systemctl is-active --quiet "$SERVICE_NAME" && udp_port_in_use "$port"; then
      ready=true
      break
    fi
    sleep 0.2
  done
  [[ $ready == true ]] || fail "hysteria2 did not become active and listen on the selected UDP port"
  systemctl is-active --quiet "$XRAY_SERVICE" || fail "tono-xray stopped during hy2 install; aborting"

  committed=1
  rm -f "$artifact"
  trap - EXIT
  printf '{"deploymentId":"%s","version":"%s","port":%s,"fingerprint":"%s","xrayUntouched":true}\n' \
    "$deployment_id" "$version" "$port" "$fingerprint"
}

mode=${1:-}
shift || true
case "$mode" in
  preflight) preflight "$@" ;;
  apply) apply_deployment "$@" ;;
  rollback) rollback_deployment "$@" ;;
  sync-identities) sync_identities apply "$@" ;;
  sync-identities-dry-run) sync_identities dry-run "$@" ;;
  *) fail "expected preflight, apply, rollback, sync-identities, or sync-identities-dry-run" ;;
esac
