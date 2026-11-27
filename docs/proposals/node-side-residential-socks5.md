# RFC: Node-Side Residential SOCKS5 Dialing (`u:` / `h:` Dual Identity)

- Status: Proposed (Draft RFC — Revision 2 addressing dual-review feedback)
- Date: 2026-11-27
- Authors: Tono Engineering
- Target components: `services/control-plane`, `services/exit-agent`, `tooling/scripts/remote`, `apps/macos` (`Tono`, `tono-core-helper`), `apps/windows` (`tono-core`, `tono-service`), `TonoKit` (iOS/Android)

---

## 1. Problem Statement

Today, residential home egress (`home_exits.kind = 'socks5'`) is dialed directly from the customer's client device via a chained `sing-box` outbound:

1. `services/control-plane/src/catalog.ts` (`homeRoutingForUser`, lines 288–294) reads `home_exits.socks5_host`, `socks5_port`, `socks5_username`, and `socks5_password` from D1 and emits `routing.homeSocks5` inside the authenticated per-user catalog response, digested into `routingSha256` (`catalog.ts:331–340`).
2. Desktop clients (`apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift`, `apps/macos/Tono/Core/ThreeTierRoutingContract.swift`, `apps/windows/crates/tono-core/src/config.rs`, `apps/windows/crates/tono-core/src/three_tier.rs`, and `apps/windows/service/src/core/sing_box_runtime.rs`) build `HOME_SOCKS5_OUTBOUND_NAME = "Tono-Home-Residential"` as a `socks` outbound with `"detour": "Tono-Exit"` and `"network": "tcp"`. Mobile (`TonoKit` `Catalog.swift:124–126`) similarly consumes `routing.homeSocks5`.
3. Every residential flow (AI domains, home DoH `Tono-AIHome-Home-DNS` in `tooling/scripts/sing-box/ai-home-template.json`, and `three-tier` residential rules) traverses:
   `Client -> Tono-Exit (VLESS-Reality or HY2) -> Exit VPS -> Client-originated SOCKS5 TCP CONNECT -> Residential IP`.

This causes three concrete operational and latency issues:

1. **Latency & Handshake Amplification**: Every residential TCP stream pays cross-border RTTs to establish TLS/QUIC to the exit node *plus* client-driven SOCKS5 greeting, auth, and `CONNECT` round-trips across the overseas link before the TCP handshake to the target host begins. Placing the SOCKS5 dialer on the exit VPS cuts residential setup to ~1–30 ms local VPS→SOCKS5 RTT.
2. **Upstream Credential Exposure & Rotation Lockout**: Because `socks5_username` and `socks5_password` sit on customer devices, `migrations/0080_home_socks5_rotation_required.sql` (D1 triggers on unbind/rebind/disable) and `services/control-plane/src/home.ts:340–360` (`assertHomeExitBindable`) set `socks5_rotation_required_at`, blocking re-assignment of the residential IP until an operator manually rotates the upstream password.
3. **Client-Side Coupling & Outbound Chaining Fragility**: Tunneling client-side SOCKS5 state machines over cross-border transports amplifies tail stalls and couples residential egress tightly to client-side `detour` chains inside privileged helper/service validators (`ThreeTierRoutingContract.swift` compiled into `tono-core-helper` via `tooling/scripts/build-core-helper.sh`, and `apps/windows/service/src/core/sing_box_runtime.rs`).

---

## 2. Goals & Non-Goals

### Goals
- Move residential SOCKS5 TCP dialing onto verified exit VPS nodes (`Xray`).
- Keep `home_exits.socks5_username` and `socks5_password` strictly inside the control-plane → per-node exit-agent boundary (never served to client apps or shared fleet tokens).
- Require zero new client transport protocols while preserving `three-tier`, `ai-home`, and `Tono-AIHome-Home-DNS` routing guarantees.
- Guarantee **default-deny fail-closed routing**: `h:` residential traffic must never fall back to datacenter `direct` (`freedom`) or reach residential-provider private IPs regardless of Xray restart, outage, or rule-mutation race.
- Enforce verified session draining on unbind so two accounts cannot overlap on the same residential IP, enabling safe eventual sunset of manual upstream password rotations (`socks5_rotation_required_at`).
- Unify exit metering across `u:` and `h:` without double-billing, and gate rollout atomically on capability versioning across D1, `exit-agent`, clients, and privileged helpers/services (including mobile `TonoKit`).

