# RFC: Node-Side Residential SOCKS5 Dialing (`u:` / `h:` Dual Identity)

- Status: Proposed (Draft RFC — Revision 3 addressing Round-2 findings)
- Date: 2026-11-27
- Authors: Tono Engineering
- Target components: `services/control-plane`, `services/exit-agent`, `tooling/scripts/remote`, `apps/macos` (`Tono`, `tono-core-helper`), `apps/windows` (`tono-core`, `tono-service`), `apps/ios/TonoKit`, `apps/android/routing`

---

## 1. Problem Statement

Today, residential home egress (`home_exits.kind = 'socks5'`) is dialed directly from the customer's client device via a chained `sing-box` outbound:

1. `services/control-plane/src/catalog.ts` (`homeRoutingForUser`, lines 288–294) reads `home_exits.socks5_host`, `socks5_port`, `socks5_username`, and `socks5_password` from D1 and emits `routing.homeSocks5` inside the authenticated per-user catalog response, digested into `routingSha256` (`catalog.ts:331–340`). When an assigned exit is disabled or unavailable (`catalog.ts:281–285`), the Worker fails closed with `503 CATALOG_UNAVAILABLE` rather than returning a cloud-only catalog.
2. Desktop clients (`apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift`, `apps/macos/Tono/Core/ThreeTierRoutingContract.swift`, `apps/windows/crates/tono-core/src/config.rs`, `apps/windows/crates/tono-core/src/three_tier.rs`, `apps/windows/crates/tono-core/src/windows_kill_switch/strict.rs`, and `apps/windows/service/src/core/sing_box_runtime.rs`) build `HOME_SOCKS5_OUTBOUND_NAME = "Tono-Home-Residential"` as a `socks` outbound with `"detour": "Tono-Exit"` and `"network": "tcp"`. Mobile clients (`apps/ios/TonoKit/Sources/TonoKit/Catalog.swift:124–126` and `apps/android/routing/.../Catalog.kt:25–73`) similarly consume `routing.homeSocks5` and enforce their own `routingSha256` verification.
3. Every residential flow (AI domains, home DoH `Tono-AIHome-Home-DNS` in `tooling/scripts/sing-box/ai-home-template.json`, and `three-tier` residential rules) traverses:
   `Client -> Tono-Exit (VLESS-Reality or HY2) -> Exit VPS -> Client-originated SOCKS5 TCP CONNECT -> Residential IP`.

This causes three concrete operational and latency issues:

1. **Latency & Handshake Amplification**: Every residential TCP stream pays cross-border RTTs to establish TLS/QUIC to the exit node *plus* client-driven SOCKS5 greeting, auth, and `CONNECT` round-trips across the overseas link before the TCP handshake to the target host begins. Moving the SOCKS5 dialer to the exit VPS reduces residential connection setup to ~1–30 ms local VPS→SOCKS5 RTT.
2. **Upstream Credential Exposure & Rotation Lockout**: Because `socks5_username` and `socks5_password` sit on customer devices, `migrations/0080_home_socks5_rotation_required.sql` (D1 triggers on unbind/rebind/disable) and `services/control-plane/src/home.ts:340–360` (`assertHomeExitBindable`) set `socks5_rotation_required_at`, blocking re-assignment of the residential IP until an operator manually rotates the upstream password.
3. **Client-Side Coupling & Outbound Chaining Fragility**: Tunneling client-side SOCKS5 state machines over cross-border links amplifies tail stalls and couples residential egress tightly to client-side `detour` chains inside privileged validators (`ThreeTierRoutingContract.swift` compiled into `tono-core-helper` via `tooling/scripts/build-core-helper.sh`, and `apps/windows/service/src/core/sing_box_runtime.rs`).

---

## 2. Goals & Non-Goals

