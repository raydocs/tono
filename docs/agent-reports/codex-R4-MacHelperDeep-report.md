Three fixes pushed; **two merged**, one awaiting CI. Locations below refer to audited baselines.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R4MH-SELECTIVE-ROUTE-GATEWAY | Helper | P1 | SelectiveFailOpen.swift:87 | AI blackhole routes omitted required gateways | Fixed in [#1110](https://github.com/raydocs/tono/pull/1110), merged |
| R4MH-UPGRADE-STAGING-COLLISION | Helper | P2 | SocketServer.swift:43 | Concurrent upgrade cleanup deletes installer candidates | Fixed in [#1130](https://github.com/raydocs/tono/pull/1130), CI queued |
| R4MH-LAN-SCOPE-NORMALIZATION | Helper | P2 | KillSwitchPF.swift:82 | Compiled PF interface syntax prevents LAN DNS refresh | Fixed in [#1135](https://github.com/raydocs/tono/pull/1135), merged |
| R4MH-SIGNEDOUT-LAUNCH-AI-HOLD | Client | P2 | AccountSession+Auth.swift:41 | Signed-out cold launch removes automatic AI hold | Unfixed [#1117](https://github.com/raydocs/tono/issues/1117): account caller outside scope |
| R4MH-CONTRACT-METADATA-MISMATCH | Build | P2 | build-core-helper.sh:57 | Guard accepts contradictory version metadata | Unfixed [#1152](https://github.com/raydocs/tono/issues/1152): build-validation follow-up |

All three PRs have `needs-hardware`:

- **#1110, #1135:** all required CI passed; merged through MERGE auto-merge.
- **#1130:** MERGE auto-merge enabled. Final commit `7e1ff847`, protocol **4.52.26**, exact contract hash verified. Previous commit passed the full gate; final combined commit’s native jobs remain queued.

**83 hypotheses examined:** 54 false-positive/rejected/unverified, 24 duplicates, three fixes, two verified unfixed. The [complete table and rejection reasons](/workspace/w1-codex/out/R4-MacHelperDeep/report.md) are recorded.

All assigned files were audited. Unfinished work: real-device qualification, #1130’s final native gate, and the two follow-up fixes above. Swift was unavailable locally; native execution used hosted CI.