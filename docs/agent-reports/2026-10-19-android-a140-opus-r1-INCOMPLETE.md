# Blind Android UI review — opus-r1 — INCOMPLETE

## 1. Frozen source and scope
- Checkout HEAD verified: `a140bac84dd692781e36dbfd5a86f9ea2d1356a0` (clean tree, `git status --short` empty).
- Diff scope: `git diff 59082acfb52f31963b39e52595549875d0f01ed4...a140bac84dd692781e36dbfd5a86f9ea2d1356a0 -- apps/android .github/workflows/android-ci.yml` (123 files, +19161). CI run 39319514149 `head_sha` = the same frozen SHA. Cloud receipt `git-receipt-final.txt` = the same SHA, 0 porcelain lines.
- Desktop brand comparison used the frozen macOS/Windows source only: `apps/windows/app/src/tono-ui/sea-presentation.ts`, `theme.ts`, `sea-scene.css`; `apps/macos/Tono/Views/SeaSceneLayerView.swift`, `Theme/TonoTheme.swift`.

## 2. Contamination disclosure
- **Not opened:** `visual-provenance-qc.txt` (only its file name showed up in a directory listing), anything under `docs/agent-reports/`, PR comments or threads, other reviewers' output, and any historical scores. Nothing was mined from git history. I ran `git log | wc -l` only to count commits.
- **Seen anyway:** the harness put the last 5 commit subjects in my session context automatically. I read `INDEX.md`. It describes the evidence and its limits, gives no scores, but does mention the CI flake. I also read the global/project agent instructions and the image-deny hook script.
- **Policy block (decisive):** the session's PreToolUse hook `~/.agents/scripts/hooks/deny-image-read.sh` denied the first image read (`cloud-ui/jvm-05-home-connected.png`). The brief forbids bypassing hooks or spawning agents, so **I could not visually inspect any PNG, contact sheet or video frame.** I also wrote no derived frames.

## 3. Findings (most severe first)
No veto-level defect showed up in source or text evidence. Visual readability and visual misleading states could not be checked (see §6).

**F1 — Medium — residual false "Connected" on system surfaces during an engine restart.**
- `surface/NotificationWatchdog.kt:116-125`, `surface/EngineWatch.kt:162-187` (100 ms poll), `surface/PublicStatus.kt:123-131`.
- Scenario, from the CI t6 receipts:
  - After the `:vpn` process is killed, Android re-posts the dead engine's CONNECTED notification with no VPN network. It was seen for ≤118 ms (retry t6-doze), ≤152 ms (attempt-1 t6-doze) and ≤105 ms (t6-both). These are sampled at about 100 ms, so the real window is not bounded by the evidence.
  - In attempt-1 t6-doze the shared tile/widget view still computed `surface=CONNECTED` 215 ms after the kill, while Android listed the dead VPN. The watch had not yet written the DeathLog: it hears the death through `main.post` and writes after that.
  - These are sub-second windows, but they claim protection while the tunnel is gone.
- Fix:
  - Have the engine write a "possibly ending" marker that readers treat as UNKNOWN before Android's VPN listing can be trusted. For example, readers could require `tonoVpn==true` and a heartbeat age under ~2 s for CONNECTED on the tile and widget.
  - Post the ongoing notification's tunnel claim in a form that a re-post cannot reuse. For example, the title is "Tono" and the state sits in text the watch rewrites.
  - Measure the re-post window from frame timestamps instead of a 100 ms poll.

**F2 — Medium (evidence/UX) — first-attempt CI failure: "Connecting" never observed.**
- `androidTest/.../LocalTunnelDeviceTest.kt:686` failed on attempt 1 and passed on a fresh-emulator retry; the workflow labels it FLAKY.
- The UI hierarchy at the failure shows `Connected`, `Cloud United States · Home United States` and `Tunnel up for 00:10`. So the tunnel connected, but the test never saw the in-between state, even though sing-box took 6.17 s to start.
- Cause not established. One plausible cause, a hypothesis only: `MainActivity.kt:32,70-77` requests POST_NOTIFICATIONS right after VPN consent. That system dialog covers Home during the whole first connect, so the user also does not see the progress state.
- No screenshot proves what was on screen (`local-t3-connecting-missing.png` is uninspected because of the policy).
- Fix: defer the notification prompt until after the Connected or Failed arrival, or explain it in the consent sheet. Make t3 record why it did not see the state (which window was on top).