### Goals
- Move residential SOCKS5 TCP dialing onto verified exit VPS nodes (`Xray`).
- Keep `home_exits.socks5_username` and `socks5_password` strictly inside the control-plane → per-node in-memory `exit-agent` trust boundary (never sent to client apps, shared fleet tokens, or unencrypted disk caches).
- Require zero new client transport protocols while preserving `three-tier`, `ai-home`, and `Tono-AIHome-Home-DNS` routing guarantees.
- Guarantee **fail-closed routing** for `h:` residential identities without breaking existing static or hand-added `u:`/non-`u:` Xray clients: `h:` traffic must never reach datacenter `direct` (`freedom`) or residential-provider private/loopback/CGNAT IPs.
- Enforce verified per-tenant session draining on unbind (falling back fail-closed or requiring upstream rotation on timeout/offline nodes) so two accounts never overlap on the same residential IP.
- Unify exit metering across `u:` and `h:` without double-billing, and migrate all four client platforms (macOS, Windows, iOS, Android) atomically before sunsetting plaintext `homeSocks5`.

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
| Cloud egress (`u`) | General overseas (`Tono-Exit`) | `u:<user_id>:<device_id>:<gen>` | Existing `device_exit_credentials` / `exit_credentials` | Default `direct` (`freedom`) outbound (existing static/hand-added clients stay intact) |
| Home egress (`h`) | Bound residential (`Tono-Home-Residential`) | `h:<user_id>:<device_id>:<gen>` | New `device_home_credentials` table | Per-tenant dynamic outbound `home:<home_exit_id>:<binding_gen>` -> literal-CIDR private block + catch-all `home-blackhole` |

### 3.2 D1 Data Model & Identity Lifecycle
Introduce explicit D1 schema and state transitions in PR 1 (gated by PR 0):

1. **`device_home_credentials`**:
   - Columns: `id` (immutable generation UUID), `user_id`, `device_id`, `home_exit_id`, `client_uuid` (VLESS credential presented on wire), `created_at`, `acknowledged_at`, `retired_at`, `retire_reason`.
   - Constraint: unique active row (`retired_at IS NULL`) per `(device_id, home_exit_id)` scoped strictly to the user's current `user_home_bindings` row.
   - Transactional lifecycle: mint/bind inside the same D1 batch updating `user_home_bindings`; unbinding sets `retired_at` atomically.
2. **Per-line delivery mode, plaintext tracking, and drain state on `home_exits`**:
   - `delivery_mode TEXT NOT NULL DEFAULT 'legacy_socks5'` (`'legacy_socks5' | 'node_only'`).
   - `ever_served_plaintext_at INTEGER` (stamped whenever `routing.homeSocks5` is serialized to any client).
   - `drain_required_generation TEXT` + per-node drain table `home_exit_drain_acks(home_exit_id, retired_generation, node_id, drained_at)` tracking every exit node that admitted `h:` credentials for that generation.
3. **Assigned node replication (`home_exit_nodes` / active cloud exits)**:
   - Each active `home_exits` row is replicated **only** to active, `node-home`-capable VLESS exit nodes explicitly designated for residential hosting (or geographically matched tier stored on `home_exits`), and `homeOutbounds` delivered to node $N$ includes **only** lines referenced by `homeIdentities` admitted on $N$.
   - The client routing response (`routing.homeTunnel`) carries the explicit list of exit base names holding that user's ACKed `h:` generation (`exitBaseNames`), matching `selectAcknowledgedExitIdentity` readiness semantics so a user never dials a node lacking their `h:` outbound.

### 3.3 Client Contracts, Privileged Versioning & Fail-Closed `503` Policy
Because `ThreeTierRoutingContract.swift` is compiled into `tono-core-helper` (`tooling/scripts/build-core-helper.sh:43`) and Windows `tono-service` validates `three_tier` / `ai-home` graphs independently (`apps/windows/service/src/core/sing_box_runtime.rs`), client-side runtime changes **require** privileged contract updates:

