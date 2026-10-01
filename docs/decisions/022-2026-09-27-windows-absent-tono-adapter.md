## 2026-09-27 · Windows installer gate and lock: a Tono adapter that is not present is neither a refusal nor a tunnel

- Status: provisional. The requirement is the owner's (2026-09-27, relayed): a leftover `Tono` adapter must not block
  a reinstall, and it may be removed only if leaving it breaks connecting. The mechanism below is
  the smaller option the owner asked to evaluate (agent, plan PLAN-stale-adapter r3, plan review
  1e546b82).
- Chosen: the manual-install gate, and every other `tunnel_present` / `tunnel_absent` caller,
  counts an interface named `Tono` as present only when Windows reports any status but
  `IfOperStatusNotPresent`; a gate that sees only not-present rows passes and notes them in
  install-gate.log. The WFP lock treats a not-present row, or `ERROR_FILE_NOT_FOUND` from
  `GetIfEntry2` after the alias resolved, as the existing retryable "did not resolve to a LUID"
  state. Nothing is removed. Exit 87 and `TONO_INSTALL_TONO_ADAPTER_PRESENT` stay for a present
  adapter; the 87 dialog no longer sends the user to Device Manager.
- Rejected: A. remove the leftover from the elevated helper (SetupDi `DIF_REMOVE`); B. have the
  Service remove it before StartClash; C. stop the Core gracefully; D. relax only the gate and keep
  `tunnel_absent` strict; E. only reword the 87 dialog; F. remove only a different-device leftover
  at the gate; G. make "tunnel LUID changed" retryable in the App; H. retry every `GetIfEntry2`
  failure.
- Why stricter: a present `Tono` adapter still refuses (a present WinTUN device always has a live
  owner); the tunnel permit is never keyed to a missing or not-present interface; every other
  row-read failure stays a permanent refusal; no privileged device code is added.
- Supersedes: the adapter clause of 2026-09-27 "which leftovers may it clear itself…" (the gate
  still removes no adapter, but no longer refuses a not-present one, and the dialog no longer names
  Device Manager). That entry's status is unchanged.
- Applied in: `fix/win-ghost-tono-adapter-20260927` (WIN-GATE-GHOST-TUN).
