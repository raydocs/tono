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

validate_servername() {
  [[ ${#1} -le 253 && $1 == *.* && $1 =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$ && $1 != *..* ]] ||
    fail "invalid certificate/SNI server name"
}

require_debian11_runtime() {
  # Only the hy2 complement supports this legacy image, not fresh Reality
  # provisioning. Verify the facilities used by the hardened units/certificate.
  local systemd_version
  systemd_version=$(systemctl --version | awk 'NR == 1 {print $2}')
  [[ $systemd_version =~ ^[0-9]+$ ]] && ((systemd_version >= 247)) ||
    fail "Debian 11 hy2 requires systemd 247 or newer"
  python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' ||
    fail "Debian 11 hy2 requires Python 3.9 or newer"
  openssl req -help 2>&1 | grep -- '-addext' >/dev/null ||
    fail "Debian 11 hy2 requires OpenSSL certificate SAN support"
}

platform() {
  [[ -r /etc/os-release ]] || fail "missing /etc/os-release"
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}:${VERSION_ID:-}" in
    ubuntu:22.04|ubuntu:24.04|debian:12|debian:13) ;;
    debian:11) require_debian11_runtime ;;
    *) fail "only Ubuntu 22.04/24.04 and Debian 11/12/13 are supported for the hy2 complement" ;;
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

refuse_managed_allowlist_sync() {
  if [[ -f $AUTH_ALLOWLIST ]] && grep -Fxq '# tono-exit-agent roster v1' "$AUTH_ALLOWLIST"; then
    fail "hy2 identities are owned by exit-agent; run its verified roster cycle, not static identity sync"
  fi
}