1. **Privileged Contract Extension**:
   - Bump `HelperProtocolVersion` (macOS) and release updated Windows `tono-service` admitting `"Tono-Home-Residential"` as a `vless` selector / outbound (per-exit hidden `vless` outbounds `"Tono-Home-<ExitBase>"` pointing to catalog exit IPs, **NO `detour`**, `network: "tcp"`, never included in `Tono-Exit`) or a per-selected-exit recompiled `vless` outbound.
   - Ensure `apps/windows/crates/tono-core/src/windows_kill_switch/strict.rs:31–41` continues deriving WFP exit IP permits across all admitted VLESS exit endpoints (already satisfied when `"Tono-Home-<ExitBase>"` reuses catalog exit IPs; verify no wildcard/extra server is permitted).
   - **Recommended shape**: Per-node hidden `vless` outbounds `"Tono-Home-<ExitBase>"` inside selector `"Tono-Home-Residential"` synchronized with `Tono-Exit` selection so switching exit nodes does not leave residential traffic pinned to a stale server or require tearing down the privileged core.
   - **Phase A Trade-Off on TCP-throttled (`hy2` auto-switch) events**: When `Tono-Exit` switches from VLESS to ` · hy2`, `Tono-Home-Residential` stays VLESS-Reality TCP on healthy nodes (selecting a non-throttled exit node via its selector when needed). PR 4 benchmarks a TCP-throttled network scenario to validate cloud HY2 + residential VLESS stability.
2. **Strict Capability Gate (App + Core + Helper/Service)**:
   - Apps send `X-Tono-Accept: ..., node-home` **ONLY** when both app binary *and* installed privileged `tono-core-helper` / `tono-service` report `node-home` support.
   - Mobile clients (`apps/ios/TonoKit` and `apps/android/routing`) are unaffected until PR 3b ships matching `homeTunnel` + v2 digest support; `hy2AcceptHeaderForClient` (`services/control-plane/src/client-identity.ts:69–72`) remains scoped strictly to HY2 stripping.
3. **Explicit Fail-Closed `503` Responses (No Silent Cloud-Only Fallback)**:
   - Consistent with `services/control-plane/src/catalog.ts:281–285` (never silently stripping home routing into a cloud-only catalog), the Worker MUST return **HTTP `503 CATALOG_UNAVAILABLE`** with a `Retry-After` header in BOTH cases below:
     - A bound `node-home`-capable client on a `node_only` (or migrating) line when **zero** served exit nodes have ACKed its active `h:` credential generation yet;
     - A legacy client (without `node-home`) bound to a `home_exits` row with `delivery_mode = 'node_only'` (plaintext `homeSocks5` is never served for `node_only` lines, preventing header-downgrade credential leaks).
   - Control-plane unit tests MUST assert `503 CATALOG_UNAVAILABLE` + `Retry-After` for both cases.

### 3.4 Byte-Exact Catalog Routing Digest (`routingSha256` v2 Contract)
Legacy macOS (`Tono`), Windows (`apps/windows/crates/tono-core/src/catalog.rs:212–229`), iOS (`apps/ios/TonoKit/.../Catalog.swift`), and Android (`apps/android/routing/.../Catalog.kt`) reject any catalog whose `routingSha256` mismatches their fixed 3-field recipe (`SHA-256 base64url(unpadded)` over `"\n"`-joined `[homeProxy, defaultProxy, socks5]`):
- Requests without `node-home` continue receiving v1 `routingSha256` over the existing 3-field recipe.
- `node-home`-capable requests receive `routingDigestVersion: 2` and v2 `routingSha256 = base64url_unpadded(SHA256(utf8(preimage)))` with an exact **8-segment** `\n` (`0x0A`)-joined preimage:
  1. `"v2"` (literal ASCII version prefix)
  2. `routing?.homeProxy ?? ""`
  3. `routing?.defaultProxy ?? ""`
  4. `routing?.homeSocks5 ? routing.homeSocks5.host : ""`
  5. `routing?.homeSocks5 ? String(routing.homeSocks5.port) : ""` (base-10 ASCII integer, `1..65535`)
  6. `routing?.homeSocks5 ? routing.homeSocks5.username : ""`
  7. `routing?.homeSocks5 ? routing.homeSocks5.password : ""`
  8. `routing?.homeTunnel ? [homeTunnel.homeExitId, homeTunnel.clientUuid, [...new Set(homeTunnel.exitBaseNames)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(",")].join("\u001f") : ""`
