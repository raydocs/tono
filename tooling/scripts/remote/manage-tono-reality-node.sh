#!/bin/bash
set -euo pipefail

umask 077

SERVICE_NAME="tono-xray.service"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"
INSTALL_ROOT="/opt/tono-xray"
SERVICE_USER="tono-xray"
# Loopback-only gRPC API. Fixed rather than configurable: it is reached over the
# SSH management path, so a per-node port would be one more thing to record and
# get wrong, and nothing outside the host can address it either way.
API_PORT=10085

fail() {
  printf 'Tono node operation failed: %s\n' "$1" >&2
  exit 1
}

require_root() {
  [[ $(id -u) -eq 0 ]] || fail "root or passwordless sudo is required"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is unavailable: $1"
}

validate_port() {
  [[ $1 =~ ^[0-9]+$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535)) || fail "invalid TCP port"
}

validate_target() {
  [[ ${#1} -le 253 && $1 =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && $1 == *.* ]] ||
    fail "Reality target must be a bounded DNS hostname"
}

platform() {
  [[ -r /etc/os-release ]] || fail "missing /etc/os-release"
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}:${VERSION_ID:-}" in
    ubuntu:22.04|ubuntu:24.04|debian:12) ;;
    *) fail "only Ubuntu 22.04/24.04 and Debian 12 are supported" ;;
  esac
  case "$(uname -m)" in
    x86_64|aarch64) ;;
    *) fail "only x86_64 and aarch64 hosts are supported" ;;
  esac
  [[ -d /run/systemd/system ]] || fail "systemd is not running"
}

port_in_use() {
  ss -H -ltn "sport = :$1" 2>/dev/null | grep -q .
}

target_supports_tls13() {
  local target=$1
  timeout 10 openssl s_client \
    -connect "$target:443" \
    -servername "$target" \
    -tls1_3 \
    -verify_hostname "$target" \
    -verify_return_error \
    </dev/null >/dev/null 2>&1
}

preflight() {
  require_root
  local port=${1:-}
  local target=${2:-}
  validate_port "$port"
  validate_target "$target"
  platform
  for command_name in getent grep install openssl sha256sum ss systemctl timeout; do
    require_command "$command_name"
  done

  local os_id arch available_kib occupied existing tls13 ufw_active
  # shellcheck disable=SC1091
  . /etc/os-release
  os_id="${ID}-${VERSION_ID}"
  arch=$(uname -m)
  available_kib=$(df -Pk / | awk 'NR == 2 { print $4 }')
  [[ $available_kib =~ ^[0-9]+$ ]] || fail "could not determine free disk space"
  ((available_kib >= 131072)) || fail "at least 128 MiB of free disk is required"

  occupied=false
  port_in_use "$port" && occupied=true
  existing=false
  if [[ -e "$SERVICE_PATH" || -e "$INSTALL_ROOT/current" ]]; then
    existing=true
  fi
  tls13=false
  target_supports_tls13 "$target" && tls13=true
  ufw_active=false
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    ufw_active=true
  fi

  # Clock skew. Reality is TLS, so a badly wrong clock makes handshakes fail in a
  # way that reads as "the node is broken" from every other vantage point. Report
  # it rather than refuse: the operator may be provisioning before NTP settles.
  local clock_synced="unknown"
  if command -v timedatectl >/dev/null 2>&1; then
    if timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q '^yes$'; then
      clock_synced=true
    else
      clock_synced=false
    fi
  fi

  # Whether this host can reach the internet over IPv6 at all. The service pins
  # its outbound to IPv4, so a node with working IPv6 is not a problem — but a
  # node where IPv6 exists and is *broken* is where an unpinned resolver would
  # have produced the intermittent egress failures that are hardest to attribute.
  # Recorded so the fleet inventory can say which nodes have it.
  local ipv6_egress=false
  if timeout 4 getent ahostsv6 one.one.one.one >/dev/null 2>&1 &&
     timeout 4 bash -c "exec 3<>/dev/tcp/2606:4700:4700::1111/443" 2>/dev/null; then
    ipv6_egress=true
  fi

  printf '{"os":"%s","arch":"%s","availableKiB":%s,"port":%s,"portInUse":%s,"existingTono":%s,"targetTLS13":%s,"ufwActive":%s,"clockSynced":"%s","ipv6Egress":%s}\n' \
    "$os_id" "$arch" "$available_kib" "$port" "$occupied" "$existing" "$tls13" "$ufw_active" \
    "$clock_synced" "$ipv6_egress"
}

