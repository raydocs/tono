## YOUR AREAS (slot W1-grok-mac-config; branch prefix `hunt/grok-maccfg-`)
Only Sol has reviewed these. You are the second model.
- **M9**: `apps/macos/Tono/Core/ConfigPipeline.swift`, `Core/Configuration/*`, `Services/ConfigParser.swift`, `Core/ManagedTrafficPolicySignature.swift`, `Services/Catalog/*`, `Services/ProviderRuleLoader.swift` (if present), `Services/ManagedDirectRefreshPolicy.swift`.
- **M10**: `Services/AppState+Catalog.swift`, `AppState+Proxy.swift`, `Core/SystemProxy.swift`, `AppState+NativeUpdate.swift`, `NativeUpdateDownload.swift`, `UpdateHandoffJournal.swift`, `UpdatePreparation.swift`, `App/AppUpdater.swift`, `AppState+Subscriptions.swift`, `SubscriptionManager.swift`, `Support/SubscriptionURLPolicy.swift`, `AppState+RouteChoices.swift`.
- **M11**: `Services/AccountSession*.swift`, `Services/Account/*`, `TonoAPIClient.swift`, `ControlPlanePath.swift`, `KeychainStore.swift`, `TonoIdentityProviders.swift`.
- **M12**: `ProtectedConnectivityVerifier.swift`, `ProtectedConnectivity.swift`, `ProtectedDNSProbe.swift`, `ProtectedSystemResolver.swift`, `TonoSidecarService.swift`, `Core/CoreWebSocket.swift`, `Core/CoreControllerClient.swift`, `ProxyService.swift`.

Hunt for:
- generated sing-box/mihomo config that could route AI domains or IPs DIRECT, or break DNS;
- signature verification gaps (policy, catalog, update package, appcast);
- subscription/URL parser edge cases (unicode, IPv6, ports, percent-encoding, huge inputs);
- update download/handoff crash windows;
- token refresh races and keychain failures that suspend the account or stop the core.

Property/fuzz-style tests for the parsers are welcome.
In-flight: #744 #730 #781 #785 #788 #795, plus codex2 mac-catalog-switch-target, mac-account-token-fixes, mac-websocket-stall and ai-direct-suffix-guard. Do not redo those.