write_allowlist() {
  refuse_managed_allowlist_sync
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
# Bind the directory, not the allowlist inode: exit-agent replaces it atomically.
ReadOnlyPaths=$INSTALL_ROOT
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

patch_hy2_config_bandwidth() {
  local path=${1:-}
  local ignore_client=${2:-}
  local up_mbps=${3:-}
  local down_mbps=${4:-}
  [[ -n $path && -f $path && ! -L $path ]] || fail "hy2 config is missing"
  python3 - "$path" "$ignore_client" "$up_mbps" "$down_mbps" <<'PY'
import json, pathlib, re, sys

path, ignore_client, up_mbps, down_mbps = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
target = pathlib.Path(path)
text = target.read_text(encoding="utf-8")

BW_RE = re.compile(r"(?m)^bandwidth:[ \t]*(?:#[^\r\n]*)?\r?\n((?:[ \t]+.*(?:\r?\n|$))*)")
IG_LINE_RE = re.compile(r"(?m)^ignoreClientBandwidth:[ \t]*(true|false)[ \t]*(?:#[^\r\n]*)?\r?$")
IG_SUB_RE = re.compile(r"(?m)^ignoreClientBandwidth:[ \t]*(?:true|false)[ \t]*(?:#[^\r\n]*)?(?:\r?\n|$)")


def extract_bw(src):
    up_val, down_val, ig_val = None, None, None
    raw_units = {}
    bw_key_count = len(re.findall(r"(?m)^bandwidth[ \t]*:", src))
    if bw_key_count > 1:
        raise SystemExit("hy2 bandwidth block is not unique")
    bw_matches = list(BW_RE.finditer(src))
    if bw_key_count == 1 and not bw_matches:
        raise SystemExit("hy2 bandwidth block is malformed")
    if bw_matches:
        body = bw_matches[0].group(1)
        for key, replacement in (("up", up_mbps), ("down", down_mbps)):
            key_matches = re.findall(rf"(?m)^[ \t]+{key}[ \t]*:", body)
            if len(key_matches) > 1:
                raise SystemExit(f"hy2 bandwidth.{key} is not unique")
            m_any = re.search(rf"(?m)^[ \t]+{key}[ \t]*:[ \t]*(.*?)[ \t]*\r?$", body)
            if not m_any:
                continue
            val_text = re.sub(r"(?:^|[ \t]+)#.*$", "", m_any.group(1)).strip()
            m_mbps = re.fullmatch(r"(\d+)\s*mbps", val_text, re.IGNORECASE)
            if not m_mbps:
                raw_units[key] = val_text
                if (up_mbps or down_mbps) and not replacement:
                    raise SystemExit("unsupported bandwidth unit in existing config")
                continue
            if key == "up":
                up_val = int(m_mbps.group(1))
            else:
                down_val = int(m_mbps.group(1))
    ig_keys = re.findall(r"(?m)^ignoreClientBandwidth[ \t]*:", src)
    if len(ig_keys) > 1:
        raise SystemExit("hy2 ignoreClientBandwidth is not unique")
    ig_m = IG_LINE_RE.search(src)
    if ig_keys and not ig_m:
        raise SystemExit("hy2 ignoreClientBandwidth is malformed")
    if ig_m:
        ig_val = ig_m.group(1) == "true"
    return up_val, down_val, ig_val, raw_units


cur_up, cur_down, cur_ig, _cur_raw_units = extract_bw(text)
new_up = int(up_mbps) if up_mbps else cur_up
new_down = int(down_mbps) if down_mbps else cur_down
new_ig = (ignore_client == "true") if ignore_client else cur_ig

if (up_mbps or down_mbps) and ((up_mbps and new_down is None) or (down_mbps and new_up is None)):
    raise SystemExit("bandwidth requires both up and down when creating missing bandwidth block")

changed = (new_up, new_down, new_ig) != (cur_up, cur_down, cur_ig)

if changed:
    if (up_mbps or down_mbps) and (new_up, new_down) != (cur_up, cur_down):
        bw_block = f"bandwidth:\n  up: {new_up} mbps\n  down: {new_down} mbps\n"
        if BW_RE.search(text):
            text, n = BW_RE.subn(bw_block, text, count=1)
            if n != 1:
                raise SystemExit("hy2 bandwidth block is not unique")
        elif re.search(r"(?m)^disableUDP:", text):
            text = re.sub(r"(?m)^disableUDP:", bw_block + "disableUDP:", text, count=1)
        else:
            text = text.rstrip("\r\n") + "\n" + bw_block

    if ignore_client and new_ig != cur_ig:
        ig_line = f"ignoreClientBandwidth: {ignore_client}\n"
        if IG_LINE_RE.search(text):
            text = IG_SUB_RE.sub(ig_line, text, count=1)
        elif re.search(r"(?m)^disableUDP:", text):
            text = re.sub(r"(?m)^disableUDP:", ig_line + "disableUDP:", text, count=1)
        else:
            text = text.rstrip("\r\n") + "\n" + ig_line

    if not text.endswith("\n"):
        text += "\n"
    target.write_text(text, encoding="utf-8")

fin_up, fin_down, fin_ig, fin_raw_units = extract_bw(text)
cap_above = (
    True
    if ((fin_up or 0) > 500 or (fin_down or 0) > 500)
    else ("unknown" if fin_raw_units else False)
)
payload = {
    "changed": changed,
    "ignoreClientBandwidth": fin_ig,
    "upMbps": fin_up,
    "downMbps": fin_down,
    "previous": {
        "ignoreClientBandwidth": cur_ig,
        "upMbps": cur_up,
        "downMbps": cur_down,
    },
    "serverCapAboveClientCatalogMax": cap_above,
}
if fin_raw_units:
    payload["rawUnits"] = fin_raw_units
print(json.dumps(payload))
PY
}

validate_bandwidth_mbps() {
  [[ $1 =~ ^[1-9][0-9]{1,3}$ ]] && ((10#$1 >= 10 && 10#$1 <= 1000)) ||
    fail "invalid bandwidth Mbps (expected integer in 10..1000)"
}

hy2_listen_port() {
  python3 - "$1" <<'PY'
import pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
m = re.search(r"(?m)^listen:\s*:(\d+)\s*\r?$", text)
if not m:
    raise SystemExit(1)
print(m.group(1))
PY
}

hy2_is_active_and_listening() {
  systemctl is-active --quiet "$SERVICE_NAME" && udp_port_in_use "$1"
}

wait_hy2_healthy() {
  local port=${1:-}
  local settle=${TONO_HY2_SETTLE_SEC:-2}
  [[ $settle =~ ^[0-9]+$ ]] || return 1
  local _i ready=false
  for _i in $(seq 1 50); do
    if hy2_is_active_and_listening "$port"; then
      ready=true
      break
    fi
    sleep 0.2
  done
  [[ $ready == true ]] || return 1
  local pid1 restarts1 pid2 restarts2
  pid1=$(systemctl show "$SERVICE_NAME" -p MainPID --value 2>/dev/null || true)
  restarts1=$(systemctl show "$SERVICE_NAME" -p NRestarts --value 2>/dev/null || true)
  if ((settle > 0)); then
    sleep "$settle"
  fi
  hy2_is_active_and_listening "$port" || return 1
  pid2=$(systemctl show "$SERVICE_NAME" -p MainPID --value 2>/dev/null || true)
  restarts2=$(systemctl show "$SERVICE_NAME" -p NRestarts --value 2>/dev/null || true)
  [[ -n $pid1 && $pid1 != "0" && $pid1 == "$pid2" && $restarts1 == "$restarts2" ]]
}

restore_bandwidth_backup() {
  local backup_path=$1 conf_path=$2 port=$3 reason=$4
  local rollback_ok=true
  rm -f "${_bw_staged:-}"
  _bw_staged=""
  if ! cp -a "$backup_path" "${conf_path}.rollback.tmp" || ! mv -f "${conf_path}.rollback.tmp" "$conf_path"; then
    rm -f "${conf_path}.rollback.tmp" >/dev/null 2>&1 || true
    rollback_ok=false
  else
    chmod 0640 "$conf_path" || rollback_ok=false
    if getent group "$SERVICE_USER" >/dev/null 2>&1; then
      chown "root:$SERVICE_USER" "$conf_path" || rollback_ok=false
    fi
    systemctl reset-failed "$SERVICE_NAME" >/dev/null 2>&1 || true
    if ! systemctl restart "$SERVICE_NAME" >/dev/null 2>&1; then
      rollback_ok=false
    elif ! wait_hy2_healthy "$port"; then
      rollback_ok=false
    fi
  fi
  _bw_backup=""
  trap - EXIT RETURN
  if [[ $rollback_ok == true ]]; then
    rm -f "$backup_path"
    printf 'Tono hy2 operation failed: %s; restored previous config and verified healthy\n' "$reason" >&2
    exit 1
  fi
  printf 'Tono hy2 operation failed: %s; rollback also failed — backup preserved at %s (manual intervention required)\n' "$reason" "$backup_path" >&2
  exit 2
}

set_bandwidth() {
  require_root
  local ignore_client="" up_mbps="" down_mbps="" dry_run=0
  while (($# > 0)); do
    case "$1" in
      --ignore-client-bandwidth)
        [[ ${2:-} == "true" || ${2:-} == "false" ]] || fail "expected true or false for --ignore-client-bandwidth"
        ignore_client=$2
        shift 2
        ;;
      --up-mbps)
        [[ $# -ge 2 ]] || fail "missing value for --up-mbps"
        validate_bandwidth_mbps "$2"
        up_mbps=$2
        shift 2
        ;;
      --down-mbps)
        [[ $# -ge 2 ]] || fail "missing value for --down-mbps"
        validate_bandwidth_mbps "$2"
        down_mbps=$2
        shift 2
        ;;
      --dry-run)
        dry_run=1
        shift 1
        ;;
      *)
        fail "unknown set-bandwidth option: $1"
        ;;
    esac
  done
  [[ -n $ignore_client || -n $up_mbps || -n $down_mbps ]] ||
    fail "set-bandwidth requires at least one of --ignore-client-bandwidth, --up-mbps, or --down-mbps"

  for command_name in chmod chown cp getent grep mktemp mv python3 rm seq sleep ss systemctl; do
    require_command "$command_name"
  done
  xray_is_active || fail "tono-xray must stay running; set-bandwidth does not replace Reality"
  hy2_is_installed || fail "tono-hy2 is not installed"
  local conf port xray_pid
  conf=$(hy2_config_path) || fail "tono-hy2 config is missing"
  port=$(hy2_listen_port "$conf") || fail "could not determine hy2 listen port"
  xray_pid=$(systemctl show "$XRAY_SERVICE" -p MainPID --value)

  local staged backup summary changed
  staged=$(mktemp "${conf}.bw.XXXXXX")
  backup=$(mktemp "${conf}.bak.XXXXXX")
  _bw_staged=$staged
  _bw_backup=$backup
  cleanup_bandwidth_temps() {
    rm -f "${_bw_staged:-}" "${_bw_backup:-}"
  }
  trap cleanup_bandwidth_temps EXIT RETURN
  cp -a "$conf" "$staged"
  cp -a "$conf" "$backup"
  summary=$(patch_hy2_config_bandwidth "$staged" "$ignore_client" "$up_mbps" "$down_mbps") ||
    fail "could not update hy2 bandwidth settings"
  if [[ $dry_run == "1" ]]; then
    cleanup_bandwidth_temps
    trap - EXIT RETURN
    python3 - "$summary" "$xray_pid" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
data["dryRun"] = True
data["xrayPid"] = int(sys.argv[2])
data["xrayUntouched"] = True
print(json.dumps(data))
PY
    return
  fi
  changed=$(python3 -c 'import json,sys; print("1" if json.loads(sys.argv[1])["changed"] else "0")' "$summary")
  if [[ $changed == "1" ]]; then
    mv -f "$staged" "$conf"
    _bw_staged=""
    if ! chmod 0640 "$conf"; then
      restore_bandwidth_backup "$backup" "$conf" "$port" "could not set hy2 config permissions"
    fi
    if getent group "$SERVICE_USER" >/dev/null 2>&1; then
      if ! chown "root:$SERVICE_USER" "$conf"; then
        restore_bandwidth_backup "$backup" "$conf" "$port" "could not set hy2 config ownership"
      fi
    fi
    if ! systemctl restart "$SERVICE_NAME" >/dev/null 2>&1; then
      restore_bandwidth_backup "$backup" "$conf" "$port" "systemctl restart failed during bandwidth change"
    fi
    if ! wait_hy2_healthy "$port"; then
      restore_bandwidth_backup "$backup" "$conf" "$port" "hy2 did not become healthy after bandwidth change"
    fi
  fi
  cleanup_bandwidth_temps
  trap - EXIT RETURN
  local xray_pid_after
  xray_pid_after=$(systemctl show "$XRAY_SERVICE" -p MainPID --value)
  [[ $xray_pid_after == "$xray_pid" ]] || fail "tono-xray pid changed during hy2 set-bandwidth"
  python3 - "$summary" "$xray_pid_after" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
data["xrayPid"] = int(sys.argv[2])
data["xrayUntouched"] = True
print(json.dumps(data))
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
  refuse_managed_allowlist_sync
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
  systemctl enable "$AUTH_SERVICE_NAME" >/dev/null 2>&1
  systemctl restart "$AUTH_SERVICE_NAME" >/dev/null
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
  # One validated input owns certificate SAN, masquerade and the client SNI.
  # Never silently fall back to a different (formerly Microsoft) host.
  local CERT_CN=${6:-}
  [[ $deployment_id =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || fail "invalid deployment identifier"
  [[ $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "invalid pinned hysteria version"
  [[ $artifact =~ ^/tmp/tono-hy2-artifact-[a-f0-9]{24}$ ]] || fail "invalid uploaded artifact path"
  [[ $expected_sha256 =~ ^[a-f0-9]{64}$ ]] || fail "invalid artifact digest"
  validate_port "$port"
  validate_servername "$CERT_CN"
  platform
  for command_name in awk chmod chown getent groupadd grep install ln mv openssl python3 readlink seq sha256sum ss systemctl useradd; do
    require_command "$command_name"
  done
  xray_is_active || fail "tono-xray must stay running; hy2 is a complement"
  [[ -f $artifact && ! -L $artifact ]] || fail "uploaded hysteria artifact is not a regular file"
  [[ $(sha256sum "$artifact" | awk '{ print $1 }') == "$expected_sha256" ]] || fail "uploaded hysteria artifact digest mismatch"
  "$artifact" version >/dev/null 2>&1 || fail "verified hysteria binary cannot run on this host"
  [[ ! -e $SERVICE_PATH && ! -e $INSTALL_ROOT/current && ! -f $INSTALL_ROOT/config.yaml ]] || fail "an existing tono-hy2 installation requires an explicit rotation workflow"
  ! udp_port_in_use "$port" || fail "the selected UDP port is already in use"
  [[ ! -e $AUTH_SERVICE_PATH && ! -e $AUTH_ALLOWLIST ]] || fail "an existing hy2 auth installation requires a reviewed recovery"
  ! ss -H -ltn 'sport = :18765' | grep -q . || fail "the hy2 auth port is already in use"

  local release committed=0 xray_pid_before xray_digest_before
  xray_pid_before=$(systemctl show "$XRAY_SERVICE" -p MainPID --value)
  xray_digest_before=$(sha256sum "$XRAY_CONFIG" | awk '{print $1}')
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
  # sing-box (macOS) pins this, not the DER hash. Printed with every new
  # certificate so a re-run can never leave the catalog's SPKI pin stale.
  local public_key_sha256
  public_key_sha256=$(openssl x509 -in "$release/cert.pem" -pubkey -noout | openssl pkey -pubin -outform der |
    openssl dgst -sha256 -binary | openssl enc -base64)
  [[ $public_key_sha256 =~ ^[A-Za-z0-9+/]{43}=$ ]] || fail "could not read the hy2 certificate public key pin"

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
bandwidth:
  up: 500 mbps
  down: 500 mbps
ignoreClientBandwidth: false
disableUDP: false
quic:
  initStreamReceiveWindow: 8388608
  maxStreamReceiveWindow: 8388608
  initConnReceiveWindow: 20971520
  maxConnReceiveWindow: 20971520
  maxIdleTimeout: 30s
  maxIncomingStreams: 1024
acl:
  inline:
    - reject(10.0.0.0/8)
    - reject(172.16.0.0/12)
    - reject(192.168.0.0/16)
    - reject(127.0.0.0/8)
    - reject(169.254.0.0/16)
    - reject(fc00::/7)
    - reject(fe80::/10)
    - reject(::1/128)
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
MemoryMax=256M
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
  [[ $(systemctl show "$XRAY_SERVICE" -p MainPID --value) == "$xray_pid_before" ]] || fail "tono-xray pid changed during hy2 install"
  [[ $(sha256sum "$XRAY_CONFIG" | awk '{print $1}') == "$xray_digest_before" ]] || fail "tono-xray config changed during hy2 install"

  committed=1
  rm -f "$artifact"
  trap - EXIT
  printf '{"deploymentId":"%s","version":"%s","port":%s,"fingerprint":"%s","certificatePublicKeySha256":"%s","xrayUntouched":true}\n' \
    "$deployment_id" "$version" "$port" "$fingerprint" "$public_key_sha256"
}

mode=${1:-}
shift || true
case "$mode" in
  preflight) preflight "$@" ;;
  apply) apply_deployment "$@" ;;
  rollback) rollback_deployment "$@" ;;
  sync-identities) sync_identities apply "$@" ;;
  sync-identities-dry-run) sync_identities dry-run "$@" ;;
  set-bandwidth) set_bandwidth "$@" ;;
  *) fail "expected preflight, apply, rollback, sync-identities, sync-identities-dry-run, or set-bandwidth" ;;
esac