rollback_deployment() {
  require_root
  local deployment_id=${1:-}
  [[ $deployment_id =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || fail "invalid deployment identifier"
  local release="$INSTALL_ROOT/releases/$deployment_id"
  local current=""
  if [[ -L "$INSTALL_ROOT/current" ]]; then
    current=$(readlink -f "$INSTALL_ROOT/current")
  fi
  if [[ -z $current && ! -e $release && ! -e $SERVICE_PATH ]]; then
    printf '{"rolledBack":true,"deploymentId":"%s"}\n' "$deployment_id"
    return
  fi
  if [[ -n $current && $current != "$release" ]]; then
    fail "refusing to roll back a deployment that is not current"
  fi
  if [[ -z $current && ! -e $release ]]; then
    fail "refusing to remove a service that cannot be tied to this deployment"
  fi

  systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
  rm -f "$SERVICE_PATH" "$SERVICE_PATH.new" "$INSTALL_ROOT/current" "$INSTALL_ROOT/current.new"
  rm -rf "$release"
  systemctl daemon-reload
  systemctl reset-failed "$SERVICE_NAME" >/dev/null 2>&1 || true
  rmdir "$INSTALL_ROOT/releases" "$INSTALL_ROOT" 2>/dev/null || true
  printf '{"rolledBack":true,"deploymentId":"%s"}\n' "$deployment_id"
}

apply_deployment() {
  require_root
  local deployment_id=${1:-}
  local version=${2:-}
  local artifact=${3:-}
  local expected_sha256=${4:-}
  local port=${5:-}
  local target=${6:-}
  [[ $deployment_id =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || fail "invalid deployment identifier"
  [[ $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "invalid pinned Xray version"
  [[ $artifact =~ ^/tmp/tono-xray-artifact-[a-f0-9]{24}$ ]] || fail "invalid uploaded artifact path"
  [[ $expected_sha256 =~ ^[a-f0-9]{64}$ ]] || fail "invalid artifact digest"
  validate_port "$port"
  validate_target "$target"
  platform
  for command_name in awk chmod chown getent groupadd grep install ln mv openssl readlink sed seq sha256sum ss systemctl timeout useradd; do
    require_command "$command_name"
  done
  [[ -f $artifact && ! -L $artifact ]] || fail "uploaded Xray artifact is not a regular file"
  [[ $(sha256sum "$artifact" | awk '{ print $1 }') == "$expected_sha256" ]] || fail "uploaded Xray artifact digest mismatch"
  [[ ! -e $SERVICE_PATH && ! -e $INSTALL_ROOT/current ]] || fail "an existing Tono Xray installation requires an explicit rotation workflow"
  ! port_in_use "$port" || fail "the selected TCP port is already in use"
  target_supports_tls13 "$target" || fail "the Reality target did not complete a verified TLS 1.3 handshake from this VPS"

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
  install -m 0755 -o root -g root "$artifact" "$release/xray"

  local uuid key_output private_key public_key short_id clients_json
  uuid=$("$release/xray" uuid)
  [[ $uuid =~ ^[a-f0-9-]{36}$ ]] || fail "Xray returned an invalid UUID"
  # A single client today, emitted as a list because that is the shape per-user
  # identity needs and changing the shape later means regenerating every node.
  # `email` is Xray's key for per-user counters: without it the stats blocks
  # above record nothing per user, only per inbound.
  clients_json=$(printf '{ "id": "%s", "flow": "xtls-rprx-vision", "email": "%s", "level": 0 }' \
    "$uuid" "node-shared")
  key_output=$("$release/xray" x25519)
  private_key=$(printf '%s\n' "$key_output" | sed -n 's/^PrivateKey:[[:space:]]*//p')
  public_key=$(printf '%s\n' "$key_output" | sed -n 's/^Password (PublicKey):[[:space:]]*//p')
  [[ $private_key =~ ^[A-Za-z0-9_-]{43}$ && $public_key =~ ^[A-Za-z0-9_-]{43}$ ]] ||
    fail "Xray returned an invalid Reality keypair"
  short_id=$(openssl rand -hex 8)

  # The stats/api/policy trio and the loopback API inbound are installed on every
  # node from the start, even though nothing reads them yet. They cost nothing at
  # runtime and cannot be added later without touching every machine in the
  # fleet — which is the position the existing sixteen nodes are already in.
  #
  # `statsUserUplink`/`statsUserDownlink` are what make per-user accounting
  # possible at all. They are per-level, and every client below is level 0.
  #
  # The API listens on 127.0.0.1 only and is reachable solely through the SSH
  # management path; no firewall rule exposes it. A dokodemo-door inbound is the
  # documented way to expose Xray's gRPC services, and the routing rule below is
  # what keeps that inbound from being treated as user traffic.
  cat >"$release/config.json" <<EOF
{
  "log": { "loglevel": "warning" },
  "stats": {},
  "api": { "tag": "api", "services": ["StatsService"] },
  "policy": {
    "levels": {
      "0": { "statsUserUplink": true, "statsUserDownlink": true }
    },
    "system": {
      "statsInboundUplink": true,
      "statsInboundDownlink": true
    }
  },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "port": $port,
      "protocol": "vless",
      "tag": "reality-in",
      "settings": {
        "clients": [$clients_json],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "raw",
        "security": "reality",
        "realitySettings": {
          "target": "$target:443",
          "serverNames": ["$target"],
          "privateKey": "$private_key",
          "shortIds": ["$short_id"]
        }
      }
    },
    {
      "listen": "127.0.0.1",
      "port": $API_PORT,
      "protocol": "dokodemo-door",
      "tag": "api-in",
      "settings": { "address": "127.0.0.1" }
    }
  ],
  "outbounds": [{
    "protocol": "freedom",
    "tag": "direct",
    "settings": { "domainStrategy": "UseIPv4" }
  }],
  "routing": {
    "rules": [
      { "type": "field", "inboundTag": ["api-in"], "outboundTag": "api" }
    ]
  }
}
EOF
  chown root:"$SERVICE_USER" "$release/config.json"
  chmod 0640 "$release/config.json"
  "$release/xray" run -test -config "$release/config.json" >/dev/null 2>&1 || fail "Xray rejected the generated configuration"

  # Xray logs to the journal and nothing bounds it. On the small disks these
  # nodes run, an unbounded journal is a slow disk-full outage whose first
  # symptom looks like a network fault. This is a journald setting, not a
  # service one — there is no per-unit size cap — so it is a drop-in, and it is
  # written only when absent so an operator's own policy is never clobbered.
  if [[ ! -e /etc/systemd/journald.conf.d/99-tono.conf ]]; then
    mkdir -p /etc/systemd/journald.conf.d
    cat >/etc/systemd/journald.conf.d/99-tono.conf <<'JOURNALD'
# Installed by Tono provisioning. Host-wide: these nodes run nothing else.
[Journal]
SystemMaxUse=200M
SystemMaxFileSize=20M
JOURNALD
    chmod 0644 /etc/systemd/journald.conf.d/99-tono.conf
    systemctl restart systemd-journald >/dev/null 2>&1 || true
  fi

  cat >"$SERVICE_PATH.new" <<EOF
[Unit]
Description=Tono managed Xray Reality node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
ExecStart=$INSTALL_ROOT/current/xray run -config $INSTALL_ROOT/current/config.json
Restart=on-failure
RestartSec=2s
TimeoutStopSec=15s
LimitNOFILE=1048576
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
MemoryDenyWriteExecute=true
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
    if systemctl is-active --quiet "$SERVICE_NAME" && port_in_use "$port"; then
      ready=true
      break
    fi
    sleep 0.2
  done
  [[ $ready == true ]] || fail "Xray did not become active and listen on the selected TCP port"

  committed=1
  # EXIT traps run after this function's local variables leave scope. Clean the
  # uploaded artifact and disarm the failure trap while those variables still
  # exist, otherwise `set -u` turns a successful install into a false failure.
  rm -f "$artifact"
  trap - EXIT
  printf '{"deploymentId":"%s","version":"%s","port":%s,"uuid":"%s","publicKey":"%s","shortId":"%s"}\n' \
    "$deployment_id" "$version" "$port" "$uuid" "$public_key" "$short_id"
}

# Network tuning, as a separate reviewable stage.
#
# Deliberately only two settings. Every "VPS optimisation" guide adds a block of
# buffer and queue sysctls; the provisioning notes already refuse those, because
# without measurement they are cargo cult and several of them make a landing node
# worse. `fq` plus `bbr` is the one change with a defensible mechanism for this
# workload — a TCP relay whose flows are long-lived and whose bottleneck is the
# path, not the host — and it is what the notes already sanction.
#
# Nothing here touches MTU, buffer sizes, qdisc classes, or offloads. If a node
# needs those, it needs measurement first, not a default.
tune_network() {
  require_root
  local backup_root="/root/tono-network-backups"
  local stamp
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  local backup="$backup_root/$stamp"
  local profile="/etc/sysctl.d/99-tono-landing.conf"

  # Refuse rather than overwrite. A second run must not silently replace a
  # profile an operator tuned by hand, and must not bury the original baseline
  # under a backup of our own settings.
  if [[ -e $profile ]]; then
    printf '{"tuned":false,"reason":"existing-tono-profile","profile":"%s"}\n' "$profile"
    return 0
  fi

  # Availability is checked, never assumed: a kernel without tcp_bbr would take
  # the congestion control setting and silently keep cubic.
  local available current_cc current_qdisc
  available=$(sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null || printf '')
  if [[ $available != *bbr* ]]; then
    modprobe tcp_bbr >/dev/null 2>&1 || true
    available=$(sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null || printf '')
  fi
  if [[ $available != *bbr* ]]; then
    printf '{"tuned":false,"reason":"bbr-unavailable","available":"%s"}\n' "$available"
    return 0
  fi

  current_cc=$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || printf 'unknown')
  current_qdisc=$(sysctl -n net.core.default_qdisc 2>/dev/null || printf 'unknown')

  mkdir -p "$backup"
  chmod 0700 "$backup_root" "$backup"
  [[ -e /etc/sysctl.conf ]] && cp -a /etc/sysctl.conf "$backup/" || true
  [[ -d /etc/sysctl.d ]] && cp -a /etc/sysctl.d "$backup/" || true
  [[ -d /etc/modules-load.d ]] && cp -a /etc/modules-load.d "$backup/" || true

  # The baseline is recorded before anything changes, because the rollback below
  # restores these exact values rather than a guess at the distribution default.
  cat >"$backup/baseline.json" <<BASELINE
{"congestionControl":"$current_cc","defaultQdisc":"$current_qdisc","stamp":"$stamp"}
BASELINE

  cat >"$profile" <<'PROFILE'
# Installed by Tono provisioning. Two settings, both with a stated mechanism:
#   fq   - pacing, which BBR requires to shape its send rate
#   bbr  - congestion control suited to a long-lived relay on a lossy path
# Anything beyond these belongs to a measured change, not to a default.
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
PROFILE
  chmod 0644 "$profile"
  printf 'tcp_bbr\n' >/etc/modules-load.d/99-tono-bbr.conf
  chmod 0644 /etc/modules-load.d/99-tono-bbr.conf

  cat >"$backup/rollback.sh" <<ROLLBACK
#!/bin/bash
# Restores the exact values recorded before Tono tuning was applied.
set -euo pipefail
rm -f "$profile" /etc/modules-load.d/99-tono-bbr.conf
sysctl -w net.core.default_qdisc="$current_qdisc" >/dev/null
sysctl -w net.ipv4.tcp_congestion_control="$current_cc" >/dev/null
sysctl --system >/dev/null
printf 'restored qdisc=%s cc=%s\n' "$current_qdisc" "$current_cc"
ROLLBACK
  chmod 0700 "$backup/rollback.sh"

  sysctl --system >/dev/null 2>&1 || fail "sysctl --system rejected the Tono profile"

  # Verify the live values rather than trusting the write. A profile that loads
  # without taking effect is the failure this whole stage exists to avoid.
  local applied_cc applied_qdisc
  applied_cc=$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || printf 'unknown')
  applied_qdisc=$(sysctl -n net.core.default_qdisc 2>/dev/null || printf 'unknown')
  if [[ $applied_cc != bbr || $applied_qdisc != fq ]]; then
    bash "$backup/rollback.sh" >/dev/null 2>&1 || true
    fail "tuning did not take effect (cc=$applied_cc qdisc=$applied_qdisc); rolled back"
  fi

  printf '{"tuned":true,"congestionControl":"%s","defaultQdisc":"%s","previousCongestionControl":"%s","previousDefaultQdisc":"%s","backup":"%s","rollback":"%s"}\n' \
    "$applied_cc" "$applied_qdisc" "$current_cc" "$current_qdisc" "$backup" "$backup/rollback.sh"
}

mode=${1:-}
shift || true
case "$mode" in
  preflight) preflight "$@" ;;
  apply) apply_deployment "$@" ;;
  rollback) rollback_deployment "$@" ;;
  tune) tune_network "$@" ;;
  *) fail "expected preflight, apply, rollback, or tune mode" ;;
esac
