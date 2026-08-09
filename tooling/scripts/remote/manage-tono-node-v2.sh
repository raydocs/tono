#!/bin/bash
set -euo pipefail
umask 077

fail(){ printf 'Tono node operation failed: %s\n' "$1" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"; }
[[ $(id -u) == 0 ]] || fail "root or passwordless sudo required"
need python3; need base64
[[ ${TONO_REQUEST_B64:-} =~ ^[A-Za-z0-9+/=]+$ ]] || fail "missing framed request"
REQUEST=$(printf '%s' "$TONO_REQUEST_B64" | base64 -d) || fail "invalid request encoding"
jget(){ REQUEST="$REQUEST" python3 - "$1" <<'PY'
import json,os,sys
v=json.loads(os.environ['REQUEST'])
for k in sys.argv[1].split('.'):
 v=v[k]
if isinstance(v,bool): print(str(v).lower())
elif isinstance(v,(dict,list)): print(json.dumps(v,separators=(',',':'),sort_keys=True))
else: print(v)
PY
}
jmaybe(){ jget "$1" 2>/dev/null || true; }
emit(){ python3 - "$@" <<'PY'
import json,sys
d={'ok':True}
for x in sys.argv[1:]:
 k,t,v=x.split('=',2); d[k]=json.loads(v) if t=='j' else v
print(json.dumps(d,separators=(',',':'),sort_keys=True))
PY
}
emit_client(){ TX="$TX" python3 <<'PY'
import json,os
p=os.environ['TX']; uuid,pub,sid=(open(p+'/client').read().splitlines()+['',''])[:3]; h=open(p+'/expected-hash').read().strip()
print(json.dumps({'ok':True,'transactionId':open(p+'/id').read().strip(),'expected':{'configSha256':h,'clientId':uuid},'client':{'uuid':uuid,'publicKey':pub,'shortId':sid}},separators=(',',':'),sort_keys=True))
PY
}
emit_healthy_client(){ TX="$TX" python3 <<'PY'
import json,os
p=os.environ['TX']; uuid,pub,sid=(open(p+'/client').read().splitlines()+['',''])[:3]
print(json.dumps({'ok':True,'healthy':True,'client':{'uuid':uuid,'publicKey':pub,'shortId':sid}},separators=(',',':'),sort_keys=True))
PY
}

op=$(jget op); mode=$(jmaybe desired.mode); port=$(jmaybe desired.servicePort)
config=$(jmaybe desired.configPath); service=$(jmaybe desired.serviceName); target=$(jmaybe desired.realityTarget)
ROOT=/var/lib/tono-node; TXROOT=$ROOT/transactions; BBR=/etc/sysctl.d/99-tono-node-bbr.conf
INSTALL=/opt/tono-xray
valid_common(){
 [[ $mode == fresh || $mode == extend ]] || fail "invalid mode"
 if ! [[ $port =~ ^[0-9]+$ ]] || ! ((port>0&&port<65536)); then fail "invalid port"; fi
 [[ $config =~ ^/([A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.json$ && $service =~ ^[A-Za-z0-9_.-]+\.service$ ]] || fail "invalid managed path/name"
 [[ $target =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && $target == *.* ]] || fail "invalid target"
}
platform(){
 # shellcheck source=/etc/os-release
 . /etc/os-release
 case "${ID:-}:${VERSION_ID:-}" in ubuntu:22.04|ubuntu:24.04|debian:12) ;; centos:7*|rhel:7*) fail "CentOS/RHEL 7 is unsupported";; *) fail "unsupported operating system";; esac
 [[ -d /run/systemd/system ]] || fail "systemd unavailable"
 case $(uname -m) in x86_64|aarch64) ;; *) fail "unsupported architecture";; esac
}
live_qdisc(){ tc qdisc show dev "$1" root | awk 'NR==1{print $2}'; }
egress_iface(){ ip -json route get 1.1.1.1 | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["dev"])'; }
bbr_probe(){
 need ip; need tc; need modinfo; need modprobe; need sysctl
 modinfo tcp_bbr >/dev/null 2>&1 || fail "tcp_bbr unavailable"
 IFACE=$(egress_iface); QDISC=$(live_qdisc "$IFACE")
 [[ $QDISC == fq ]] || fail "primary root qdisc must already be fq"
}
ufw_status(){ command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; }
ufw_has_port(){ ufw status 2>/dev/null | grep -Eq "(^|[[:space:]])${port}/tcp([[:space:]]|$).*ALLOW"; }
ssh_allowed(){
 local sp=${SSH_CONNECTION##* }; [[ $sp =~ ^[0-9]+$ ]] || return 1
 ufw status 2>/dev/null | grep -Eq "(^|[[:space:]])${sp}/tcp([[:space:]]|$).*ALLOW"
}
safe_parent(){
 local d; d=$(dirname "$config")
 [[ -d $d && ! -L $d && $(stat -c %u "$d") == 0 && $((8#$(stat -c %a "$d") & 8#022)) == 0 ]] || fail "config parent must be root-owned and not group/world writable"
}
service_xray(){
 local pid
 pid=$(systemctl show -p MainPID --value "$service"); [[ $pid =~ ^[1-9][0-9]*$ ]] || fail "service process unavailable"
 XRAY_EXEC=$(TONO_PID="$pid" TONO_CONFIG="$config" python3 <<'PY'
import os
pid=os.environ['TONO_PID']; cfg=os.environ['TONO_CONFIG'].encode()
args=[x for x in open('/proc/'+pid+'/cmdline','rb').read().split(b'\0') if x]
hits=[i for i in range(len(args)) if args[i] in (b'-config',b'-c')]
if len(hits)!=1 or hits[0]+1>=len(args) or args[hits[0]+1]!=cfg: raise SystemExit(1)
if any(x in (b'-confdir',b'--confdir') or x.startswith((b'-config=',b'-c=',b'-confdir=',b'--confdir=')) for x in args): raise SystemExit(1)
env=[x for x in open('/proc/'+pid+'/environ','rb').read().split(b'\0') if x]
if any(x.startswith((b'XRAY_LOCATION_CONFDIR=',b'xray.location.confdir=')) and x.split(b'=',1)[1] for x in env): raise SystemExit(1)
print(os.path.realpath('/proc/'+pid+'/exe'))
PY
 ) || fail "service command is not bound to managed config"
 [[ -x $XRAY_EXEC ]] || fail "service binary unavailable"
}
mutation_preconditions(){
 safe_parent
 if [[ $mode == fresh ]]; then
   if getent group tono-xray >/dev/null || id tono-xray >/dev/null 2>&1; then fail "fresh principal ownership conflict"; fi
   [[ ! -e $config && ! -L $config && ! -e /etc/systemd/system/$service && ! -L /etc/systemd/system/$service && ! -e $INSTALL ]] || fail "fresh ownership conflict"
   ! ss -H -ltn "sport = :$port" | grep -q . || fail "service port already occupied"
 else
   [[ -f $config && ! -L $config ]] || fail "extend config missing"
   systemctl is-active --quiet "$service" || fail "extend service must already be active"
   service_xray
 fi
}

preflight(){
 valid_common; platform
 for c in systemctl sha256sum stat ss python3 ip free nproc journalctl nstat flock openssl install; do need "$c"; done
 [[ $(df -Pk / | awk 'NR==2{print $4}') -ge 131072 ]] || fail "insufficient disk"
 if [[ $mode == fresh ]]; then
   for c in getent groupadd useradd userdel groupdel pgrep; do need "$c"; done
 fi
 mutation_preconditions
 local firewall=false; ufw_status && ! ufw_has_port && firewall=true
 local actions='["transactional-config","restart","fresh-verification"]'
 if [[ $(jget desired.enableBbr) == true ]]; then
   bbr_probe
   if [[ $(sysctl -n net.ipv4.tcp_congestion_control) != bbr || $(sysctl -n net.core.default_qdisc) != fq || $QDISC != fq ]]; then actions='["transactional-config","bbr-fq","restart","fresh-verification"]'; fi
 fi
 emit "arch=s=$(uname -m)" "firewallChangeRequired=j=$firewall" "actions=j=$actions" "expected=j={}"
}

capture_one(){
 local name=$1 path=$2
 local d="$TX/backup/$name"
 if [[ -e $path || -L $path ]]; then
   mkdir -p "$d"; cp -a -- "$path" "$d/value"; printf 'present\n' >"$d/presence"
   (cd "$d"; find value -type f -print0 | sort -z | xargs -0 -r sha256sum) >"$d/sha256"
   stat -c '%u %g %a' "$path" >"$d/stat"
 else mkdir -p "$d"; printf 'absent\n' >"$d/presence"; : >"$d/sha256"; fi
 printf '%s\t%s\n' "$name" "$path" >>"$TX/artifacts"
}
backup(){
 mkdir -m 700 "$TX/backup"
 capture_one config "$config"; capture_one unit "/etc/systemd/system/$service"; capture_one current "$ROOT/current"
 systemctl is-enabled "$service" >"$TX/service.enabled" 2>/dev/null || true
 systemctl is-active "$service" >"$TX/service.active" 2>/dev/null || true
 if [[ $(jget desired.enableBbr) == true && ( $(sysctl -n net.ipv4.tcp_congestion_control) != bbr || $(sysctl -n net.core.default_qdisc) != fq ) ]]; then
   capture_one bbr "$BBR"; printf '%s\n' "$(sysctl -n net.ipv4.tcp_congestion_control)" >"$TX/cc"; printf '%s\n' "$(sysctl -n net.core.default_qdisc)" >"$TX/qdisc-default"; touch "$TX/bbr-mutated"
   [[ -d /sys/module/tcp_bbr ]] || touch "$TX/bbr-module-loaded-by-transaction"
 fi
 : >"$TX/ufw-rule"; printf '%s\n' "$(jget transactionId)" >"$TX/id"
 (cd "$TX/backup"; find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 sha256sum) >"$TX/backup/manifest.sha256"
 chmod -R a-w "$TX/backup"
 rm -f "$TX/no-managed-mutation"
}
restore_one(){
 local d=$TX/backup/$1 path=$2; rm -rf -- "$path"
 if grep -qx present "$d/presence"; then mkdir -p "$(dirname "$path")"; cp -a "$d/value" "$path"; fi
}
rollback(){
 exec 9>"/run/lock/tono-node.lock"
 flock -x 9
 local id; id=$(jget transactionId); [[ $id =~ ^[a-f0-9]{32}$ ]] || fail "invalid transaction"
 TX=$TXROOT/$id
 if [[ ! -e $TX || ( -d $TX && ! -s $TX/id ) ]]; then
   [[ ! -L $ROOT/current || $(readlink -f "$ROOT/current") != "$TX" ]] || fail "partial transaction became current"
   rm -f -- "/tmp/tono-xray-$id" "$config.tono-$id.tmp" "/etc/systemd/system/$service.tono-$id.tmp" "$BBR.tono-$id.tmp"; rm -rf -- "$TX"
   mkdir -p "$TXROOT"; mkdir -m 700 "$TX"; printf '%s\n' "$id" >"$TX/id"; touch "$TX/no-managed-mutation"; printf 'restored-pending-verification\n' >"$TX/status"
   emit "restored=j=true"; return
 fi
 [[ -f $TX/id && $(cat "$TX/id") == "$id" ]] || fail "transaction binding mismatch"
 if [[ -f $TX/no-managed-mutation ]]; then
   rm -f -- "/tmp/tono-xray-$id" "$config.tono-$id.tmp" "/etc/systemd/system/$service.tono-$id.tmp" "$BBR.tono-$id.tmp"
   [[ ! -L $ROOT/current || $(readlink -f "$ROOT/current") != "$TX" ]] || fail "preparing transaction became current"
   printf 'restored-pending-verification\n' >"$TX/status"; emit "restored=j=true"; return
 fi
 (cd "$TX/backup"; sha256sum -c manifest.sha256 >/dev/null) || fail "backup integrity failure"
 [[ $(cat "$TX/status") == rolled-back ]] && { emit "restored=j=true"; return; }
 if systemctl cat "$service" >/dev/null 2>&1; then systemctl stop "$service" >/dev/null || true; fi
 local stopped_pid stopped_state; stopped_pid=$(systemctl show -p MainPID --value "$service" 2>/dev/null || true); stopped_state=$(systemctl is-active "$service" 2>/dev/null || true)
 if ! { [[ -z $stopped_pid || $stopped_pid == 0 ]] && [[ $stopped_state != active && $stopped_state != activating && $stopped_state != deactivating ]]; }; then fail "service did not stop for rollback"; fi
 if [[ -f $TX/service-enabled-by-transaction ]] && systemctl cat "$service" >/dev/null 2>&1; then systemctl disable "$service" >/dev/null; fi
 rm -f -- "$config.tono-$id.tmp" "/etc/systemd/system/$service.tono-$id.tmp" "$BBR.tono-$id.tmp"
 restore_one config "$config"; restore_one unit "/etc/systemd/system/$service"; restore_one current "$ROOT/current"
 rm -rf -- "$INSTALL/releases/$id"; [[ ! -L $INSTALL/current || $(readlink -f "$INSTALL/current") != "$INSTALL/releases/$id" ]] || rm -f "$INSTALL/current"
 if [[ -f $TX/bbr-mutated ]]; then restore_one bbr "$BBR"; sysctl -w "net.ipv4.tcp_congestion_control=$(cat "$TX/cc")" >/dev/null; sysctl -w "net.core.default_qdisc=$(cat "$TX/qdisc-default")" >/dev/null; fi
 if [[ -s $TX/ufw-rule ]] && ufw status 2>/dev/null | grep -Fq "$(cat "$TX/ufw-rule")"; then
   ufw --force delete allow "$port/tcp" comment "$(cat "$TX/ufw-rule")" >/dev/null
 fi
 [[ ! -s $TX/ufw-rule ]] || ! ufw status 2>/dev/null | grep -Fq "$(cat "$TX/ufw-rule")" || fail "UFW rollback did not remove transaction rule"
 systemctl daemon-reload
 if grep -qx active "$TX/service.active"; then systemctl start "$service" >/dev/null; systemctl is-active --quiet "$service" || fail "restored service did not start"
 else ! systemctl is-active --quiet "$service" || fail "restored service unexpectedly active"; fi
 if [[ -f $TX/user-created ]]; then
   if id tono-xray >/dev/null 2>&1; then ! pgrep -u tono-xray >/dev/null 2>&1 || fail "transaction user still owns a process"; userdel tono-xray >/dev/null; fi
   ! id tono-xray >/dev/null 2>&1 || fail "transaction user was not removed"
 fi
 if [[ -f $TX/group-created ]]; then
   if getent group tono-xray >/dev/null; then groupdel tono-xray >/dev/null; fi
   ! getent group tono-xray >/dev/null || fail "transaction group was not removed"
 fi
 rmdir "$INSTALL/releases" "$INSTALL" 2>/dev/null || true
 rm -f "/tmp/tono-xray-$id"
 printf 'restored-pending-verification\n' >"$TX/status"; emit "restored=j=true"
}

make_fresh_config(){
 local binary=$1 uuid keys priv pub sid
 uuid=$($binary uuid); keys=$($binary x25519); priv=$(sed -n 's/^PrivateKey:[[:space:]]*//p' <<<"$keys"); pub=$(sed -n 's/^Password (PublicKey):[[:space:]]*//p' <<<"$keys"); sid=$(openssl rand -hex 8)
 [[ $uuid =~ ^[a-f0-9-]{36}$ && $priv =~ ^[A-Za-z0-9_-]{43}$ && $pub =~ ^[A-Za-z0-9_-]{43}$ ]] || fail "credential generation failed"
 export TONO_CONFIG_TMP="$TMP_CONFIG" TONO_PORT="$port" TONO_TARGET="$target" TONO_NEW_UUID="$uuid" TONO_REALITY_PRIVATE="$priv" TONO_SHORT_ID="$sid"
 python3 <<'PY'
import json,os
p=os.environ['TONO_CONFIG_TMP']; port=os.environ['TONO_PORT']; target=os.environ['TONO_TARGET']; uuid=os.environ['TONO_NEW_UUID']; priv=os.environ['TONO_REALITY_PRIVATE']; sid=os.environ['TONO_SHORT_ID']
d={'log':{'loglevel':'warning'},'inbounds':[{'listen':'0.0.0.0','port':int(port),'protocol':'vless','settings':{'clients':[{'id':uuid,'flow':'xtls-rprx-vision'}],'decryption':'none'},'streamSettings':{'network':'raw','security':'reality','realitySettings':{'target':target+':443','serverNames':[target],'privateKey':priv,'shortIds':[sid]}}}],'outbounds':[{'protocol':'freedom'}]}
open(p,'x').write(json.dumps(d,separators=(',',':')))
PY
 unset TONO_CONFIG_TMP TONO_PORT TONO_TARGET TONO_NEW_UUID TONO_REALITY_PRIVATE TONO_SHORT_ID
 printf '%s\n%s\n%s\n' "$uuid" "$pub" "$sid" >"$TX/client"
}
extend_config(){
 TONO_SOURCE="$config" TONO_DEST="$TMP_CONFIG" python3 <<'PY'
import os,shutil
src=os.environ['TONO_SOURCE']; dst=os.environ['TONO_DEST']; flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0)
fd=os.open(dst,flags,0o600)
with os.fdopen(fd,'wb') as out, open(src,'rb') as inp: shutil.copyfileobj(inp,out)
PY
 local uuid; service_xray; uuid=$($XRAY_EXEC uuid); export TONO_NEW_UUID="$uuid" TONO_CONFIG_TMP="$TMP_CONFIG" TONO_PORT="$port" TONO_TARGET="$target"
 python3 <<'PY'
import json,os
p=os.environ['TONO_CONFIG_TMP']; u=os.environ['TONO_NEW_UUID']; port=int(os.environ['TONO_PORT']); target=os.environ['TONO_TARGET']; before=json.load(open(p)); after=json.loads(json.dumps(before)); hits=[]
for ib in after.get('inbounds',[]):
 rs=ib.get('streamSettings',{}).get('realitySettings',{}); clients=ib.get('settings',{}).get('clients')
 if ib.get('protocol')=='vless' and ib.get('port')==port and ib.get('streamSettings',{}).get('security')=='reality' and rs.get('target')==target+':443' and target in rs.get('serverNames',[]) and isinstance(clients,list): hits.append((ib,clients))
if len(hits)!=1: raise SystemExit('expected exactly one matching Reality VLESS inbound')
old=json.loads(json.dumps(hits[0][1])); hits[0][1].append({'id':u,'flow':'xtls-rprx-vision'})
if hits[0][1][:-1] != old or hits[0][1][-1] != {'id':u,'flow':'xtls-rprx-vision'}: raise SystemExit('old clients not preserved or non-exact semantic change')
open(p,'w').write(json.dumps(after,separators=(',',':')))
PY
 printf '%s\n\n\n' "$uuid" >"$TX/client"
}
prepare(){
 exec 9>"/run/lock/tono-node.lock"; flock -x 9
 valid_common; platform; local id; id=$(jget transactionId); [[ $id =~ ^[a-f0-9]{32}$ ]] || fail "invalid transaction"
 TX=$TXROOT/$id; mkdir -p "$TXROOT"; [[ ! -e $TX ]] || fail "transaction already exists"
 mkdir -m 700 "$TX"; printf '%s\n' "$id" >"$TX/id"; printf 'preparing\n' >"$TX/status"; touch "$TX/no-managed-mutation"
 [[ ! -e $ROOT/current && ! -L $ROOT/current ]] || fail "current transaction already exists"
 local tc="$config.tono-$id.tmp" tu="/etc/systemd/system/$service.tono-$id.tmp" tb="$BBR.tono-$id.tmp"
 [[ ! -e $tc && ! -L $tc && ! -e $tu && ! -L $tu && ! -e $tb && ! -L $tb ]] || fail "transaction temporary path collision"
 mutation_preconditions
 if [[ $(jget desired.enableBbr) == true ]]; then bbr_probe; fi
 if ufw_status && ! ufw_has_port; then [[ $(jget desired.allowFirewallChange) == true ]] || fail "firewall approval required"; ssh_allowed || fail "SSH allow rule not proven"; fi
 emit "prepared=j=true"
}
apply(){
 exec 9>"/run/lock/tono-node.lock"
 flock -x 9
 valid_common; platform; local id; id=$(jget transactionId); [[ $id =~ ^[a-f0-9]{32}$ ]] || fail "invalid transaction"
 TX=$TXROOT/$id; [[ -f $TX/id && $(cat "$TX/id") == "$id" && -f $TX/no-managed-mutation && $(cat "$TX/status") == preparing ]] || fail "transaction was not prepared"
 [[ ! -e $ROOT/current && ! -L $ROOT/current ]] || fail "current transaction already exists"
 TMP_CONFIG="$config.tono-$id.tmp"; TMP_UNIT="/etc/systemd/system/$service.tono-$id.tmp"; TMP_BBR="$BBR.tono-$id.tmp"
 [[ ! -e $TMP_CONFIG && ! -L $TMP_CONFIG && ! -e $TMP_UNIT && ! -L $TMP_UNIT && ! -e $TMP_BBR && ! -L $TMP_BBR ]] || fail "transaction temporary path collision"
 mutation_preconditions
 if [[ $(jget desired.enableBbr) == true ]]; then bbr_probe; fi # all unsafe checks before backup/mutation
 if ufw_status && ! ufw_has_port; then [[ $(jget desired.allowFirewallChange) == true ]] || fail "firewall approval required"; ssh_allowed || fail "SSH allow rule not proven"; fi
 backup; printf 'applying\n' >"$TX/status"
 if [[ $mode == fresh ]]; then
   local artifact sha; artifact=$(jget artifact); sha=$(jget artifactSha256); [[ $artifact == /tmp/tono-xray-$id && -f $artifact && ! -L $artifact ]] || fail "invalid artifact"
   [[ $(sha256sum "$artifact"|awk '{print $1}') == "$sha" ]] || fail "artifact digest mismatch"
   touch "$TX/group-created"; groupadd --system tono-xray
   touch "$TX/user-created"; useradd --system --gid tono-xray --home-dir /nonexistent --shell /usr/sbin/nologin tono-xray
   [[ $(getent passwd tono-xray | cut -d: -f6-7) == /nonexistent:/usr/sbin/nologin ]] || fail "dedicated account policy mismatch"
   install -d -o root -g root -m 0755 "$INSTALL" "$INSTALL/releases" "$INSTALL/releases/$id"; install -o root -g root -m 0755 "$artifact" "$INSTALL/releases/$id/xray"; ln -s "$INSTALL/releases/$id" "$INSTALL/current"; rm -f "$artifact"; make_fresh_config "$INSTALL/current/xray"
   cat >"$TMP_UNIT" <<EOF
[Unit]
Description=Tono managed Xray Reality node
After=network-online.target
[Service]
User=tono-xray
Group=tono-xray
ExecStart=$INSTALL/current/xray run -config $config
Restart=on-failure
NoNewPrivileges=true
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
EOF
   install -m 0644 "$TMP_UNIT" "/etc/systemd/system/$service"; rm -f "$TMP_UNIT"
 else extend_config; fi
 local xray; if [[ $mode == fresh ]]; then xray="$INSTALL/current/xray"; else xray="$XRAY_EXEC"; fi
 "$xray" run -test -config "$TMP_CONFIG" >/dev/null 2>&1 || fail "Xray rejected temporary config"
 if [[ -e $config ]]; then chown --reference="$config" "$TMP_CONFIG"; chmod --reference="$config" "$TMP_CONFIG"; else chown root:tono-xray "$TMP_CONFIG"; chmod 0640 "$TMP_CONFIG"; fi
 mv -f "$TMP_CONFIG" "$config"
 if [[ $(jget desired.enableBbr) == true && ( $(sysctl -n net.ipv4.tcp_congestion_control) != bbr || $(sysctl -n net.core.default_qdisc) != fq || $QDISC != fq ) ]]; then
   printf 'net.ipv4.tcp_congestion_control = bbr\nnet.core.default_qdisc = fq\n' >"$TMP_BBR"; install -m 0644 "$TMP_BBR" "$BBR"; rm "$TMP_BBR"
   modprobe tcp_bbr; sysctl -p "$BBR" >/dev/null
 fi
 if ufw_status && ! ufw_has_port; then
   local tag="tono-tx-$id"; printf '%s\n' "$tag" >"$TX/ufw-rule"
   ufw allow "$port/tcp" comment "$tag" >/dev/null
   ufw status | grep -Fq "$tag" || fail "UFW transaction rule was not recorded"
 fi
 local hash; hash=$(sha256sum "$config"|awk '{print $1}'); printf '%s\n' "$hash" >"$TX/expected-hash"; ln -s "$TX" "$ROOT/current.tmp"; mv -Tf "$ROOT/current.tmp" "$ROOT/current"
 systemctl daemon-reload; if [[ $mode == fresh ]]; then touch "$TX/service-enabled-by-transaction"; systemctl enable "$service" >/dev/null; fi
 local iface; iface=$(egress_iface); printf '%s\n' "$iface" >"$TX/iface"
 printf '%s %s %s %s %s\n' \
   "$(cat /sys/class/net/"$iface"/statistics/rx_dropped)" "$(cat /sys/class/net/"$iface"/statistics/tx_dropped)" \
   "$(cat /sys/class/net/"$iface"/statistics/rx_errors)" "$(cat /sys/class/net/"$iface"/statistics/tx_errors)" \
   "$(nstat -asz TcpRetransSegs 2>/dev/null | awk '/TcpRetransSegs/{print $2+0}' | tail -n1)" >"$TX/net-before"
 systemctl show -p MainPID --value "$service" >"$TX/prior-mainpid"; date +%s >"$TX/activation-time"; printf 'activation-pending\n' >"$TX/status"; systemctl restart "$service"
 local uuid pub sid; IFS= read -r uuid <"$TX/client"; pub=$(sed -n 2p "$TX/client"); sid=$(sed -n 3p "$TX/client")
 emit_client
}
verify(){
 local id; id=$(jget transactionId); TX=$TXROOT/$id
 [[ $id =~ ^[a-f0-9]{32}$ && -f $TX/id && $(cat "$TX/id") == "$id" ]] || fail "transaction binding mismatch"
 [[ $(cat "$TX/status") == activation-pending || $(cat "$TX/status") == verified ]] || fail "transaction not activation-pending/verified"
 [[ -L $ROOT/current && $(readlink -f "$ROOT/current") == "$TX" && -f $config ]] || fail "managed artifacts absent"
 if [[ $mode == fresh ]]; then [[ -f /etc/systemd/system/$service ]] || fail "managed unit absent"; fi
 service_xray
 local hash expected client; hash=$(sha256sum "$config"|awk '{print $1}'); expected=$(jmaybe expected.configSha256); client=$(jmaybe expected.clientId)
 [[ -n $expected ]] || expected=$(cat "$TX/expected-hash"); [[ -n $client ]] || client=$(sed -n 1p "$TX/client"); [[ $hash == "$expected" ]] || fail "config hash mismatch"
 TONO_VERIFY_CONFIG="$config" TONO_VERIFY_CLIENT="$client" python3 <<'PY'
import json,os
d=json.load(open(os.environ['TONO_VERIFY_CONFIG'])); u=os.environ['TONO_VERIFY_CLIENT']
if u and sum(c.get('id')==u for i in d.get('inbounds',[]) for c in i.get('settings',{}).get('clients',[]))!=1: raise SystemExit(1)
PY
 local pid started activation; pid=$(systemctl show -p MainPID --value "$service"); started=$(date -d "$(systemctl show -p ExecMainStartTimestamp --value "$service")" +%s); activation=$(cat "$TX/activation-time")
 [[ $pid =~ ^[1-9][0-9]*$ && $pid != "$(cat "$TX/prior-mainpid")" && $started =~ ^[1-9][0-9]*$ && $started -ge $activation ]] || fail "service process was not newly activated"
 systemctl is-active --quiet "$service"; ss -H -lntp "sport = :$port" | grep -Eq "pid=$pid([,\"]|$)" || fail "service PID does not own listener"
 ! journalctl -u "$service" --since '-2 minutes' -p err --no-pager | grep -q . || fail "journal errors"
 read -r load _ </proc/loadavg; read -r _ total used _ < <(free -m | awk '/^Mem:/{print $1,$2,$3,$4}')
 [[ ${load%.*} -lt $(nproc) && $used -lt $total ]] || fail "resource pressure"
 local iface brx btx bre bte brt arx atx are ate art
 iface=$(cat "$TX/iface"); read -r brx btx bre bte brt <"$TX/net-before"
 arx=$(cat /sys/class/net/"$iface"/statistics/rx_dropped); atx=$(cat /sys/class/net/"$iface"/statistics/tx_dropped)
 are=$(cat /sys/class/net/"$iface"/statistics/rx_errors); ate=$(cat /sys/class/net/"$iface"/statistics/tx_errors)
 art=$(nstat -asz TcpRetransSegs 2>/dev/null | awk '/TcpRetransSegs/{print $2+0}' | tail -n1); art=${art:-0}; brt=${brt:-0}
 ((are == bre && ate == bte)) || fail "network error counters increased"
 ((arx - brx <= 1000 && atx - btx <= 1000 && art - brt <= 100)) || fail "drop/retrans counters increased abnormally"
 if [[ $(jget desired.enableBbr) == true ]]; then [[ $(sysctl -n net.ipv4.tcp_congestion_control) == bbr && $(sysctl -n net.core.default_qdisc) == fq && $(live_qdisc "$(egress_iface)") == fq ]] || fail "BBR/fq verification failed"; fi
 if [[ $(jget desired.allowFirewallChange) == true ]] && ufw_status; then ufw_has_port || fail "UFW service rule missing"; [[ ! -s $TX/ufw-rule ]] || ufw status | grep -Fq "$(cat "$TX/ufw-rule")" || fail "UFW transaction tag missing"; fi
 emit_healthy_client
}
verify_restored(){
 local id name path d; id=$(jget transactionId); TX=$TXROOT/$id
 [[ -f $TX/status && ( $(cat "$TX/status") == restored-pending-verification || $(cat "$TX/status") == rolled-back ) ]] || fail "rollback not recorded"
 [[ ! -L $ROOT/current || $(readlink -f "$ROOT/current") != "$TX" ]] || fail "transaction still current"
 if [[ -f $TX/no-managed-mutation ]]; then
   [[ ! -e /tmp/tono-xray-$id && ! -L /tmp/tono-xray-$id && ! -e $config.tono-$id.tmp && ! -L $config.tono-$id.tmp && ! -e /etc/systemd/system/$service.tono-$id.tmp && ! -L /etc/systemd/system/$service.tono-$id.tmp && ! -e $BBR.tono-$id.tmp && ! -L $BBR.tono-$id.tmp ]] || fail "preparing transaction artifact remains"
   printf 'rolled-back\n' >"$TX/status"; emit "healthy=j=true"; return
 fi
 while IFS=$'\t' read -r name path; do
   d=$TX/backup/$name
   if grep -qx absent "$d/presence"; then [[ ! -e $path && ! -L $path ]] || fail "absent artifact was not removed"
   else [[ -e $path || -L $path ]] || fail "present artifact was not restored"
     [[ $(stat -c '%u %g %a' "$path") == "$(cat "$d/stat")" ]] || fail "restored artifact metadata mismatch"
     if [[ -L $d/value ]]; then [[ -L $path && $(readlink "$path") == "$(readlink "$d/value")" ]] || fail "restored symlink mismatch"
     elif [[ -f $d/value ]]; then [[ -f $path && $(sha256sum "$path"|awk '{print $1}') == "$(sha256sum "$d/value"|awk '{print $1}')" ]] || fail "restored artifact hash mismatch"; fi
   fi
 done <"$TX/artifacts"
 [[ ! -e $config.tono-$id.tmp && ! -L $config.tono-$id.tmp && ! -e /etc/systemd/system/$service.tono-$id.tmp && ! -L /etc/systemd/system/$service.tono-$id.tmp && ! -e $BBR.tono-$id.tmp && ! -L $BBR.tono-$id.tmp ]] || fail "transaction temporary artifact remains"
 local before_enabled after_enabled; before_enabled=$(cat "$TX/service.enabled"); after_enabled=$(systemctl is-enabled "$service" 2>/dev/null || true); [[ $after_enabled == "$before_enabled" ]] || fail "service enablement not restored"
 if grep -qx active "$TX/service.active"; then systemctl is-active --quiet "$service" || fail "service activity not restored"; else ! systemctl is-active --quiet "$service" || fail "service activity not restored"; fi
 if [[ -f $TX/bbr-mutated ]]; then [[ $(sysctl -n net.ipv4.tcp_congestion_control) == "$(cat "$TX/cc")" && $(sysctl -n net.core.default_qdisc) == "$(cat "$TX/qdisc-default")" ]] || fail "sysctl not restored"; fi
 if [[ -f $TX/bbr-module-loaded-by-transaction ]]; then [[ ! -d /sys/module/tcp_bbr ]] || modprobe -r tcp_bbr >/dev/null; [[ ! -d /sys/module/tcp_bbr ]] || fail "BBR module load was not rolled back"; fi
 [[ ! -f $TX/user-created ]] || ! id tono-xray >/dev/null 2>&1 || fail "transaction user still exists"
 [[ ! -f $TX/group-created ]] || ! getent group tono-xray >/dev/null || fail "transaction group still exists"
 printf 'rolled-back\n' >"$TX/status"
 emit "healthy=j=true"
}

case "$op" in preflight) preflight;; prepare) prepare;; apply) apply;; verify) valid_common; verify;; rollback) valid_common; rollback;; verify-restored) valid_common; verify_restored;; *) fail "unknown operation";; esac
