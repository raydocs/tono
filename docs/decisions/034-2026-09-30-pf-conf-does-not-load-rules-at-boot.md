## 2026-09-30 · Should `/etc/pf.conf` keep loading the kill-switch rule file at boot?

- Status: provisional
- Chosen: no. The on-disk hook only declares `anchor "tono.killswitch"`. While the helper is enforcing, it loads the rules with one `pfctl -f` of a temporary copy that still contains `load anchor from`, so an already-enabled PF does not see an empty anchor. Rejected: leaving `load anchor from` in `/etc/pf.conf` (Safe Mode still runs Apple's pfctl and does not run this LaunchDaemon, so a block file or a stuck file survives the mode people use to recover). Also rejected: skipping protection only when `kern.safeboot` is set (BRICK-M10). This daemon does not run in Safe Mode; the boot path does not re-arm at all.
- Why stricter: a live Core can still install the block before PF is enabled. The cost is a short interval after boot, before the helper starts, where another program enabling PF evaluates an empty anchor. Safe Mode, where this helper does not run, no longer reinstalls the block from the rule file once this helper has rewritten the hook.
- Applied in: [#701](https://github.com/raydocs/tono/pull/701) (`KillSwitchPF.swift`); BRICK-M9, MAC-BOOT-DNS-ORPHAN.