**F3 — Minor — a blank sea with no words or action when the engine never answers.**
- `ui/TonoRoot.kt:62` renders only `SeaScene(NIGHT)` when `snapshot == null`, for both WAITING and LOST.
- Scenario: `bindService` returns false, or the engine crash-loops before `restore()`. The link is LOST, `revive` exits because `!bound` (`EngineClient.kt:65`), and the screen stays a bare night sea indefinitely: no "Status unknown", no Retry. That makes the primary action undiscoverable in this failure mode. On a normal cold start it is a short wordless frame.
- Fix: when `s == null` and (`link == LOST` or WAITING lasts over about 1.5 s), show the "Status unknown" header with a Retry or Open-settings action.

**F4 — Minor — desired line briefly shown as the line under "Connected".**
- `engine/TonoVpnService.kt:683-685`, `:689-691`, `:695-697`.
- `selectNode`, `setMode` and `setExcluded` broadcast `copy(selectedNode/mode)` while the phase is still CONNECTED with the old `applied`, and only then call `reloadIfRunning()`.
- Home's exit pill (`ui/HomeScreen.kt:376`) shows `selectedNode`, so one snapshot shows "Connected" with the newly selected city. `PublicStatus.line` also changes. Lines and the notification correctly use `appliedNode`.
- Fix: apply the selection and `ledger.begin(CONNECTING)` in one `update` when a tunnel is running. Optionally, have the pill show `appliedNode` while the tunnel is up.

**F5 — Minor/Medium — the widget can keep a stale tunnel claim when the engine and the watch both die and Android does not restart the engine.**
- `surface/TonoWidget.kt:80-86`, `NotificationWatchdog.kt:44-47`.
- The backstops are inexact, non-waking ELAPSED alarms: STALE_MS+10 s and HEARTBEAT+10 s, so roughly 20–40 s or more, longer in Doze.
- RemoteViews keep showing "Connected" until then. The tile is fine because it recomputes in `onStartListening`.
- Device evidence never exercised this path: t6-both says "the alarm path was not needed: Android restarted the engine".
- Fix: for live states, include the record's time in the widget detail ("Connected · 14:02"), or schedule the recheck with a guaranteed mechanism. Add a device test where the restart is suppressed.

**F6 — Minor — one-tap sign-out releases protection.**
- `ui/SettingsScreen.kt:136` → `TonoVpnService.signOut()` (`:272-282`) stops the core immediately, with no confirmation, even while connected.
- Fix: confirm when `tunnelUp` (stricter, non-leaking default).

**F7 — Minor — the "Connected" proof is weaker than the copy implies.**
- `engine/Probes.kt:32`: any HTTPS answer from www.cloudflare.com counts as OK. If routing ever sent that host DIRECT, the screen would say "Connected · Cloud <phone's own country>".
- The routing host check `t1-routing-matches-exit-logs` passed against stand-ins only.
- Fix: require the probe's TLS connection to go through the exit outbound (sing-box connection tag or stats) before CONNECTED.

**F8 — Info (a11y):** `a11y-report.txt` shows merged node text such as "ConnectConnect" and "CancelCancel connecting" (text plus click label). That suggests a redundant TalkBack phrase. The actual TalkBack speech was not verified.

## 4. Scores
**No score can be given.** Five of the seven items depend mainly on visual inspection: information hierarchy as seen, restrained premium brand look, the Liquid Glass material, state motion, and legibility. Those inputs were blocked (§2). Giving numbers would invent evidence.

| Item (max) | Status | Source/text-only observation (not a score) |
|---|---|---|
| 信息层级减字 (20) | 未评 | The Home source holds one state word, one line, the primary capsule, the exit pill and the dock. Details are on demand. Visual hierarchy was not seen. |
| 交互连贯单手 (20) | 未评 | Primary action at the bottom: a 371×58 dp capsule. Settings and Details are 48 dp. Swipe-up for Details works. Exactly one action per phase (interaction-report). F3 and F6 apply. |
| 高级克制·桌面品牌一致 (15) | 未评 | Tokens and the 2ED573/FFB46A palette match the desktop. Sky states mirror desktop SeaScene. Nothing visual was compared. |
| Liquid Glass 材质 (15) | 未评 | The numeric glass-report shows the blur leaves 0.2% of the stripes. Fallback below API 31 is a denser tint. Appearance not seen. |
| 状态动效 (15) | 未评 | Reduced-motion video: 110 of 144 consecutive frame pairs near-static, versus 41 of 144 with normal motion (my numeric diff). The CI emulator's health line reads "median frame 950 ms", so its recordings say nothing about smoothness. |
| 可访问性适配 (10) | 未评 | Text reports show 2.0× font, 360 dp, landscape, keyboard focus, screen-reader order and zh-rCN string parity all passing. TalkBack speech not verified. |
| 真实性性能 (5) | 未评 | Emulator with software GPU only; no phone. |
| 合计 / 各项≥70% | 不可计算 | — |

