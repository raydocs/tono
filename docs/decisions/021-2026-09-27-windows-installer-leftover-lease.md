## 2026-09-27 · Windows installer gate: which leftovers may it clear itself, and when does the uninstaller hand back its lease?

- Status: provisional (agent). Reason codes on every refusal, and Chinese + English dialogs with
  Russian repeating the English text, are owner decisions (2026-09-27).
- Chosen: the gate clears by itself only a core runtime record whose Core is gone (the pid exited
  or now runs another image) and only when no Tono Service is registered. It does not remove a
  leftover `Tono` network adapter (the dialog says restart, then Device Manager), does not treat an
  unreadable active-owner record or a DNS restore that carries a note as absent, and does not
  auto-retire a stale connected owner (that stays the confirmed 78 path). The uninstaller hands
  its manual lease back at the end of its Uninstall section instead of when its window closes; an
  aborted section keeps the lease as before. Rejected: PnP removal of the adapter from the elevated
  helper, quarantining owner or DNS evidence in the gate, one generic code with the cause only in
  the log.
- Why stricter: residual Tono WFP filters with no Service still need the 78 consent, active
  protection still refuses with 77, and nothing that can hold or re-arm protection is cleared. The
  one automatic clear is a record for a process that no longer exists, with no Service left to
  write another; the earlier lease release follows the section's last change and never an abort.
- Applied in: `fix/windows-gate-reasons-20260927` (WIN-GATE-OPAQUE).
