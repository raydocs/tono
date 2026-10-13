## 2026-10-13 · An update executor that dies before it stops the Service: leave the machine Blocked, or release?
- Status: provisional (the owner may overturn it; only the owner sets `owner` or `reversed`)
- Chosen: the App watches the install after the Service launched the executor
  (`watch_executor_launch`, `apps/windows/app/src-tauri/src/tono/commands/update.rs`). A Status that
  still says `Launching` 120 s later (polled every 2 s), or says `Staged`/`Reserved`/`Extracting`, means
  the executor never consumed the install: it was killed, found a repair already running, refused its
  image binding, receipt or staged components, or the receipt expired. The App then restores internet
  through the same update-aware automatic release as a failed Prepare
  (`disconnect_for_generation`, `DisconnectApplyingNarrow`): general traffic is released and AI-service
  destinations stay blocked (decision 031). An explicit strict kill switch is refused by the Service and
  stays Blocked. No refusal is special-cased: a binding, tamper or expiry refusal happens before the
  executor consumes anything, so no installed file has changed and the install can be offered again.
  A Status that cannot be read, or any state past `Launching`, is not a loss: the executor stops the
  Service for a real install, and its own recovery owns the update. The same change flushes the
  session credential writer (retrying a failed vault write) before the executor starts, because the
  executor ends the App with TerminateProcess and skips the exit flush; a flush that still fails is
  logged and does not block the update. Rejected: leaving the machine Blocked until a Service restart
  or a manual Restore internet (a restart only returns `Launching` to `Staged`); releasing on every
  refusal except tamper (a tamper refusal changed nothing, so keeping the user offline protects
  nothing); a Service-side watchdog (`core/update.rs` is being changed for #1307 and needs the
  executor's process identity, which the App cannot read); refusing the update when the session cannot
  be flushed (a vault that cannot be written would then block every update).
- Why stricter: nothing is loosened beyond what a failed update already does. The release is the
  automatic one decision 031 prescribes, it keeps the AI hold, it never overrides an explicit strict
  kill switch, and it runs only when the Service itself says the executor consumed nothing. The
  cost is a wait of about two minutes (plus one Status look of at most 5 s) offline while the executor
  is slow or dead. A very slow executor that tries to consume after the release is refused: the
  release records the disconnect on the attempt first, and an attempt with a recorded disconnect
  grants no further authority (`Store::live_attempt`). While an executor holds the transaction lock the
  release is refused (the store is busy) and protection stays as it was; the two never work in
  parallel, and the release is not retried. The
  slow-executor case is therefore never worse than a user pressing Restore internet at that moment.
- Applied in: the PR from `claude/win-update-executor-watch`; finding `R2UA-F2`
  (#1055).
