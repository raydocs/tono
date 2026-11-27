# RFC: Node-Side Residential SOCKS5 Dialing (`u:` / `h:` Dual Identity)

- Status: Proposed (Draft RFC)
- Date: 2026-11-27
- Authors: Tono Engineering
- Target components: `services/control-plane`, `services/exit-agent`, `tooling/scripts/remote`, `apps/macos`, `apps/windows`

---

## 1. Problem Statement

Today, residential home egress (`home_exits.kind = 'socks5'`) is dialed directly from the customer's desktop client through an upstream `sing-box` chain (`detour`):

1. `services/control-plane/src/catalog.ts` (`homeRoutingForUser`, lines 288–294) reads `home_exits.socks5_host`, `socks5_port`, `socks5_username`, and `socks5_password` from D1 and emits `routing.homeSocks5` in plain structured JSON inside the authenticated per-user catalog response.
2. Desktop clients (`apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift` and `apps/windows/crates/tono-core/src/config.rs`, `HOME_SOCKS5_OUTBOUND_NAME = "Tono-Home-Residential"`) instantiate a client-side `socks` outbound chained with `"detour": "Tono-Exit"`.
3. Every residential flow (AI domains, home DNS `Tono-AIHome-Home-DNS` in `tooling/scripts/sing-box/ai-home-template.json`, and `three-tier` residential rules) traverses:
   `Client -> Tono-Exit (VLESS-Reality or HY2) -> Exit VPS -> Client-originated SOCKS5 CONNECT/UDP -> Residential IP`.

This architecture causes three production pain points:

1. **Latency & Handshake Amplification**: Every new TCP connection and DNS lookup pays mainland→overseas round-trips for TLS/QUIC framing *plus* an encapsulated end-to-end SOCKS5 greeting + username/password auth + `CONNECT` exchange driven by the client. Over high-RTT cross-border links, AI streaming/WebSocket reconnects and TLS handshakes stall noticeably compared to dialing the upstream SOCKS5 hop from the nearby US/JP exit VPS (~1–30 ms RTT to the residential gateway).
2. **Upstream Credential Exposure & Rotation Lockout**: Because `socks5_username` and `socks5_password` are delivered to the client device (`routingSha256` in `services/control-plane/src/catalog.ts:331–340`), any user who was previously bound to a residential line retains usable upstream credentials in their cached catalog. To prevent re-issuance to another customer, `services/control-plane/src/home.ts:340–360` (`assertHomeExitBindable`) sets `socks5_rotation_required_at` (`409 SOCKS5_ROTATION_REQUIRED`), forcing manual upstream password rotation before the IP can be reused.
3. **Double-Encapsulation Fragility & Protocol Drift**: When a user switches cloud egress to Hysteria 2 or encounters packet loss, tunneling nested client SOCKS5 state machines (`socks5` over tunnel) amplifies tail latency and couples residential egress health to client-side proxy chaining rules (`ThreeTierRoutingContract` in `tooling/scripts/core-helper/main.swift`).

---

## 2. Goals & Non-Goals

### Goals
- Move the residential SOCKS5 TCP/UDP dialer (`socks` outbound) from customer devices onto Tono exit VPS nodes (`Xray`).
- Keep client devices zero-credential with respect to `home_exits.socks5_username` / `socks5_password` (the upstream residential secret never leaves the control-plane → exit-node trust boundary).
- Require zero new client transport protocols and preserve `Tono-Home-Residential` routing contracts (`three-tier`, `ai-home`, `Tono-AIHome-Home-DNS`).
- Fail closed: traffic presenting a residential identity must **never** fall through to an exit VPS datacenter IP (`direct`) if the residential outbound or routing rule is missing, disabled, or unhealthy.
- Unify exit metering under `services/exit-agent` without double-counting when traffic switches from client-chained `homeSocks5` to node-side `h:` egress.
- Support staged rollout with full backward compatibility for existing `0.0.88` desktop clients.

### Non-Goals
- Replacing Cloudflare Worker catalog distribution or introducing direct control-plane → VPS inbound push RPCs (exit nodes remain pull-only over TLS using `authenticateExitNode`).
- Supporting customer-configured custom SOCKS5 addresses from the desktop UI (managed `home_exits` remain control-plane owned).
- Requiring immediate residential `h:` multiplexing over Hysteria 2 on day one (see Section 5 for the phased HY2 plan).

---

## 3. Target Architecture: Dual-Identity Model (`u:` vs `h:`)

