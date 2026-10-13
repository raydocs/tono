## 2026-10-13 · Does a pending Windows update keep blocking other users after its receipt expires?
- Status: provisional (the owner may overturn it; only the owner sets `owner` or `reversed`)
- Chosen: an update attempt that is past its 48 h receipt expiry, was never consumed (the
  consumed high-water is still below its release sequence) and has no live executor is archived
  (`retired-<attempt>.json`, the high-water and generation kept) the next time any caller opens the
  store through `lifecycle_allowed`, `release_allowed`, `pending()` or an update request; the
  read-only release admission and the `/status` pending flag treat it as not pending without
  writing. A consumed attempt (Consumed, Replaced, RolledBack, Uncertain) keeps blocking whatever
  the clock says. Rejected: letting another user's Disconnect or release cancel the owner's
  unexpired attempt (any local user could then drop the owner's recovery obligation and protection
  state), and expiring consumed records (their recovery obligation outlives the receipt).
- Why stricter: it frees only a record that `live_attempt` already refuses, so it grants no install,
  no consumption and no release authority. It never lowers the high-water, so the same release cannot
  be replayed. An unreadable clock or store counts as not expired, and a failed archive leaves the
  record pending. Within the 48 h a second user is still blocked behind an unconsumed attempt: that
  window is the price of not letting one local user cancel another's update.
- Applied in: PR for #1293 items 3 and 5 (`claude/svc-pending-owner`).
