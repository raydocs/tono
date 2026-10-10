## 2026-10-10 · A third API relay on another provider, and a per-relay connect budget
- Status: provisional (owner approval via Puck 2026-10-10, relayed by the coordinator session; the owner confirms the status)
- Chosen: amends [077](077-2026-10-10-api-relay-outside-cloudflare.md). A third Tono API relay
  at **154.84.56.196:2053** (AROSSCLOUD INC, AS400619, Los Angeles; not DMIT), same nginx
  `stream` + `ssl_preread` SNI allow-list (`api.afk.ccwu.cc`, `releases.afk.ccwu.cc`) and
  unterminated TLS to the fixed Cloudflare upstream as the two DMIT relays
  ([`tono-relay.stream.conf`](../../tooling/ops/relay/tono-relay.stream.conf)). It replaces the
  first choice, 38.14.195.144 (Uscloud, San Jose), whose provider drops inbound TCP 2053, so it
  was never reachable. Appended **last** to every compiled list (macOS `ControlPlaneRelays`,
  Windows `API_RELAYS`, control plane `api-relays.ts`, `cn_acceptance.py`), so a walk that
  reaches a DMIT relay and a remembered relay index are unchanged. Not on an exit node: no
  `tono-xray`, no exit agent, so `exitNodeId` is absent and no end-to-end report is accepted for
  it (TCP-open probe only; gap recorded in [docs/ops/api-relay.md](../ops/api-relay.md)). The
  macOS API exchange's relay connect budget becomes 5 s **per relay** (15 s for three) instead
  of 5 s shared, matching its updater package GET; Windows stays at 4 s per relay (12 s).
  Rejected: putting it first (moves every relayed customer off a measured path for no gain:
  mainland round trips matched the DMIT relays); a third DMIT node (same provider failure
  domain); giving the host an exit-agent token only to report the probe (a node credential on a
  host that serves no exit).
- Why stricter: TLS stays end to end and every path validates the same Cloudflare certificate;
  the relay forwards two SNIs to a fixed upstream and closes everything else, so it cannot act
  as a general proxy. Since decisions 086 (macOS) and 090 (Windows) the relays are the armed
  no-tunnel control-plane permit, so this adds exactly one more `IP:2053` TCP tuple to that
  permit (PF: interactive user only; WFP: Tono app ID only) — the same shape as the two DMIT
  entries, nothing broader; the helper version and WFP namespace change with it. Exposure added:
  one more operator-controlled host on a provider not used before sees client IP, SNI, byte
  counts and session time (14-day log rotation). Availability widens: a DMIT outage no longer
  removes every relay. Still one metro (Los Angeles): a regional or shared-transit event can.
- Applied in: PR [#1538](https://github.com/raydocs/tono/pull/1538); runbook
  [docs/ops/api-relay.md](../ops/api-relay.md); changelog
  [2026-10-10-third-api-relay.md](../changelog.d/2026-10-10-third-api-relay.md). Node side
  deployed by the coordinator session on 2026-10-10 20:16 UTC; rollback
  `/root/tono-relay-rollback.sh` on the node.
