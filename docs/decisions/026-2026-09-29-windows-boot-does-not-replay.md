## 2026-09-29 · After an unexpected restart on Windows, does the Service start the Core by itself, and does the App say why it did not?

- Status: provisional
- Chosen: no replay, and no new notice. The Service replays a run intent only if the intent was recorded
  in this boot (the volatile `BootSession` marker) and a wanted barrier was restored. Otherwise it holds
  the Core stopped with the barrier up until the user connects, and it does not rewrite the intent. The App
  shows its existing Protected Offline state. Rejected: a clean-shutdown marker that would replay after a
  crash, since holding is stricter; an App notice for the hold (plan OQ1, left open because it needs new
  UI strings); rewriting the intent at a held boot (a boot-path write that can fail, and it erases evidence).
- Why stricter: nothing connects before logon without the user, and fail-closed is unchanged, because the
  barrier stays up while the Core is held. The cost is availability. The user connects once after a crash,
  a blue screen or a power loss, and taps Retry once after a planned restart whose logoff release did not
  finish.
- Applied in: PR [#680](https://github.com/raydocs/tono/pull/680) (`core/boot_session.rs`,
  `core/desired.rs`; BRICK-W1); plan PLAN-win-boot-uninstall r3, plan review 38c453fa.
