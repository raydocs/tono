# G3: account restore is not protected update verification

Baseline: `1d00b581dffdd98e84821c8789eb0c46b7a21bed`.

Windows `tono_prepare_update` can record `wasConnected: false` together with
`keepKillSwitchArmed: true` when updating from Protected Offline. First launch
advances that journal to `ProtectionResuming`; account restoration previously
called the verified-connection commit path whenever `wasConnected` was false.
That could persist Verified/Committed and erase the journal without a new
verified connection. This is a false recovery receipt, not a demonstrated WFP
traffic leak.

The account-restore path now requires both original protection flags to be
false and an affirmative Service observation that protection is absent. Armed
or unknown Service state is not absence. Protected recovery still commits only
from the existing post-verification connection path; phases, installer behavior,
and PF/WFP rules are unchanged.

Evidence:

- One file-backed App regression failed before the guard: account restoration
  incorrectly returned a successful commit for the Protected Offline journal.
- After the fix, the same test retains protected/unknown evidence byte-for-byte,
  still permits the verified-connection owner to commit, and permits a genuinely
  unprotected first launch with proven absence to commit.
- Mac-hosted App library: 476 tests passed with the existing `clippy` feature;
  the three update-handoff tests also pass. Native Windows CI is required before
  merge; these tests do not exercise an installed Service or WFP.

Related to #26 / SHIP_PLAN G3, not closure of that issue. Installer-bound identity,
target version, cross-process protected ownership and installed-device acceptance
remain open. No deployment, version bump, customer-feed promotion or core change.
