# SESSION_STATE (iOS, thread T-01a14a94)

## Objective
Round 10 (Puck T-01a148c3, r9 reviews Opus 84 / GPT 86+veto): fix mode-apply state (desired/applied/pending,
no false "in effect", apply error visible while connected, fault-injection save/send/reload); P1s (mode one-liners,
gear vs Details apart, empty/invalid query feedback, edit-domain UI test); union items verified. Full green CI +
visuals, freeze, report Puck (archive commit first). Self-score private. No merge/TF/signing. Never claim a leak.
Previous:
Round 8 (Puck T-01a148c3): Settings length + dark glass (remaining design gaps), CI green, new evidence; FREEZE baseline,
report exact head/run/artifact/rubric location to Puck for independent blind review; self-score prepared locally only
(.amp/in/self-score-r8.md), not posted as formal until reviews exist. No merge/TF/signing.
Previous:
Round 7 (Puck T-01a148c3, 2026-10-18): glass (no dark pill), motion (connecting vs network change distinct, no title
overlap), then Settings/Details fewer words, one-handed paths, preview-tag layout. CI full green no skips, new shots,
formal per-item rescore (87 is current; ~7 device pts stay open). Report T-01a148c3. No merge/TF/signing.
Previous:
Round 5 (Puck T-01a148c3, 2026-10-18): from 88 toward >=95 on non-device gaps: Liquid Glass (glass-on-glass in
sheets, no GlassEffectContainer/interactive glass, no zoom morph from source, custom Settings header), Control
symbol brand, other round-4 fixables. Same rubric. CI green, new shots/video, per-item rescore with device-only
gaps listed. Push PR 1672 only; report T-01a148c3. No merge/TF/signing/licensing/Android.

## Decided
- New branch; old feat/ios-native-companion untouched. Official libbox alpha.12 25b0d5ea. Decision 129 provisional.
- Tokens app-only Keychain; extension rebuilds config from App Group inputs. Probes in app.
- Brand = apps/windows/app/scripts/generate-tono-icons.py draw_tile/draw_mark (not purple TO).
- Visual evidence only from GitHub-hosted macos-26 simulator (ios-ci.yml); no user runner.

