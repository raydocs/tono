import Foundation

nonisolated struct InitialDiskSnapshot: Sendable {
    let proxyRegions: [ProxyRegion]
    let rules: [RuleItem]
    let cachedCatalog: ManagedExitCatalogCache?
    let cachedTrafficPolicy: ManagedTrafficPolicyCache?
    let config: ClashConfig?
}