### Non-Goals
- Opening inbound management ports from Cloudflare Workers to VPSes (exit nodes remain pull-only over TLS via `authenticateExitNode`).
- Allowing customer-supplied arbitrary SOCKS5 hosts from client UIs.
- Serving residential `h:` tunnels over Hysteria 2 before Hysteria 2 per-user metering and per-user outbound ACL isolation exist (Section 5).

---

## 3. Dual-Identity Architecture, Schema, and Client Contracts (`u:` vs `h:`)

### 3.1 Separate Namespaces (`u:` Cloud vs `h:` Residential)
Each node-home-capable Xray VLESS-Reality inbound serves two isolated credential namespaces:

| Namespace | Traffic Class | Xray Email / Counter Label | Identity Store | Xray Routing Target |
| :--- | :--- | :--- | :--- | :--- |
| Cloud egress (`u`) | General overseas (`Tono-Exit`) | `u:<user_id>:<device_id>:<gen>` | Existing `device_exit_credentials` / `exit_credentials` | Static rule -> `direct` (`freedom`) |
| Home egress (`h`) | Bound residential (`Tono-Home-Residential`) | `h:<user_id>:<device_id>:<gen>` | New `device_home_credentials` table | Dynamic per-line outbound `home:<home_exit_id>:<tag_ver>` (default-deny `home-blackhole`) |

### 3.2 D1 Data Model & Identity Lifecycle
Introduce explicit D1 schema and state transitions before any implementation starts:

1. **`device_home_credentials`**:
   - Columns: `id` (immutable generation UUID), `user_id`, `device_id`, `home_exit_id`, `client_uuid` (VLESS credential presented on wire), `created_at`, `acknowledged_at`, `retired_at`, `retire_reason`.
   - Constraint: unique active row (`retired_at IS NULL`) per `(device_id, home_exit_id)` scoped strictly to the user's current `user_home_bindings` row.
   - Transactional lifecycle: mint/bind inside the same D1 batch/transaction updating `user_home_bindings`; retiring/unbinding sets `retired_at` atomically.
2. **Per-line delivery mode & plaintext audit flags on `home_exits`**:
   - `delivery_mode TEXT NOT NULL DEFAULT 'legacy_socks5'` (`'legacy_socks5' | 'node_only'`).
   - `ever_served_plaintext_at INTEGER` (stamped whenever `routing.homeSocks5` is serialized to any client).
   - `drain_required_before_rebind_at INTEGER` + per-node drain table `home_exit_drain_acks(home_exit_id, retired_generation, node_id, drained_at)` tracking nodes that actually held an `h:` identity before rebinding (Section 7).
3. **Assigned node replication (`home_exit_nodes` / active cloud exits)**:
   - Resolve pinning vs replication explicitly before PR1: each active `home_exits` row is replicated **only** to active, `node-home`-capable VLESS exit nodes explicitly enabled for residential hosting (or geographically matched tier stored on `home_exits`), and `homeOutbounds` delivered to node $N$ contains **only** the `home_exits` rows referenced by `homeIdentities` admitted on $N$.
   - The client routing response (`routing.homeTunnel`) carries the explicit allowed list of exit node names/base names holding that user's ACKed `h:` identity, matching `selectAcknowledgedExitIdentity` readiness semantics so a user never dials a node lacking their `h:` outbound.

### 3.3 Client & Privileged Contract Versioning (`HelperProtocolVersion` & Windows Service)
Because `ThreeTierRoutingContract.swift` is compiled into `tono-core-helper` (`tooling/scripts/build-core-helper.sh`) and Windows `tono-service` validates `three_tier` / `ai-home` graphs independently (`apps/windows/service/src/core/sing_box_runtime.rs`), client-side runtime changes **require** privileged contract updates:

1. **Privileged Contract Extension**:
   - Bump `HelperProtocolVersion` (macOS) and release updated Windows `tono-service` admitting a second valid shape for `HOME_SOCKS5_OUTBOUND_NAME` (`"Tono-Home-Residential"`):
     - Either a `vless` outbound (`network: "tcp"`, TLS/Reality pinned per catalog node, **NO `detour`**, excluded from `Tono-Exit` selector), OR a mirrored `selector` tag `"Tono-Home-Residential"` selecting over per-node `h:` VLESS-Reality outbounds (each `h:` outbound strictly bound to a catalog exit IP, no `detour`, `network: "tcp"`).
   - **Recommended shape (avoids selector desync)**: Emit one hidden `vless` outbound `"Tono-Home-<ExitBase>"` per `homeTunnel.exitBaseNames` + selector `"Tono-Home-Residential"` defaulting to the currently selected cloud node's base name (when ready) and synced on every `Tono-Exit` switch without requiring full helper teardown/recompile, OR recompile `Tono-Home-Residential` on every active-exit switch. Both satisfy **zero `detour`** so residential bytes never double-traverse `Tono-Exit` `u:` accounting.
   - **Phase A Trade-Off on TCP-throttled (`hy2` auto-switch) events**: When `u:` falls back from VLESS to ` · hy2`, `Tono-Home-Residential` remains on VLESS-Reality TCP on healthy nodes (or fails over within the `homeTunnel` exit selector to a non-throttled exit node). PR4 explicitly benchmarks a TCP-throttled network scenario to confirm cloud HY2 + residential VLESS stability.
2. **Strict Capability Gate (App + Core + Privileged Helper/Service)**:
   - Apps advertise `X-Tono-Accept: ..., node-home` **ONLY** when the running app binary *and* installed privileged `tono-core-helper` / `tono-service` both report `node-home` support. An app with an older helper/service NEVER sends `node-home` and stays on legacy `homeSocks5` (until `node_only` sunset).
   - Control plane serves `routing.homeTunnel` **ONLY** when BOTH the request advertises `node-home` AND at least one served exit node has ACKed the device's `h:` generation (`node-home` readiness ACK in D1).

### 3.4 Versioned Catalog Routing Digest (`routingSha256` v2)
Currently `routingSha256` (`services/control-plane/src/catalog.ts:331–340`) hashes a fixed 3-field recipe (`homeProxy`, `defaultProxy`, `homeSocks5`), and macOS (`Tono`), Windows (`apps/windows/crates/tono-core/src/catalog.rs:212–229`), and iOS reject any mismatch with `InvalidResponse`:
- Legacy clients (without `node-home`) continue receiving v1 `routingSha256` over the existing 3-field recipe.
- `node-home`-capable clients receive `routingDigestVersion: 2` and `routingSha256` covering `homeProxy`, `defaultProxy`, `homeSocks5`, AND canonical serialized `homeTunnel` (`homeExitId`, `clientUuid`, sorted `exitBaseNames`), ensuring `h:` credential rotations immediately invalidate client caches without breaking legacy `routing_digest` verification.

---

## 4. Exit-Node Reconciliation, Default-Deny Topology, and Outage Bounds

### 4.1 Scoped Pull Payload (`homeIdentities` & `homeOutbounds` Separation)
Current `GET /api/v1/home/exit-identities` (`services/control-plane/src/exit-identity-roster.ts:25–50`) returns `{ nodeId, observedAt, retireSharedLegacy, sourceUsageWatermarks, identities }`.

Older exit agents ignore unknown JSON fields inside `identities` rows (`services/exit-agent/reconcile_and_report.py:598–680`) and prefix every identity with `u:` (`client_label`, `:350–358`), while `/api/v1/ops-ingest/node-clients` reuses the roster helper and `authenticateExitNode(req, e, true)` accepts the shared `HOME_AGENT_TOKEN` when `exit_credential_rollout` is `'dual'`.