Instead of inventing a custom multiplexing header or signaling protocol inside `VLESS`, each exit node runs a **single** Xray VLESS-Reality inbound holding two strictly separated client namespaces for bound accounts:

| Namespace | Purpose | Roster Label (`email` / stats counter) | Credential Source | Xray Routing Target |
| :--- | :--- | :--- | :--- | :--- |
| Standard cloud egress | General overseas traffic (`Tono-Exit`) | `u:<user_id>:<device_id>:<gen>` | `exit_credentials` / device exit UUID | Default `direct` outbound (`freedom`) |
| Residential home egress | Bound residential IP traffic (`Tono-Home-Residential`) | `h:<user_id>:<device_id>:<gen>` | Separate derived or minted residential UUID per `(user, device)` (or per user in `dual` rollout) | Dedicated Xray outbound `home:<home_exit_id>` -> blackhole fallback if unmatched |

### How Clients Use the Dual Identity
1. Desktop clients advertise node-side residential capability via `X-Tono-Accept: hy2, node-home` (mirroring the existing `X-Tono-Accept: hy2` gate in `services/control-plane/src/catalog.ts:317–321`).
2. For capable clients with an active `kind = 'socks5'` binding:
   - `services/control-plane/src/catalog.ts` **omits** `routing.homeSocks5` (or sets a non-secret directive `routing.homeTunnel = { homeExitId, proxyBaseName, credentialUuid }` / dedicated `home` proxy entry verified by catalog signature/digest).
   - No `socks5_username` or `socks5_password` is serialized into the client response or hashed client routing document.
   - The client compiles `Tono-Home-Residential` directly as a **VLESS-Reality** outbound dialing the selected exit node with the user's `h:` UUID, instead of a local `socks` outbound chaining `"detour": "Tono-Exit"`.
   - `Tono-AIHome-Home-DNS` (`tooling/scripts/sing-box/ai-home-template.json`) keeps `"detour": "Tono-Home-Residential"`, so DNS for AI/residential domains continues flowing strictly through the residential exit.
3. For legacy clients that do **not** send `node-home` in `X-Tono-Accept`:
   - During migration, the control plane may either continue serving `homeSocks5` (preserving `0.0.88` compatibility) or enforce a minimum app version before removing client-side `socks5` secrets completely.

---

## 4. Exit-Node Reconciliation & Strict Fail-Closed Ordering

### 4.1 Authenticated Control-Plane Pull Contract
`services/control-plane/src/index.ts:1166–1172` serves `GET /api/v1/home/exit-identities` to exit nodes authenticated via `authenticateExitNode`.

We extend the roster payload (gated by node capability/protocol version or as an additive field in v2):
```json
{
  "nodeId": "...",
  "observedAt": 1795777566,
  "roster": [
    {
      "userId": "usr_...",
      "deviceId": "dev_...",
      "clientUUID": "...",
      "kind": "u"
    },
    {
      "userId": "usr_...",
      "deviceId": "dev_...",
      "clientUUID": "...",
      "kind": "h",
      "homeExitId": "hex_..."
    }
  ],
  "homeOutbounds": [
    {
      "homeExitId": "hex_...",
      "status": "active",
      "protocol": "socks",
      "host": "198.51.100.10",
      "port": 1080,
      "username": "...",
      "password": "..."
    }
  ]
}
```
Security boundaries:
- Upstream residential credentials in `homeOutbounds` are sent **only** to active `exit_nodes` whose roster references them (or all active assigned exit nodes for the bound shard), never to desktop/admin public catalog endpoints.
- Any persisted roster cache (`roster_cache_path` in `services/exit-agent/reconcile_and_report.py:838`) holding `homeOutbounds` must keep strict service ownership and `0600` permissions, matching existing node token and state guarantees.

### 4.2 Xray `26.3.27` Outbound & Routing Synchronization
`tooling/scripts/remote/exit_metering_config.py` currently enables `HandlerService` and `StatsService` inside Xray's `api.services`.
Adding `RoutingService` alongside `HandlerService` exposes Xray's documented dynamic rule APIs (`adr` / `adrules` and `rmr` / `rmrules`), while `HandlerService` provides `ado` (`AddOutbound`) and `rmo` (`RemoveOutbound`).

