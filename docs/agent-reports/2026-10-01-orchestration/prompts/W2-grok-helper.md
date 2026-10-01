## YOUR AREAS (slot W2-grok-helper; branch prefix `hunt/grok-helper-`)
Only Sol (and GLM) have reviewed these. You are the second strong model. This is the root helper, the most critical code.
- **M1**: `tooling/scripts/core-helper/{main,SocketServer,HelperPower,HelperHTTP}.swift`, `tooling/scripts/helper-shared/PeerAuthorization.swift`.
- **M2**: `KillSwitchPF.swift`, `KillSwitchManager.swift` (+ `KillSwitchTests.swift`).
- **M3**: `ProtectedDNSManager.swift`, `CoreManager.swift`.
- **M4**: `Update{Transaction,Storage,Runtime,Package,Executor}.swift` (+ `UpdateTests.swift`). These were never fully reviewed.

Hunt for:
- PF anchor/token lifecycle: rules left after crash, pfctl -E/-X token leaks, a flush affecting non-tono anchors;
- DNS snapshot/restore correctness;
- peer authorization bypass on the helper socket (local privesc);
- update package verification: signature/hash, path traversal on extraction, symlink races in root-writable paths, rollback;
- SIGTERM/KeepAlive restart paths;
- the fail-open-but-still-block-AI invariant.

Helper changes need the HelperProtocolVersion +0.0.1 bump and CONTRACT.sha256 regeneration (see the rules). Open at most ONE helper PR at a time, so you don't collide with yourself. Wait for it to merge before the next, or bundle related fixes.
In-flight: #761 #763 #765 #773 #794 #795 (and the user's #691: never touch it).
