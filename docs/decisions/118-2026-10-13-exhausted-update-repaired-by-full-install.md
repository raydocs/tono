## 2026-10-13 · How does a Windows machine leave an update record whose recovery is exhausted?
- Status: provisional (the owner may overturn it; only the owner sets `owner` or `reversed`)
- Chosen: a verified full install repairs it. An attempt that is Consumed or Uncertain, whose
  recovery failed `MAX_RECOVERY_RUNS` times and that has no live executor lets the install chain
  pass: `begin_manual` takes its lease beside the record, `maintenance_allowed` and
  `enter_repair_gate` pass only under that lease, and `State::validate` accepts a lease next to a
  Consumed or Uncertain attempt. `finish_manual` then archives the attempt (`retired-<id>.json`,
  consumed high-water and generation kept, recovery task retired) only when the installed three
  components equal the attempt's original or its signed target and every durable plan member is on
  the same side; the target side also removes the retained rollback copies. Any other result
  (another release's bytes, a mixed tree, an unreadable member) leaves the record pending and
  still hands the lease back. The Check refusal and `needs_attention` carry the instruction, which
  the App shows as its update-check error. Rejected: clearing the record (it would drop the evidence
  and the consumed-sequence high-water, so the failed release could be replayed), a repair that
  archives after any successful install (a newer release's bytes are unproven against this
  record), and a repair for uninstall or for a Replaced attempt (a live successor may still adopt
  it; uninstall removes everything and keeps its refusal).
- Why stricter: nothing is released or relaxed. Protection, the fail-closed filters and the DNS and
  Core-absent checks of the install gate are unchanged; only the update-record refusal is lifted
  for a record no process can still advance. The archive keeps the evidence and the high-water.
  A newer signed update whose components are all proven is not added: Prepare and Check still
  refuse a pending record, and a newer full install passes the gates but leaves the record
  pending until the original or the target is installed. The owner may overturn this.
- Applied in: PR for #1307 (`claude/svc-repair`).