- **Canonicalization invariants**:
  - `homeTunnel` subfields join with ASCII Unit Separator (`0x1F`); `exitBaseNames` are deduplicated, sorted strictly by UTF-8 byte / Unicode codepoint order, and joined with `,` (`0x2C`).
  - Admission/encoding MUST reject `\n` (`0x0A`) or `\u001f` (`0x1F`) in any field, and `,` (`0x2C`) inside any `exitBaseNames` item.
  - When `routing` is absent (`undefined`), all 7 payload fields are empty `""` (`"v2\n\n\n\n\n\n\n"`).
- **Mandatory Shared Test Vectors**: Commit `tooling/scripts/tests/fixtures/routing-digest-v2-vectors.json` covering absent routing, empty `homeTunnel`, sorted multi-node non-ASCII UTF-8 `exitBaseNames` (`"Los Angeles · Mesa"`), empty `exitBaseNames`, rotation of `clientUuid`, and mixed `homeProxy`/`homeTunnel`. TypeScript, Swift (macOS & iOS), Kotlin (Android), and Rust test suites MUST all assert identical digests against these shared vectors before PR 1 / PR 3b merge.

---

## 4. Exit-Node Reconciliation, Fail-Closed Topology, and Outage Bounds

### 4.1 Scoped Pull Payload (`homeIdentities` & `homeOutbounds` Separation)
Current `GET /api/v1/home/exit-identities` (`services/control-plane/src/exit-identity-roster.ts:25–50`) returns `{ nodeId, observedAt, retireSharedLegacy, sourceUsageWatermarks, identities }`. Older `parse_roster` implementations (`services/exit-agent/reconcile_and_report.py:598–680`) ignore unknown fields inside `identities` rows (which today carry no `kind` field) and emit `u:` for every row, while `/api/v1/ops-ingest/node-clients` reuses the same roster helper and `authenticateExitNode(req, e, true)` accepts the fleet-wide `HOME_AGENT_TOKEN` when `exit_credential_rollout` is `'dual'`.

1. **Separate Top-Level Keys**: Keep `identities` strictly `u:`-only with no `kind` field and unchanged shape. Deliver residential credentials solely under new top-level keys `homeIdentities` and `homeOutbounds` so un-upgraded agents and `/api/v1/ops-ingest/node-clients` never see or mis-install `h:` UUIDs.
2. **Strict Server-Side Scoping & Token Gate**:
   - Require `exit_credential_rollout.phase === 'device_only'` globally before enabling `node-home`.
   - `homeIdentities` and `homeOutbounds` are populated **ONLY** when `authenticateExitNode` validates a **per-node token yielding non-null `nodeId`** AND the node has declared `node-home` + verified `xrayVersion` capability (never under `HOME_AGENT_TOKEN` or ops collector paths).
   - `homeOutbounds` includes **ONLY** `status = 'active'` residential lines bound to accounts in that node's `homeIdentities`.
   - Every response carrying `homeOutbounds` is audit-logged (`node_id`, `observed_at`, `home_exit_ids`). Temporary `ado` JSON files live exclusively inside a root/service-owned `0700` directory with `0600` permissions and `try/finally` unlinking.
3. **Cache Exclusion & Fail-Closed Outage TTL**:
   - Bump `ROSTER_CACHE_VERSION` (`reconcile_and_report.py`).
   - **Plaintext SOCKS5 exclusion**: `roster_cache_path` (`reconcile_and_report.py:838`) MUST NEVER persist `homeOutbounds` (username/password/host/port) to disk — outbound credentials exist only in `exit-agent` memory and transient `0600` `ado` staging files.
   - Cloud `u:` identities keep the existing outage recovery cache, whereas **`h:` identities MUST fail closed during extended outages or Xray restarts**:
     - Cached `homeIdentities` carry a short signed/monotonic lease (`MAX_HOME_OUTAGE_LEASE_SEC <= 300s`). Once expired, or on `tono-xray` restart (where in-memory `homeOutbounds` and dynamic rules are lost), `exit-agent` guarantees zero `h:` clients remain active without fresh control-plane verification.

