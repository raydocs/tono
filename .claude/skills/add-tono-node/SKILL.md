---
name: add-tono-node
description: Bring a fresh VPS into the Tono fleet end to end, finish a half-added node, or audit one — provision Xray Reality, meter it, install account identities, register it with the ops hub and Komari, and publish it to the customer catalog. Use when adding, re-adding, replacing or auditing an exit node, or when a node is serving customers but missing from monitoring, metering or the identity sync.
---

# Adding a node to the Tono fleet

A node is not added when it passes a data-plane test. It is added when it appears in
**five** places, and **none of them errors if you skip it**:

| System | What it does | Skipping it looks like |
|---|---|---|
| Xray + Reality | serves traffic | obvious |
| Metering (`stats` + `HandlerService`) | per-account byte counters | usage silently reads 0 |
| Account identities (`u:<userId>`) | who may connect | **every customer fails to connect** |
| Ops hub registry | pushes accounts, pulls usage | works today, rots quietly |
| Komari | monitoring and the 三网 panel | invisible while serving customers |
| Managed catalog | customers can select it | node exists, nobody sees it |

Each of those failures has actually happened here. Five nodes carried customer traffic for
weeks while metering none of it. A replaced machine kept its old catalog entry and was
unreachable for a day without a single error anywhere.

## Use the script

```sh
cd ~/Downloads/Project/tono-node-provisioning
bin/onboard-node.rb --host <ip> --name "City · Landmark"      # add, or finish a partial add
bin/onboard-node.rb --host <ip> --name "City · Landmark" --check   # audit only, exit 1 on problems
```

Every step is idempotent and verifies by reading state back, so running it against a
half-finished node finishes it. `--check` changes nothing and is safe to loop over the whole
fleet:

```sh
ssh tono-199.30.91.172 'python3 -c "
import json
s=json.load(open(\"/opt/tono-ops/nodes.secrets.json\"))
for n in (s.get(\"nodes\") or []): print(\"%s|%s|%s\" % (n[\"name\"], n[\"host\"], n.get(\"port\",22)))
"' | while IFS='|' read -r name host port; do
  bin/onboard-node.rb --host "$host" --name "$name" --port "$port" --check >/dev/null 2>&1 \
    && echo "OK   $name" || echo "FAIL $name"
done
```

The VPS must already exist and accept root by password or by the fleet key. Debian 12/13 and
Ubuntu 22.04/24.04 are supported; a newer release needs the allowlist in
`remote/manage-tono-reality-node.sh` widened.

## What the script already handles — do not "fix" these by hand

Each of these is a trap that cost real downtime before it was automated.

- **The catalog is edited as text, never parsed.** `{{TONO_CLIENT_UUID}}` is valid YAML
  flow-mapping syntax, so `safe_load` turns every placeholder into a nested hash and dumping
  it back rewrites all of them — destroying the per-account credential mechanism for the
  entire fleet in one publish. Any catalog change must be a targeted textual edit with the
  diff asserted to fall only on the intended lines.
- **The catalog entry carries the placeholder, not a real UUID.** The provisioner writes a
  concrete UUID into its private per-node YAML; publishing that would put the node back on a
  single shared credential whose traffic bills to nobody. The control plane also rejects it
  as `INVALID_CATALOG`.
- **`expectedRevision` is the compare-and-swap.** Fetch, edit, publish against the revision
  you fetched.
- **The Komari agent binary is copied from the hub**, checksum-compared, never downloaded.
  A fresh download is how versions drift apart across the fleet.
- **An existing Komari entry is reused.** Creating a second one leaves a duplicate row that
  is permanently "never reported".
- **Reality SNI is `www.bing.com` fleet-wide.** Measured from the mainland probe, Bing
  completes a handshake inside China; cloudflare.com, apple.com, microsoft.com, amazon.com
  and nvidia.com do not. Note that node→front latency is nearly irrelevant and easy to
  optimise by mistake: the client never contacts the front, only the node does, and only
  when answering an active probe. `serverNames` and `target` must name the same host —
  Reality relays that host's real certificate, so a client claiming a name the certificate
  does not cover fails the handshake.
- **The hub is what reaches nodes, not your laptop.** Node credentials are mixed: some
  key-only, some password-only. A tool that SSHes directly from the laptop works on the two
  or three nodes that happen to carry the fleet key and reports every other node as
  unreachable.

## Still needs a human

- **The host-key fingerprint.** The script pins it and prints it; compare it against the
  provider console. If a pin already exists and differs, it refuses — a changed key is what
  a reinstall looks like and also what a man-in-the-middle looks like. Delete the line from
  `~/.ssh/tono-fleet-known-hosts` only if you know the machine was reinstalled.
- **`publish-managed-catalog.rb` reads a stale Keychain entry.**
  `com.raydocs.tono.staging.admin-api-token` 401s; `tono-admin` works. `onboard-node.rb`
  uses the working one. Whether to fix the older script or the Keychain entry is a decision
  nobody has made.
- **Names must match exactly** between `nodes.secrets.json` and the catalog.
  `Los Angeles · Lagoon（家宽测试）` versus `Los Angeles · Lagoon` is a real mismatch the
  audit reports today.

## Replacing a machine

The dangerous case, because the node keeps its address and its name.

**A reinstall mints new Reality keys, so the catalog entry must be replaced too.** Provision
the new machine, then edit that node's `public-key` and `short-id` in the catalog — textually
— and publish. Skipping it leaves customers selecting a node whose keys no longer exist,
with no error raised anywhere. That is exactly what happened to `Los Angeles · Pacific` for
about twenty-four hours.

Prefer migration over reprovisioning when the machine is staying: `remote/` carries scripts
that swap the binary and layout while preserving the Reality keys, which needs no catalog
change and costs one ~2 second restart.

## Removing a node

Reverse order, so customers stop selecting it before it stops answering: catalog → hub
registry → Komari → the box itself. A node left in the catalog but unreachable is the worst
state — `Tokyo · Sakura` is in exactly that state today.

## Verifying for real

`--check` reads state back from all five systems, but it does not prove a customer can
connect. For that, drive a real account through the node:

```sh
zsh tooling/scripts/test-isolated-data-plane.sh /abs/one-node.yaml "City · Landmark" <ip>
```

Build that one-node YAML **from the published catalog**, not by hand — hardcoding
`servername` is what makes this test fail with `curl (35) SSL_ERROR_SYSCALL`, which reads
exactly like a broken node.

**Any "it broke after my change" conclusion needs a control**: run the same test against a
node you did not touch. That single habit has caught two false alarms here, one of which
would have led to reverting a correct change.
