## 2026-10-11 · The sign-in screen reads a typed, request-bound recovery outcome; support shows only once the request has ended
- Status: provisional (owner direction via Puck 2026-10-11: login cleanup with support shown low-key only after bounded
  recovery is exhausted; the UI may not infer that state from copy, a timer, a retry count or Protected Offline; recorded
  by the coordinator, which owns the native side)
- Question: the sign-in screen had only an error string. Windows' `TONO_RELAYS_UNREACHABLE` says that one request walked
  the relays; the Mac's `ControlPlaneUnreachable` attempts/stoppedEarly were flattened to text before `LoginView`. Neither
  said whether Tono was still trying, so the UI could not show a support entry without guessing.
- Chosen: each sign-in request (send code; verify code through adopting the session) is one bounded operation: the
  control-plane walk (the relays alone without a tunnel, decision 091) inside the client's own bounded retry (Mac two
  attempts; Windows one transport retry). Native code publishes `signInRecovery` (Mac `AccountSession.signInRecovery`,
  Windows `TonoStatus.signInRecovery`):
  - `operation`: process-local request count; a newer request, a dismissal (another email, sign-out) or a success
    replaces or clears it, and the end of a request that was replaced does not land.
  - `step`: `sendCode` | `verifyCode`.
  - `phase`: `automatic` while the request is in flight; `userAction` once it ended in a recovery-relevant failure and no
    attempt of it is scheduled. Only then may the UI show the low-key support entry. `userAction` says nothing about
    later network changes, and the user's retry starts a new request.
  - `cause` (allowlisted classes, no address, host or account value): `relaysUnreachable` (every route the walk had,
    the relays included, failed), `network` (any other unanswered request, including one stopped early so a request
    that may have arrived is not sent twice), `clock`, `interception`, `service`; Windows also `captive`,
    `localConflict`, `localStore`.
  - Absent: no request, a success (a sent code included: waiting for the email is not a failure), a cancellation, or
    an answer the user acts on directly (wrong or expired code, rate limit, device limit, refused or suspended account,
    Keychain/session-save failure with its own copy).
  Protection is a separate state: recording or clearing an outcome never reads or changes the kill switch, PF or WFP,
  and the background protection recovery never writes it. Windows adds `tono_sign_in_dismiss` for the screen's
  "use another email".
  Rejected: a timer or count of failed requests (not the scheduler's own end; would hide support forever on a network
  where every request fails the same way, or show it while a retry is still running); deriving it from the error copy.
- Not covered: a request the user leaves in flight on the Mac (the email field is locked while it runs); the
  protection side's own exhaustion signal (separate, not this decision).