### 4.2 Safe Xray Topology Without Breaking Existing `u:` / Static / Hand-Added Clients
Provisioned exit nodes extract **only** the `xray` binary (`tooling/scripts/provision-reality-node.rb:215`, `tooling/scripts/provision-tono-node.py`) and do **not** ship `geoip.dat` — so rules referencing `geoip:private` would crash `tono-xray` startup! Furthermore, defaulting the entire node to `blackhole` unless `^u:` or `shared-legacy` matches would break existing static client emails (`exit_metering_config.py:145`, e.g. `user-42`) and hand-added non-`u:` clients that `reconcile` (`reconcile_and_report.py:1232–1238`) deliberately leaves untouched.

Instead, `exit_metering_config.py` preserves existing non-`h:` clients while making **`^h:` strictly default-deny**:

1. **Outbounds (`config.json`)**:
   - Keep `direct` (`freedom`) as Index `0` outbound so all `u:`, `shared-legacy`, static, and hand-added clients continue functioning identically.
   - Add `{ "tag": "home-blackhole", "protocol": "blackhole" }` in static `config.json`.
2. **Static `config.json` Rules (always active immediately on Xray boot)**:
   - Rule #1: `{ "type": "field", "inboundTag": ["api"], "outboundTag": "api" }`
   - Rule #2 (Literal Private/SSRF Guard — **NO `geoip.dat` dependency**):
     ```json
     {
       "type": "field",
       "user": ["regexp:^h:"],
       "ip": [
         "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
         "127.0.0.0/8", "169.254.0.0/16", "100.64.0.0/10",
         "fc00::/7", "fe80::/10", "::1/128"
       ],
       "outboundTag": "home-blackhole"
     }
     ```
     (Exact CIDR scope aligned with `manage-tono-hy2-node.sh:831–838` plus CGNAT `100.64.0.0/10`; blocks literal private IPs, while remote domain resolution occurs on the residential SOCKS5 proxy.)
   - Rule #3 (Catch-All Static Fail-Closed Guard): `{ "type": "field", "user": ["regexp:^h:"], "outboundTag": "home-blackhole" }` — ensures that after any Xray restart (when dynamic rules and dynamic outbounds are absent), every `h:` identity immediately hits `home-blackhole`.
3. **Atomic Full-Rule-List Replacement in Runtime (`ReloadRules` / replace-all)**:
   - Because appending dynamic rules after static Rule #3 would shadow per-line `h:` routes, `exit-agent` MUST **never append**: on every topology sync it pushes the complete ordered rule list via `RoutingService` replace-all (`adr` / `AddRule(shouldAppend=false)`):
     1. `[API -> api]`
     2. `[user: regexp:^h: + private CIDRs -> home-blackhole]`
     3. `[Per-line dynamic rules: user: [h_label...] -> home:<home_exit_id>:<binding_gen>]`
     4. `[Catch-all fail-closed guard: user: regexp:^h: -> home-blackhole]`
   - Combined with NEVER writing `h:` clients into static `config.json` (while per-tenant `home:...` outbounds exist only in memory via `ado`), zero `h:` traffic can ever reach `direct` (`freedom`) during normal operation, live mutations, rule failures, or restarts.
4. **Why Option B ("template reload") stays rejected**: Modifying static `config.json` requires restarting `tono-xray`, dropping all live API-added `u:` and `h:` clients for a few seconds (`Decision 140`) plus up to one reconcile interval (~60s) and placing plaintext residential secrets on disk.
5. **Mandatory PR 0 Verification Gate (Before PR 1)**:
   - Verify against **BOTH** `Xray 26.3.27` (rolled-back nodes) and `Xray v26.11.9` (`provision-tono-node.py:13`, `provision-reality-node.rb:16`):
     1. Whether `RoutingService` `ReloadRules` (`shouldAppend=false` via `xray api` CLI or stdlib HTTP/2-gRPC) atomically replaces the entire rule table without restarting `tono-xray` or dropping connections;
     2. `HandlerService` `ado` / `rmo` and whether `rmo` cancels established TCP/HTTP2/SSE connections bound to the removed outbound tag (feeding directly into Section 7.1);
     3. Whether `xray api` exposes a `TestRoute` CLI subcommand or if `exit-agent` needs a stdlib gRPC/HTTP2 client for `TestRoute` / deterministic rule-digest verification;
     4. Literal CIDR + `user: ["regexp:^h:"]` matching and `"routing": { "domainStrategy": "AsIs" }` enforcement without `geoip.dat`.
   - `exit-agent` refuses advertising `node-home` on any unverified `xray version`.

