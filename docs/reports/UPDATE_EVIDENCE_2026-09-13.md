# G3 unreadable update evidence — 2026-09-13

Both clients used their *resumable* journal loader to decide whether to show
the incomplete-update warning. Corrupt, unsupported or expired records yielded
no resumable journal, hiding the warning even though evidence remained on disk.

The status check now distinguishes a genuinely missing journal from an
unreadable/expired one. Valid active updates are not labeled failed. Known
committed/idle records do not warn. No failed/corrupt/expired evidence is erased
by the new warning path; no resume permission or phase transition was added.

Evidence:

- macOS: the new file-backed XCTest failed at both corrupt and expired warning
  assertions before the fix. The matching journal target passes 20 tests after.
- Windows App: the new file-backed Rust regression failed at the corruption
  assertion before the fix. Both update-handoff tests pass after (Mac host with
  the existing `clippy` test feature; native Windows CI still required).
- Tests use temporary files and verify byte-for-byte retention. They do not
  change the installed helper, network or the user's real update journal.

This is a diagnostic-truth fix related to #26, **not closure of #26**. Installer
identity/target-version binding, Service/WFP ownership transfer, and installed
Windows/macOS successful/failed update exercises remain required by G3.
No sing-tun change, production deployment, version bump or feed promotion.
