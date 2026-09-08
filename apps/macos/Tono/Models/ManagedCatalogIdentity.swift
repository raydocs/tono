/// Stable identifiers for the managed catalog, shared by validation, storage and
/// UI state. Catalog processors must not depend on the AppState composition root.
nonisolated enum ManagedCatalogIdentity {
    static let regionID = "tono-managed-catalog"
    static let sourceID = "tono-managed-catalog"
}