### 4.3 Mandatory Add/Remove Ordering
1. Validate referenced `homeOutbounds` (`status == 'active'`, valid host, port `1..65535`, non-empty username/password).
2. Add missing dynamic `home:<home_exit_id>:<binding_gen>` `socks` outbound via `ado`.
3. Atomically replace the Xray rule list so `[API -> api, h:+privateCIDRs -> home-blackhole, per-line h: -> home:<id>:<binding_gen>, regexp:^h: -> home-blackhole]` is active.
4. Run PR0-verified route assertion (`TestRoute` via CLI or stdlib gRPC) confirming `h_label` resolves to `home:<id>:<binding_gen>` and private CIDRs resolve to `home-blackhole`.
5. **Only after (2)–(4) pass**, call `adu` to install `h_label`. If any prerequisite fails, refuse `h_label` (and `rmu` if present).
6. On unbind/revocation/expiry: **First** `rmu` `h_label`, **Second** atomically replace rules omitting `h_label`, **Last** `rmo` `home:<id>:<binding_gen>` once zero active `h:` clients target it.

### 4.4 Enforced DNS Integrity
- `exit_metering_config.py` enforces `"routing": { "domainStrategy": "AsIs" }` and disables traffic sniffing overrides on `node-home` inbounds.
- Domain targets pass verbatim in SOCKS5 `CONNECT` (`ATYP = 0x03`), and `Tono-AIHome-Home-DNS` continues tunneling DoH queries through `Tono-Home-Residential` -> `home:<home_exit_id>:<binding_gen>`.
- **PR 4 Acceptance Gate**: Packet capture (`tcpdump -i any udp port 53 or tcp port 53`) on the canary exit VPS during AI fetches proves zero DNS queries leave the VPS resolver/NIC directly.

---

## 5. Hysteria 2 (`tono-hy2`) Compatibility

- **Phase A (This RFC)**:
  - `sync_hy2_roster` (`services/exit-agent/reconcile_and_report.py:1636–1660`) reads **only** `identities` (which remains `u:`-only) and explicitly refuses any unexpected residential namespace marker, ensuring `/opt/tono-hy2/auth-allow.sha256` never admits `h:` credentials.
  - `Tono-Home-Residential` (`h:`) remains strictly VLESS-Reality TCP on `Xray`, preventing datacenter leaks through `tono-hy2`.
- **Phase B (Future Optional Only)**:
  - Strictly blocked on first shipping per-user `tono-hy2` metering (currently HY2 is unmetered) and per-identity outbound ACL isolation.

---

## 6. Unified Metering, Atomic Cutover, and Safe Agent Rollback

1. **Identity & Parser Atomicity**:
   - Extend `client_label`, `attributed_user` (`reconcile_and_report.py:361–372`), `reconcile` inventory/removal filtering (`:1232–1238`, so `reconcile` revokes stale `h:` labels identically to `u:` rather than treating them as hand-added), and `aggregate_user_totals` in **the exact same PR (PR 2)**.
   - Control plane never issues `h:` credentials until the serving node's `exit-agent` reports `meteringProtocolVersion >= 3` (`u:` + `h:` capable).
2. **Anti-Double-Billing Invariant**:
   - Capable clients remove `"detour": "Tono-Exit"` on `Tono-Home-Residential`. Cloud traffic increments `user>>>u:...`; residential traffic increments `user>>>h:...`. Zero flow crosses both counters.
