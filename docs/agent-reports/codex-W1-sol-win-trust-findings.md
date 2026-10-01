# W1-sol-win-trust: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 22:00 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| PR#843 | hunt/sol-trust-vault-write-retry | none | yes | fix(windows): retry failed session vault mutations on flush |
| PR#873 | hunt/sol-trust-release-absent-owner | needs-hardware | yes | fix(windows): stop unrecorded cores before owner-only release |
| PR#912 | hunt/sol-trust-release-scm-probe-timeout | needs-hardware | yes | fix(windows): bound SCM reads in release and readiness paths |
| PR#933 | hunt/sol-trust-scm-verifier-worker-cap | needs-hardware | yes | fix(windows): cap surviving SCM verification threads |
| PR#955 | hunt/sol-trust-goodbye-admission | needs-hardware | yes | fix(windows): reserve accepted Service shutdown before new work |
| PR#983 | hunt/sol-trust-selective-release-retry | needs-hardware | yes | fix(windows): retain the AI hold on selective release retries |
| PR#990 | hunt/sol-trust-stale-replay-verdict | none | yes | fix(windows): keep obsolete token replays from rejecting a valid session |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| WIN-VAULT-WRITE-RETRY | A12 | P1 | apps/windows/app/src-tauri/src/tono/credentials.rs:743 | Failed vault mutations discarded; flush never retried persistence | real-fixed #843 |
| WIN-IPC-CONNECTION-CAP | W6 | — | apps/windows/vendor/kode-bridge/src/ipc_http_server.rs:252 | Suspected unbounded concurrent IPC clients | false-positive default 128-connection semaphore |
| WIN-SERVICE-LOG-UNICODE | A7 | — | apps/windows/app/src-tauri/src/core/service/mod.rs:294 | Hex log slicing could panic on Unicode | false-positive trusted service emits only ASCII hex |
| WIN-SERVICE-STOP-WATCHDOG | A7 | — | apps/windows/app/src-tauri/src/core/service/mod.rs:852 | Failed stop could leave owner monitor cancelled | false-positive every failure restores monitor or owner recovery |
| WIN-PROXY-CRASH-LEFTOVER | A7 | — | apps/windows/app/src-tauri/src/core/manager/lifecycle.rs:33 | Crash could leave system proxy pointing at stopped core | false-positive current Windows product never enables system proxy; owned legacy cleanup exists |
| WIN-OWNER-RELEASE-NONE | W6 | P1 | apps/windows/service/src/core/server/handlers.rs:415 | Missing/corrupt active-owner lets release skip live Core stop | real-fixed #873 |
| AUTH-STALE-REFRESH | A12 | — | apps/windows/crates/tono-core/src/auth.rs:1551 | Stale refresh could overwrite replacement account | false-positive identity and token epochs reject stale commit |
| AUTH-LOGOUT-REPLACEMENT | A12 | — | apps/windows/crates/tono-core/src/auth.rs:1334 | Logout could erase replacement account | duplicate previously fixed identity race |
| AUTH-IDENTITY-PAYLOAD | A12 | — | apps/windows/crates/tono-core/src/auth.rs:1414 | Refresh payload could replay across accounts | false-positive identity admission rejects other account token |
| AUTH-ROTATION-TIMEOUT | A12 | — | apps/windows/crates/tono-core/src/auth.rs:1566 | Lost refresh response could destroy session | false-positive server provides 600-second rotation replay grace |
| AUTH-VERDICT-DEADLOCK | A12 | — | apps/windows/crates/tono-core/src/auth.rs:1659 | Verdict sink could deadlock product state | false-positive production sink uses independent short locks |
| AUTH-EXPIRY-OVERFLOW | A12 | — | apps/windows/crates/tono-core/src/auth.rs:1069 | Expiry subtraction could overflow | false-positive accepted expiry and ordinary clock bounds exclude overflow |
| POLICY-REVISION-REPLAY | A12 | — | apps/windows/crates/tono-core/src/policy.rs:743 | Unsigned revision could roll policy backward | false-positive signed embedded revision ratchet |
| POLICY-SIGNATURE-DOWNGRADE | A12 | — | apps/windows/crates/tono-core/src/policy.rs:781 | Same revision could downgrade signed policy | false-positive downgrade retains current policy |
| POLICY-CRASH-TEMP | A12 | — | apps/windows/crates/tono-core/src/policy.rs:899 | Crash temp collision could permanently stop sync | false-positive failure removes stale scratch; bounded retry succeeds |
| CATALOG-ORDER-ROLLBACK | A12 | — | apps/windows/crates/tono-core/src/catalog.rs:365 | Late catalog could replace newer document | false-positive tracker plus serialized persist-before-commit |
| POLICY-AI-SUFFIX | A12 | — | apps/windows/crates/tono-core/src/policy.rs:334 | Signed direct suffix could cover AI services | duplicate #797 |
| INSTALLATION-ID-WRITE | A12 | — | apps/windows/app/src-tauri/src/tono/commands/account.rs:92 | Failed installation ID persistence creates temporary ID | false-positive explicit best-effort design; existing sessions use JWT identity |
| SELECTIVE-AI-HOOK | A12 | — | apps/windows/crates/tono-core/src/network_disposition.rs:59 | Ordinary exhausted recovery has no registered selective AI hook | false-positive hook absence alone: production failure path calls Service narrow release; SFO-1 limitations remain known |
| JOURNAL-PARTIAL-WRITE | A12 | — | apps/windows/crates/tono-core/src/update_journal/store.rs:99 | Crash could leave partial durable journal | false-positive unique scratch synced and atomically replaced |
| JOURNAL-FAILED-ADVANCE | A12 | — | apps/windows/crates/tono-core/src/update_journal/store.rs:182 | Failed publication could advance journal | false-positive previous durable bytes retained |
| JOURNAL-PHASE-REGRESS | A12 | — | apps/windows/crates/tono-core/src/update_journal/store.rs:214 | Restart could regress recovery phase | false-positive migration re-entry preserves progress |
| JOURNAL-PROTECTED-SHORTCUT | A12 | — | apps/windows/crates/tono-core/src/update_journal.rs:108 | Protected update could skip recovery | false-positive protection obligations gate shortcut edges |
| JOURNAL-REMOVE-NETWORK | A12 | — | apps/windows/app/src-tauri/src/tono/update_handoff.rs:140 | Failed journal removal could strand network | false-positive projection warning only; service receipts own update behavior |
| UPDATE-RECEIPT-ARITHMETIC | A12 | — | apps/windows/crates/tono-core/src/update_contract.rs:219 | Receipt timestamp subtraction could panic | false-positive ordering guards precede subtraction |
| RECOVERY-CANCEL-GUARD | A12 | — | apps/windows/crates/tono-core/src/recovery.rs:7 | Cancelled caller could release recovery lock early | false-positive detached worker retains exclusive guard |
| RECOVERY-STALE-SELECTION | A12 | — | apps/windows/app/src-tauri/src/tono/connection/heal.rs:99 | Late preflight could use deselected exit | duplicate codex2 in-flight stale-preflight candidate |
| HEAL-LATE-PROBE | A12 | — | apps/windows/crates/tono-core/src/heal.rs:505 | Late probe could win after deadline | false-positive race_sticky has no production caller; live preflight timed |
| HEAL-CANDIDATE-HISTORY | A12 | — | apps/windows/app/src-tauri/src/tono/connection/heal.rs:66 | Exhausted candidate history could prevent healing | false-positive healthy preferred session resets history; sticky detour deliberate |
| FSM-DISCONNECT-RECONNECT | A12 | — | apps/windows/crates/tono-core/src/connection.rs:413 | Disconnect could admit reconnect under its own generation | false-positive active flags cleared and callers fence generations |
| W6-LENGTH-OVERFLOW | W6 | — | apps/windows/vendor/kode-bridge/src/codec.rs:88 | Oversized length could overflow parser | false-positive checked addition and offset guard |
| W6-DECODE-LOOP | W6 | — | apps/windows/vendor/kode-bridge/src/ipc_http_server.rs:766 | Malformed bytes could loop handler forever | false-positive Framed ends stream after decoder error |
| W6-STALE-OWNER-GATE | W6 | — | apps/windows/service/src/core/server/mod.rs:800 | Owner authorization could race lifecycle mutation | false-positive owner check follows lifecycle lock |
| W6-COPIED-TOKEN | W6 | — | apps/windows/service/src/core/auth.rs:542 | Copied token could impersonate another user | false-positive kernel peer SID must match declared owner |
| W6-REMOTE-CONNECT | W6 | — | apps/windows/service/src/core/windows_kill_switch.rs:1430 | RDP connect rejected | false-positive deliberate initial remote-session refusal |
| W6-APP-IDENTITY | W6 | — | apps/windows/service/src/core/server/mod.rs:800 | Same-user non-App mutation access | duplicate #352 |
| W6-START-FAILURE | W6 | — | apps/windows/service/src/core/server/handlers.rs:703 | Post-arm Core start failure keeps protection | duplicate #769 |
| W6-SERVICE-STOP | W6 | — | apps/windows/service/src/core/server/mod.rs:457 | Ordinary service stop retains protection | duplicate #792 |
| W6-AUTH-HANG | W6 | — | apps/windows/service/src/core/auth.rs:314 | Authentication filesystem call could block executor | false-positive blocking pool and five-second deadline |
| W6-CLIENT-WEDGE | W6 | — | apps/windows/service/src/client/mod.rs:144 | Client identity verification could wedge executor | false-positive isolated IPC worker and SCM three-second deadline |
| W6-MUTATION-REPLAY | W6 | — | apps/windows/service/src/client/mod.rs:295 | Transport retry could duplicate mutation | false-positive writes get one transport attempt |
| W6-SERVICE-PROXY | W6 | — | apps/windows/service/src/core/server/mod.rs:256 | Service proxy mutation could leave a leftover | false-positive Windows service proxy operations inactive |
| W6-ELEVATED-TOKEN | W6 | — | apps/windows/app/src-tauri/src/core/owner_identity.rs:487 | Elevated token could exclude ordinary owner | false-positive user SID explicitly assigned; directory ownership scenario admin-only |
| W6-PIN-SESSION-RACE | W6 | — | apps/windows/service/src/core/server/handlers.rs:535 | Stale pin write could mutate live protection | false-positive bounded public pins; no live protection mutation or verified effect |
| WIN-GOODBYE-CONNECT-RACE | W6 | P2 | apps/windows/service/src/core/server/mod.rs:392 | Accepted goodbye can stop a connection started in its 250ms grace | real-fixed #955 |
| W8-SIGNED-DIGEST | W8 | — | apps/windows/service/src/core/runtime_generation/core_integrity.rs:85 | Signing could make compiled digest stale | false-positive shipped core bytes pinned before package signing |
| W8-CORRUPT-MANIFEST | W8 | — | apps/windows/service/src/core/runtime_generation/assets.rs:322 | Corrupt manifest could permanently refuse start | false-positive rebuilt from default; existing regression |
| W8-CASE-DESTINATIONS | W8 | — | apps/windows/service/src/core/runtime_generation/assets.rs:293 | Case aliases could sweep refreshed assets | false-positive current product declares no runtime assets or providers |
| W8-PROVIDER-CRASH | W8 | — | apps/windows/service/src/core/runtime_generation/mod.rs:148 | Interrupted manifest commit could poison provider provenance | false-positive current product has no runtime providers |
| W8-SOURCE-RELINK | W8 | — | apps/windows/service/src/core/runtime_generation/assets.rs:530 | Changing source could redirect privileged copy | false-positive opened-handle validation and bounded copy |
| W8-UNSIGNED-CORE | W8 | — | apps/windows/service/src/core/runtime_generation/core_integrity.rs:158 | Unsigned binary could bypass trust | false-positive exact SHA256 remains mandatory; unsigned shipped core deliberate |
| W8-WATCHDOG-PIN | W8 | — | apps/windows/service/src/core/runtime_generation/core_integrity.rs:219 | Watchdog or restore bypasses digest check | false-positive documented omission; no ordinary stale-image path proven; updates suppress restart |
| A13-WINTRUST-NETWORK | A13 | P2 | apps/windows/crates/tono-authenticode/src/windows_impl.rs:46 | Network retrieval could delay Authenticode discovery | false-positive as availability finding: no proven outage or machine hang; background latency observation only |
| WIN-RELEASE-SCM-PROBE-HANG | A7 | P1 | apps/windows/app/src-tauri/src/core/service/mod.rs:524 | Unbounded stopped-state query permanently holds Disconnect release worker | real-fixed #912 |
| A7-PREREQUISITE-EXECUTOR | A7 | — | apps/windows/app/src-tauri/src/tono/commands/account.rs:184 | SCM prereq read could freeze runtime executor | false-positive dispatched through spawn_blocking |
| A7-STARTUP-EVIDENCE | A7 | — | apps/windows/app/src-tauri/src/core/runstate/mod.rs:283 | Startup readiness could wait forever | false-positive evidence collection has five-second timeout |
| A7-PRIVILEGED-ADMISSION | A7 | — | apps/windows/app/src-tauri/src/core/runstate/mod.rs:529 | Privileged installer could hold admission forever | false-positive 150-second deadline then deliberate quarantine |
| A7-SETTLED-NOTIFICATION | A7 | — | apps/windows/app/src-tauri/src/core/runstate/mod.rs:198 | Missed settlement notification could hang wait | false-positive notify enabled before state check |
| A7-STALE-HEALTH | A7 | — | apps/windows/app/src-tauri/src/core/runstate/mod.rs:350 | Late readiness sample overwrites a newer operation | false-positive refresh reservation fences generation |
| A7-PAC-START | A7 | — | apps/windows/app/src-tauri/src/core/runstate/mod.rs:587 | PAC startup could hang service mode | false-positive legacy path unused; readiness settlement is bounded |
| A7-SIDECAR-ORPHAN | A7 | — | apps/windows/app/src-tauri/src/core/manager/mod.rs:128 | Dropped child could leave untracked core | false-positive production Windows setter is unreachable |
| A7-PROXY-CLEAR-STOP | A7 | — | apps/windows/app/src-tauri/src/core/manager/lifecycle.rs:25 | Proxy cleanup failure prevents stop | false-positive retaining listener avoids dead proxy; current Windows has no proxy activation |
| A7-SHORT-OWNER-TOKEN | A7 | — | apps/windows/app/src-tauri/src/core/owner_identity.rs:218 | Interrupted token write permanently excludes owner | false-positive unusable token regenerated; server rereads per request |
| A7-OLD-MONITOR-SESSION | A7 | — | apps/windows/app/src-tauri/src/core/service/owner.rs:183 | Delayed old monitor clears adopted session | false-positive generation CAS and post-lock recheck fence recovery |
| A7-LOST-START-RESPONSE | A7 | — | apps/windows/app/src-tauri/src/core/service/mod.rs:1319 | Lost start response leaves unstoppable Core | false-positive generation reconciliation and owner-only release recover it |
| A7-INSTALLER-INHERITED-PIPE | A7 | — | apps/windows/app/src-tauri/src/core/service/install.rs:559 | Inherited output handles deadlock installer | duplicate known installer hang fixed by status and bounded quarantine |
| A7-SCM-ERROR-PATH | A7 | P1 | apps/windows/app/src-tauri/src/core/service/mod.rs:614 | Connect and Repair also perform unbounded SCM evidence/BFE reads | duplicate same root cause WIN-RELEASE-SCM-PROBE-HANG; included in fix |
| AUTH-UNOWNED-CACHE-RESIDUAL | A12 | P2 | apps/windows/app/src-tauri/src/tono/catalog_sync.rs:147 | Persistent cache-file sharing failure retains previous account catalog | duplicate documented H3-F1/#316 residual; no ownership binding |
| AUTH-MARKER-PARTIAL-COMMIT | A12 | — | apps/windows/app/src-tauri/src/tono/credentials.rs:91 | Crash partially commits session ownership marker | false-positive synced closed scratch is atomically replaced |
| AUTH-VAULT-REBIND-STALE | A12 | — | apps/windows/app/src-tauri/src/tono/credentials.rs:610 | Delayed roaming migration resurrects retired token | false-positive latest vault reread under write/delete lock |
| AUTH-GRANT-TORN-POSITIVE | A12 | — | apps/windows/app/src-tauri/src/tono/state.rs:841 | Torn offline grant admits revoked session or strands network | false-positive unreadable grant refuses; outage also needs unreachable control plane |
| AUTH-IID-PERSIST-SESSION | A12 | — | apps/windows/app/src-tauri/src/tono/commands/account.rs:95 | Failed installation ID persistence invalidates restored session | false-positive refresh sends token only; device debt documented #409 |
| WIN-CORE-STOP-WAIT | W6 | — | apps/windows/service/src/core/manager.rs:213 | Core stop could wait forever for a wedged child | false-positive child wait has termination deadline; tracked failed child retained for retry |
| WIN-SCM-VERIFIER-WORKERS | W6 | P2 | apps/windows/service/src/client/mod.rs:165 | Repeated monitor calls spawn unbounded detached SCM verifier threads during a sustained stall | real-fixed #933 |
| WIN-GOODBYE-RELAUNCH | A7 | — | apps/windows/app/src-tauri/src/lib.rs:419 | Second same-user App relaunch triggers goodbye race | false-positive as primary trigger: persistent singleton coordination; same-App update provides actual trigger |
| WIN-SELECTIVE-RELEASE-RETRY | A7 | P2 | apps/windows/app/src-tauri/src/core/service/mod.rs:1323 | Automatic selective release retries all failures as plain release, dropping AI hold | real-fixed #983 |
| W6-SESSION-GENERATION-REPLAY | W6 | — | apps/windows/service/src/core/server/mod.rs:1116 | Obsolete same-user session proof could mutate a replacement Core | false-positive owner, generation and token-hash checks reject it |
| W6-WRITER-ROTATION-AMPLIFICATION | W6 | — | apps/windows/service/src/core/server/handlers.rs:940 | Writer rotation could create excessive privileged files | false-positive size and retention clamped before persistence |
| W6-UPDATE-START-EPOCH | W6 | — | apps/windows/service/src/core/windows_kill_switch.rs:47 | Update takeover should invalidate StartClash via release epoch | false-positive documented update and Disconnect epochs have separate purposes |
| W6-STATUS-WRITER-CONTENTION | W6 | — | apps/windows/service/src/core/server/handlers.rs:63 | Status reads could queue behind slow lifecycle mutations | false-positive diagnostics avoid writer lock and read published snapshots |
| A13-THUMBPRINT-NORMALIZATION | A13 | — | apps/windows/service/src/core/runtime_generation/core_integrity.rs:82 | Malformed thumbprint could bypass trust | false-positive compile-time pin, mandatory binary digest remains |
| A13-SIGNER-BUFFER-BOUNDS | A13 | — | apps/windows/crates/tono-authenticode/src/windows_impl.rs:168 | Signer property read could panic or trust failed certificate extraction | false-positive bounded hashes, checked API results, fail-closed callers |
| W8-PROGRAMDATA-OWNER-PATH | W8 | — | apps/windows/service/src/core/paths.rs:65 | Owner key or ProgramData resolution could select arbitrary paths | false-positive known-folder resolution and validated owner keys |
| PROTECTED-DIAGNOSTIC-HANG | A12 | — | apps/windows/crates/tono-core/src/protected_connectivity.rs:98 | Failed authoritative proof could await diagnosis without bound | false-positive production transaction uses shared deadline |
| POLICY-SWITCH-MEDIA-PIN | A12 | — | apps/windows/crates/tono-core/src/policy.rs:609 | Switching to a media IP could leave it permitted DIRECT | false-positive plan builder rechecks selected node |
| AUTH-REFUSED-VERIFIED-LIFT | A12 | — | apps/windows/crates/tono-core/src/auth.rs:1044 | Old successful request could undo permanent Refused | false-positive sink lifts only Forbidden |
| JOURNAL-OVERSIZED-READ | A12 | — | apps/windows/crates/tono-core/src/update_journal/store.rs:137 | Large journal could exhaust memory | false-positive no ordinary producer writes unbounded journal |
| CREDENTIAL-DEV-ACL | A12 | — | apps/windows/crates/tono-core/src/credentials.rs:127 | File credential implementation lacks native Windows ACL enforcement | false-positive production uses Credential Manager |
| AUTH-CLOCK-REPLAY-VERDICT | A12 | P2 | apps/windows/crates/tono-core/src/auth.rs:1611 | Obsolete decisive replay under clock skew could refuse current rotated session | real-fixed #990 |