## 5. Coverage checklist
- [x] **Truthful connection claims, app:** `TunnelAuthority.seal` is used on every write and read. Home drops the sun, fill, timer and speed unless the link is LIVE.
- [x] **Notification and shared status:** sealed, session-fenced. Residual issue: F1.
- [x] **Desired vs confirmed identity:** `appliedNode`/`appliedMode` are used in Lines, the notification, Lanes and tile/widget detail. Transient leak: F4.
- [x] **Lifecycle, reconnect, concurrency:** TunnelLedger generation fencing; EngineClient callback epoch and dead-session filter; StatusFile version/elapsed ordering; DeathLog; RepostGuard. Read in source; t5 and t6 receipts read for both attempts.
- [x] **Credentials:** PublicStatus holds no tokens or email; backup is excluded; cleartext is off; the local test server only works on debug builds and loopback; the account is bound to the API base.
- [x] **Weakened protection:** none found in the UI path. F6 is a UX-level release of protection.
- [~] **Single-handed primary action:** checked from source and text reports; layout not seen.
- [~] **Large font, locales, landscape, small phone:** text reports only.
- [ ] **Materials and visual brand:** blocked.
- [ ] **Motion:** visual frames blocked; numeric only.
- [ ] **Original screenshots and recordings:** blocked.

## 6. Evidence actually inspected
- **Source:** TunnelAuthority, PublicStatus/SurfaceRules/StatusFile/DeathLog, ClaimRules, EngineWatch, NotificationWatchdog, TonoNotifications, TonoVpnService (full), EngineSnapshot, Probes, EngineClient, HomeScreen, TonoRoot, LinesSheet, DetailsSheet, Glass, Tokens, MainActivity, SystemSurfaces, SurfaceCopy, TonoTileService, TonoWidget, strings (en and zh parity), manifest and security XML, the LocalTunnelDeviceTest t3 block, and the desktop sea and theme files.
- **Text evidence:**
  - INDEX.md, `ci-redacted-text/device-counts.json` and `jvm-counts.json`.
  - Attempt 1: the t3 instrument output and stack, `local-t3-connecting-missing.xml`, the logcat t3 window, t5 and t6, and the summary.
  - Retry: t5, t6, health and summary.
  - `ci-raw/run.json` (head SHA, success).
  - Cloud: summary (24/24 PASS), a11y, interaction, glass, font-2.0, small-phone, landscape, keyboard, theme, screen-reader order, real tile/widget/motion, animations and motion-frames reports.
  - The manifest header and line count (61 rows), cloud-unit build-lint and mobile-test tails, and the git receipt.
- **Numeric video checks** (ffprobe and ffmpeg framemd5/tblend, nothing written to disk): metadata for all 7 MP4s, unique-frame counts, and consecutive-frame difference statistics for the normal and reduced JVM motion videos.
- **Not inspected:** all 61 cloud PNGs, the 3 contact sheets, the frame tar archives, about 78 CI tunnel PNGs including `local-t3-connecting-missing.png`, and the visual content of every video.

## 7. Not run / needs a real device
- No builds, emulators or tests were run by me.
- Unverified by anyone, according to the evidence: TalkBack speech, haptics, OEM skins, the live production service, a signed release, real-device energy and frame performance, an actual connected launcher widget, and the alarm backstop with the restart suppressed (F5).
- Licenses screen not captured. JVM screenshots exist only in zh-rCN, and the cloud 200% captures are fixtures.

## 8. Overall verdict
**INCOMPLETE.**
- Source and text evidence show a carefully fenced truth model, with no veto-level state misleading found.
- There are sub-second residual false-Connected windows on system surfaces (F1), a flaky first-attempt state observation (F2), and the minor issues F3–F7.
- Visual inspection required by the rubric was blocked by session policy, so no score or pass is given.

VERDICT: INCOMPLETE/100 | 否决: 无法判定（截图与视频画面因会话策略未检视）；源码与文本证据中未发现一票否决项
