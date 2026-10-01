Both fixes merged through green CI. Combined current-main tests passed: **353 tests, zero failures**.

**65 hypotheses examined: 2 fixed, 8 duplicates, 55 false-positive/rejected hypotheses.** “Rejected” includes candidates without a proven harmful production path.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R4CORE-YAML-MAPPING-QUOTE | Mihomo config | P2 | config.rs:716 | Bracketed legacy node names break generated YAML | Fixed in [#1148](https://github.com/raydocs/tono/pull/1148) |
| R4CORE-SINGBOX-OPTIONAL-FINGERPRINT | sing-box | P1 | sing_box/runtime.rs:233 | Omitted optional fingerprint rejects valid catalog | Fixed in [#1157](https://github.com/raydocs/tono/pull/1157) |
| R4CORE-H01 | Policy | — | policy.rs:768 | Forged revision pins policy | Duplicate H3-F5/#342; signed ratchet repairs it |
| R4CORE-H02 | Catalog | — | catalog.rs:365 | Same revision rejects another account’s catalog | False positive; different validated digest installs |
| R4CORE-H03 | Routing | — | connection/switch.rs:225 | Transport switch retains UDP DIRECT fallback | Duplicate #783; transport change cold rebuilds |
| R4CORE-H04 | sing-box | P2 | sing_box/runtime.rs:271 | HY2 UDP misses residential TCP routing | Duplicate known WIN-HY2-HOME-UDP-LEAK limitation |
| R4CORE-H05 | Policy cache | — | policy.rs:902 | Concurrent writes collide | False positive; production writes serialized |
| R4CORE-H06 | Policy | — | policy.rs:304 | Trusted policy can route OpenAI DIRECT | False positive; complete AI suffix guard applies |
| R4CORE-H07 | Core preference | — | sing_box/flag.rs:45 | Large preference file exhausts memory | Rejected; no supported product writer/trigger proved |
| R4CORE-DNS01 | Windows DNS | — | windows_dns.rs:46 | Callback storage expires | Duplicate #828; callback retains Arc |
| R4CORE-DNS02 | Windows DNS | — | windows_dns.rs:131 | DNS cancellation hangs Connect | False positive; outer timeout and bounded cancellation |
| R4CORE-DNS03 | Browser DNS | — | browser_dns.rs:152 | Profile omission misses Secure DNS | False positive; setting lives in Local State |
| R4CORE-DNS04 | Browser DNS | — | browser_dns.rs:235 | Invalid preference overrides policy | False positive; managed policy wins |
| R4CORE-DNS05 | Signed apps | — | signed_apps.rs:723 | Writable installs receive directory grants | Duplicate #633/#634; DACL/exact-file guards |
| R4CORE-DNS06 | Signed apps | — | connection/monitor.rs:493 | Discovery stalls health monitor | False positive; separate blocking task |
| R4CORE-DNS07 | Plugin | — | stream.rs:153 | Pipe opening bypasses timeout | Rejected; inactive customer pipe path |
| R4CORE-DNS08 | Plugin | — | models.rs:10 | New enum values break parsing | False positive; operational enums preserve unknowns |
| R4CORE-DNS09 | Controller | — | models.rs:93 | `/configs` nullable TUN fails parsing | Rejected; latent mismatch has no active consumer |
| R4CORE-DNS10 | DNS | — | connection/direct.rs:1680 | sing-box DNS endpoint incompatible | False positive; pinned endpoint and answers match |
| R4CORE-DNS11 | Controller | — | mihomo.rs:813 | Selector/group API incompatible | False positive; pinned request/response shapes match |
| R4CORE-DNS12 | DNS | — | mihomo.rs:555 | Cache-flush endpoints missing | False positive; pinned core implements both |
| R4CORE-DNS13 | Controller | — | models.rs:723 | Delay history overflows u16 | False positive; upstream uses uint16 |
| R4CORE-DNS14 | Controller | — | connection/direct.rs:492 | Rules API breaks DIRECT verification | False positive; sing-box DIRECT currently disabled |
| R4CORE-DNS15 | Controller | — | models.rs:989 | Connection metadata rejects new types | False positive; unknown strings tolerated |
| R4CORE-DNS16 | HY2 | — | sing_box/runtime.rs:227 | DER/SPKI fields conflict or fail parsing | False positive; alpha.9 supports both |
| R4CORE-DNS17 | Routing | — | sing_box/runtime.rs:310 | Partial guard exposes AI through DIRECT | Rejected; affected DIRECT emitter inactive |
| R4CORE-DNS18 | DNS | — | sing_box/runtime.rs:359 | Real host answers break exact DIRECT matching | Rejected; affected DIRECT emitter inactive |
| R4CORE-DNS19 | DNS | — | runtime-template.json:6 | DoH bootstrap recursively deadlocks | False positive; exit and resolver addresses are literals |
| R4CORE-DNS20 | DNS | — | runtime-template.json:10 | AAAA escapes protected IPv4 path | False positive; empty AAAA response and IPv6 rejection |
| R4CORE-DNS21 | DNS | — | sing_box/runtime.rs:23 | Fake-IP pool fails Windows proof | False positive; pool lies inside accepted prefix |
| R4CORE-DNS22 | Residential | — | sing_box/runtime.rs:299 | SOCKS hop bypasses exit physically | False positive; explicit Tono-Exit detour |
| R4CORE-AUTH01 | Auth | — | auth.rs:1041 | Token and epoch captured separately | Rejected; no harmful outcome proved |
| R4CORE-AUTH02 | Auth | — | auth.rs:1499 | Repeated refreshes hang indefinitely | False positive; transport/owner deadlines apply |
| R4CORE-AUTH03 | Auth | — | auth.rs:1621 | Obsolete 401 suspends successor | Duplicate #990; successor bearer guard |
| R4CORE-AUTH04 | Auth | — | auth.rs:1621 | Pending refresh fails to neutralize replay 401 | False positive; deliberate tested conservative rule |
| R4CORE-AUTH05 | Credentials | — | auth.rs:1534 | Persistence failure loses rotated token | Duplicate #843/#980; retained durable-write retry |
| R4CORE-AUTH06 | Auth | — | auth.rs:991 | Adoption retains previous refresh token | False positive; tested optional preservation; producer supplies refresh |
| R4CORE-AUTH07 | Auth | — | auth.rs:1044 | Early renewal swallows refusal | False positive; refusal reported before outer handling |
| R4CORE-AUTH08 | Auth | — | auth.rs:1416 | Retired request mixes accounts | False positive; identity guards surround dispatch/replay |
| R4CORE-AUTH09 | Auth | — | auth.rs:1018 | Clock skew causes subtraction overflow | False positive; ordered positive operands |
| R4CORE-AUTH10 | Telemetry | — | auth.rs:675 | Unicode clipping violates Worker bounds | Rejected; production coreErrors absent |
| R4CORE-AUTH11 | Audit | — | audit.rs:313 | SignInFail leaks credentials locally | Rejected; no credential-bearing trigger proved; uploader redacts |
| R4CORE-AUTH12 | Evidence | — | local_evidence.rs:174 | Log-tail slicing panics on UTF-8 | False positive; newline/end boundaries |
| R4CORE-AUTH13 | Evidence | — | local_evidence.rs:223 | Hex slicing panics | False positive; ASCII/even-length guards |
| R4CORE-AUTH14 | Connectivity | — | protected_connectivity.rs:110 | Diagnostic hangs after failed proof | False positive; shared deadline and request timeout |
| R4CORE-AUTH15 | Customer failure | — | customer_failure.rs:302 | Poisoned DNS retargets authenticated client | False positive; original-authority TLS and address guards |
| R4CORE-AUTH16 | Auth | — | auth.rs:1317 | Upload ACK accepted without storage | False positive; unsuccessful storage receipts rejected |
| R4CORE-CTRL01 | Controller | — | connection/controller.rs:117 | Bearer authentication incompatible | False positive; pinned API matches |
| R4CORE-CTRL02 | Controller | — | connection/controller.rs:323 | Version response fails readiness | False positive; caller requires compatible 2xx |
| R4CORE-CTRL03 | Core selection | — | connection/core_select.rs:158 | Capability preflight hangs | False positive; 32-second IPC timeout |
| R4CORE-SB02 | sing-box | — | sing_box/runtime.rs:233 | Explicit non-Chrome unselected node aborts compilation | Rejected; producers emit Chrome; filtering needs contract decision |
| R4CORE-SB03 | sing-box | — | sing_box/runtime.rs:253 | Optional flow lost or changed | False positive; admitted absence/vision preserved |
| R4CORE-STATE01 | State | — | connection.rs:134 | Recovery counters overflow | False positive; finite budget bounds counters |
| R4CORE-STATE02 | Update contract | — | update_contract.rs:217 | Expiry subtraction underflows | False positive; timestamp ordering checked first |
| R4CORE-STATE03 | Update journal | — | update_journal.rs:79 | Expiry addition overflows startup | Rejected; no realistic supported clock trigger |
| R4CORE-STATE04 | Heal | — | connection/heal.rs:71 | Backup never seeds hysteresis | False positive; note_connected seeds it |
| R4CORE-STATE05 | Recovery | — | connection/unarmed_probe.rs:81 | Clock rollback stalls scheduling | False positive; production uses Instant |
| R4CORE-STATE06 | Update journal | — | update_journal.rs:213 | Legacy retirement bypasses native protection | False positive; native receipt independent |
| R4CORE-STATE07 | Recovery | — | recovery.rs:11 | Detached recovery mutates replacement session | False positive; ownership and generation guards |
| R4CORE-STATE08 | Heal | — | heal.rs:508 | Probe wins after deadline | Rejected; helper has no production caller |
| R4CORE-STATE09 | Disposition | — | network_disposition.rs:59 | Missing hook releases AI blocking | False positive; native release retains selective policy |
| R4CORE-STATE10 | Heal | — | heal.rs:229 | TLS timeout classified as QUIC | Duplicate grok-A12 report |
| R4CORE-STATE11 | Core selection | — | connection/stages.rs:205 | Resume presence substitutes for barrier truth | Rejected; no harmful routing/trust/outage path proved |
| R4CORE-STATE12 | Core selection | — | connection/core_select.rs:44 | App/service pin-file locations differ | Rejected; unsupported manual setup only |
| R4CORE-STATE13 | sing-box | — | sing_box/runtime.rs:212 | DER-only sibling bricks VLESS connection | False positive; unselected sibling omitted; regression passed |

Both **#1148 and #1157** have `needs-hardware`; merge auto-merge was enabled with **MERGE**, and both are merged.

All assigned source areas were reviewed. **Unfinished: real Windows DNS/TUN/WFP and installed-core hardware acceptance.** No verified unfixed findings.

[Full report with complete paths and evidence](/workspace/w1-codex/out/R4-CoreLib/final-report.md) · [findings.tsv](/workspace/w1-codex/out/R4-CoreLib/findings.tsv) · [prs.tsv](/workspace/w1-codex/out/R4-CoreLib/prs.tsv)