---
name: add-tono-node
description: Bring a fresh VPS into the Tono fleet end to end — provision Xray Reality, meter it, install account identities, register it with the ops hub and Komari, tune TCP, and publish it to the customer catalog. Use when adding, re-adding, or auditing an exit node, or when a node is serving customers but missing from monitoring or the identity sync.
---

# Adding a node to the Tono fleet

A node is not "added" when it passes a data-plane test. It is added when it appears in
**five** places. Every one of them is a separate manual step, and **none of them errors if
you skip it** — a node missing from the identity sync accepts nobody, a node missing from
Komari is invisible while it serves customers, and a node missing from the ops hub silently
stops receiving new accounts.

Work through the checklist. Verify each step by reading the state back, not by trusting the
script's own output.

| System | What it does | Skipping it looks like |
|---|---|---|
| Xray + Reality on the box | serves traffic | obvious |
| Metering (`tono-api`, stats) | per-account byte counters | usage silently reads 0 |
| Account identities (`u:<userId>`) | who may connect | **every customer fails to connect** |
| Ops hub registry | pushes new accounts, pulls usage | works today, rots quietly |
| Komari | monitoring / quality panel | invisible while serving customers |
| Managed catalog | customers can select it | node exists, nobody sees it |

---

## 0. Facts you need first

- **Ops hub**: `199.30.91.172`. Holds `/opt/tono-ops/nodes.secrets.json` (SSH credentials
  for every node), runs `collect.py --sync-clients` every minute and `--usage` every ten.
  Also runs the Komari server on `:25774`.
- **Admin token** for the control plane: Keychain service `tono-admin`.
  The service named `com.raydocs.tono.staging.admin-api-token` that
  `publish-managed-catalog.rb` reads is **stale and 401s** — do not trust it.
- **Roster token** (`/api/v1/home/exit-identities`): Keychain service
  `com.raydocs.tono.staging.home-agent-token`.
- Naming convention is `City · Landmark`, e.g. `Los Angeles · Mesa`.

## 1. SSH access

`provision-reality-node.rb` shells out to system `ssh` with `StrictHostKeyChecking=yes` and
passes no `-i`, so the host **must** be an alias in `~/.ssh/config`. Match the existing
block shape:

```
Host tono-<something>
  HostName <ip>
  User root
  Port 22
  IdentityFile <key>
  IdentitiesOnly yes
  UserKnownHostsFile /Users/rw/.ssh/tono-fleet-known-hosts
  StrictHostKeyChecking yes
```

Then `ssh-keyscan -t ed25519 <ip> >> ~/.ssh/tono-fleet-known-hosts`. A private key must be
`chmod 600` or OpenSSH refuses it.

## 2. Provision

Local preconditions for the built-in verification: Tono must be **disconnected**, and TCP
ports 21053 / 28790 / 29090 free.

```
ruby tooling/scripts/provision-reality-node.rb \
  --ssh tono-<alias> --name "City · Landmark" \
  --server <public-ip> --expected-exit-ipv4 <public-ip>          # dry run first
ruby tooling/scripts/provision-reality-node.rb ... --apply
```

It pins Xray, verifies its SHA-256, installs an unprivileged service, runs an authenticated
Reality data-plane test, and writes a private one-node YAML to
`~/Library/Application Support/Tono/Operations/catalog.d/<slug>.yaml`. It publishes nothing.
Any failure rolls the node back.

Supported platforms are Ubuntu 22.04/24.04 and Debian 12/13. Anything newer needs the
allowlist in `tooling/scripts/remote/manage-tono-reality-node.sh` widened — check the rest
of that script still applies before doing so.

## 3. Tag the fleet inbound, then meter

The provisioner leaves the inbound **untagged**, but the hub's sync and the metering agent
both address it as `tono-vless`. Set the tag first, or the sync has nothing to write to.

