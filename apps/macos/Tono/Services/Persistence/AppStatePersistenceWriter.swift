import Foundation

actor AppStatePersistenceWriter {
    func saveRegions(_ regions: [ProxyRegion]) {
        ConfigStorage.shared.saveProxyRegions(regions)
    }

    func save(
        regions: [ProxyRegion],
        rules: [RuleItem],
        config: RuntimeConfig
    ) {
        let storage = ConfigStorage.shared
        storage.saveProxyRegions(regions)
        storage.saveRules(rules)
        storage.saveConfig(config)
    }
}
