## 2026-10-10 · Windows armed-without-tunnel control plane may use the Tono relays (owner W-A, amends 077)
- Status: owner (W-A, approved directly by the owner 2026-10-10: "按你说的改"; relayed by the coordinator of the Amp backlog session)
- Question: [decision 077](077-2026-10-10-api-relay-outside-cloudflare.md) kept the Tono API relays out of the WFP
  bootstrap permit, so while protection is armed without a tunnel (Bootstrap, Blocked / Protected Offline, including
  the strict kill switch's held-closed state) the Windows client could reach the control plane only through the
  Cloudflare addresses. For the customer the relays exist for (carrier path to Cloudflare broken), that meant no
  sign-in, token refresh or catalog fetch until protection was turned off.
- Chosen: WFP rule C (`apps/windows/service/src/core/wfp_model.rs`, the app-scoped bootstrap API channel) also
  permits TCP to each compiled relay tuple, today `179.253.233.220:2053` (Westwood) and `179.255.154.17:2053` (Mesa).
  Each permit carries exactly rule C's conditions: `ALE_APP_ID` of the installed Tono app (`AleAppIdTonoApp`, #334),
  one exact remote address (/32), TCP, one exact remote port; same layer, weight and non-persistence as the
  Cloudflare entries. The tuples come from one compiled list, `tono_service_protocol::API_RELAYS`
  (`apps/windows/service/src/lib.rs`), which the app re-exports as `bootstrap::API_RELAYS` and walks; nothing is
  resolved or sent over IPC. Rendered only where rule C already renders a channel: not in `Locked` (connected), not
  without an installed app path, and not for a record with no admitted API address (the ownerless emergency block).
  The Cloudflare pins, learned addresses and `CONTROL_PLANE_PORTS` entries are unchanged (owner chose to keep them).
  Client order is unchanged (`transport.rs` `send_over_paths`): a remembered alternate port or relay first, then the
  pins and the system resolver, then the relays, DoH, the alternate ports; the relay walk was never skipped while
  armed, it was only blocked by WFP.
  Rejected: relays only, dropping the Cloudflare entries (the macOS shape of decision 086, open PR #1507;
  the owner chose to keep them on Windows, where rule C is already bound to the Tono app); an all-apps or
  port-range permit; a relay list fetched from the API or resolved by name.
- Threat model: the permit matches only flows the installed Tono app (Program Files, admin-write) opens, so no other
  process gains anything (H1-F5's Windows half stays closed). The relays are nginx `stream` with `ssl_preread`: they
  admit only the SNIs `api.afk.ccwu.cc` and `releases.afk.ccwu.cc` and pass TLS through unterminated, so the app
  validates Cloudflare's certificate for the hostname and the relay sees SNI and ciphertext; anything else goes to a
  closed port. Through a relay the app therefore reaches a subset of what the Cloudflare entries already reach. Port
  2053 only: the same hosts' `tono-xray` on 443 is not covered by this permit. Exposure added: a relay operator or
  compromised relay sees client IP, SNI, sizes and timing (as decision 077 records) also while the user is in
  Protected Offline; a relay that is down costs one 4 s connect budget per relay before the next path.
- Why stricter than the alternatives: no new process, no new protocol, no range, no DNS, no change to connected
  mode, the floor, DIRECT, LAN or HoldClosed semantics beyond these entries where rule C already applies.
- Third relay: `38.14.195.144:2053` (PR #1538) was not merged when this was applied, so it is not in the list. When
  #1538 merges, add it to `tono_service_protocol::API_RELAYS` (one list; the app picks it up) and to the literal in
  `bootstrap_channel_adds_exactly_the_tono_relays_for_the_tono_app_over_tcp`, and bump `FILTER_NAMESPACE`.
- Applied in: PR [#1539](https://github.com/raydocs/tono/pull/1539) (`amp/w-a-wfp-relay-permit`, filter namespace v14, `…9e0d…`); changelog
  [2026-10-10-win-wfp-relay-permit.md](../changelog.d/2026-10-10-win-wfp-relay-permit.md); finding H1-F5
  (FINDINGS_LEDGER Windows note); runbook [docs/ops/api-relay.md](../ops/api-relay.md).