Edit `/opt/tono-xray/current/config.json`, set `"tag": "tono-vless"` on the 443 inbound,
validate, restart. Then:

```
scp tooling/scripts/remote/enable-tono-exit-metering.sh \
    tooling/scripts/remote/exit_metering_config.py <node>:/root/
ssh <node> 'sh /root/enable-tono-exit-metering.sh'
```

This adds a loopback-only `tono-api` inbound on `:10085`, stats, and per-user counters at
policy level 0. It costs one restart. Run it twice — the second run must say
`already metered`, which is how you know the probe works.

**Validating an Xray config**: `xray run -test -config <file>` infers the format from the
**file extension**. A candidate named `config.json.new` fails with
`Failed to get format of ...` — nothing to do with its contents. Name it `*.json`.

## 4. Account identities

Every customer gets a per-account UUID (`exit_credentials.client_uuid`), and the node must
hold it as a client labelled `u:<userId>`. The hub's `--sync-clients` cron does this within
a minute of registration in step 5 — so normally **just wait and verify**.

To do it by hand without a restart, the payload for Xray 26.3.27 must be a **full inbound
spec**. A partial one prints `Added 0 user(s) in total.` and exits 0:

```json
{"inbounds":[{"tag":"tono-vless","port":443,"protocol":"vless",
  "settings":{"clients":[{"id":"<uuid>","flow":"xtls-rprx-vision","email":"u:<userId>"}],
              "decryption":"none"}}]}
```

```
xray api adu --server=127.0.0.1:10085 /root/adu.json
```

That is runtime-only. **Also write the clients into `config.json`**, or they vanish on the
next restart.

`services/exit-agent/reconcile_and_report.py` is dead code — it speaks an older Xray CLI
(`adu --tag/--email/--uuid`) and no node has it installed. Do not deploy it.

## 5. Register with the ops hub

Without this the node never receives new accounts and its usage is never collected.

Prefer key auth over the password path the older entries use:

```
ssh 199.30.91.172 'cd /opt/tono-ops && \
  test -f tono-collector || ssh-keygen -q -t ed25519 -N "" -f tono-collector'
# install /opt/tono-ops/tono-collector.pub into the node's /root/.ssh/authorized_keys
ssh 199.30.91.172 'cd /opt/tono-ops && \
  ssh-keyscan -t ed25519 <ip> >> tono-collector-known-hosts && sort -u -o tono-collector-known-hosts tono-collector-known-hosts'
```

Then append to `/opt/tono-ops/nodes.secrets.json` (back it up first):

```json
{"name":"City · Landmark","host":"<ip>","port":22,"user":"root","key":true}
```

`"key": true` uses `/opt/tono-ops/tono-collector` and **requires** the host key pin;
`ssh_command` refuses to fall back to a password, by design. Verify by watching
`/var/log/tono-ops-sync.log` for a line naming the node.

### The fleet is not uniform: check `key` before assuming a password

`nodes.secrets.json` carries **two** auth shapes. Sixteen nodes hold a `password`;
`Los Angeles · Mesa` holds `"key": true` and has **no password at all** — it is the first
node of the key migration the hub's `ssh_command` was already written for.

Any loop that does `env["SSHPASS"] = n.get("password", "")` and shells out to `sshpass`
gets `Permission denied (publickey)` on a key-auth node, and every ad-hoc script reports
that as **"unreachable"** — which is how a perfectly healthy node gets written up as dead.
It has already happened once.

Branch the way `collect.py` does:

```python
if n.get("key"):
    argv = ["ssh", "-i", "/opt/tono-ops/tono-collector", "-o", "IdentitiesOnly=yes",
            "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
            "-o", "UserKnownHostsFile=/opt/tono-ops/tono-collector-known-hosts"]
else:
    argv = ["sshpass", "-e", "ssh", "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null"]      # env SSHPASS = n["password"]
argv += ["-p", str(n.get("port", 22)), f"{n.get('user','root')}@{n['host']}"]
```