**Critical engineering verification required before PR #3 implementation**:
On Xray `26.3.27`, verify via integration test whether `xray api adr` reliably *prepends* (or orders by rule priority ahead of the default `direct` catch-all/final outbound) when modifying live routing rules without restarting `tono-xray`:
- **Option A (Live gRPC `HandlerService` + `RoutingService`)**: Zero connection drop for `u:` and `h:` peers during bind/unbind changes, provided rule insertion precedence ahead of `direct` is deterministic and verifiable via Xray query/probe.
- **Option B (Versioned template reload / local Xray SOCKS-mux helper if `RoutingService` lacks atomic priority ordering)**: Atomic config write + reload ONLY on `homeOutbounds` topology change (rare — binds/unbinds are low frequency compared to `u:`/`h:` client roster churn, which continues using zero-restart `adu`/`rmu`). If `RoutingService` cannot guarantee rule order before `direct` after Xray restart or live mutation, Option B + startup static rules guarantees fail-closed routing.

Regardless of Option A or B, Xray routing rules **must** enforce:
1. Per-line rule matched on full credential label (or unambiguous user list):
   `{ "type": "field", "user": ["h:..."], "outboundTag": "home:<home_exit_id>" }`
2. **Fail-closed safety net** immediately after per-line `h:` rules and before any default `direct` fallback:
   Any traffic whose inbound client `email` starts with `h:` (matched via explicit enumerated active `h:` labels on every round, or regex/domain-less blackhole rule if supported and verified on `26.3.27`) that misses its `home:<home_exit_id>` rule **must** route to a `blackhole` outbound (`"tag": "home-blackhole"`), **never** to VPS `direct`.

### 4.3 Mandatory Add/Remove Ordering (No Window for Leak or Ghost Traffic)
`services/exit-agent/reconcile_and_report.py` must strictly order operations on every reconcile cycle:

**Provisioning / Rebinding a residential user (`h:` identity):**
1. Validate `homeOutbound.status == 'active'` and host/port/credential well-formedness.
2. Ensure `outboundTag = "home:<home_exit_id>"` exists in Xray (`ado` if missing; if updated host/port/creds, rotate under new tag e.g. `home:<id>:<digest8>` before draining old tag).
3. Ensure routing rule `{ "user": [h_label], "outboundTag": outbound_tag }` is installed **and verified active**.
4. **Only after (2) and (3) succeed**, call `adu` to install the `h:` inbound client credential.
   - If step (2) or (3) fails, refuse installing that `h:` client (and remove it if already installed), surfacing an error in `reconcile_and_report.py` without breaking healthy `u:` clients or healthy other `h:` users.

**Unbinding / Suspending / Rotating (`home_exits.status != 'active'` or user removed):**
1. **First**, call `rmu` to remove the `h:` inbound client from VLESS (immediately terminating new dials; for stuck connections follow Decision 140 bounded restart escalation if removal fails repeatedly).
2. **Second**, remove the `user -> home:<id>` routing rule (routing any residual matched label to `home-blackhole` first if draining).
3. **Last**, call `rmo` once zero active `h:` users reference `home:<home_exit_id>`.

### 4.4 DNS Handling on the Exit Node
When a client connects to the exit node presenting its `h:` UUID, the destination inside the VLESS payload is either:
- An IP address (e.g., resolved via `Tono-AIHome-Home-DNS` DoH tunneling over `Tono-Home-Residential`), or
- A domain name (SOCKS5 `ATYP = 0x03` remote domain resolution).

Wait: if a domain destination arrives at Xray and Xray triggers its VPS-local `Freedom`/system DNS before dialing the `socks` outbound, the residential ISP could see requests originating directly rather than letting the residential SOCKS5 proxy resolve DNS, or VPS DNS could leak/differ geographically!
Xray's `socks` outbound passes domain addresses (`address` preserved) directly in the SOCKS5 `CONNECT` header when `routing.domainStrategy = "AsIs"` (and we must assert Xray does not pre-resolve `h:` targets locally to IPs before dialing `home:<home_exit_id>`). Additionally, `Tono-AIHome-Home-DNS` continues routing DoH queries through `Tono-Home-Residential` -> `home:<home_exit_id>` -> residential IP.

---

## 5. Compatibility with Hysteria 2 (`tono-hy2`)

`tooling/scripts/remote/manage-tono-hy2-node.sh` deploys `tono-hy2` alongside `tono-xray` with:
- Localhost auth microservice `tono-hy2-auth` on `127.0.0.1:18765/auth` (`ALLOW = Path("/opt/tono-hy2/auth-allow.sha256")`), returning `{"ok": true, "id": digest[:12]}`.
- `services/exit-agent/reconcile_and_report.py:1636` (`sync_hy2_roster`) writing SHA-256 hashes of `roster[i]["clientUUID"]`.

