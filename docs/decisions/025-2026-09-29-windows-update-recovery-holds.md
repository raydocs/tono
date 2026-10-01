## 2026-09-29 · Does the Windows App's native-update recovery reconnect by itself after a restart?

- Status: provisional
- Chosen: no. The App starts the update-recovery Connect only when its own Adopt returned a certain answer
  that it is the successor the executor launched (`successor_relaunched` false). A later App after a
  restart, or an Adopt that failed or gave an uncertain answer, holds for the life of that App process, and
  the existing "update recovery incomplete" banner shows beside Protected Offline. The user's own Connect
  and Restore internet are unchanged. Rejected: a boot marker in the update receipt or attempt (changes the
  shared v1 contract with macOS); an App-side boot record taken at update start (would hold every connected
  user after the first routine update into this version); making `successor_relaunched` durable (a schema
  change in the shared transaction store).
- Why stricter: no Connect at logon that the user did not ask for. Nothing widens exposure. The cost is
  that recovery waits for the user; the 48 h receipt-expiry dead end stays open as BRICK-W6.
- Applied in: PR [#680](https://github.com/raydocs/tono/pull/680) (`tono/commands/update.rs` `Adoption`,
  `tono/commands/restore.rs`, Service `successor_relaunched`; BRICK-W1).