Before concluding a node is down, prove it with something that does not depend on SSH
auth at all — ICMP, and a TCP connect to 443 and 22:

```
ping -c 3 <ip>; nc -z <ip> 443; nc -z <ip> 22
```

`check-node-in-fleet.py` already branches correctly; hand-rolled loops are where this bites.

## 6. Komari monitoring

Nothing auto-registers. Create the client on the hub, which returns its token:

```
POST /api/login          {"username": ..., "password": ...}   # creds: /root/komari-admin.txt
POST /api/admin/client/add  {"name": "City · Landmark"}       # -> {"uuid": ..., "token": ...}
```

Copy the **fleet's existing** `/opt/komari-agent/agent` binary rather than downloading a new
one, so versions do not drift. Then a unit identical to the other nodes':

```
ExecStart=/opt/komari-agent/agent --endpoint http://199.30.91.172:25774 --token=<token>
```

`systemctl enable --now komari-agent`. The journal should reach
`WebSocket connected using v2 protocol`.

Checking from the control-plane side: `/api/v1/ops/*` requires **Cloudflare Access**, not a
bearer token. An admin token gets `ACCESS_UNAUTHORIZED`, which reads exactly like an empty
panel. Verify against the hub's own push instead — it reports `agentCount`.

## 7. TCP tuning

```
scp tooling/scripts/remote/tune-tono-tcp.sh <node>:/root/ && ssh <node> 'sh /root/tune-tono-tcp.sh'
```

Idempotent, reversible with `--revert`, no restart. Worth 3.5x on the China path — the stock
4 MiB send ceiling caps a single flow at ~229 Mbit/s at 140 ms RTT. Do **not** benchmark this
from inside the US: a 50 ms path never reaches the ceiling and shows only +6%.

## 8. Publish to the customer catalog

Two rules, both of which the control plane enforces by refusing:

1. Every node's `uuid` must be the literal `{{TONO_CLIENT_UUID}}` placeholder, which is
   substituted per account on fetch. A real UUID is rejected with `INVALID_CATALOG`.
2. **Append — never replace.** `publish-managed-catalog.rb --publish <one-file>` replaces
   the entire catalog with that one node. Use `--append`, or build the combined document
   and PUT it with `expectedRevision` for CAS.

Append textually so existing bytes survive, and match the live document's **two-space list
indentation** — the private per-node YAML is written at zero indent and mixing the two is
invalid YAML.

```
GET  /api/v1/admin/exit-catalog                      # -> {revision, yaml}
PUT  /api/v1/admin/exit-catalog  {yaml, expectedRevision}
```

`mihomo -t` on the raw catalog **fails by design** — the placeholder is not a valid UUID.
That is not a problem with your edit; confirm by testing the unmodified live catalog too.
The real validator is `publish-managed-catalog.rb --dry-run`.

## 9. Verify all five, by reading state back

```
# catalog
curl -H "Authorization: Bearer $(security find-generic-password -s tono-admin -w)" \
  https://api.afk.ccwu.cc/api/v1/admin/exit-catalog | grep -c "City · Landmark"
# hub registry + komari + identities + tuning
ssh 199.30.91.172 'grep -c "<ip>" /opt/tono-ops/nodes.secrets.json; grep "City" /var/log/tono-ops-sync.log | tail -1'
ssh <node> 'systemctl is-active komari-agent tono-xray; sysctl -n net.core.wmem_max'
```

Then prove a **real account identity** routes, not just that the port answers:

```
zsh tooling/scripts/test-isolated-data-plane.sh /abs/one-node.yaml "City · Landmark" <ip>
```

## Removing or replacing a node

Reverse order: remove from the catalog first (customers stop selecting it), then the hub
registry, then Komari, then the box. A node left in the catalog but unreachable is the worst
state — `Tokyo · Sakura` (148.135.183.152) is in exactly that state today.