If an `h:` identity were naively synced into `/opt/tono-hy2/auth-allow.sha256` without separate Hysteria 2 ACL routing, Hysteria 2 would exit directly from the VPS datacenter IP — **an immediate datacenter-IP leak**.

### Design Decision: Two-Phase HY2 Strategy
1. **Phase A (Initial Ship — Recommended)**:
   - `/opt/tono-hy2/auth-allow.sha256` and `tono-hy2` admit **only** `kind = 'u'` identities (enforced in `sync_hy2_roster`).
   - `Tono-Home-Residential` (`kind = 'h'`) dials **VLESS-Reality (`Xray`)** on the same exit node.
   - **Why this is the right trade-off**:
     - Residential AI/home flows are interactive HTTP/TLS/WebSocket streams where Xray `xtls-rprx-vision` latency is optimal once the node-to-SOCKS5 hop is adjacent.
     - Many upstream residential SOCKS5 proxies do not reliably support SOCKS5 UDP ASSOCIATE or drop high-rate QUIC datagrams; terminating QUIC/HY2 from client→VPS and forcing UDP or TCP through residential SOCKS5 does not help residential traffic unless the outbound itself is clean TCP/UDP, whereas Xray VLESS-Vision maps TCP 1:1 cleanly to residential SOCKS5 TCP `CONNECT`.
     - Zero change to `tono-hy2` binary/systemd config or Brutal/BBR tuning.
2. **Phase B (Future Optional — HY2 for `h:` if ever needed)**:
   - Only pursue if users on extreme TCP-throttled networks need Hysteria 2 for `Tono-Home-Residential`.
   - Implementation: `tono-hy2-auth` returns `id: "h:<home_exit_id>:<digest12>"` (for `h:` tokens) vs `"u:<digest12>"`, paired with Hysteria 2 server `outbounds` (one `socks5` outbound per `home_exit_id`, synced cleanly + safe `acl` user-match routing). Because Hysteria 2 lacks an incremental gRPC `AddOutbound` API and requires config reload for new outbounds, Phase A avoids unnecessary HY2 churn while giving 100% of the node-side SOCKS5 latency/security benefit immediately.

---

## 6. Unified Metering & Anti-Double-Billing

Currently (`services/exit-agent/reconcile_and_report.py:350–373`):
- `client_label` emits `u:<user_id>:<device_id>:<generation>`.
- `attributed_user(label)` parses `u:` labels into `user_id` for `StatsService` counter collection and monotonic reporting (`usage_report_sources`, `adopt_source_watermarks`).

With node-side `h:` identities:
1. `client_label(..., kind="h")` emits `h:<user_id>:<device_id>:<generation>`.
2. `attributed_user(label)` is extended to accept both `u:` and `h:` prefixes and map both to `user_id` (while ignoring `shared-legacy` and unknown prefixes).
3. **Why double-billing never occurs**:
   - Capable clients configure `Tono-Home-Residential` directly to the exit node's `h:` identity (**not** detoured via `Tono-Exit` `u:`). Thus residential bytes increment **only** `user>>>h:...>>>traffic>>>uplink|downlink`, while cloud bytes increment **only** `user>>>u:...>>>traffic>>>uplink|downlink`.
   - `lifetime_totals` tracks per-label counters independently per counter label, and `aggregate_user_totals` sums both `u:` and `h:` counters per `user_id` before delta/watermark reporting.
   - Because each `u:` and `h:` counter name is distinct, Xray restart/rotation preserves per-label monotonic watermarks identically.
4. **Optional Phase-2 home-line analytics**: Because `u:` and `h:` labels stay separate inside `StatsService`, `exit-agent` can later report an optional breakdown `{ cloudBytes, homeBytes }` alongside total `usageBytes` without changing client protocols.

---

## 7. Security & Operational Lifecycle (`socks5_rotation_required_at` Retirement)

