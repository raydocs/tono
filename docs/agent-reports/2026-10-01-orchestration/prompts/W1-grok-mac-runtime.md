## YOUR AREAS (slot W1-grok-mac-runtime; branch prefix `hunt/grok-macrt-`)
Only Sol (and GLM) have reviewed these. You are the second strong model.
- **M5**: `apps/macos/Tono/Core/{HelperManager,HelperProtocolVersion,PrivilegedRuntimeCoordinator,RuntimeCleanup,NetworkProtectionOperations,CoreRuntimeManager}.swift`.
- **M6**: `apps/macos/Tono/Services/AppState+Connect.swift` (2515 lines: the connect FSM, monitor, repair, reconnect).
- **M7**: `Services/AppState.swift`, `Core/ExitHeal.swift`, `Services/AppState+LaunchProtection.swift`, `Services/AppState+Persistence.swift`, `Services/Persistence/*`.
- **M8**: `App/AppDelegate.swift`, `Services/PhysicalNetworkReachability.swift`, `Services/NetworkUplinkSnapshot.swift`, `Services/KillSwitchService.swift`, `Services/Connection/ConnectionCoordinator.swift`, `Services/Connection/ProtectedReconnectSchedule.swift`.

Hunt for:
- Swift concurrency bugs: actor reentrancy across `await`, `Task` cancellation not checked, `@MainActor` violations, continuations resumed twice or never;
- state flags not reset on error paths;
- quit/terminate while connecting;
- sleep/wake and network-change races;
- app crash leaving the helper armed;
- persisted state that blocks the next launch.

In-flight PRs: #720 #738 #756 #760 #774 #778 #782.
Helper-side files are NOT yours; another slot owns them later. If an app fix requires a helper contract change, report it instead of fixing it.