3. **Watermark Recovery Caveat**:
   - Because `adopt_source_watermarks` (`reconcile_and_report.py:1371–1411`) assigns source-level recovery watermarks to the first label in sorted order (`"h:"` sorts before `"u:"`), combined user totals (`u: + h:`) stay exact, while any future separate `{ cloudBytes, homeBytes }` split MUST track distinct per-bucket watermarks.
4. **Safe PR 2 Rollback**:
   - Old agents do not touch non-`u:` labels (`attributed_user` `:361–372`, `reconcile` `:1232–1238`). Before downgrading `exit-agent`, run control-plane `withdrawHome = true` / agent `--withdraw-home` (`rmu(h:*) -> replace rules -> rmo(home:*)`) OR restart `tono-xray` (taking a few seconds per `Decision 140`, clearing all dynamic `h:` clients/rules/outbounds).

---

## 7. Session Drain on Unbind & `socks5_rotation_required_at` Sunset

### 7.1 Single-Mechanism Drain Protocol & Bounded Fail-Closed Timeout
Because `rmu` only stops new handshakes while open HTTP/2, WebSocket, and SSE streams persist, immediate rebinding to customer B would let A share B's residential IP.

**Concrete Drain Protocol (NO restart-heavy fallback inside Section 7)**:
1. When user A is unbound on a `node_only` line, D1 marks A's `h:` credentials `retired` and advances `home_exits.drain_required_generation = <binding_gen_A>`. While any node in `home_exit_drain_acks` matching `binding_gen_A` remains un-ACKed, **`home_exits` stays fail-closed unavailable for rebinding (`assertHomeExitBindable` rejects rebind with `409 HOME_EXIT_DRAINING`)**.
2. Holding exit nodes run ONLY **per-tenant ephemeral outbound teardown**: isolate each tenant binding onto outbound tag `home:<home_exit_id>:<binding_gen_A>`, call `rmu(h_A)` -> replace rules omitting `h_A` -> `rmo("home:<home_exit_id>:<binding_gen_A>")` -> post ACK to `home_exit_drain_acks`.
   - **PR 0 Prerequisite Gate**: PR 0 explicitly verifies on both Xray `26.3.27` and `v26.11.9` whether `rmo` immediately terminates established outbound TCP streams holding tag `home:<home_exit_id>:<binding_gen_A>`. If either Xray version leaves established streams open after `rmo`, Section 7 does **NOT** fall back to restarting `tono-xray` (which drops unrelated `u:` users); instead, unbind continues requiring upstream password rotation until a verified per-tenant Xray stream-cancellation primitive is shipped.
3. **Bounded `DRAIN_ACK_TIMEOUT_SEC` (Offline/Stuck Node Rule)**:
   - Measure real residential session lifetimes in PR 4 to tune `DRAIN_ACK_TIMEOUT_SEC` (e.g. `120s` after unbind).
   - If a holding node is offline or fails to ACK past `DRAIN_ACK_TIMEOUT_SEC`, the line remains **strictly fail-closed (unavailable for rebinding)** indefinitely — timed-out nodes NEVER auto-clear drain! Rebinding a stuck line requires an explicit operator **upstream password rotation** (`socks5_rotation_required_at` clearance).

### 7.2 Sunset of Plaintext `homeSocks5` & `migrations/0080` Triggers
1. Throughout PR 1–PR 4, `migrations/0080_home_socks5_rotation_required.sql` triggers stay active for any line with `delivery_mode = 'legacy_socks5'` OR `ever_served_plaintext_at IS NOT NULL`.
2. Flipping a line to `delivery_mode = 'node_only'` immediately stops emitting `routing.homeSocks5` regardless of client `X-Tono-Accept` headers (blocking header-downgrade credential extraction; legacy clients receive `503 CATALOG_UNAVAILABLE` + `Retry-After`).
3. Once desktop (`macOS`/`Windows` + helpers/services) **AND mobile (`apps/ios/TonoKit/Sources/TonoKit/Catalog.swift:124–126` & `apps/android/routing/.../Catalog.kt:25–73`)** have shipped PR 3 / PR 3b:
   - Rotate upstream residential passwords once for every line with `ever_served_plaintext_at IS NOT NULL` and clear `ever_served_plaintext_at`;
   - Land a reviewed migration (verified by `tooling/scripts/check-migrations-additive.mjs`) updating the `0080` D1 triggers so `node_only` lines require `home_exit_drain_acks` clearance (or explicit manual rotation override) rather than `socks5_rotation_required_at`;
   - Enforce minimum supported client versions with `503 CATALOG_UNAVAILABLE` for obsolete clients.

