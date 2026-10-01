Normal Quit removes the AI hold. Existing docs deliberately require full release on explicit Disconnect, so runtime behavior remains unchanged pending a policy decision.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| MAC-QUIT-AI-HOLD | macOS | P1 | AppDelegate.swift:350 | Quit removes AI floor | Real-unfixed: decision item in #1031 |
| MAC-QUIT-AI-HOLD-WATCHDOG | Helper | — | SocketServer.swift:250 | Watchdog could restore hold | False positive: required intent was deleted |
| MAC-QUIT-AI-HOLD-WINDOWS-PREMISE | Windows | — | commands/quit.rs:331 | Explicit Quit preserves hold | False positive: connected Quit fully releases |

[PR #1031](https://github.com/raydocs/tono/pull/1031): docs-only, `needs-hardware` applied, **auto-merge off**, CI passed.

**2 false positives; 3 hypotheses examined.** Focused audit complete. Native Swift/PF/DNS testing was unavailable; the behavior fix awaits policy reconciliation.