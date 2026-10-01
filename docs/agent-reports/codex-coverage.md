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
