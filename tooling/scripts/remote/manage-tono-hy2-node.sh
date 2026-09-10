#!/bin/bash
set -euo pipefail

umask 077

# Complement role: Hysteria2 beside an existing tono-xray TCP Reality service.
# This script must never stop, replace, or rewrite tono-xray.
# Auth currently copies the first xray client UUID as the hysteria password.
# That is enough for a freshly provisioned single-client node; fleet-wide
# identity sync is not this script's job.

XRAY_SERVICE="tono-xray.service"
XRAY_CONFIG="/opt/tono-xray/current/config.json"
SERVICE_NAME="tono-hy2.service"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"
INSTALL_ROOT="/opt/tono-hy2"
SERVICE_USER="tono-hy2"
CERT_CN="www.microsoft.com"

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

read_xray_uuid() {
  [[ -f $XRAY_CONFIG && ! -L $XRAY_CONFIG ]] || fail "existing tono-xray config is required; hy2 does not replace Reality"
  python3 - "$XRAY_CONFIG" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as handle:
    config = json.load(handle)
clients = config["inbounds"][0]["settings"]["clients"]
uuid = clients[0]["id"]
if not isinstance(uuid, str) or len(uuid) != 36:
    raise SystemExit("xray uuid missing")
print(uuid)
PY
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
  if [[ -e "$SERVICE_PATH" || -e "$INSTALL_ROOT/current" ]]; then
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
  rm -f "$SERVICE_PATH" "$INSTALL_ROOT/current"
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
  [[ ! -e $SERVICE_PATH && ! -e $INSTALL_ROOT/current ]] || fail "an existing tono-hy2 installation requires an explicit rotation workflow"
  ! udp_port_in_use "$port" || fail "the selected UDP port is already in use"

  local password
  password=$(read_xray_uuid)

  local release committed=0
  release="$INSTALL_ROOT/releases/$deployment_id"

  cleanup_apply() {
    local status=$?
    rm -f "$artifact"
    if ((status != 0 && committed == 0)); then
      systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
      rm -f "$SERVICE_PATH" "$SERVICE_PATH.new" "$INSTALL_ROOT/current" "$INSTALL_ROOT/current.new"
      rm -rf "$release"
      systemctl daemon-reload >/dev/null 2>&1 || true
      systemctl reset-failed "$SERVICE_NAME" >/dev/null 2>&1 || true
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

  cat >"$release/config.yaml" <<EOF
listen: :$port
tls:
  cert: $INSTALL_ROOT/current/cert.pem
  key: $INSTALL_ROOT/current/key.pem
auth:
  type: password
  password: $password
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
After=network-online.target $XRAY_SERVICE
Wants=network-online.target

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
  systemctl enable --now "$SERVICE_NAME" >/dev/null

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
  *) fail "expected preflight, apply, or rollback mode" ;;
esac