To close **every** legacy misinterpretation and credential-exposure vector:
1. **Separate Top-Level Keys**: Never embed `h:` rows in `identities` or `exitCredentialRoster`. Publish residential assignments solely under new top-level keys `homeIdentities` and `homeOutbounds`. Legacy `parse_roster` and `/api/v1/ops-ingest/node-clients` never inspect these keys and cannot mis-install `h:` UUIDs into `u:` or `sync_hy2_roster`.
2. **Strict Server-Side Scoping & Token Gate**:
   - Require `exit_credential_rollout.phase === 'device_only'` before enabling `node-home` globally.
   - `homeIdentities` and `homeOutbounds` are populated **ONLY** when `authenticateExitNode` verifies a **per-node token with non-null `nodeId`** AND the node has declared `node-home` + verified `xrayVersion` capability (NEVER populated on `HOME_AGENT_TOKEN` or ops collector routes).
   - `homeOutbounds` includes **ONLY** `status = 'active'` residential lines bound to accounts in that node's own `homeIdentities`.
   - Every response carrying `homeOutbounds` is audit-logged (`node_id`, `observed_at`, bound `home_exit_ids`). Temporary `ado` JSON files written by `exit-agent` live exclusively inside a root/service-owned `0700` staging directory with `0600` file permissions and `try/finally` unlinking.
3. **Cache Isolation & Fail-Closed Outage TTL**:
   - Bump `ROSTER_CACHE_VERSION` (`reconcile_and_report.py`).
   - While cloud `u:` identities retain the existing outage recovery cache, **`h:` residential credentials MUST fail closed during extended control-plane outages or Xray restarts**:
     - Cached `homeIdentities` carry a short signed/monotonic lease (`MAX_HOME_OUTAGE_LEASE_SEC`, e.g., `<= 300s` / 5 missed cadences). Once expired or if `homeOutbounds` cannot be verified, `exit-agent` executes local `h:` withdrawal (`rmu` all `h:` -> `rmr` -> `rmo`) rather than leaving potentially unbound customers active for 24h (`reconcile_and_report.py:1824–1878`).
     - On `tono-xray` restart, **zero `h:` identities** may be reinstalled unless outbound + rule installation and `TestRoute` verification succeed in the same pass.

### 4.2 Default-Deny Xray Topology & Rule Ordering (Verified Pre-PR1 on `26.3.27` & `v26.11.9`)
Current nodes (`manage-tono-reality-node.sh`, `exit_metering_config.py`) run with `"outbounds": [{"protocol": "freedom"}]` as default outbound and only the API routing rule; moreover, Xray's `ReloadRules` appends or replaces the rule list rather than prepending ahead of a fallback rule.

Therefore, `home:` safety **must not depend on `AddRule` insertion precedence**. `exit_metering_config.py` converts node-home nodes to a **default-deny Xray topology**:

