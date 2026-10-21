PRIVATE implementer self-score, round 11, code head c2f8762977360d8f2c953bf787651b8c5ad825df (iOS CI run 39184374749, artifact 12159295214; ci-gate 39184377684).
Written 2026-10-19 after the green run, before any round-11 review. NOT disclosed to reviewers. Rubric unchanged; device/signing gaps not counted.
Calibration: r8 self 91.5 vs 83/87.5; r9 self 89.5 vs 84/86+veto; r10 self 87.5 vs 81+veto/86+veto+authenticity floor. Self ran 1.5-8.5 high and twice missed the veto path.
| Item | Max | R10 Opus | R10 GPT | R11 self | Basis |
| Hierarchy / few words | 20 | 17 | 18.5 | 18 | unchanged layout; "Couldn't confirm" / "Unconfirmed" add words only in fault states; AX5 title one word per line |
| One-handed | 20 | 16 | 17 | 17 | line pending on Home capsule; switch rows tappable full width; Close 44 pt (top right, still a reach; swipe closes) |
| Brand | 15 | 13 | 13.5 | 13.5 | unchanged visuals; widget Retry uses brand fill |
| Liquid Glass | 15 | 12 | 13 | 12.5 | Close becomes a glass circle over the bar; otherwise unchanged; no grabber on one-detent sheets |
| Motion | 15 | 11 | 13.5 | 13 | app reload no longer shows Network changed/Cancel (source + typecheck only); pending spinner on Home; reconnecting vs partly-working skies still alike in stills |
| Accessibility | 10 | 8 | 7.5 | 8.5 | AX5 audits + Lines/degraded/network-changed; audit-independent AX5 sweep 172 elements 0 failures; contrast method fixed with CI calibration (3.3/4.4 fail, 16.2 pass); real fixes found by the sweep (Close, switches, grabber, title mid-word); VoiceOver not run by a person |
| Authenticity/perf | 5 | 4 | 3 | 3.5 | heartbeat->shared snapshot->widget/control chain executed on Linux CI (TonoKit) and rendered in simulator gallery; real extension and device NOT executed; widget on Home Screen still "Status unavailable" (no App Group unsigned) |
| Total | 100 | 81 (veto) | 86 (veto, floor) | 86 | Veto path (heartbeat) judged fixed: source + executed unit chain + simulator render; not verified in a real Network Extension or device, so a reviewer may still weigh it as unproven |
Not 95. Below 95 mainly on: device authenticity (unverifiable here), glass/motion polish unchanged this round, one-handed top-right Close.