---

## 8. Staged Implementation Roadmap

| Stage | Scope | Entry Gate / Verification |
| :--- | :--- | :--- |
| **PR 0: Xray `26.3.27` & `v26.11.9` Capabilities Probe** | Non-prod script verifying on **both** `26.3.27` and `v26.11.9`: replace-all `ReloadRules` ordering, `HandlerService` `ado`/`rmo` active-stream cancellation on `rmo`, literal CIDR + `regexp:^h:` rule matching (without `geoip.dat`), `domainStrategy: "AsIs"`, and `TestRoute` CLI vs stdlib HTTP/2-gRPC availability. | Mandatory gate **before PR 1** finalizes D1/RPC/drain design. |
| **PR 1: Control Plane, D1 Schema & `routingSha256` v2 Vectors** | Add `device_home_credentials`, `home_exit_drain_acks`, `delivery_mode` / `ever_served_plaintext_at`, `homeIdentities` & scoped `homeOutbounds` (per-node `nodeId` + `device_only` only), explicit `503` unready/downgrade tests, `routing-digest-v2-vectors.json` + TS digest v2. | Legacy `homeSocks5` stays default; Vitest + D1 additive/idempotent migration checks. |
| **PR 2: Exit Agent & `exit_metering_config.py`** | Literal-CIDR + catch-all `^h: -> home-blackhole` static config transform, `AsIs` DNS enforcement, memory-only `homeOutbounds` (`0700`/`0600` `ado` dir, never cached on disk), atomic full-rule-list replace + route verification, fail-closed `h:` outage lease, `identities`-only HY2 isolation, unified `u:`/`h:` metering & `--withdraw-home` rollback. | Agent tests + canary rehearsal on `Los Angeles · Mesa` with test account. |
| **PR 3: Desktop Apps + Helper/Service Contracts + Rust Vectors** | Bump `HelperProtocolVersion` (`ThreeTierRoutingContract.swift`) + Windows `tono-service` (`three_tier.rs`, `sing_box_runtime.rs`, verifying `windows_kill_switch/strict.rs:31–41`); advertise `node-home` only when helper/service agrees; pass shared `routing-digest-v2-vectors.json` in Swift & Rust. | Hosted `ci-gate` (`macos` privileged/unit tests, `windows` `core`/`service` tests). |
| **PR 3b: Mobile (`apps/ios/TonoKit` & `apps/android/routing`)** | Support `homeTunnel`, `routingSha256` v2 (verified against shared `routing-digest-v2-vectors.json`), and `node-home` header across iOS (`Catalog.swift`) and Android (`Catalog.kt`) before any plaintext sunset. | `TonoKit` + Android `routing` unit suites. |
| **PR 4: Canary & Full E2E Proof** | Verify on canary node + test accounts: RTT improvement, zero VPS DNS leaks (`tcpdump`), forced outbound/rule fault -> `home-blackhole` fail-closed, cloud HY2 + AI VLESS concurrency & TCP-throttled run, real session drain lifetimes, zero D1 double-billing. | All canary metrics green before broad `delivery_mode = 'node_only'` rollout. |
| **PR 5: Plaintext Sunset & `0080` Trigger Migration** | Enforce minimum client versions (`503 CATALOG_UNAVAILABLE` on legacy clients), rotate `ever_served_plaintext_at` lines once upon switching to `node_only`, update `0080` D1 triggers to drain-ACK + timeout fail-closed enforcement. | Zero residential SOCKS5 secrets ever leave control-plane + node-agent boundary. |
