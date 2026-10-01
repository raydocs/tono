# R3-A11 audit report — GPT-6.1 Sol (Codex CLI)

Baseline: `origin/main` `7c16960c`, branch `hunt/sol-r3gen-a11-audit`, September 30, 2026. No new verified ordinary-user bug and no source changes or PRs. Dedupe included all open PR titles/bodies touching assigned files, findings ledger/fragments, and open issues. Final PR-list refresh showed only blocked migration #203 touching the assigned files.

All assigned files were read end to end: `config.rs` (2,957 lines), `node.rs` (1,392), `sing_box.rs` (728), `sing_box/flag.rs` (104), `sing_box/runtime.rs` (768), and `connection_plan.rs` (213). Callers/callees followed through catalog/policy admission, staging, DIRECT, controller selection, healing, cleanup, owner sessions, Service WFP/DNS and the pinned Mihomo source.

Windows production still builds Mihomo YAML (`connection/stages.rs:202`, `connection/direct.rs:535`). The sing-box compiler and local migration flag have no production callers. Dormant versions of known defects were not fixed or reported as new production bugs.

| ID | Area | Severity | File:line | One-line description | Verdict |
|---|---|---|---|---|---|
| A11-H01 | sing-box | — | apps/windows/crates/tono-core/src/sing_box/runtime.rs:274 | No-home process DIRECT could precede AI protection | duplicate #871; dormant compiler has no production callers |
| A11-H02 | sing-box | — | apps/windows/crates/tono-core/src/sing_box/runtime.rs:275 | HY2 assistant UDP bypasses residential TCP route | duplicate #783; dormant gap already recorded |
| A11-H03 | sing-box | — | apps/windows/crates/tono-core/src/sing_box/runtime.rs:203 | Stock core rejects emitted DER certificate pin field | duplicate #203 migration blocker; dormant compiler |
| A11-H04 | sing-box | — | apps/windows/crates/tono-core/src/sing_box/runtime.rs:324 | Domain and IP DIRECT conditions might use OR | false-positive explicit logical AND |
| A11-H05 | sing-box | — | apps/windows/crates/tono-core/src/sing_box/runtime.rs:396 | Controller DNS might receive stale pinned or fake IP | false-positive pin/fake-IP rules are inbound-scoped; controller uses exit DoH |
| A11-H06 | sing-box | — | apps/windows/crates/tono-core/src/sing_box/runtime.rs:244 | Selected/home transport sockets might enter TUN | false-positive both endpoint exclusions emitted; SOCKS intentionally detours through exit |
| A11-H07 | sing-box | — | apps/windows/crates/tono-core/src/sing_box/runtime.rs:177 | Forged ValidatedNode might bypass admission | false-positive all nodes readmitted and compared |
| A11-H08 | sing-box | — | apps/windows/crates/tono-core/src/sing_box/runtime.rs:96 | Unicode certificate pin might panic in byte slicing | false-positive ASCII hexadecimal plus 64-byte length checked first |
| A11-H09 | sing-box flag | — | apps/windows/crates/tono-core/src/sing_box/flag.rs:20 | Local flag might silently enable unqualified runtime | false-positive no production callers; corrupt and foreign records remain disabled |
| A11-H10 | sing-box | — | apps/windows/crates/tono-core/src/sing_box/runtime.rs:130 | Empty capabilities might bypass caller trust boundary | false-positive owner-admitted compiler API; not trust admission |
| A11-H11 | config | — | apps/windows/crates/tono-core/src/config.rs:1135 | Signed-app DIRECT might win over AI domains/IPs | duplicate #871; current main emits AI guards before signed-app DIRECT |
| A11-H12 | config | — | apps/windows/crates/tono-core/src/config.rs:1080 | HY2 UDP might miss required home route | duplicate #783; current main rejects matching assistant UDP before DIRECT and MATCH |
| A11-H13 | config | — | apps/windows/crates/tono-core/src/config.rs:958 | Client-chosen TLS SNI might direct arbitrary raw destination | false-positive parse-pure-ip explicitly false with address-free suffix rules |
| A11-H14 | config | — | apps/windows/crates/tono-core/src/config.rs:996 | DoH bootstrap might recurse through exit selector | false-positive resolver and catalog node servers are IPv4 literals; explicit exit selection |
| A11-H15 | config | — | apps/windows/crates/tono-core/src/config.rs:920 | Real host pins might lose metadata and miss exact DIRECT rules | false-positive pinned Mihomo hosts middleware stores real IP-to-host mapping before fake IP |
| A11-H16 | config | — | apps/windows/crates/tono-core/src/config.rs:663 | Home node socket might lack route exclusion | false-positive selected and distinct home IPv4 addresses excluded; SOCKS stays chained |
| A11-H17 | config | — | apps/windows/crates/tono-core/src/config.rs:718 | Windows path regex flow indicators might break YAML | false-positive serializer postprocess quotes affected sequence scalars, including redacted copy |
| A11-H18 | config | — | apps/windows/crates/tono-core/src/config.rs:1250 | VLESS UDP might fall back to DIRECT | false-positive explicit UDP REJECT precedes MATCH; selected HY2 alone omits floor |
| A11-H19 | config | — | apps/windows/crates/tono-core/src/config.rs:640 | Invalid required residential hop might silently use cloud exit | false-positive validate_residential_routing rejects before runtime construction |
| A11-H20 | node | — | apps/windows/crates/tono-core/src/node.rs:189 | Unicode names might panic in suffix/base-name parsing | false-positive UTF-8-safe ends_with/strip_suffix; controller names JSON-serialized |
| A11-H21 | node | — | apps/windows/crates/tono-core/src/node.rs:339 | IPv6/hostname/percent-encoded endpoint might misroute bootstrap | false-positive public-IPv4-only catalog contract rejects these forms |
| A11-H22 | node | — | apps/windows/crates/tono-core/src/node.rs:216 | Invalid ports might crash or truncate | false-positive u16 decoding rejects overflow; zero explicitly rejected |
| A11-H23 | node | — | apps/windows/crates/tono-core/src/node.rs:181 | HY2 protocol might disagree with suffix-derived transport | duplicate accepted-design D6; Worker rejects mismatch |
| A11-H24 | node | — | apps/windows/crates/tono-core/src/node.rs:347 | Missing Reality fingerprint might break connection | duplicate PERF-CONNECT-1; config proxy_mapping supplies chrome |
| A11-H25 | node | — | apps/windows/crates/tono-core/src/node.rs:143 | HY2 option mapping might drop or change certificate pin | false-positive required DER fingerprint retained; pinned verifier hashes leaf cert.Raw |
| A11-H26 | node | — | apps/windows/crates/tono-core/src/node.rs:150 | Omitting VLESS UDP capability might break required transport | false-positive generic VLESS UDP deliberately rejected; HY2 separately enables UDP |
| A11-H27 | node | — | apps/windows/crates/tono-core/src/node.rs:134 | Omitted HY2 ALPN/keepalive options might break connection defaults | false-positive pinned client supplies h3 and QUIC defaults; shorter keepalive known HY2-IDLE-MIHOMO |
| A11-H28 | node | — | apps/windows/crates/tono-core/src/node.rs:370 | UUID canonicalization might alter HY2 password | false-positive ordinary Worker and exit-agent rosters use canonical lowercase UUIDs |
| A11-H29 | node | — | apps/windows/crates/tono-core/src/node.rs:453 | Post-collection node cap might permit machine exhaustion | false-positive catalog rejects YAML over 1 MiB before parsing |
| A11-H30 | node/provisioning | — | tooling/scripts/provision-reality-node.rb:61 | Unicode provision label can exceed client UTF-8 byte cap | false-positive for requested reachability: requires administrator selecting long name; no ordinary failure path or current fleet trigger proved |
| A11-H31 | connection plan | — | apps/windows/app/src-tauri/src/tono/connection_plan.rs:88 | Strict initial failure might release protection | false-positive current Windows caller always passes false and production intent constructors write strict=false |
| A11-H32 | connection plan | — | apps/windows/app/src-tauri/src/tono/connection_plan.rs:15 | Lost StartClash response might bypass stale-arm cleanup | false-positive changed Service generation reconciles a single lost response; unresolved ambiguity needs second status failure |
| A11-H33 | connection plan | — | apps/windows/app/src-tauri/src/tono/connection_plan.rs:164 | Single-flight admission might start during Disconnect | false-positive begin_attempt checks disconnect under lock; generation and lifecycle gates prevent overtake |
| A11-H34 | connection plan | — | apps/windows/app/src-tauri/src/tono/connection.rs:684 | Pre-arm failure might remove previous recovery AI hold | false-positive requires live App Service session; Service stop transition also returns before disarm when unarmed |
| A11-H35 | config/policy | — | apps/windows/crates/tono-core/src/config.rs:1222 | Trusted DIRECT policy might insert protected AI host or parent suffix | duplicate #797 protected overlap guards |
| A11-H36 | config | — | apps/windows/crates/tono-core/src/config.rs:1159 | Malformed DIRECT host or path regex might inject runtime rule | false-positive policy validates DNS labels; production regex builder escapes delimiters and bounds patterns |
| A11-H37 | connection plan | — | apps/windows/app/src-tauri/src/tono/connection/cleanup.rs:145 | Automatic timeout late-commit cleanup might remove AI hold | false-positive single delayed StartClash is bounded below 310s transaction; compound-delay or sleep/wake variant remains unverified |
| A11-H38 | config DNS | — | apps/windows/crates/tono-core/src/config.rs:996 | DoH might follow China DIRECT rule | false-positive explicit #Tono-Exit proxy suffix bypasses upstream rule routing |
| A11-H39 | config sniffing | — | apps/windows/crates/tono-core/src/config.rs:959 | Sniffed host might bypass exact pinned address | false-positive override-destination=false retains original address; exact rule ANDs host and address |
| A11-H40 | config DNS | — | apps/windows/crates/tono-core/src/config.rs:982 | DIRECT reload might discard fake-IP map | false-positive pinned Mihomo executor PatchFrom preserves fake-IP and real-host mappings |
| A11-H41 | config DNS | — | apps/windows/crates/tono-core/src/config.rs:982 | Fake-IP recovery TTL might be ignored | false-positive pinned Mihomo DNS middleware writes configured TTL |
| A11-H42 | config IPv6 | — | apps/windows/crates/tono-core/src/config.rs:861 | IPv6 defaults might create unreviewed TUN plane | false-positive ipv6=false clears upstream default TUN IPv6 addresses and fake IPv6 pool |