1. **First Outbound = `blackhole`** (Xray's default outbound when no rule matches):
   - Index `0`: `{ "tag": "home-blackhole", "protocol": "blackhole" }`
   - Explicit cloud outbound: `{ "tag": "direct", "protocol": "freedom" }`
2. **Static `config.json` Startup Rules (evaluated in order)**:
   - Rule #1: `{ "type": "field", "inboundTag": ["api"], "outboundTag": "api" }`
   - Rule #2: `{ "type": "field", "user": ["regexp:^u:", "shared-legacy"], "outboundTag": "direct" }` (explicitly matches only `u:` and legacy cloud traffic — verified in Xray `UserMatcher`!).
   - Rule #3 (Private-IP / SSRF Guard for SOCKS5): `{ "type": "field", "user": ["regexp:^h:"], "ip": ["geoip:private"], "outboundTag": "home-blackhole" }` — prevents `h:` clients from reaching residential-provider LAN or VPS loopback literals via the `socks` outbound (Xray's built-in Freedom private-IP block does not cover `socks`).
3. **Dynamic Runtime Objects (NEVER written to static `config.json`)**:
   - `exit-agent` manages ONLY `h:` users (`adu`/`rmu`), per-line `socks` outbounds (`ado`/`rmo`, tag `home:<home_exit_id>:<cred_digest8>`), and explicit user->outbound rules (`adr`/`rmr`: `{ "type": "field", "user": ["h:..."], "outboundTag": "home:<home_exit_id>:<cred_digest8>" }`) appended after static Rules #1–#3.
   - Any `h:` client whose dynamic rule or outbound fails to install, crashes, or is removed falls through Rule #2 (doesn't match `^u:`) straight to **Index 0 outbound `home-blackhole`** — zero window to leak VPS `direct` IP even if Xray restarts or rules clear.
4. **Why Option B ("template reload") is rejected**: Reloading `config.json` in Xray restarts the `systemd` process, dropping all dynamically added `u:` and `h:` clients for 30–90 seconds (`Decision 140`) and storing residential SOCKS5 credentials on disk. Option A (`HandlerService` + `RoutingService`) is mandatory.
5. **Mandatory PR0 Verification Gate (Before PR1)**:
   - Because fleet nodes currently run both `Xray 26.3.27` (rolled-back nodes) and `Xray v26.11.9` (`provision-tono-node.py:13`, `provision-reality-node.rb:16`), run a live integration harness against **both versions** before PR1 merges verifying:
     - `HandlerService` (`ado`, `rmo`) and `RoutingService` (`adr`, `rmr`, `TestRoute` or equivalent query);
     - Static `user: ["regexp:^u:", "shared-legacy"]` match behavior;
     - Closed-connection semantics when a matched `outboundTag` is absent vs Index 0 `home-blackhole` fallback;
     - `exit-agent` refuses `node-home` capability advertisement on any unverified `xray version`.

### 4.3 Mandatory Add/Remove Execution Order & Post-Reconcile `TestRoute`
Every reconcile round executes strictly in order:
1. Validate every referenced `homeOutbound` (`status == 'active'`, public IPv4/valid host, port `1..65535`, non-empty username/password).
2. Add missing dynamic `home:<home_exit_id>:<digest8>` `socks` outbound via `ado`.
3. Add/update dynamic rule `{ "user": [h_label], "outboundTag": "home:<home_exit_id>:<digest8>" }` via `adr`.
4. Call `RoutingService` `TestRoute` simulating inbound user `h_label` -> **assert matched outbound equals `home:<home_exit_id>:<digest8>`** (and private IP routes to `home-blackhole`).
5. **Only if steps (2)–(4) pass**, call `adu` to admit `h_label` (otherwise refuse `h_label` and remove it via `rmu` if previously installed).
6. On unbind/revocation/expiry:
   - **First** `rmu` the `h:` inbound client;
   - **Second** `rmr` its routing rule;
   - **Last** `rmo` `home:<id>:<digest8>` once zero active `h:` clients target that tag (and execute unbind drain ACK if retired — Section 7).

### 4.4 Enforced DNS Integrity
- `exit_metering_config.py` enforces `"routing": { "domainStrategy": "AsIs" }` and disables traffic sniffing overrides on `node-home` inbounds (refusing config validation if violated).
- Domain destinations delivered over VLESS pass verbatim as hostnames into the Xray `socks` outbound `CONNECT` request (SOCKS5 `ATYP = 0x03`), while `Tono-AIHome-Home-DNS` continues forwarding DNS-over-HTTPS queries through `Tono-Home-Residential` -> `home:<home_exit_id>`.
- **PR4 Acceptance Gate**: Packet capture (`tcpdump -i any udp port 53 or tcp port 53`) on the canary exit VPS during AI domain fetches confirms **zero** DNS queries leave the VPS resolver/NIC directly.

---

## 5. Hysteria 2 (`tono-hy2`) Compatibility

- **Phase A (This RFC)**:
  - `sync_hy2_roster` (`services/exit-agent/reconcile_and_report.py:1636–1660`) **strictly rejects any `h:` row** at parser boundary and populates `/opt/tono-hy2/auth-allow.sha256` exclusively from validated `kind == 'u'` entries in `identities` (with unit tests over mixed `u`/`h` payloads).
  - Residential `Tono-Home-Residential` (`h:`) remains strictly VLESS-Reality TCP on `Xray`, avoiding any datacenter leak through `tono-hy2`.
- **Phase B (Future Optional Only)**:
  - Only considered if severe carrier TCP throttling affects AI domains, and strictly **blocked on first landing per-identity HY2 metering** (currently HY2 is unmetered) plus per-identity `tono-hy2-auth` user tags paired with static/synced HY2 outbound ACL isolation.

---

## 6. Unified Metering, Atomic Cutover, and Safe Agent Rollback

1. **Identity & Parser Atomicity**:
   - Extend `client_label`, `attributed_user`, `reconcile` inventory/removal filtering (preventing `reconcile` from ignoring `h:` as "hand-added"), and `aggregate_user_totals` in `services/exit-agent/reconcile_and_report.py` **in the exact same PR (PR2)**, gated behind explicit agent capability registration in D1.
   - Control plane never issues `h:` credentials until the serving exit node's `exit-agent` reports `meteringProtocolVersion >= 3` (`u:` + `h:` capable).
2. **Anti-Double-Billing Invariant**:
   - Capable clients remove `"detour": "Tono-Exit"` on `Tono-Home-Residential`. Cloud destinations traverse `Tono-Exit` (`u:`), incrementing `user>>>u:...`; residential destinations traverse `Tono-Home-Residential` (`h:`), incrementing `user>>>h:...`. Zero flow touches both identities.
3. **Watermark Recovery Caveat on Future Breakdown**:
   - Note that `adopt_source_watermarks` (`reconcile_and_report.py:1371–1411`) assigns a source-level recovery watermark to the first label in sorted order, and `"h:"` sorts before `"u:"`. Total user billing (`u: + h:`) stays exact under `adopt_source_watermarks`, whereas any future separate `{ cloudBytes, homeBytes }` split **must** track distinct `usage_report_sources` buckets per identity namespace.
4. **Safe PR2 Rollback**:
   - Because older `exit-agent` releases ignore non-`u:` labels as "hand-added" (`reconcile_and_report.py:101`), simply downgrading the agent binary would strand active `h:` clients unrevoked and unmetered!
   - **Mandatory Rollback Protocol**: Control plane exposes a node/fleet kill-switch (`withdrawHome = true`) / agent supports `--withdraw-home` mode that executes `rmu(h:*) -> rmr(h:*) -> rmo(home:*)`, OR operator restarts `tono-xray` (clearing dynamic `h:` state, since static `config.json` holds zero `h:` clients), **before** downgrading the `exit-agent` binary.

---

## 7. Session Drain on Unbind & `socks5_rotation_required_at` Sunset

### 7.1 Closing the Persistent-Session Overlap Gap
Removing an Xray client via `rmu` blocks **new** VLESS handshakes, but active TCP/HTTP2/WebSocket/SSE streams stay open until idle/closed. Decision 140's bounded restart only runs after repeated failed `rmu`s for `u:` identities. If user A is unbound at $t_0$ and user B is bound at $t_0 + 5\text{ s}$, A's open browser/Claude SSE tabs would still share B's residential IP.

**Verified Drain Protocol (replaces manual upstream password changes once plaintext ceases)**:
1. When user A is unbound/disabled on a `node_only` line, A's `h:` UUID is marked `retired` in `device_home_credentials`, and `home_exits` advances `outbound_generation` (`home:<id>:<new_digest>`).
2. Nodes currently holding A's `h:` identity stop admitting new handshakes via `rmu` and drain existing streams tied to A's outbound tag:
   - Either isolate each tenant binding onto a dedicated ephemeral outbound tag (`home:<id>:<binding_gen>`) whose outbound instance is explicitly torn down (`rmo` cancels Xray outbound connections / drain helper or scoped worker reload when sessions persist past a short grace window, verified in PR0 on both Xray `26.3.27` and `v26.11.9`), OR execute coordinated `tono-xray` reload where no other long-lived sessions are impacted;
   - Record per-node `home_exit_drain_acks` once zero active sessions/conntrack entries remain on A's tag.
3. Rebinding `home_exit_id` to user B (`assertHomeExitBindable` + D1 rebind checks) waits until **all holding nodes ACK drain** (measured and tuned from PR4 real session lifetime telemetry).

### 7.2 Sunset of Plaintext `homeSocks5` & `migrations/0080` Triggers
1. Throughout PR1–PR4 migration, D1 triggers (`migrations/0080_home_socks5_rotation_required.sql`) stay active for any line with `delivery_mode = 'legacy_socks5'` OR `ever_served_plaintext_at IS NOT NULL`.
2. Any line kept in `legacy_socks5` still forbids un-rotated rebinding, and `node-home` downgrade attacks (client omitting `X-Tono-Accept: node-home` header) cannot fetch plaintext once an operator flips the line to `delivery_mode = 'node_only'`.
3. Once desktop (`macOS`/`Windows` + helpers/services) **and mobile (`iOS`/`Android` `TonoKit`, which drops `hy2AcceptHeaderForClient` for HY2 today via `services/control-plane/src/client-identity.ts:69–72` but reads `routing.homeSocks5`)** have migrated:
   - Rotate upstream residential passwords once for every line with `ever_served_plaintext_at IS NOT NULL` and clear `ever_served_plaintext_at` after upgrading to `delivery_mode = 'node_only'`;
   - Land a reviewed migration (verified with `tooling/scripts/check-migrations-additive.mjs`) updating the `0080` D1 triggers so `node_only` lines require node drain ACKs instead of `socks5_rotation_required_at`;
   - Sunset legacy clients with clear fail-closed `503` (`CLIENT_UPGRADE_REQUIRED` / `CATALOG_UNAVAILABLE`) rather than quietly dropping home routing (`catalog.ts:283–285`).

---

## 8. Staged Implementation Roadmap

| Stage | Scope | Entry Gate / Verification |
| :--- | :--- | :--- |
| **PR 0: Xray `26.3.27` & `v26.11.9` Capabilities Probe** | Non-prod verification script proving `ado`/`rmo`, `adr`/`rmr`, `TestRoute`, `user: ["regexp:^u:"]`, Index 0 `home-blackhole`, `rmo` stream cancellation semantics, and `domainStrategy: "AsIs"` on **both** Xray versions. | Required **before** PR 1 finalizes D1/RPC schema. |
| **PR 1: Control Plane & D1 Schema** | Add `device_home_credentials`, `home_exit_drain_acks`, `delivery_mode` / `ever_served_plaintext_at`, `homeIdentities` & scoped `homeOutbounds` top-level response fields (per-node token + `device_only` only), versioned `routingSha256` v2, node capability + Xray-version gating. | Legacy `homeSocks5` stays default; Vitest + D1 additive/idempotent migration checks. |
| **PR 2: Exit Agent & `exit_metering_config.py`** | Default-deny `home-blackhole` + `^u:` + `geoip:private` static config transform, strict add/TestRoute/remove ordering, fail-closed outage lease for `h:`, HY2 `kind == 'u'` isolation test, unified `u:`/`h:` metering & `--withdraw-home` safe rollback. | Agent tests + live canary rehearsal on `Los Angeles · Mesa` with test account. |
| **PR 3: Desktop Apps + Helper/Service Contracts** | Bump `HelperProtocolVersion` (`ThreeTierRoutingContract.swift`) + Windows `tono-service` (`three_tier.rs`, `sing_box_runtime.rs`) admitting no-`detour` `Tono-Home-Residential` VLESS/selector + `routingSha256` v2; advertise `node-home` only when helper/service agrees. | Hosted `ci-gate` (`macos` privileged/unit tests, `windows` `service` tests). |
| **PR 3b: Mobile (`TonoKit` iOS/Android)** | Support `homeTunnel` VLESS outbound + `routingSha256` v2 + `node-home` header on iOS & Android prior to any plaintext deprecation. | `TonoKit` test suite. |
| **PR 4: Canary & Full E2E Proof** | Verify on canary node + test clients: RTT drop vs chained `socks5`, zero VPS DNS leaks (`tcpdump`), forced outbound/rule fault -> `home-blackhole` closed fail, cloud-to-HY2 + AI-VLESS concurrency & TCP-throttled run, real session drain lifetimes, zero D1 double-billing. | All canary metrics green before broad `delivery_mode = 'node_only'` rollout. |
| **PR 5: Plaintext Sunset & Trigger Migration** | Enforce minimum client versions (`503` on obsolete legacy clients), migrate `node_only` lines (one upstream rotation if `ever_served_plaintext_at` set), update `0080` D1 triggers to drain-ACK enforcement, remove client-side `socks5` secrets. | Clean steady state with zero residential secrets on client devices. |
