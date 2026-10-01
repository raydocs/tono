# codex-coverage (Codex account 2 slots; mirrored from the orchestrator COVERAGE.md on the box)

## Codex acct-2 coverage (Sol, executor)
| Slot | Areas covered | Model | State | Gaps | PRs |
|---|---|---|---|---|---|
| W1-sol-cp | C5, C6, C7a, C7b, C8 (all 83 migrations), C9 | Sol (Codex acct 2) | finished 19:51 MT | unfinished: C9 CSS/SVG styling; 6 real-unfixed need product decisions (home paste password, onboarding role, profile port, 3 legacy admin UI) | PRs: #821 #832 #839 #865 #883 #890 #903 #918 #924 #931 #938 #947 |
| W2-sol-leftovers | M14, O1, T4, A13 (plugin-core, logger) | Sol (Codex acct 2) | finished 20:05 MT | unfinished: none reported; 7 real-unfixed (see report) | PRs: #818 #823 #825 #834 #848 #869 #880 #892 #915 #957 #965 #968 #969 |
| W1-sol-win-app | A1, A5 (rest), A8, A9, A10 | Sol (Codex acct 2) | finished 20:33 MT | unfinished: none; 1 decision item (DIRECT auto-health recovery) | PRs: #820 #828 #898 #916 #932 #951 #980 #984 |
| W1-sol-win-trust | W6, W8, A7, A12, A13 (authenticode) | Sol (Codex acct 2) | finished 21:05 MT | unfinished: none; real-device validation pending | PRs: #PR#843 #PR#873 #PR#912 #PR#933 #PR#955 #PR#983 #PR#990 |
| R3-W1hi | W1 windows_kill_switch.rs lines 3278+ (Sol pass), selective_layer.rs | Sol (Codex acct 2) | finished 21:05 MT | unfinished: 2 unverified DNS/TUN scenarios | PRs: #974 #976 #978 #986 #988 |
| R3-W5gap | W5 dns/mod.rs 2022+, engine.rs, native_apply.rs | Sol (Codex acct 2) | finished 21:05 MT | unfinished: 3 unverified candidates | PRs: #982 #985 #987 #989 |
| R3-M10gap | M10 SubscriptionManager, UpdateHandoffJournal, NativeUpdateDownload, SubscriptionURLPolicy | Sol (Codex acct 2) | finished 21:05 MT | unfinished: none | PRs: #991 #993 |
| R3-M6M8 | M6 AppState+Connect, M8 lifecycle/reachability | Sol (Codex acct 2) | finished 21:19 MT | unfinished: none (Swift not runnable; 1 decision item R3CONN-DEC01) | PRs: #1001 |
| R3-A2A4 | A2, A3, A4 (Windows connection flow) | Sol (Codex acct 2) | finished 21:33 MT | unfinished: 3 unverified candidates; native/real-device checks | PRs: #1003 #1010 |
| R3-C4E1 | C4 ingest/quota/policy, E1 exit-agent | Sol (Codex acct 2) | finished 21:33 MT | unfinished: 1 decision item | PRs: #1009 #1015 |
| R3-A11 | A11 tono-core config/node/sing_box, connection_plan | Sol (Codex acct 2) | finished 21:46 MT | unfinished: none (0 real) | PRs:  |
| R3-M9M11 | M9 config pipeline/catalog/policy signature, M11 account/keychain | Sol (Codex acct 2) | finished 21:46 MT | unfinished: none | PRs: #1008 #1016 #1019 |
| R3-M5M7 | M5 runtime coordinator/helper manager, M7 persistence/launch protection/exit heal | Sol (Codex acct 2) | finished 21:46 MT | unfinished: 3 unverified candidates; 1 real-unfixed | PRs:  |
| R3-W3W9gap | W3 process.rs/proxy.rs, W9 uninstall/legacy cleanup | Sol (Codex acct 2) | finished 22:00 MT | unfinished: 1 real-unfixed (core job spawn window) | PRs: #994 #999 #1004 #1012 #1022 #1026 |
| R3-M12 | M12 protected connectivity, probes, websocket, sidecar | Sol (Codex acct 2) | finished 22:00 MT | unfinished: none | PRs: #1027 |
| R3-W4W7 | W4 service lifecycle, W7 update | Sol (Codex acct 2) | finished 22:10 MT | unfinished: none | PRs: #1005 #1007 #1014 #1017 #1025 |
| R3-MacQuitHold | MAC-QUIT-AI-HOLD focused check | Sol (Codex acct 2) | finished 22:10 MT | unfinished: decision item (docs PR #1031) | PRs: #1031 |
| R3-E2T2 | E2 home-agent/provisioning/remote, T2 sing-box/mihomo tooling | Sol (Codex acct 2) | finished 22:24 MT | unfinished: real-device HY2/VPS acceptance; peer-history retention design | PRs: #995 #996 #997 #998 #1000 #1002 #1011 #1018 #1035 |
| R3-W2W3 | W2 WFP engine/model/security, W3 manager/netmon | Sol (Codex acct 2) | finished 22:24 MT | unfinished: DHCPv6 identity decision item | PRs: #PR#1032 |
| R3-W1lo | W1 windows_kill_switch.rs lines 1-3278 | Sol (Codex acct 2) | finished 22:24 MT | unfinished: none | PRs: #1021 #1024 #1029 |
| R3-M1M3 | M1 helper socket/power/http, M2 PF kill switch, M3 protected DNS/core manager | Sol (Codex acct 2) | finished 22:47 MT | unfinished: 6 unverified; 1 real-unfixed app-side (MAC-APP-FAILURE-AI-HOLD, handed to R3-P1mac) | PRs: #1028 #1030 #1033 |
| R3-RegMac | regression review: 49 merged macOS PRs | Sol (Codex acct 2) | finished 22:47 MT | unfinished: none | PRs: #1039 #1043 |
| R3-W9inst | W9 install_service, update_executor/journal, NSIS | Sol (Codex acct 2) | finished 22:47 MT | unfinished: lower-priority candidates unverified | PRs: #1042 |
| R3-P1mac | macOS AI hold after exhausted connection failure (fixed, #1048); DashScope coverage investigated | Sol (Codex acct 2) | finished 22:58 MT | unfinished: MAC-DASHSCOPE-DIRECT-COVERAGE unfixed -> issue #1050 | PRs: #1048 |
| R3-P1win | Windows automatic DIRECT release + update Connecting cleanup investigated; decision record #1046 | Sol (Codex acct 2) | finished 22:58 MT | unfinished: WIN-DIRECT-RESTORE-WRITER-DELAY-AUTO + WIN-UPDATE-CONNECTING-CLEANUP unfixed -> issue #1051 (now R4-Issue1051) | PRs: #1046 |
| R3-A5A6 | Windows account/session (A5) and quit/update/window lifecycle (A6): all assigned files read end to end; 4 fixes #1036 #1038 #1045 #1047 | Sol (Codex acct 2) | finished 23:10 MT | unfinished: 3 conditional P2s unfixed (WIN-GRANT-FLUSH-QUEUE, WIN-UPDATE-CONNECTING-CLEANUP, WIN-UPDATE-TOKEN-FLUSH -> issues #1056/#1051/#1055); real-device validation | PRs: #1036 #1038 #1045 #1047 |
| R3-RegWin | Windows regression review of 107 merged PRs (complete inventory to ~22:47 MT); 3 fixes #1037 #1040 #1044; 40 follow-up hypotheses | Sol (Codex acct 2) | finished 23:21 MT | unfinished: 7 real-unfixed -> issues #1054 (P1 unarmed loop, fix slot queued), #1055, new RegWin issue; physical Windows acceptance | PRs: #1037 #1040 #1044 |
