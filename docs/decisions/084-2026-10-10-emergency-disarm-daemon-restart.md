## 2026-10-10 · After `--emergency-disarm` stops the macOS helper daemon, does it start it again?
- Status: provisional (backlog A13 while the owner was asleep; the owner may revisit)
- Chosen: the operator's `sudo …/tono-core-helper --emergency-disarm` boots the daemon out first (R3-O4) and leaves
  it stopped after a finished release (PF released; DNS restored, or a surviving Core reported). The operator restores
  normal operation by reopening Tono and approving the administrator prompt, or with
  `sudo launchctl bootstrap system /Library/LaunchDaemons/com.raydocs.tono.core-helper.plist`; the plist stays, so it
  also starts at the next restart. When the release did not finish (PF release refused, or DNS not restored), or it
  reported success but does not read back clean (a DNS snapshot still pending, a service or the active resolver still on
  Tono's 127.0.0.1, or Tono's PF block still in effect — an update disconnect can swallow a DNS write failure), the
  command bootstraps the daemon again, as `--emergency-reset` already does for refused/DNS-failed outcomes, because the
  daemon's start releases a leftover block and retries the DNS restore (#1165) and nothing else would. Only launchd's
  definite "no such service" (exit 113) counts as not loaded or stopped; a launchctl that fails or runs out of time
  is "unknown" and is treated as possibly stopped (restart on an unfinished release; bootstrap of a still-loaded
  daemon only fails). A daemon launchd definitely did not have is left alone, as before. The bootout phase is
  hard-bounded to 20 s of wall time (each launchctl call: deadline, SIGTERM, SIGKILL, then abandoned).
  Rejected: always restarting the daemon (it would be a second writer again right after the release, and a GUI
  request could re-arm what the operator just released); never restarting it (an unfinished release would be left
  with no process able to retry it).
- Why stricter: the escape hatch never waits on, or fails because of, launchd; no new command or socket request; PF
  and DNS release are the same calls as before.
- Applied in: [#1504](https://github.com/raydocs/tono/pull/1504) (backlog A13, helper 4.52.45).