## PRs and counts

- PRs opened: none; auto-merge and labels: not applicable. `prs.tsv` is empty.
- Total hypotheses examined: **42**. False positives/rejected hypotheses: **34**. Known duplicates/accepted design: **8**. New verified bugs: **0**.
- Findings receipt: `findings.tsv`, one line per hypothesis. Source worktree is clean.

## Verification

Linux, Rust 1.98.1, baseline 7c16960c: `CARGO_BUILD_JOBS=2 cargo test -p tono-core --locked` passed. Raw suite receipts: `329 passed; 0 failed` unit; integration suites `10 passed`, `1 passed`, `1 passed`, `3 passed`. Total **344 executed tests, zero failures, zero ignored tests**. Doc-test runner had zero tests and is not additional qualification. Existing dead-code warning for `SING_BOX_FAKE_IPV4` remains.

No new tests were added because no new bug was verified. Native Windows/Tauri, installed WFP/DNS/TUN, actual crash, sleep/wake and transport behavior could not run in this Linux VM.

Pinned upstream source `ac017cdd246ce8bd547653d927e7bf77d7ee73d5` was read to verify DNS/host-map preservation, fake-IP TTL, explicit resolver proxy routing and transport mapping. Evidence retained at `/tmp/R3-A11-mihomo-source`; primary references: [DNS middleware](https://github.com/MetaCubeX/mihomo/blob/ac017cdd246ce8bd547653d927e7bf77d7ee73d5/dns/middleware.go), [DNS dialer](https://github.com/MetaCubeX/mihomo/blob/ac017cdd246ce8bd547653d927e7bf77d7ee73d5/tunnel/dns_dialer.go), [reload mapping preservation](https://github.com/MetaCubeX/mihomo/blob/ac017cdd246ce8bd547653d927e7bf77d7ee73d5/hub/executor/executor.go), [DER verifier](https://github.com/MetaCubeX/mihomo/blob/ac017cdd246ce8bd547653d927e7bf77d7ee73d5/component/ca/fingerprint.go).

## Remaining limits

Assigned static scope finished. Native-device qualification remains unavailable. The compound-delay or sleep/wake version of H37 was not proved: a hypothetical automatic transaction timeout followed by a successful late startup uses plain release in `cleanup.rs:145`, but a single delayed StartClash is externally bounded below the 310-second total deadline. Changing that release unconditionally would also recreate an AI hold after explicit Restore; any later fix must preserve the retirement cause. This is an unverified follow-up, not a new verified finding or product decision.

The administrator-selected Unicode provisioning-name candidate H30 lies outside ordinary-user/failure reachability and the assigned fix scope; no fleet occurrence was proved. Client byte bounds remain intact.

Hunter: GPT-6.1 Sol (Codex CLI)