## Active diffs
- round 5: Theme.swift (interactive glass, contentCard; GlassCluster reverted), HomeView (zoom sources/transitions, sheet cycle), SettingsView (NavigationStack, disclosure), Details/Onboarding cards, TunnelControl + tono.sun.on/off symbolsets (tools/generate-control-symbols.py), WidgetGallery controls, UITest settings scroll shot, preview-screenshots (17c, sheet-zoom.mp4)
- round 4: Status/, WidgetUI/, Widgets/ (new target TonoWidgets), App/Views/OnboardingView.swift, WidgetGallery.swift, TonoKit StatusSnapshot, decision 130
- apps/ios/** ; .github/workflows/ios-ci.yml ; docs/decisions/129-* ; docs/changelog.d/2026-10-17-ios-singbox-horizon.md

## Tool receipts
- swift test (Linux): 50/50 pass (TunnelStop + PrimaryAction red-checked)
- check-singbox.sh: 4 configs ok; two-module stub typecheck (.amp/in/stubcheck/run2.sh) App+PT: 0 errors
- CI fails fixed: UIKit link (aebd009), strings comment `*/` (a139e07), HTTP1.Failure public init (278c8c3)
- CI 39054122334 @278c8c3: ALL GREEN (libbox, Release device, Debug sim, 23 shots + video) = render round 1
- Round 1 findings: large-text layout, sheet show-through, fill flash up⇄up, title stacking, sim banner
- pushed 58119c5 = round 2 fixes; CI sub 6abbf165

## Verification
- CI 39057008451 @e0f5586 ALL GREEN (Release device + Debug sim + install/launch + 23 shots + video); artifact 12109818172 expires 2026-10-31
- UI round 2 scored 77/100 (not pass); PR verification comment posted (issuecomment-6238669350)
- CI 39071414305 @9a097b6: build/shots/6 interaction tests pass; 3 audit tests fail (unattributed hit/contrast; sheet text-clipped)
- CI 39074124929 @f8b589f: 6/6 interaction pass; contrast now attributed+measured pass; fails: sweep exitCapsule 4.1 (method artifact), section-label clip flags; AX5 en capture found real exit-capsule mid-word wrap
- CI 39078716807 @63066f0 ALL GREEN: 9/9 XCUITests (6 interaction + 3 audit), 46 shots, 3 videos; artifact 12118980608 until 2026-10-31
- Round 3 score 86/100 (auth/perf 4/5 host-only); verification comment issuecomment-6243397252; changelog da33078
- Reports sent: Puck T-01a148c3 + T-01a1463a, Android T-01a14a6e

- CI 39091191911 @35cdff4 ALL GREEN: 15/15 XCUITests (12 flows incl. real Dynamic Island LA, audits, perf), 55 shots, 3 videos; artifact 12122929452 until 2026-11-01
- swift test (Linux) 59 pass; red: testReasserting nil != NETWORK_CHANGED on old ConnectionState
- Round 4 score 88/100; changelog dbcae08 pushed; PR body updated; verification comment issuecomment-6245223035

- pushed 034ca9a (glass) then ea131b9 (settings disclosure); CI 39097275884 cancelled by 39097318071 @ea131b9; sub 6f7f229b

- CI 39097318071 @ea131b9 FAIL: sweep Cancel 1.2:1 / Disconnect 1.1:1 (GlassEffectContainer over label) -> 1b7e983 removed
- CI 39099937341 @1b7e983 ALL GREEN: 15/15, 57 shots, 4 videos; artifact 12126403272 until 2026-11-01
- Round 5 score 91/100; changelog 21ffa22; PR body updated; comment issuecomment-6246316587

- Round 6 (2026-10-18): Settings gear moved to Home bottom row (UITest bottom-third assert); mode one-liners; shorter copy. pushed 159ebad; sub b2161aff

- CI 39103718199 @159ebad FAIL 14/15: bottom-third Settings test passes; testAccessibilityAuditSheets red: sheet-settings UITextField (route check) text-clipped (shorter copy moved it into view). Artifact 12127933792 until 2026-11-01. Not fixed (freeze).

- Reviews committed verbatim aa4a751 (docs/agent-reports/2026-10-18-mobile-*); reply sent to Puck
- Review rework pushed 3861d8d (stale/dropped/reconnecting titles, Other line->Lines, route field wraps, AX capsule, gear glass+scaled, dots scale, LineNaming, zh Home, LA tag line, gallery top inset, settings badge inline, tests incl. ZZ real widget best-effort); TonoKit 60 pass; sub 9dd8c0a3
- Not adopted: offline Connect stays tappable (Android parity; starting arms On Demand) -> note in PR

- CI 39108037311 @3861d8d success but 17 pass + 1 SKIP (ZZ real widget: gallery rendered "Status unavailable", placement not found); artifact 12129919786. Not counted green.
- pushed f4553dc: ZZ test asserts system gallery lists "Tono status" (no skip), placement logged; LS rect stale footnote 2 lines; sub 3e7d21b2

- CI 39111212441 @f4553dc ALL GREEN 18/18, 0 skipped; REAL-WIDGET placed-and-read=yes; 60 shots, 4 videos; artifact 12131067795 until 2026-11-01
- Formal score 87/100 (reviews 83/83); changelog 91f7530; PR body updated; comment issuecomment-6248037573

- Round 7 pushed fc9c812: glass tint/rim, SkyState.reconnecting + sweep, AnyTransition.swap, Settings/Details fewer words, 2 new UITests (20 total), preview tags corner, state-cycle-en.mp4
- swift test (Linux) 61 pass; red: testNetworkChangeHoldsTheSunAboveAFirstStart with reason ignored -> "rising" != "reconnecting"

- CI 39114598985 @fc9c812 FAIL 19/20: SWEEP home-network-changed Cancel 3.5:1 (label alone on wide capsule; label box 14.6:1); video: sunrise replayed on connected->reconnecting (stale onChange reason); LS preview tag overlapped title. New tests both pass; title swaps sequential (frames checked)
- pushed 1a75705: session clock while reconnecting, CapsuleState onChange key, glass sheen, LS tags under widgets; sub created

- CI 39118209252 @1a75705 ALL GREEN 20/20, 0 skipped; REAL-WIDGET placed-and-read=yes; 61 PNG, 5 MP4; artifact 12134207150 until 2026-11-01; frames: reconnect keeps clock, no sunrise, sequential swaps
- Formal score 90.5 (self; 2.5 design + 7 device open); PR body updated; comment issuecomment-6249068471; changelog 9b34dea

- Round 8 pushed 5586651: route check Settings->Details (+UITest testRouteCheckInDetailsAnswers, 21 total), About 4->2 lines (contract digest into scope disclosure), glass catch-light (sun centre / moon right), sheen 0.08; shot 09b-details-full

- CI 39127157474 @5586651 FAIL 20/21: AUDIT sheet-details Settings row pushed off screen, 1.2:1 after scroll; artifact shows catch-light works
- pushed 217eb1e: route check inside routes card (prompt "Check a site, e.g. claude.ai"), Details spacing 18; removed check_hint/settings_check

- CI 39130734441 @217eb1e ALL GREEN 21/21, 0 skipped; REAL-WIDGET placed-and-read=yes; 64 PNG 5 MP4; artifact 12139096378 until 2026-11-01
- BASELINE FROZEN: code 217eb1e; tip f7b7ddd (changelog only). Self-score private in .amp/in/self-score-r8.md (not disclosed). PR body has rubric verbatim + score status; verification comment posted (no score)

- Puck: round-8 Opus blind review 83 (not pass); GPT blind review in progress. Stay FROZEN (no push) until Puck sends both full reports; do not fetch any review myself.
- Round 9 plan (on receipt): Details route answer hidden by keyboard -> make answer visible above keyboard; test must assert answer is actually visible (hittable / frame above keyboard), not only exists; then union of both reviews' findings; full green CI on exact head + new shots/video; freeze; ask Puck for next blind review; deliver self-score with reviews.

- Reviews archived verbatim d9afa6a: docs/agent-reports/2026-10-18-ios-r8-blind-review-{opus-5-5 (301f7acc, via download_thread_file), gpt-6-1-sol (83495344)}.md + note (scores side by side, self 91.5 disclosed beside, isolation). Puck told.
- Round 9 pushed 5662631: RouteCheck focus release + scroll + announcement + user-language answer + stale clear/recompute; Details detent grows on focus; Settings mode picker removed (Details only); include-all pending note; ReflectionColumn replaces ellipse catchLight; sheet smoke 0.6, contentCard 0.5; reconnecting sun 0.66 (red: 0.9 !< 0.72). UITests: 2 route-check tests (22 total). TonoKit 61 pass.
- Not adopted (again): offline Connect stays tappable; light appearance stays dark (brand)

- CI 39136687684 @5662631 FAIL 21/22: AUDIT sheet-settings label not human-readable (bare email now in view). Both route-check tests pass; shots show answer visible + Stable recompute.
- pushed b36d07d: "Signed in as …" account row

- CI 39140462842 @b36d07d ALL GREEN 22/22, 0 skipped; REAL-WIDGET placed-and-read=yes; 65 PNG 5 MP4; artifact 12142836958 until 2026-11-01
- BASELINE FROZEN (round 9): code b36d07d; tip 8dd22e2 (changelog only). Self-score r9 private .amp/in/self-score-r9.md (89.5). PR body: r8 reviews + self side by side, r9 section; verification comment issuecomment-6252217753

- r9 reviews archived verbatim 894360d (opus + artifact-sha256, gpt + inventory/manifest/receipt, note: verdicts not averaged, self 89.5 beside); changelog has source check; Puck told (first reply)
- Source check: save try? swallowed; send nil == success; derive .connected ignores failure; libbox 25b0d5ea StartOrReloadService closes old before new (no graph after core refusal)

- Round 10 pushed 7c52c6a: RouteApply (TonoKit) + explicit ReloadReply + extension restore + routesStopped; AppModel desired/pending/failed; Details segments + plain lines + check feedback + keyboard scroll; gear/Details apart; clock/rate overlap; contrast; 3 UI tests + LA end + placed assert; findings IOS-1672-R9-*
- swift test (Linux) 66 pass; red (mutation to b36d07d contract): 4/5 RouteApplyTests fail, 8 assertions (.amp/in/red-r10.txt); PT stub typecheck 0 errors
- auto CI subscription refused (opt-out) -> bounded gh run watch

- CI 39147800209 @7c52c6a FAIL 24/25: invalid-query message cleared by newline onChange; new tests (refused mode, edit clears, LA end, placed) pass; shots: refused note OK, gear/Details apart, no LA in widget shot; fixed title ROUTES_STOPPED, AX5 segments, clock delay, home shot
- pushed a6aba1b (fixes)

- CI 39152384717 @a6aba1b FAIL 23/25: refused test loop never swiped (Details title not hittable); AUDIT sheet-details Settings 1.2:1 at y807 (near sheet bottom). Invalid-query + routes-stopped title + AX5 segments OK.
- pushed 436f367: Details shorter (1-line mode lines, spacing 14, lanes 48), test swipes until routeNote hittable

- CI 39156608142 @436f367 FAIL 24/25: only AUDIT sheet-details Settings 1.2:1 again (now y762); video shows Apple audit resizing text mid-run -> race. Refused-mode test passes now.
- pushed 90822de: contrast flags failing in-callback re-measured after audit (decides; both logged)

- CI 39160461314 @90822de ALL GREEN 25/25, 0 skipped, placed asserted; 70 PNG 5 MP4; artifact 12150076988 until 2026-11-01; ci-gate 39160465005 success; frames checked (clock after fill, no rate morph)
- BASELINE FROZEN (round 10): code 90822de; tip 16e9b2b (changelog only). Self-score sealed .amp/in/self-score-r10.md sha256 bfb994c5... (87.5, undisclosed). PR body updated; verification comment issuecomment-6254897149

## Next
report Puck (T-01a148c3) baseline for round-10 blind reviews; then wait (no pushes)
