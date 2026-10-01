## 2026-09-26 · Windows: which vault session does the next launch trust after a sign-in that did not finish saving?

- Status: provisional
- Chosen: a sign-in always marks the local session marker pending (also over a
  committed marker) before it retires anything, and commits it only after the new
  session is durable in the vault. A sign-in that ends before its session reaches
  the vault (release refused, superseded, `client.adopt` failed) puts back the
  marker as it was before any sign-in was in flight, because the vault still holds
  what that marker described; a pending marker it puts back belongs to an adopted
  sign-in whose commit task is still running. Once `client.adopt` has queued the
  new session, a crash or a commit that never lands (the commit task retries until
  the process exits) leaves the marker pending, and the next launch treats the vault
  session as not owned: the user signs in again, through main's existing
  unowned-session path, which releases stored protection when the Service reports
  it armed. Rejected:
  restoring the previous account's committed marker after the new session was
  queued, which would let the next launch silently restore the previous account or
  trust a session that never reached the vault.
- Why stricter: once a switch has handed its session to the vault, no account is
  resumed unless this installation proved that session durable. The cost is a
  re-login. No new sign-out or release path is added; the existing unowned-session
  path handles the case.
- Applied in: [#642](https://github.com/raydocs/tono/pull/642) for
  [#409](https://github.com/raydocs/tono/issues/409).
