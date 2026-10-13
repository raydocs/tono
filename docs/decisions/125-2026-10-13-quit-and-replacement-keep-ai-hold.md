## 2026-10-13 · Do Quit and account replacement fully release the selective AI-service hold?
- Status: owner (accepted; answered directly by the owner on 2026-10-13, not provisional)
- Chosen: Quit and account replacement restore ordinary internet but KEEP the selective AI-service
  hold, until Tono reopens and connects, or the user explicitly chooses Restore internet (the only
  full release). Crashes and automatic failures already keep the hold. Rejected: a full release on
  Quit (decision 073 already refused it on macOS), and a full release when a replacement sign-in
  retires the old account's runtime (#1120).
  - macOS Quit: unchanged in code. Decision 073 / #1445 already sends `POST /killswitch/quit`, which
    keeps an armed or retained hold, never installs one for an idle Mac, and yields to an explicit
    Restore. No helper protocol change, so `HelperProtocolVersion.current` stays 4.52.53. An older
    installed helper is repaired before the Quit release, exactly as for Restore internet, so the
    Quit path never needs the old full disarm.
  - Windows Quit (connected, and the no-product-state path): releases with the Service's narrow
    (AI-preserving) request. A Service that rejects the narrow payload falls back to today's plain
    release (existing `LegacyReleasePayload` path).
  - Windows replacement sign-in: the retirement inside `adopt_replacing_with` uses its own narrow
    disposition. Sign Out and Restore internet keep their full-release semantics, and a Restore
    that overlaps a Quit or a replacement dominates it (`begin_release` ANDs the dispositions).
  - A failed native update (`*_applying_narrow`) installs the hold only when one is owed: the
    session was armed, or an earlier automatic release left one. A user who was Unprotected, or had
    just chosen Restore internet, gets no new hold (#1293 item 4). Explicit Restore is the user's
    full release and is respected.
  - A second emergency release must not remove the hold the first one installed (#1055
    R3REGW-ROLLBACK-DOUBLE-HOLD). #1087 already made the reapply in place; a regression now pins
    the emergency path.
- Why stricter: nothing new is released. The AI hold stays through Quit and replacement, the same
  hold crashes already leave, and it goes away only on Restore internet or the next Connect. Ordinary
  internet is restored as before. Strict mode and fail-closed PF/WFP are untouched.
- Applied in: the macOS Quit copy and this decision (PR for #1052 macOS), the Windows Quit,
  replacement and update-failure code (PR for #1052 Windows, #1120, #1293 item 4, #1055 row).
  #1071 / #1504 (A13) is paused with another agent; it follows this decision when A13 resumes.
- Limits: the hold is best effort and does not promise that all AI traffic is blocked (see
  `selective-fail-open.md`). Native PF, WFP and NRPT behavior needs real hardware.