### Threat Model Improvements
- **No secret leakage to endpoints**: Compromise of a customer laptop, local `sing-box` `config.json`, or memory/cache dump only reveals an ephemeral revocable `h:` UUID, never `socks5_host:port:username:password`.
- **Instant revocation without upstream password change**: Unbinding user A in D1 (`user_home_bindings` delete/update) removes A's `h:` UUID from the next `GET /api/v1/home/exit-identities` roster. `exit-agent` calls `rmu` within one cadence (<= 60s), cutting off A's access to the residential IP while the upstream SOCKS5 password remains unchanged. User B can immediately be bound to that same `home_exits` row with a fresh `h:` UUID.
- **Sunset of `socks5_rotation_required_at`**:
  - While legacy client-side `homeSocks5` clients are still allowed to connect, `assertHomeExitBindable` (`services/control-plane/src/home.ts:340–360`) **must remain enforced** for any line previously served via plaintext `homeSocks5`.
  - Once minimum supported client version forces `X-Tono-Accept: node-home` (and plaintext `homeSocks5` emission is removed from `catalog.ts`), newly created/bound lines never mark `socks5_rotation_required_at`, eliminating manual residential password rotations on user churn.

---

## 8. Client Compatibility & Staged Migration Plan

| Stage | Scope | Backward Compatibility / Rollback |
| :--- | :--- | :--- |
| **PR 1: Control-Plane + DB Schema (`h:` identity & pull API)** | Add `h:` credential issuance / ack / revocation alongside `u:` in D1 + `catalog.ts` / `index.ts`; return `kind: "u" \| "h"` and `homeOutbounds` to exit-agent only when requested; keep legacy `homeSocks5` untouched for current clients. | Zero client impact; roll back by reverting Worker deploy / feature flag. |
| **PR 2: Exit-Agent Reconciliation (`reconcile_and_report.py` + metering)** | Extend `exit_metering_config.py` (`RoutingService` or template reload verified on Xray `26.3.27`), implement strict add/remove ordering (`outbound` -> `rule` -> `h:` client, reverse on revoke), fail-closed `home-blackhole` guard, exclude `h:` from `sync_hy2_roster`, extend `attributed_user` for `h:`. | Canary on 1 VPS (`Los Angeles · Mesa`) with test account; roll back cleanly by restarting `exit-agent` prior version (removes dynamically added `h:` users while `u:` stays untouched). |
| **PR 3: Desktop Clients (macOS & Windows `node-home` capability)** | Send `X-Tono-Accept: hy2, node-home`; update `ConfigPipeline+SingBoxProduct.swift`, Windows `tono-core/src/config.rs` + `sing_box/runtime.rs`, and `ThreeTierRoutingContract` / `ownedRuntimeConfigIsSafe` in `core-helper` so `Tono-Home-Residential` builds a VLESS outbound using the `h:` credential when `routing.homeTunnel` is returned (keeping fallback support if `routing.homeSocks5` is returned). | Clients still understand legacy `homeSocks5` if server toggles capability off; canary via user allowlist or header flag. |
| **PR 4: Canary & Latency / Leak Verification** | Verify end-to-end RTT improvement, exit-node IP verification (`whoami`/exit check through `Tono-AIHome-Home-DNS` and AI domains -> residential IP, cloud domains -> VPS IP), simulated `homeOutbounds` failure -> `h:` traffic fails closed (`blackhole`, zero VPS IP leak), and zero double-counting in D1 `usage_bytes`. | Feature flag rollback immediately returns clients to legacy `homeSocks5`. |
| **PR 5: Legacy Deprecation & `socks5_rotation_required_at` Sunset** | Enforce minimum client version, stop emitting plaintext `routing.homeSocks5`, stop setting `socks5_rotation_required_at` for `node-home`-only lines, update `ops-panel` line management UI copy. | Clean steady state; all residential credentials remain strictly control-plane + exit-node internal. |

---

## 9. Open Questions for Sign-Off Before PR #1

1. **Xray `26.3.27` `RoutingService` rule ordering**: Should `exit-agent` use `RoutingService` (`adr`/`rmr`) for live dynamic rules, or manage residential outbounds/rules in a drop-in/rewritten config snippet on topology changes? (Needs 15-minute verification against `xray 26.3.27` CLI on canary VM before PR #2.)
2. **Exit node pinning vs any-active-node `h:` replication**: Should `h:` credentials + `homeOutbounds` be pushed to **all** active VLESS exit nodes (so switching from `Los Angeles · Mesa` to `San Jose · CloudSilk` seamlessly keeps `Tono-Home-Residential` working on the user's chosen geographic hop), or only to a designated subset of nodes geographically close to each residential ISP? (Pushing only the bound `homeOutbounds` used by active accounts on that node keeps the outbound table small even fleet-wide.)
3. **Residential bandwidth quota accounting**: Should `h:` traffic count 1:1 against existing `users.usage_bytes`, or also emit a separate per-home-line counter (`GET /api/v1/ops/home-lines/{id}/usage`) in `services/home-agent` / `services/exit-agent`?
