# Tono node provisioning (local operator draft)

This is a single-node, operator-reviewed workflow. It never publishes a catalog and
Komari support is a draft only. Use placeholder values while preparing files; keep
inventory, host keys, identities, state, and enrollment drafts in a current-user-only
directory **outside this repository**.

## Private inventory

JSON schema (one selected node is processed; passwords are not accepted):

```json
{"nodes":{"opaque-node-id":{"host":"node.example.invalid","user":"root","port":22,"identityFile":"C:\\Private\\id_ed25519","mode":"fresh","servicePort":443,"realityTarget":"cover.example.invalid","configPath":"/etc/xray/config.json","serviceName":"tono-xray.service","catalogName":"Tono node","publicServer":"node.example.invalid"}}}
```

All three local file arguments and `--state-dir` must be absolute and outside the
checkout. The identity is mandatory. On Windows the tool fails closed unless ACLs
allow only the current user, SYSTEM, and Administrators. SSH uses system OpenSSH with
`-F NUL` (or `-F /dev/null`) so the explicit host cannot be rewritten by user config.
The state directory must already exist, must not be a link/reparse point, and its ACL
and each atomically written state file are re-probed.
SSH additionally uses strict, explicitly isolated host-key, identity-agent, forwarding, and multiplexing
settings. Logs contain only a deterministic anonymous ID—not host, user, ports,
paths, endpoints, credentials, or config bodies.

```powershell
py scripts\provision-tono-node.py plan --inventory C:\Private\inventory.json --node-id opaque-node-id --known-hosts C:\Private\known_hosts --state-dir C:\Private\state
py scripts\provision-tono-node.py apply --inventory C:\Private\inventory.json --node-id opaque-node-id --known-hosts C:\Private\known_hosts --state-dir C:\Private\state
```

## Stages and approvals

`plan` is the default and invokes only remote read-only preflight; it never downloads
Xray. `apply` downloads the official pinned Xray v26.3.27 asset locally, verifies its
exact architecture checksum, extracts and strictly uploads it for fresh mode, then
creates a unique transaction and verifies after restart. `verify` checks the recorded
transaction. `rollback` restores its immutable backup. Desired-state changes are not
rotation: first explicitly roll back and review a new plan.

Fresh mode requires the configured JSON parent directory to pre-exist as a
non-symlink, root-managed directory. It owns only `/opt/tono-xray/releases/<transaction>`, the
`/opt/tono-xray/current` symlink, its dedicated non-root account/unit, and config. It
does not replace `/usr/local/bin/xray`. UUID and
Reality keys are generated on the target; the private key is never returned. Extend
mode structurally copies live JSON to `.tmp.json`, appends exactly one client while
preserving all other semantics and ownership/mode, runs the official config test, and
atomically replaces it.

Use `--enable-bbr` only after review. It fails closed unless the live primary root
qdisc is already `fq`, so it never replaces a live qdisc. Only when either sysctl must
change does it capture and manage the exact two-setting drop-in and prior values.
Already-enabled BBR/fq is a no-op. If active UFW lacks the
service rule, plan reports `firewallChangeRequired`; apply additionally requires
`--allow-firewall-change`, proves the SSH port is allowed, and adds one transaction-
tagged rule. No other firewall backend is changed.

Komari is off. `--enable-komari-agent` requires a private manifest with version exactly
`1.2.60` and a SHA-256, then apply fails closed because remote installation is not yet
supported; it never claims installation.

An SSH EOF/255 during the restart-bearing apply is indeterminate, never success. The
transaction and expected state are already remote; a new strict pinned session checks
transaction/status binding, a new MainPID whose start follows activation, and that
exact PID's root-visible `ss -lntp` listener, plus hashes/client, journal, BBR/UFW, and
host pressure/counters. The authenticated Reality data-plane probe remains an
**external operator acceptance check after apply**; a local TCP listener is not that
probe. Mismatch
causes rollback and another fresh restored-state verification.

Extend mode can be verified and rolled back by this tool, but `enroll-draft`
requires usable Reality public-key and short-ID metadata. If an existing config
does not expose enough information to produce those values without putting its
private key in process arguments, enrollment fails closed; do not bypass that
boundary.

After successful verification only, `enroll-draft --expected-revision 0` (a
nonnegative integer) writes a complete private Clash VLESS Reality Vision fragment
using `catalogName` and `publicServer`, and a redacted diff with
`requiresHumanCASConfirmation=true` and `published=false`. Human CAS confirmation and
publication are deliberately separate and no API or Cloudflare call exists here.
