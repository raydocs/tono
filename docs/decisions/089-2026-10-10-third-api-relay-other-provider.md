## 2026-10-10 · A third API relay on another provider, and a per-relay connect budget
- Status: provisional (owner approval via Puck 2026-10-10, relayed by the coordinator session; the owner confirms the status)
- Chosen: amends [077](077-2026-10-10-api-relay-outside-cloudflare.md). A third Tono API relay
  at 38.14.195.144:2053 (Uscloud Inc, AS402169, San Jose), same nginx `stream` + `ssl_preread`
  SNI allow-list (`api.afk.ccwu.cc`, `releases.afk.ccwu.cc`) and unterminated TLS to the
  Cloudflare edge as the two DMIT relays. Appended **last** to every compiled list (macOS
  `ControlPlanePath.apiRelays`, Windows `bootstrap::API_RELAYS`, control plane `api-relays.ts`),
  so a walk that reaches a DMIT relay and a remembered relay index are unchanged. Unlike 077's
  relays it is not on an exit node: no `tono-xray`, no exit agent, so `exitNodeId` is absent
  and no end-to-end report is accepted for it (TCP-open probe only; gap recorded in
  [docs/ops/api-relay.md](../ops/api-relay.md)). The macOS API exchange's relay connect
  budget becomes 5 s **per relay** (15 s for three) instead of 5 s shared, matching its
  updater package GET; Windows stays at 4 s per relay (12 s). Rejected: putting it first
  (would move every relayed customer off the CN-optimised DMIT path); a third DMIT node (same
  provider failure domain); giving the host an exit-agent token only to report the probe
  (a node credential on a host that serves no exit).
- Why stricter: the WFP/PF bootstrap permits are unchanged and stay Cloudflare-only, so while
  protection is armed the new relay is blocked like any other address; TLS stays end to end
  and every path validates the same Cloudflare certificate. Exposure added: one more
  operator-controlled host sees client IP, SNI, byte counts and session time (14-day log
  rotation), on a provider not used before. Availability only widens: one provider's outage
  no longer removes every relay. The merge waits on external acceptance (allowed SNI TLS and
  `/api/v1/health` 200 through 38.14.195.144:2053 from outside; unknown or missing SNI
  closed): on 2026-10-10 the provider's network firewall drops inbound 2053.
- Applied in: PR amp/third-api-relay (draft); runbook [docs/ops/api-relay.md](../ops/api-relay.md);
  changelog [2026-10-10-third-api-relay.md](../changelog.d/2026-10-10-third-api-relay.md).
  Node side deployed by the coordinator session on 2026-10-10; rollback `/root/tono-relay-rollback.sh`.
