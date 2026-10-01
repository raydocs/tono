# RegLate / RegLate2 (Windows) and WinSvcIPC review: 2026-10-01

Hunter: Claude Opus 5.5. Scope:

- Every PR merged since 2026-10-01T04:45:00Z that touches `apps/windows` or the Windows release tooling. That is 50 PRs; the last was #663 at 09:54Z.
- Special attention to the sing-box default-kernel set (#1140, #1159, #1175, #1196, #1157) and to admission PR #1188, which was still open at report time with auto-merge set and state CLEAN.
- The WinSvcIPC scan: Service request handling, desired/owner state, the SCM stop path and the shutdown path.

Method: diff review against current main (0676435b, then e2bf1603), with callers and callees followed across files. Locally I ran only `rustfmt --check` and one Node test, and one mihomo `-t` run that tested a config file only. No native cargo, Tauri or network commands were run on this Mac. Severity follows the slot prompts: a P0 is a single-failure path; anything that needs two failures or a millisecond race is P2 at most.

## Result

There is no unfixed P0 or P1.

- I found one P1 regression and fixed it in **#1221**.
- I found one P2 race in the sing-box DIRECT path and fixed it in **#1227**.
- I opened issues for the remaining P2 items: **#1228** and **#1229**.

## Sing-box review points

| Point | Verdict |
|---|---|
| Mihomo runs only when mihomo is explicitly chosen, or when sing-box is missing or fails its digest check, and only while WFP is unarmed | Holds in `core_select.rs::resolve`. Known gap #1197: "armed" is `active_runtime_resume.is_some()`, which is narrower than WFP armed, and any probe error reads as "Service too old". Not re-reported. |
| Kernels never swap while WFP is armed | Holds, apart from #1197. `ArmedRefusesFallback` refuses the swap; it does not silently fall back. |
| Protocol 18/19 with mixed App/Service versions | Works by design. A Service below 18 refuses sing-box (`ServiceRefusesSingBox`). Below 19, DIRECT is skipped (`sing_box_direct_service_ready`) and the session stays full-tunnel. |
| A failure never cuts the network | Holds on every sing-box failure path I traced: health release keeps the AI hold, and StartClash failure releases with the AI hold. Strict mode is not written by Windows production (see FP-5), so a strict-mode-only difference is P3. |

## Findings table

| ID | Area | Sev | file:line | One line | Verdict |
|---|---|---|---|---|---|
| REG-1121 | tono-core DNS | P1 | `crates/tono-core/src/config.rs` (dns) | `dns.fallback` without `fallback-filter` makes mihomo load the default GeoIP CN filter. Windows ships no `Country.mmdb`, so the download happens before the tunnel is up; when it fails, the whole config is refused. Confirmed with mihomo `-t`, config test only. | **fixed in #1221** (needs-hardware, auto-merge) |
| WIN-SINGBOX-DIRECT-SWITCH-RACE | App sing-box DIRECT (#1175) | P2 | `app/src-tauri/src/tono/connection/direct.rs` `replace_sing_box_for_direct` | The process replacement took no policy/mutation admission and no context recheck, unlike the mihomo bracket. A hot switch or policy update could interleave, and Core would restart on the node the session had already left while WFP was narrowed to the new one. | **fixed in #1227** (needs-hardware, auto-merge) |
| H5 | App monitor vs sing-box DIRECT | P2 | `connection/monitor.rs` ~1008-1069, `connection_health.rs:194` | The sing-box replacement changes the Core pid without the owned-reload marker, so `core_changed` fires. A monitor tick that lands inside the replacement can fail the in-place proof and trigger a rebuild, and that rebuild runs DIRECT again. Not a cut (WFP stays armed, AI hold kept). | real, unfixed: **#1228** |
| REG-1074 | Service DIRECT retire | P2 | `service/src/server/mod.rs` `retire_expired_fresh_arm` | If the active owner record is corrupt or mismatched, the retire keeps failing and the session stays Blocked. | real, unfixed: **#1229** item 1 (needs a corrupt record) |
| H-IPC-1 | Service startup | P2 | `service/src/bin/service.rs` reconcile | An unverified intent plus a failed startup reconcile leaves the Service Blocked. | real, unfixed: **#1229** item 2 (two failures) |
| H-IPC-2 | Service SCM stop | P2 | SCM stop, repair gate | A repair-gate I/O error during an SCM stop skips the protection release. | real, unfixed: **#1229** item 3 (two failures) |
| H3-restore | App startup restore (#1045) | P2 | `commands/restore.rs:160` | Sign-in during startup pin hydration skips the stored-protection probe; the resync poll at the end of restore handles it. | real, unfixed: **#1229** item 4 (needs three conditions) |
| H3s | App/Service sing-box DIRECT failure | P3 | `direct.rs` `restore_sing_box_full_tunnel`, `windows_kill_switch.rs` `restore_sing_box_full_tunnel` | On a double failure, the sing-box DIRECT path uses the narrow release / `disarm_unlocked(true)` even in strict mode, while mihomo stays Blocked. | latent: Windows production never writes strict mode (FP-5) |
| H6 | App sing-box DIRECT restore | P3 | `direct.rs` `restore_sing_box_full_tunnel` | The result of the restore replace is ignored, so the App can show Connected after the Service has released. The monitor recovers. | unfixed, P3 |
| REG-1157 | tono-core sing-box | P3 | `crates/tono-core/src/sing_box/runtime.rs` | An explicit VLESS fingerprint other than chrome rejects the whole compile; admission accepts any value of 64 characters or fewer. The catalog emits only chrome or nothing. | latent, P3 |
| REG-1159 | Release tooling / install | P3 | install transaction | A fresh install refuses when `sing-box.exe` is missing or quarantined by AV. This is deliberate (pinned publish); with mihomo there was a silent fallback. | deliberate; noted |
| H1 | App unarmed recovery | P3 | `connection.rs:365-369`, `unarmed_probe.rs:205` | A selection check returning `Stale` with no failure generation ends background recovery. | millisecond race, P3 |
| H2 | App unarmed backoff | P3 | `unarmed_probe.rs:376-380` | A physical-route change resets the backoff, so frequent metric flips could bring back the #1054 flapping. | unverified; needs hardware |
| H-IPC-3 | App Service client | P3 | `core/service/mod.rs` `reconcile_lost_tono_start` | With concurrent starts, the App can adopt another start's generation while holding its own token. | the token check fails, and the lost-start recovery runs; no cut |

### Per-PR verdicts (no regression found)

- **App connect, health, recovery and account:** #1045, #1047, #1066, #1070, #798, #1111, #1112, #1116, #1106, #1098, #1133, #1138, #1142, #1150, #1156, #1107 are ok. Lock order is policy, then privileged, then state, at every site I checked. Disconnect aborts the monitor before a health release could start recovery.
- **App controller, UI and metadata:** #1122, #1123, #1118, #1128, #1129, #1160, #1148 are ok.
- **Core identity and tooling:** #1119 (identity adaptive.2, rebuilt in CI) is ok. #1173 is ok; `node --test tooling/scripts/tests/windows-release-staging.test.mjs` passes.
- **Service:** #1074 (see REG-1074), #1075, #1076, #1087, #982, #1090, #926, #930, #1084, #1147, #1089, #1155, #1163, #1168, #1172 are ok; #1121 is fixed in #1221.
- **Sing-box set:**
  - #1140 is ok apart from #1197.
  - #1196 is ok: no pipe wait for sing-box.
  - #1157 is ok (see REG-1157).
  - #1159 is ok: `desktop-update-v1.mjs` emits `singBoxSha256`, and the App and Service pins match in the release.
  - #1175 is ok apart from the issues fixed or filed above.
  - #1188 (open) is ok: the full-tunnel and DIRECT documents the compiler emits pass its whitelist. The earlier Codex re-review passed at 8b865c77.
- **#663** merged into `release/windows`, not main. Its TUN route wait probes 198.18.5.25 and 198.18.0.2, and both route through the sing-box `Tono` TUN (`198.18.0.1/30`, `auto_route`), so it works with the sing-box default. Ok.
- **Docs:** #1092, #1202 and #1205 are docs only.

## False positives (rejected)

1. **FP-1, #1133 policy lock held across a release could deadlock with catalog/policy sync or DIRECT.** The lock order is the same at every site.
2. **FP-2, health recovery after a user Disconnect joins its release (#1142/#1156).** `invalidate_connection` aborts the monitor first.
3. **FP-3, `health_guard.expect` panic.** Both conditions use the same `health_monitor_releases` values.
4. **FP-4, #1066's early return leaves no health monitor.** The monitor is spawned before that return.
5. **FP-5, StartClash rollback and sing-box DIRECT restore release in strict mode.** Windows production never writes `strict_kill_switch=true`.
6. **FP-6, SCM stop with a failed DNS restore.** This is already #792.
7. **FP-7, an old Service refuses `fallback` from a new App.** The connect fails but the network is not cut, and both ship together. P3.
8. **FP-8, App parking_lot locks held across `.await`.** All of them are synchronous and short.
9. **FP-9, #1173's moved preflight could miss sing-box resources.** `sing-box-sha256.txt` is staged first.
10. **FP-10, #1119's identity bump could break the build on an old binary.** CI rebuilds from the patch and checks the result.
11. **FP-11, after #798, FailOpen with `armed == false` no longer adds the AI hold.** Before arming, the earlier AI hold is still in place.
12. **FP-12, sing-box clash_api lacks the `/dns/query` and `/delay` endpoints.** Both are supported.
13. **FP-13, no Authenticode pin for sing-box.** None is configured in the release; the SHA-256 pin covers it.
14. **FP-14, App/Service sing-box pin mismatch.** The release sets both from the same `sing-box-sha256.txt`.
15. **FP-15, controller CORS origin.** Only the Rust client talks to the controller.

Hypotheses examined: 29. That is the 14 findings-table rows plus the 15 false positives above.

## Not finished

- `service/src/core/desired.rs`, `core/manager.rs`, `core/structure.rs` and `runstate`: I read only their call sites, with no end-to-end deep scan.
- No hardware run. #1221, #1227, #1228 and #1229 carry `needs-hardware`.
- Owner-gated items were not touched (#1197's decision-040 wording, and the strict-mode items).
