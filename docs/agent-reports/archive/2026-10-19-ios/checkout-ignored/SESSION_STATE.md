# SESSION_STATE (iOS, thread T-01a14a94)

## Objective
Round 12 (Puck T-01a148c3; r11 Opus 83.5 no veto, GPT 84 + a11y 65% floor + F2 veto; archived 9a3e279):
F1 fix Cancel on Preparing/Connecting gradient fill (real UI) + local glyph-vs-local-background measurement +
Preparing coverage, mixed-gradient negative control; F2 unconfirmed -> all lanes/exits conservative + screenshot
regression; F4 app/tunnel status write race both directions (real shared file, locking, writer rule) + fault
evidence; F3 put-back obligation kept when later save fails; raw receipts (mutation red, stub typecheck) archived;
honest sweep counts (unique). Green exact head, freeze, seal self-score, reply Puck. No merge/TF/signing.
## Decided
- Official libbox alpha.12 25b0d5ea (StartOrReloadService closes old graph first). Decision 129 provisional.
- Visual evidence only from GitHub-hosted macos-26 (ios-ci.yml); no user runner.
- Not adopted: offline Connect stays tappable; light appearance stays dark.
- r10 reviews archived verbatim 1fc38d6 (6 hashes matched); self 87.5 sealed published beside.

## Active diffs
- TonoKit: StatusSnapshot (fromTunnel routing:, StatusWording), TunnelGraph (new), RouteApply (status, unconfirmed, report.unsaved)
- PacketTunnelProvider (TunnelGraph, heartbeat, no reasserting on app reload); WidgetUI/Widgets (wording, Retry); TunnelCommand (reload while up)
- AppModel (unconfirmed, unsavedRoutes, routeNote, previewApply faults silent/putback/slow); Details/Lines/Home/Settings; WidgetGallery card+control; strings
- UITests (+5 tests, AX5 audits +3, sweep); preview-screenshots (+5 shots); findings IOS-1672-R10-* (5); changelog

## Tool receipts
- swift test (Linux) 69 pass; red mutations M1-M4 all fail as expected (.amp/in/red-r11.txt)
- stub typecheck PT: 0 errors (check catches reintroduced graphRunning); App model+services: only pre-existing TunnelCommandError (AppIntents)
- r10 baseline: CI 39160461314 @90822de green 25/25; artifact 12150076988

- r12 receipts committed d8f4289 (docs/agent-reports/2026-10-19-ios-r12-receipts): swift test 74/74; M1-M7 all exit 1; stub PT/App 0 err; negative control 1 err
- CI 39192116052 @aae2681 FAIL 30/33: label metric all phases pass (prep 10.05, conn 9.22; old-fill probe 4.40 fails); real: AX5 sign-in subtitle over moon 2.8 (fixed: no moon at AX sizes); artifact: widget orange line 1.2 (fixed: eroded cores; offline r11 Cancel 2.99/3.81 still fail); probe rows moved (capsules own screen)
- then: widget truncation fix (ViewThatFits), audit waived tally; offline-label receipt 57d0564
## Verification
- CI 39184374749 @c2f8762 ALL GREEN 31/31, 0 skipped; AX5 sweep 172/0; probe 3.3/4.4 fail 16.2 pass; REAL-WIDGET placed; 79 PNG 5 MP4; artifact 12159295214 until 2026-11-02; TonoKit Linux 69/69; ci-gate 39184377684 success
- BASELINE FROZEN (round 11): code c2f8762; tip f63a947 (changelog only). Self-score sealed .amp/in/self-score-r11.md sha256 bedebcfb... (86, undisclosed). PR body updated; verification comment issuecomment-6258154835
- CI 39167318732 @3008c96 FAIL 28/30: AUDIT sheet-details Settings 1.2:1 after audit too (offline: 97th pct 1.19 vs glyph 15.27, ink 2.1% -> method artifact); AX5 sweep only Sheet Grabber 76x25. New 5 tests pass.
- fix: measuredContrast = 90th pct of ink (>=1.5:1), logs both; calibration probe test (3:1, 4:1 fail; primary pass); grabber hidden on single-detent (AX) sheets, sweep unchanged (no exemption); AX5 title one word per line (Reconnectin/g)

## Next
poll iOS CI @880012a (sleep<=600 loops); on green: inspect primary-label-*, contrast-probe-*, a11y-largest-text-en-signin/widgets, details-mode-unconfirmed; then PR body, verification comment, seal self-score, reply Puck
